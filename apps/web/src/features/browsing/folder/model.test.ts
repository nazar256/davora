import type { FileEntry } from "@davora/shared";
import { describe, expect, it } from "vitest";

import { folderReducer, type FolderEvent, type FolderKey, type FolderRequest, type FolderState } from "./model";

const key: FolderKey = { accountId: "alpha", cacheNamespace: "ns-alpha", path: "Docs" };
const contextToken = {};
const request = (generation: number, overrides: Partial<FolderKey> = {}): FolderRequest => ({
  key: { ...key, ...overrides },
  generation,
  contextToken
});
const items: FileEntry[] = [{ path: "Docs/a.txt", name: "a.txt", isFolder: false }];
const reduce = (events: FolderEvent[]): FolderState => events.reduce(folderReducer, { kind: "idle" });

describe("folder lifecycle model", () => {
  it("transitions an uncached request through initial loading to live ready", () => {
    expect(reduce([
      { type: "request-started", request: request(1) },
      { type: "live-response-accepted", request: request(1), items, message: "viewing" }
    ])).toEqual({ kind: "ready", key, contextToken, items, source: "live", message: "viewing" });
  });

  it("shows cached items while refreshing and retains them when refresh fails", () => {
    expect(reduce([
      { type: "request-started", request: request(1) },
      { type: "cached-snapshot-shown", request: request(1), items, cachedAt: "2026-01-01", mode: "online" },
      { type: "refresh-failed", request: request(1), items }
    ])).toEqual({ kind: "stale", key, contextToken, items, source: "cache", reason: "refresh-failed", cachedAt: "2026-01-01" });
  });

  it.each(["offline", "server-unavailable"] as const)("represents a %s cache-only snapshot distinctly", (reason) => {
    expect(reduce([
      { type: "request-started", request: request(1) },
      { type: "cached-snapshot-shown", request: request(1), items, mode: reason }
    ])).toEqual({ kind: "stale", key, contextToken, items, source: "cache", reason });
  });

  it("represents explicit-offline local items without cache provenance", () => {
    expect(reduce([
      { type: "request-started", request: request(1) },
      { type: "explicit-offline-snapshot-shown", request: request(1), items }
    ])).toEqual({ kind: "offline", key, contextToken, items, source: "explicit-offline" });
  });

  it.each(["live-failure", "offline-cache-miss", "server-cache-miss"] as const)("represents %s without contradictory item state", (reason) => {
    const error = new Error(reason);
    expect(reduce([
      { type: "request-started", request: request(1) },
      { type: "load-failed", request: request(1), error, reason }
    ])).toEqual({ kind: "failed", key, contextToken, error, reason });
  });

  it("ignores late results unless generation and complete key both match", () => {
    const current = reduce([
      { type: "request-started", request: request(2) },
      { type: "live-response-accepted", request: request(1), items, message: "viewing" },
      { type: "load-failed", request: request(2, { path: "Other" }), error: new Error("late"), reason: "live-failure" }
    ]);

    expect(current).toEqual({ kind: "initialLoading", request: request(2) });
  });

  it("cancels only the matching request and reset always returns idle", () => {
    const loading = reduce([{ type: "request-started", request: request(2) }]);
    expect(folderReducer(loading, { type: "request-cancelled", request: request(1) })).toBe(loading);
    expect(folderReducer(loading, { type: "request-cancelled", request: request(2) })).toEqual({ kind: "idle" });
    expect(folderReducer({ kind: "ready", key, contextToken, items, source: "live", message: "viewing" }, { type: "reset" })).toEqual({ kind: "idle" });
  });
});
