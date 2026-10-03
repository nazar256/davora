import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDeferred } from "../../../test/primitives";
import type { SearchKey } from "./model";
import type { SearchLoadOutcome, SearchPorts } from "./ports";
import { useSearch } from "./useSearch";

const key = (query: string, accountId = "alpha"): SearchKey => ({ accountId, cacheNamespace: `ns-${accountId}`, path: "Docs", query });
const item = (path: string) => ({ path, name: path.split("/").at(-1)!, isFolder: false, score: 1 });
const createPorts = (loadSearch: SearchPorts["loadSearch"]): SearchPorts => ({
  createAbortHandle: () => new AbortController(), loadSearch,
  readCachedSearch: vi.fn(), writeCachedSearch: vi.fn()
});

describe("useSearch", () => {
  it("masks and aborts a superseded query and ignores its late result", async () => {
    const old = createDeferred<SearchLoadOutcome>();
    let oldSignal: AbortSignal | undefined;
    const ports = createPorts(vi.fn<SearchPorts["loadSearch"]>(({ query, signal }) => {
      if (query === "old") { oldSignal = signal; return old.promise; }
      return Promise.resolve({ completeness: "complete" as const, kind: "success", items: [item("Docs/new.txt")] });
    }));
    const { result, rerender } = renderHook(({ searchKey }) => useSearch({ key: searchKey, token: "token", mode: "online", explicitOfflineItems: [], ports }), {
      initialProps: { searchKey: key("old") }
    });
    rerender({ searchKey: key("new") });
    expect(result.current.state.kind).toBe("searching");
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "ready", items: [item("Docs/new.txt")] }));
    expect(oldSignal?.aborted).toBe(true);
    old.resolve({ completeness: "complete" as const, kind: "success", items: [item("Docs/old.txt")] });
    await act(async () => { await old.promise; });
    expect(result.current.state).toMatchObject({ kind: "ready", items: [item("Docs/new.txt")] });
  });

  it("ignores a late terminal outcome after same-account token replacement", async () => {
    const old = createDeferred<SearchLoadOutcome>();
    const onSessionTerminated = vi.fn();
    const ports = createPorts(vi.fn<SearchPorts["loadSearch"]>(({ token }) => token === "old"
      ? old.promise
      : Promise.resolve({ completeness: "complete" as const, kind: "success", items: [item("Docs/new.txt")] })));
    const { result, rerender } = renderHook(({ searchKey, token }) => useSearch({ key: searchKey, token, mode: "online", explicitOfflineItems: [], ports, onSessionTerminated }), {
      initialProps: { searchKey: key("q"), token: "old" }
    });
    rerender({ searchKey: key("q"), token: "new" });
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "ready", items: [item("Docs/new.txt")] }));
    old.resolve({ kind: "unauthorized", error: new Error("expired") });
    await act(async () => { await old.promise; });
    expect(onSessionTerminated).not.toHaveBeenCalled();
  });

  it("aborts and ignores a late result after search-port replacement", async () => {
    const old = createDeferred<SearchLoadOutcome>();
    let oldSignal: AbortSignal | undefined;
    const oldPorts = createPorts(vi.fn<SearchPorts["loadSearch"]>((input) => {
      oldSignal = input.signal;
      return old.promise;
    }));
    const newPorts = createPorts(vi.fn<SearchPorts["loadSearch"]>(async () => ({ completeness: "complete" as const, kind: "success",
      items: [item("Docs/new-port.txt")]
    })));
    const { result, rerender } = renderHook(({ ports }) => useSearch({
      key: key("q"),
      token: "token",
      mode: "online",
      explicitOfflineItems: [],
      ports
    }), { initialProps: { ports: oldPorts } });

    await waitFor(() => expect(oldPorts.loadSearch).toHaveBeenCalled());
    rerender({ ports: newPorts });
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "ready", items: [item("Docs/new-port.txt")] }));

    expect(oldSignal?.aborted).toBe(true);
    old.resolve({ completeness: "complete" as const, kind: "success", items: [item("Docs/late-old-port.txt")] });
    await act(async () => { await old.promise; });
    expect(result.current.state).toMatchObject({ kind: "ready", items: [item("Docs/new-port.txt")] });
    expect(oldPorts.writeCachedSearch).not.toHaveBeenCalled();
    expect(newPorts.writeCachedSearch).toHaveBeenCalledWith("ns-alpha", "Docs", "q", [item("Docs/new-port.txt")]);
  });

  it.each([
    ["path", { ...key("q"), path: "Other" }],
    ["namespace", { ...key("q"), cacheNamespace: "ns-replaced" }],
    ["account", { ...key("q"), accountId: "beta" }]
  ] as const)("isolates late results after a %s-only replacement", async (_dimension, replacementKey) => {
    const old = createDeferred<SearchLoadOutcome>();
    const ports = createPorts(vi.fn<SearchPorts["loadSearch"]>(({ path }) => path === "Docs" && replacementKey.path !== "Docs"
      ? old.promise
      : vi.mocked(ports.loadSearch).mock.calls.length === 1
        ? old.promise
        : Promise.resolve({ completeness: "complete" as const, kind: "success", items: [item(`${replacementKey.path}/new.txt`)] })));
    const { result, rerender } = renderHook(({ searchKey }) => useSearch({ key: searchKey, token: "token", mode: "online", explicitOfflineItems: [], ports }), {
      initialProps: { searchKey: key("q") }
    });

    rerender({ searchKey: replacementKey });
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "ready", key: replacementKey }));
    old.resolve({ completeness: "complete" as const, kind: "success", items: [item("Docs/late.txt")] });
    await act(async () => { await old.promise; });

    expect(result.current.state).toMatchObject({ kind: "ready", key: replacementKey });
    expect(result.current.state.kind === "ready" ? result.current.state.items : []).not.toContainEqual(item("Docs/late.txt"));
    expect(ports.writeCachedSearch).toHaveBeenCalledTimes(1);
    expect(ports.writeCachedSearch).toHaveBeenCalledWith(
      replacementKey.cacheNamespace,
      replacementKey.path,
      replacementKey.query,
      [item(`${replacementKey.path}/new.txt`)]
    );
  });

  it("publishes changed explicit-offline snapshots without any I/O", async () => {
    const ports = createPorts(vi.fn<SearchPorts["loadSearch"]>());
    const first = [item("Docs/first.txt")];
    const second = [item("Docs/second.txt")];
    const { result, rerender } = renderHook(({ items }) => useSearch({ key: key("q"), mode: "explicit-offline", explicitOfflineItems: items, ports }), {
      initialProps: { items: first }
    });
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "offline", items: first }));
    rerender({ items: second });
    expect(result.current.state).toMatchObject({ kind: "offline", items: second });
    expect(ports.loadSearch).not.toHaveBeenCalled();
    expect(ports.readCachedSearch).not.toHaveBeenCalled();
  });

  it("keeps account-scoped results and cache writes isolated after account replacement", async () => {
    const old = createDeferred<SearchLoadOutcome>();
    const ports = createPorts(vi.fn<SearchPorts["loadSearch"]>(({ token }) => token === "token-alpha"
      ? old.promise
      : Promise.resolve({ completeness: "complete" as const, kind: "success", items: [item("Docs/beta.txt")] })));
    const alphaKey = key("q", "alpha");
    const betaKey: SearchKey = { ...key("q", "beta"), cacheNamespace: "ns-beta" };
    const { result, rerender } = renderHook(({ searchKey, token }) => useSearch({
      key: searchKey,
      token,
      mode: "online",
      explicitOfflineItems: [],
      ports
    }), { initialProps: { searchKey: alphaKey, token: "token-alpha" } });

    rerender({ searchKey: betaKey, token: "token-beta" });
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: "ready", key: betaKey, items: [item("Docs/beta.txt")] }));
    old.resolve({ completeness: "complete" as const, kind: "success", items: [item("Docs/alpha-late.txt")] });
    await act(async () => { await old.promise; });

    expect(result.current.state).toMatchObject({ kind: "ready", key: betaKey, items: [item("Docs/beta.txt")] });
    expect(ports.writeCachedSearch).toHaveBeenCalledTimes(1);
    expect(ports.writeCachedSearch).toHaveBeenCalledWith("ns-beta", "Docs", "q", [item("Docs/beta.txt")]);
  });

  it.each(["unauthorized", "reconnect-required"] as const)("terminates the current %s search exactly once", async (kind) => {
    const onSessionTerminated = vi.fn();
    const ports = createPorts(vi.fn<SearchPorts["loadSearch"]>(async () => ({ kind, error: new Error(kind) })));
    const { result } = renderHook(() => useSearch({
      key: key("q"),
      token: "token",
      mode: "online",
      explicitOfflineItems: [],
      ports,
      onSessionTerminated
    }));

    await waitFor(() => expect(result.current.state.kind).toBe("inactive"));
    expect(onSessionTerminated).toHaveBeenCalledTimes(1);
    expect(onSessionTerminated).toHaveBeenCalledWith(kind, expect.any(Error), expect.objectContaining({ accountId: "alpha" }), expect.any(Object));
    expect(ports.readCachedSearch).not.toHaveBeenCalled();
  });

  it("keeps whitespace and missing-token contexts inactive and aborts on unmount", () => {
    const deferred = createDeferred<SearchLoadOutcome>();
    let signal: AbortSignal | undefined;
    const ports = createPorts(vi.fn<SearchPorts["loadSearch"]>((input) => { signal = input.signal; return deferred.promise; }));
    const initialProps: { searchKey?: SearchKey; token?: string } = { token: "token" };
    const { result, rerender, unmount } = renderHook(({ searchKey, token }: { searchKey?: SearchKey; token?: string }) => useSearch({ key: searchKey, token, mode: "online", explicitOfflineItems: [], ports }), {
      initialProps
    });
    expect(result.current.state.kind).toBe("inactive");
    rerender({ searchKey: key("q"), token: undefined });
    expect(result.current.state.kind).toBe("inactive");
    rerender({ searchKey: key("q"), token: "token" });
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
