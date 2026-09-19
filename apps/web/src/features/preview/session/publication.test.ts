import { describe, expect, it } from "vitest";

import { createPreviewRequestKey, createPreviewSnapshot } from "./model";
import { DEFAULT_PREVIEW_CACHE_STATE, mapPreviewSessionPublication } from "./publication";

const key = createPreviewRequestKey({
  requestSequence: 1,
  accountId: "alpha",
  cacheNamespace: "ns",
  path: "Docs/report.txt",
  contextGeneration: "1",
  connectionMode: "online",
  heicPreviewEnabled: false,
  freshnessIntervalMs: 10_000,
  cacheLimitBytes: 1000
});

function snapshot(fingerprint: string) {
  return createPreviewSnapshot({
    preview: {
      path: key.path,
      name: "report.txt",
      isFolder: false,
      viewer: "text",
      content: fingerprint,
      encoding: "utf8",
      truncated: false,
      bytesRead: fingerprint.length
    },
    fingerprint,
    source: "inline"
  });
}

describe("mapPreviewSessionPublication", () => {
  it("maps closed to a cleared preview surface", () => {
    expect(mapPreviewSessionPublication({ kind: "closed" })).toEqual({
      selected: undefined,
      previewOpen: false,
      loadingPreview: false,
      previewError: undefined,
      pendingPreviewUpdate: undefined,
      previewCacheState: DEFAULT_PREVIEW_CACHE_STATE,
      clearOpenedEntry: true
    });
  });

  it("maps opening to a loading preview surface", () => {
    expect(mapPreviewSessionPublication({ kind: "opening", key })).toEqual({
      selected: undefined,
      previewOpen: true,
      loadingPreview: true,
      previewError: undefined,
      pendingPreviewUpdate: undefined,
      previewCacheState: DEFAULT_PREVIEW_CACHE_STATE,
      clearOpenedEntry: false
    });
  });

  it("maps cached states to cache UI facts", () => {
    const current = snapshot("cached");
    expect(mapPreviewSessionPublication({
      kind: "cached",
      key,
      current,
      status: "fresh",
      cachedAt: "2026-07-18T12:00:00.000Z"
    })).toMatchObject({
      selected: current.preview,
      previewOpen: true,
      loadingPreview: false,
      previewCacheState: {
        source: "cache",
        cachedAt: "2026-07-18T12:00:00.000Z",
        refreshing: false,
        stale: false,
        updateReady: false
      }
    });

    expect(mapPreviewSessionPublication({
      kind: "cached",
      key,
      current,
      status: "refreshing"
    }).previewCacheState).toMatchObject({ refreshing: true, stale: false });

    expect(mapPreviewSessionPublication({
      kind: "cached",
      key,
      current,
      status: "cache-only"
    }).previewCacheState.stale).toBe(true);

    expect(mapPreviewSessionPublication({
      kind: "cached",
      key,
      current,
      status: "refresh-failed"
    }).previewCacheState.stale).toBe(true);
  });

  it("maps live and refresh-ready states to their UI surfaces", () => {
    const current = snapshot("current");
    const next = snapshot("next");

    expect(mapPreviewSessionPublication({ kind: "live", key, current })).toMatchObject({
      selected: current.preview,
      previewOpen: true,
      previewCacheState: { source: "live", refreshing: false, stale: false, updateReady: false }
    });

    expect(mapPreviewSessionPublication({
      kind: "refresh-ready",
      key,
      current,
      next,
      cachedAt: "2026-07-18T12:00:00.000Z"
    })).toMatchObject({
      selected: current.preview,
      pendingPreviewUpdate: { file: next.preview },
      previewCacheState: {
        source: "cache",
        cachedAt: "2026-07-18T12:00:00.000Z",
        stale: true,
        updateReady: true
      }
    });
  });

  it("maps failed to an error surface without clearing opened entry", () => {
    const publication = mapPreviewSessionPublication({ kind: "failed", key, message: "Preview unavailable" });
    expect(publication.previewOpen).toBe(true);
    expect(publication.previewError?.message).toBe("Preview unavailable");
    expect(publication.clearOpenedEntry).toBe(false);
  });
});
