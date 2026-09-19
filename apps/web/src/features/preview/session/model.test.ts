import { describe, expect, it } from "vitest";

import {
  createPreviewRequestKey,
  createPreviewSessionState,
  createPreviewSnapshot,
  normalizePreviewPath,
  samePreviewRequestKey,
  type PreviewSessionState
} from "./model";

const preview = {
  path: "Projects/report.txt",
  name: "report.txt",
  isFolder: false,
  viewer: "text" as const,
  content: "hello",
  encoding: "utf8" as const,
  truncated: false,
  bytesRead: 5
};

describe("preview-session model", () => {
  it("normalizes a complete request identity without accepting tokens or stream URLs", () => {
    const first = createPreviewRequestKey({
      requestSequence: 4,
      accountId: "account-a",
      cacheNamespace: "cache-a",
      path: "/Projects/report.txt/",
      contextGeneration: "session-generation-opaque",
      connectionMode: "online",
      heicPreviewEnabled: true,
      freshnessIntervalMs: 30_000,
      cacheLimitBytes: 1024
    });
    const same = createPreviewRequestKey({ ...first, path: "Projects/report.txt" });
    const next = createPreviewRequestKey({ ...first, requestSequence: 5 });

    expect(first.path).toBe("Projects/report.txt");
    expect(samePreviewRequestKey(first, same)).toBe(true);
    expect(samePreviewRequestKey(first, next)).toBe(false);
    expect(JSON.stringify(first)).not.toContain("token");
    expect(normalizePreviewPath("///Projects/report.txt///")).toBe("Projects/report.txt");
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("represents only explicit session states and deeply snapshots preview facts", () => {
    const current = createPreviewSnapshot({ preview, fingerprint: "v1", source: "inline" });
    const next = createPreviewSnapshot({ preview: { ...preview, content: "new" }, fingerprint: "v2", source: "blob" });
    const states: readonly PreviewSessionState[] = [
      { kind: "closed" },
      { kind: "opening", key: createPreviewRequestKey({ requestSequence: 1, accountId: "a", cacheNamespace: "c", path: "x", contextGeneration: "g", connectionMode: "online", heicPreviewEnabled: false, freshnessIntervalMs: 1, cacheLimitBytes: 1 }) },
      { kind: "cached", key: createPreviewRequestKey({ requestSequence: 2, accountId: "a", cacheNamespace: "c", path: "x", contextGeneration: "g", connectionMode: "cache-only", heicPreviewEnabled: false, freshnessIntervalMs: 1, cacheLimitBytes: 1 }), current, status: "cache-only", cachedAt: "2026-07-18T12:00:00.000Z" },
      { kind: "live", key: createPreviewRequestKey({ requestSequence: 3, accountId: "a", cacheNamespace: "c", path: "x", contextGeneration: "g", connectionMode: "online", heicPreviewEnabled: false, freshnessIntervalMs: 1, cacheLimitBytes: 1 }), current },
      { kind: "refresh-ready", key: createPreviewRequestKey({ requestSequence: 4, accountId: "a", cacheNamespace: "c", path: "x", contextGeneration: "g", connectionMode: "online", heicPreviewEnabled: false, freshnessIntervalMs: 1, cacheLimitBytes: 1 }), current, next, cachedAt: "2026-07-18T12:00:00.000Z" },
      { kind: "failed", key: createPreviewRequestKey({ requestSequence: 5, accountId: "a", cacheNamespace: "c", path: "x", contextGeneration: "g", connectionMode: "online", heicPreviewEnabled: false, freshnessIntervalMs: 1, cacheLimitBytes: 1 }), message: "unavailable" }
    ];

    preview.content = "mutated";
    expect(current.preview.content).toBe("hello");
    expect(states.map((state) => state.kind)).toEqual(["closed", "opening", "cached", "live", "refresh-ready", "failed"]);
    expect(Object.isFrozen(current)).toBe(true);
    expect(Object.isFrozen(current.preview)).toBe(true);
    const refreshReady = createPreviewSessionState(states[4]);
    expect(Object.isFrozen(refreshReady)).toBe(true);
    expect(refreshReady).toMatchObject({ kind: "refresh-ready", cachedAt: "2026-07-18T12:00:00.000Z" });
  });
});
