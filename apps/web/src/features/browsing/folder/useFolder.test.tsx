import type { FileEntry } from "@davora/shared";
import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDeferred } from "../../../test/primitives";
import type { FolderKey } from "./model";
import type { FolderLoadOutcome, FolderPorts } from "./ports";
import { useFolder } from "./useFolder";

const key = (path: string): FolderKey => ({ accountId: "alpha", cacheNamespace: "ns-alpha", path });
const liveItems: FileEntry[] = [{ path: "Docs/live.txt", name: "live.txt", isFolder: false }];
const noOfflineItems: FileEntry[] = [];

const createPorts = (loadFolder: FolderPorts["loadFolder"]): FolderPorts => ({
  createAbortHandle: () => new AbortController(),
  loadFolder,
  readCachedFolder: vi.fn(() => undefined),
  writeCachedFolder: vi.fn()
});

describe("useFolder", () => {
  it("loads the current folder and exposes forced reload", async () => {
    const ports = createPorts(vi.fn<FolderPorts["loadFolder"]>(async () => ({
      kind: "success",
      items: liveItems
    })));
    const { result } = renderHook(() => useFolder({
      key: key("Docs"),
      token: "token",
      mode: "online",
      explicitOfflineItems: noOfflineItems,
      ports
    }));

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    vi.mocked(ports.readCachedFolder).mockClear();
    await act(async () => { await result.current.reload({ preferCache: false }); });
    expect(ports.readCachedFolder).not.toHaveBeenCalled();
    expect(ports.loadFolder).toHaveBeenCalledTimes(2);
  });

  it("aborts a replaced path and ignores its late response", async () => {
    const oldLoad = createDeferred<FolderLoadOutcome>();
    let oldSignal: AbortSignal | undefined;
    const ports = createPorts(vi.fn<FolderPorts["loadFolder"]>(({ path, signal }) => {
      if (path === "Old") {
        oldSignal = signal;
        return oldLoad.promise;
      }
      return Promise.resolve({ kind: "success", items: liveItems });
    }));
    const { result, rerender } = renderHook(({ folderKey }) => useFolder({
      key: folderKey,
      token: "token",
      mode: "online",
      explicitOfflineItems: noOfflineItems,
      ports
    }), { initialProps: { folderKey: key("Old") } });

    rerender({ folderKey: key("New") });
    expect(result.current.state.kind === "ready" ? result.current.state.items : []).not.toContainEqual(
      expect.objectContaining({ path: "Old/late" })
    );
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "ready", key: key("New") }));
    expect(oldSignal?.aborted).toBe(true);
    oldLoad.resolve({ kind: "success", items: [{ path: "Old/late", name: "late", isFolder: false }] });
    await act(async () => { await oldLoad.promise; });
    expect(result.current.state).toMatchObject({ kind: "ready", key: key("New"), items: liveItems });
  });

  it("suppresses previous folder items as soon as the complete key changes", async () => {
    const replacement = createDeferred<FolderLoadOutcome>();
    const oldItems: FileEntry[] = [{ path: "Old/item.txt", name: "item.txt", isFolder: false }];
    const ports = createPorts(vi.fn<FolderPorts["loadFolder"]>(({ path }) => path === "Old"
      ? Promise.resolve({ kind: "success", items: oldItems })
      : replacement.promise));
    const { result, rerender } = renderHook(({ folderKey }) => useFolder({
      key: folderKey,
      token: "token",
      mode: "online",
      explicitOfflineItems: noOfflineItems,
      ports
    }), { initialProps: { folderKey: key("Old") } });
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "ready", items: oldItems }));

    rerender({ folderKey: { accountId: "beta", cacheNamespace: "ns-beta", path: "New" } });

    expect(result.current.state.kind).toBe("initialLoading");
  });

  it("keeps terminal callbacks bound to the request that started them", async () => {
    const deferred = createDeferred<FolderLoadOutcome>();
    const firstCallback = vi.fn();
    const replacementCallback = vi.fn();
    const ports = createPorts(vi.fn<FolderPorts["loadFolder"]>(() => deferred.promise));
    const { rerender } = renderHook(({ callback }) => useFolder({
      key: key("Docs"),
      token: "token",
      mode: "online",
      explicitOfflineItems: noOfflineItems,
      ports,
      onSessionTerminated: callback
    }), { initialProps: { callback: firstCallback } });

    rerender({ callback: replacementCallback });
    deferred.resolve({ kind: "unauthorized", error: new Error("expired") });
    await waitFor(() => expect(firstCallback).toHaveBeenCalledOnce());
    expect(replacementCallback).not.toHaveBeenCalled();
  });

  it("suppresses token-A state and ignores its late terminal result after token replacement", async () => {
    const tokenA = createDeferred<FolderLoadOutcome>();
    const tokenBItems: FileEntry[] = [{ path: "Docs/token-b.txt", name: "token-b.txt", isFolder: false }];
    const onSessionTerminated = vi.fn();
    let tokenASignal: AbortSignal | undefined;
    const ports = createPorts(vi.fn<FolderPorts["loadFolder"]>(({ token, signal }) => {
      if (token === "token-a") {
        tokenASignal = signal;
        return tokenA.promise;
      }
      return Promise.resolve({ kind: "success", items: tokenBItems });
    }));
    const { result, rerender } = renderHook(({ token }) => useFolder({
      key: key("Docs"),
      token,
      mode: "online",
      explicitOfflineItems: noOfflineItems,
      ports,
      onSessionTerminated
    }), { initialProps: { token: "token-a" } });

    rerender({ token: "token-b" });
    expect(result.current.state.kind).toBe("initialLoading");
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "ready", items: tokenBItems }));
    expect(tokenASignal?.aborted).toBe(true);

    tokenA.resolve({ kind: "unauthorized", error: new Error("old token expired") });
    await act(async () => { await tokenA.promise; });
    expect(onSessionTerminated).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ kind: "ready", items: tokenBItems });
  });

  it("reports worker availability only for the current folder context", async () => {
    const oldLoad = createDeferred<FolderLoadOutcome>();
    const availability = { unavailable: vi.fn(), available: vi.fn() };
    const ports = createPorts(vi.fn<FolderPorts["loadFolder"]>(({ path }) => path === "Old"
      ? oldLoad.promise
      : Promise.resolve({ kind: "success", items: liveItems })));
    const { result, rerender } = renderHook(({ folderKey }) => useFolder({
      key: folderKey,
      token: "token",
      mode: "online",
      explicitOfflineItems: noOfflineItems,
      ports,
      onWorkerUnavailable: availability.unavailable,
      onWorkerAvailable: availability.available
    }), { initialProps: { folderKey: key("Old") } });

    rerender({ folderKey: key("New") });
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "ready", key: key("New") }));
    oldLoad.resolve({ kind: "transient", error: new Error("server down") });
    await act(async () => { await oldLoad.promise; });

    expect(availability.unavailable).not.toHaveBeenCalled();
    expect(availability.available).toHaveBeenCalledOnce();
  });

  it("aborts StrictMode replay work and leaves the final owner cancellable", async () => {
    const deferred = createDeferred<FolderLoadOutcome>();
    const controllers: AbortController[] = [];
    const ports: FolderPorts = {
      createAbortHandle: () => {
        const controller = new AbortController();
        controllers.push(controller);
        return controller;
      },
      loadFolder: vi.fn(() => deferred.promise),
      readCachedFolder: vi.fn(() => undefined),
      writeCachedFolder: vi.fn()
    };
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { unmount } = renderHook(() => useFolder({
      key: key("Docs"),
      token: "token",
      mode: "online",
      explicitOfflineItems: noOfflineItems,
      ports
    }), { wrapper });

    await waitFor(() => expect(controllers.length).toBeGreaterThanOrEqual(2));
    expect(controllers[0]?.signal.aborted).toBe(true);
    expect(controllers.at(-1)?.signal.aborted).toBe(false);
    unmount();
    expect(controllers.at(-1)?.signal.aborted).toBe(true);
  });

  it("hides revoked explicit-offline items before publishing the smaller snapshot", async () => {
    const firstItems: FileEntry[] = [
      { path: "Docs/kept.txt", name: "kept.txt", isFolder: false },
      { path: "Docs/revoked.txt", name: "revoked.txt", isFolder: false }
    ];
    const remainingItems: FileEntry[] = [firstItems[0]];
    const ports = createPorts(vi.fn<FolderPorts["loadFolder"]>());
    const { result, rerender } = renderHook(({ items }) => useFolder({
      key: key("Docs"),
      mode: "explicit-offline",
      explicitOfflineItems: items,
      ports
    }), { initialProps: { items: firstItems } });
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "offline", items: firstItems }));

    rerender({ items: remainingItems });
    expect(result.current.state).toMatchObject({ kind: "offline", items: remainingItems });
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "offline", items: remainingItems }));
  });

  it("aborts active work before publishing explicit-offline items", async () => {
    const onlineLoad = createDeferred<FolderLoadOutcome>();
    let onlineSignal: AbortSignal | undefined;
    const ports = createPorts(vi.fn<FolderPorts["loadFolder"]>(({ signal }) => {
      onlineSignal = signal;
      return onlineLoad.promise;
    }));
    const offlineItems = [{ path: "Docs/local.txt", name: "local.txt", isFolder: false }];
    const { result, rerender } = renderHook(({ mode }: { mode: "online" | "explicit-offline" }) => useFolder({
      key: key("Docs"),
      token: mode === "online" ? "token" : undefined,
      mode,
      explicitOfflineItems: offlineItems,
      ports
    }), { initialProps: { mode: "online" } });

    rerender({ mode: "explicit-offline" });
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "offline", items: offlineItems }));
    expect(onlineSignal?.aborted).toBe(true);
    expect(ports.loadFolder).toHaveBeenCalledOnce();
  });

  it("aborts active work on unmount", () => {
    const deferred = createDeferred<FolderLoadOutcome>();
    let signal: AbortSignal | undefined;
    const ports = createPorts(vi.fn<FolderPorts["loadFolder"]>((input) => {
      signal = input.signal;
      return deferred.promise;
    }));
    const { unmount } = renderHook(() => useFolder({
      key: key("Docs"),
      token: "token",
      mode: "online",
      explicitOfflineItems: noOfflineItems,
      ports
    }));

    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
