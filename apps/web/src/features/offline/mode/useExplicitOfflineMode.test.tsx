// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useExplicitOfflineMode } from "./useExplicitOfflineMode";
import {
  EXPLICIT_OFFLINE_STORAGE_UNAVAILABLE_STATUS,
  EXPLICIT_OFFLINE_TRANSITION_FAILED_STATUS
} from "./controller";

describe("useExplicitOfflineMode", () => {
  it("keeps account-keyed mode disabled without reading storage when no account exists", () => {
    const network = { setBlocked: vi.fn() };
    const storage = {
      read: vi.fn(() => ({ kind: "failed" as const, reason: "corrupt" as const, error: new Error("corrupt") })),
      commit: vi.fn(),
      reset: vi.fn(),
      repair: vi.fn()
    };
    const { result } = renderHook(() => useExplicitOfflineMode({
      ports: {
        storage,
        network,
        entry: {
          pauseFolderAudio: vi.fn(), closeDestinationPicker: vi.fn(), clearActionDialog: vi.fn(), closePreview: vi.fn(),
          setWorkerUnavailable: vi.fn(), failActiveTransfers: vi.fn(), setStatus: vi.fn()
        }
      }
    }));

    expect(result.current.enabled).toBe(false);
    expect(result.current.storageState).toBe("ready");
    expect(storage.read).not.toHaveBeenCalled();
    expect(network.setBlocked).toHaveBeenLastCalledWith(false);
  });

  it("restores each account's gate synchronously before passive effects and does not bleed state", async () => {
    const enabled = new Set(["alpha"]);
    const network = { setBlocked: vi.fn() };
    const ports = {
      storage: {
        read: (accountId: string | undefined) => ({ kind: "ready" as const, enabled: Boolean(accountId && enabled.has(accountId)) }),
        commit: (accountId: string, value: boolean) => {
          if (value) enabled.add(accountId);
          else enabled.delete(accountId);
          return { kind: "committed" as const };
        },
        repair: () => ({ kind: "repaired" as const })
        , reset: () => ({ kind: "committed" as const })
      },
      network,
      entry: {
        pauseFolderAudio: vi.fn(),
        closeDestinationPicker: vi.fn(),
        clearActionDialog: vi.fn(),
        closePreview: vi.fn(),
        setWorkerUnavailable: vi.fn(),
        failActiveTransfers: vi.fn(),
        setStatus: vi.fn()
      }
    };
    const alpha = { id: "alpha", displayName: "Alpha" };
    const beta = { id: "beta", displayName: "Beta" };
    const { result, rerender } = renderHook(({ account }) => useExplicitOfflineMode({ activeAccount: account, ports }), {
      initialProps: { account: alpha }
    });

    expect(result.current.enabled).toBe(true);
    expect(network.setBlocked).toHaveBeenLastCalledWith(true);

    rerender({ account: beta });
    expect(result.current.enabled).toBe(false);
    expect(network.setBlocked).toHaveBeenLastCalledWith(false);

    await act(async () => {
      result.current.setEnabled(true);
    });
    expect(result.current.enabled).toBe(true);
    expect(network.setBlocked).toHaveBeenLastCalledWith(true);
    expect(enabled).toEqual(new Set(["alpha", "beta"]));
  });

  it("fails closed when startup storage read fails without mutating storage", () => {
    const network = { setBlocked: vi.fn() };
    const setStatus = vi.fn();
    const storage = {
      read: vi.fn(() => ({ kind: "failed" as const, reason: "unavailable" as const, error: new Error("blocked") })),
      commit: vi.fn(() => ({ kind: "failed" as const, error: new Error("blocked") })),
      reset: vi.fn(() => ({ kind: "failed" as const, error: new Error("blocked") })),
      repair: vi.fn(() => ({ kind: "failed" as const, error: new Error("blocked") }))
    };
    const { result } = renderHook(() => useExplicitOfflineMode({
      activeAccount: { id: "alpha", displayName: "Alpha" },
      ports: {
        storage,
        network,
        entry: {
          pauseFolderAudio: vi.fn(), closeDestinationPicker: vi.fn(), clearActionDialog: vi.fn(), closePreview: vi.fn(),
          setWorkerUnavailable: vi.fn(), failActiveTransfers: vi.fn(), setStatus
        }
      }
    }));

    expect(result.current.enabled).toBe(true);
    expect(result.current.storageState).toBe("fail-closed");
    expect(result.current.storageError).toMatchObject({ message: "blocked" });
    expect(network.setBlocked).toHaveBeenLastCalledWith(true);
    expect(storage.commit).not.toHaveBeenCalled();
    expect(storage.repair).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(EXPLICIT_OFFLINE_STORAGE_UNAVAILABLE_STATUS);
  });

  it("stays blocked and reports a repair failure", () => {
    const network = { setBlocked: vi.fn() };
    const storage = {
      read: vi.fn(() => ({ kind: "ready" as const, enabled: false, repair: { kind: "write" as const, value: '["alpha"]' } })),
      commit: vi.fn(() => ({ kind: "committed" as const })),
      reset: vi.fn(() => ({ kind: "committed" as const })),
      repair: vi.fn(() => ({ kind: "failed" as const, error: new Error("quota") }))
    };
    const { result } = renderHook(() => useExplicitOfflineMode({
      activeAccount: { id: "alpha", displayName: "Alpha" },
      ports: {
        storage,
        network,
        entry: {
          pauseFolderAudio: vi.fn(), closeDestinationPicker: vi.fn(), clearActionDialog: vi.fn(), closePreview: vi.fn(),
          setWorkerUnavailable: vi.fn(), failActiveTransfers: vi.fn(), setStatus: vi.fn()
        }
      }
    }));

    expect(result.current.enabled).toBe(true);
    expect(result.current.storageState).toBe("fail-closed");
    expect(network.setBlocked).toHaveBeenLastCalledWith(true);
    expect(result.current.transitionError).toMatchObject({ message: "quota" });
  });

  it("reports a retryable status when a mode transition cannot be persisted", () => {
    const setStatus = vi.fn();
    const storage = {
      read: vi.fn(() => ({ kind: "ready" as const, enabled: false })),
      commit: vi.fn(() => ({ kind: "failed" as const, reason: "unavailable" as const, error: new Error("quota") })),
      reset: vi.fn(() => ({ kind: "committed" as const })),
      repair: vi.fn(() => ({ kind: "repaired" as const }))
    };
    const { result } = renderHook(() => useExplicitOfflineMode({
      activeAccount: { id: "alpha", displayName: "Alpha" },
      ports: {
        storage,
        network: { setBlocked: vi.fn() },
        entry: {
          pauseFolderAudio: vi.fn(), closeDestinationPicker: vi.fn(), clearActionDialog: vi.fn(), closePreview: vi.fn(),
          setWorkerUnavailable: vi.fn(), failActiveTransfers: vi.fn(), setStatus
        }
      }
    }));

    act(() => {
      result.current.setEnabled(true);
    });

    expect(result.current.enabled).toBe(false);
    expect(result.current.transitionError).toMatchObject({ message: "quota" });
    expect(setStatus).toHaveBeenCalledWith(EXPLICIT_OFFLINE_TRANSITION_FAILED_STATUS);
  });
});
