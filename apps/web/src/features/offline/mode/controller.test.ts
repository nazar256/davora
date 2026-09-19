import { describe, expect, it, vi } from "vitest";

import {
  EXPLICIT_OFFLINE_TRANSFER_TERMINAL_MESSAGE,
  setExplicitOfflineMode
} from "./controller";
import type { ExplicitOfflineModePorts, ExplicitOfflineModeStorageCommit } from "./ports";

function ports(order: string[]): ExplicitOfflineModePorts & {
  readonly storageCommit: ReturnType<typeof vi.fn>;
  readonly storageRead: ReturnType<typeof vi.fn>;
  readonly storageReset: ReturnType<typeof vi.fn>;
} {
  const storageCommit = vi.fn((_accountId: string, enabled: boolean): ExplicitOfflineModeStorageCommit => {
    order.push(`persist:${enabled}`);
    return { kind: "committed" };
  });
  const storageRead = vi.fn((_accountId?: string) => ({ kind: "ready" as const, enabled: false }));
  const storageReset = vi.fn((): ExplicitOfflineModeStorageCommit => ({ kind: "committed" }));
  return {
    storage: {
      commit: storageCommit,
      read: storageRead,
      reset: storageReset,
      repair: vi.fn(() => ({ kind: "repaired" as const }))
    },
    network: {
      setBlocked: vi.fn((blocked: boolean) => order.push(`gate:${blocked}`))
    },
    entry: {
      pauseFolderAudio: vi.fn(() => order.push("pause")),
      closeDestinationPicker: vi.fn(() => order.push("destination")),
      clearActionDialog: vi.fn(() => order.push("action")),
      closePreview: vi.fn(() => order.push("preview")),
      setWorkerUnavailable: vi.fn((unavailable: boolean) => order.push(`worker:${unavailable}`)),
      failActiveTransfers: vi.fn(() => order.push("transfers")),
      setStatus: vi.fn((message: string) => order.push(`status:${message}`))
    },
    storageCommit,
    storageRead,
    storageReset
  };
}

describe("explicit offline mode controller", () => {
  it("persists and gates before the complete entry-only cleanup transaction", () => {
    const order: string[] = [];
    const input = ports(order);

    setExplicitOfflineMode({ id: "alpha", displayName: "Alpha" }, true, input, () => order.push("feature"));

    expect(order).toEqual([
      "persist:true",
      "gate:true",
      "feature",
      "pause",
      "destination",
      "action",
      "preview",
      "worker:false",
      "transfers",
      "status:Explicit offline mode enabled for Alpha."
    ]);
    expect(input.entry.failActiveTransfers).toHaveBeenCalledWith("alpha", EXPLICIT_OFFLINE_TRANSFER_TERMINAL_MESSAGE);
  });

  it("reopens the gate without running entry cleanup when disabling", () => {
    const order: string[] = [];
    const input = ports(order);

    setExplicitOfflineMode({ id: "alpha", displayName: "Alpha" }, false, input);

    expect(order).toEqual([
      "persist:false",
      "gate:false",
      "status:Returning Alpha online."
    ]);
    expect(input.entry.pauseFolderAudio).not.toHaveBeenCalled();
    expect(input.entry.failActiveTransfers).not.toHaveBeenCalled();
  });

  it("keeps the previous state and performs no success effects when persistence fails", () => {
    const order: string[] = [];
    const input = ports(order);
    input.storageCommit.mockReturnValue({ kind: "failed", error: new Error("quota") });

    expect(setExplicitOfflineMode({ id: "alpha", displayName: "Alpha" }, true, input)).toMatchObject({ kind: "failed" });
    expect(order).toEqual([]);
    expect(input.network.setBlocked).not.toHaveBeenCalled();
    expect(input.entry.failActiveTransfers).not.toHaveBeenCalled();
    expect(input.entry.setStatus).not.toHaveBeenCalled();

    input.storageCommit.mockClear();
    expect(setExplicitOfflineMode({ id: "alpha", displayName: "Alpha" }, false, input)).toMatchObject({ kind: "failed" });
    expect(order).toEqual([]);
    expect(input.network.setBlocked).not.toHaveBeenCalled();
    expect(input.entry.setStatus).not.toHaveBeenCalled();
  });

  it("uses explicit Go-online reset for corrupt storage", () => {
    const order: string[] = [];
    const input = ports(order);
    input.storageRead.mockReturnValue({ kind: "failed", reason: "corrupt", error: new Error("corrupt") });

    expect(setExplicitOfflineMode({ id: "alpha", displayName: "Alpha" }, false, input)).toEqual({ kind: "committed", enabled: false });
    expect(input.storage.reset).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["gate:false", "status:Returning Alpha online."]);
  });

  it("keeps corrupt storage fail-closed when reset fails and exposes no success status", () => {
    const order: string[] = [];
    const input = ports(order);
    input.storageRead.mockReturnValue({ kind: "failed", reason: "corrupt", error: new Error("corrupt") });
    input.storageReset.mockReturnValue({ kind: "failed", reason: "unavailable", error: new Error("blocked") });

    expect(setExplicitOfflineMode({ id: "alpha", displayName: "Alpha" }, false, input)).toMatchObject({ kind: "failed" });
    expect(input.network.setBlocked).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });
});
