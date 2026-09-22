import { describe, expect, it, vi } from "vitest";

import { PreviewSessionController } from "./controller";
import { createPreviewSnapshot, type PreviewSessionState } from "./model";
import type { PreviewAcquisition, PreviewCacheEntry, PreviewCacheEvent, PreviewCacheSnapshot, PreviewCacheWriteResult, PreviewFailure, PreviewSessionPorts } from "./ports";

const request = {
  accountId: "account-a",
  cacheNamespace: "cache-a",
  path: "Projects/report.txt",
  contextGeneration: "opaque-session-generation",
  connectionMode: "online" as const,
  heicPreviewEnabled: false,
  freshnessIntervalMs: 10_000,
  cacheLimitBytes: 1000,
  target: "previewable" as const
};

function acquisition(fingerprint: string, source: "inline" | "blob" | "stream" = "inline"): PreviewAcquisition {
  return {
    snapshot: createPreviewSnapshot({
      preview: {
        path: request.path,
        name: "report.txt",
        isFolder: false,
        viewer: "text",
        content: fingerprint,
        encoding: "utf8",
        truncated: false,
        bytesRead: fingerprint.length
      },
      fingerprint,
      source
    }),
    ...(source === "inline" ? {} : { material: { id: `material-${fingerprint}`, kind: source } })
  };
}

function cacheEntry(value: PreviewAcquisition, cachedAtMs = 0, cachedAt = "2026-07-18T12:00:00.000Z"): PreviewCacheEntry {
  return { acquisition: value, cachedAt, cachedAtMs };
}

function cacheSnapshot(): PreviewCacheSnapshot {
  return { itemCount: 1, totalBytes: 5, limitBytes: 1000 };
}

function cacheWriteResult(snapshot = cacheSnapshot()): PreviewCacheWriteResult {
  return { kind: "stored", snapshot };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function ports(overrides: Partial<PreviewSessionPorts> = {}): PreviewSessionPorts & {
  published: PreviewSessionState[];
  cacheSnapshots: PreviewCacheSnapshot[];
  cacheEvents: PreviewCacheEvent[];
  publishedFailures: PreviewFailure[];
  releases: string[];
  aborts: string[];
} {
  const published: PreviewSessionState[] = [];
  const cacheSnapshots: PreviewCacheSnapshot[] = [];
  const cacheEvents: PreviewCacheEvent[] = [];
  const publishedFailures: PreviewFailure[] = [];
  const releases: string[] = [];
  const aborts: string[] = [];
  let abortCount = 0;
  return {
    cache: {
      read: vi.fn(async () => undefined),
      write: vi.fn(async () => cacheWriteResult())
    },
    live: {
      acquire: vi.fn(async () => acquisition("live"))
    },
    abort: {
      create: vi.fn(() => {
        const id = `abort-${++abortCount}`;
        return { id, abort: () => aborts.push(id) };
      })
    },
    resources: {
      apply: vi.fn((material) => ({ id: `resource-${material.id}`, kind: material.kind })),
      release: vi.fn((resource) => releases.push(resource.id))
    },
    current: { isCurrent: () => true },
    failures: { classify: (error) => ({ kind: "ordinary", message: error instanceof Error ? error.message : "unavailable" }) },
    failurePublication: { publishFailure: (_key, failure) => { publishedFailures.push(failure); return true; } },
    publication: { publish: (state) => { published.push(state); return true; } },
    cachePublication: {
      publishSnapshot: (_key, snapshot) => { cacheSnapshots.push(snapshot); return true; },
      publishEvent: (event) => { cacheEvents.push(event); return true; }
    },
    clock: { now: () => 10_001 },
    published,
    cacheSnapshots,
    cacheEvents,
    publishedFailures,
    releases,
    aborts,
    ...overrides
  };
}

describe("PreviewSessionController", () => {
  it("uses a fresh cache without live work and snapshots the current cache state", async () => {
    const exactCachedAt = "2020-01-01T00:00:00.000Z";
    const adapter = ports({ cache: { read: vi.fn(async () => cacheEntry(acquisition("cached"), 5_000, exactCachedAt)), write: vi.fn(async () => cacheWriteResult()) } });
    const controller = new PreviewSessionController(adapter);

    const outcome = await controller.open(request);

    expect(outcome.kind).toBe("opened");
    expect(adapter.live.acquire).not.toHaveBeenCalled();
    expect(adapter.published.at(-1)).toMatchObject({ kind: "cached", status: "fresh", current: { fingerprint: "cached" }, cachedAt: exactCachedAt });
  });

  it("uses a cache-only entry without live work and fails only when no readable cache exists", async () => {
    const cachedAdapter = ports({ cache: { read: vi.fn(async () => cacheEntry(acquisition("cached"), 0)), write: vi.fn(async () => cacheWriteResult()) } });
    const cached = new PreviewSessionController(cachedAdapter);
    await cached.open({ ...request, connectionMode: "cache-only" });
    expect(cachedAdapter.live.acquire).not.toHaveBeenCalled();
    expect(cachedAdapter.published.at(-1)).toMatchObject({ kind: "cached", status: "cache-only" });

    const missingAdapter = ports();
    const missing = new PreviewSessionController(missingAdapter);
    await expect(missing.open({ ...request, connectionMode: "cache-only" })).resolves.toMatchObject({ kind: "failed" });
    expect(missingAdapter.live.acquire).not.toHaveBeenCalled();
    expect(missingAdapter.published.at(-1)).toMatchObject({ kind: "failed" });
  });

  it("shows stale cache immediately, keeps it after a refresh failure, and never applies a pending update", async () => {
    const refresh = deferred<PreviewAcquisition>();
    const adapter = ports({
      cache: { read: vi.fn(async () => cacheEntry(acquisition("cached", "blob"), 0)), write: vi.fn(async () => cacheWriteResult()) },
      live: { acquire: vi.fn(() => refresh.promise) }
    });
    const controller = new PreviewSessionController(adapter);

    await controller.open(request);
    expect(adapter.published.at(-1)).toMatchObject({ kind: "cached", status: "refreshing" });
    refresh.reject(new Error("offline"));
    await controller.waitForBackground();

    expect(adapter.published.at(-1)).toMatchObject({ kind: "cached", status: "refresh-failed", current: { fingerprint: "cached" } });
    expect(adapter.resources.apply).toHaveBeenCalledTimes(1);
    expect(adapter.releases).toEqual([]);
  });

  it("holds a changed non-stream refresh until explicitly applied, but verifies an unchanged refresh", async () => {
    const exactCachedAt = "2026-07-18T09:00:00.000Z";
    const changedAdapter = ports({
      cache: { read: vi.fn(async () => cacheEntry(acquisition("old", "blob"), 0, exactCachedAt)), write: vi.fn(async () => cacheWriteResult()) },
      live: { acquire: vi.fn(async () => acquisition("new", "blob")) }
    });
    const changed = new PreviewSessionController(changedAdapter);
    await changed.open(request);
    await changed.waitForBackground();
    expect(changedAdapter.published.at(-1)).toMatchObject({ kind: "refresh-ready", current: { fingerprint: "old" }, next: { fingerprint: "new" }, cachedAt: exactCachedAt });
    expect(changedAdapter.resources.apply).toHaveBeenCalledTimes(1);
    await expect(changed.applyRefresh()).resolves.toMatchObject({ kind: "applied" });
    expect(changedAdapter.published.at(-1)).toMatchObject({ kind: "live", current: { fingerprint: "new" } });
    expect("cachedAt" in (changedAdapter.published.at(-1) ?? {})).toBe(false);
    expect(changedAdapter.releases).toEqual(["resource-material-old"]);

    const sameAdapter = ports({
      cache: { read: vi.fn(async () => cacheEntry(acquisition("same", "blob"), 0)), write: vi.fn(async () => cacheWriteResult()) },
      live: { acquire: vi.fn(async () => acquisition("same", "blob")) }
    });
    const same = new PreviewSessionController(sameAdapter);
    await same.open(request);
    await same.waitForBackground();
    expect(sameAdapter.published.at(-1)).toMatchObject({ kind: "cached", status: "verified", current: { fingerprint: "same" } });
    expect(sameAdapter.resources.apply).toHaveBeenCalledTimes(1);
  });

  it("replaces stale streams directly, then publishes current cache accounting and readiness", async () => {
    const adapter = ports({
      cache: { read: vi.fn(async () => cacheEntry(acquisition("old", "blob"), 0)), write: vi.fn(async () => cacheWriteResult()) },
      live: { acquire: vi.fn(async () => acquisition("stream", "stream")) }
    });
    const controller = new PreviewSessionController(adapter);

    await controller.open(request);
    await controller.waitForBackground();

    expect(adapter.cache.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ snapshot: expect.objectContaining({ fingerprint: "stream" }) }), expect.anything());
    expect(adapter.published.at(-1)).toMatchObject({ kind: "live", current: { fingerprint: "stream" } });
    expect(adapter.cacheSnapshots).toEqual([cacheSnapshot()]);
    expect(adapter.cacheEvents).toEqual([expect.objectContaining({ kind: "stream-cache-ready" })]);
    expect(adapter.releases).toEqual(["resource-material-old"]);
  });

  it("keeps identical cached playback when a stale stream refresh verifies unchanged", async () => {
    const adapter = ports({
      cache: { read: vi.fn(async () => cacheEntry(acquisition("same", "blob"), 0)), write: vi.fn(async () => cacheWriteResult()) },
      live: { acquire: vi.fn(async () => acquisition("same", "stream")) }
    });
    const controller = new PreviewSessionController(adapter);

    await controller.open(request);
    await controller.waitForBackground();

    expect(adapter.published.at(-1)).toMatchObject({ kind: "cached", status: "verified", current: { fingerprint: "same" } });
    expect(adapter.resources.apply).toHaveBeenCalledTimes(1);
    expect(adapter.cache.write).not.toHaveBeenCalled();
    expect(adapter.releases).toEqual([]);
  });

  it("still persists a verified-identical stream refresh when the cached entry is metadata-only", async () => {
    const adapter = ports({
      cache: { read: vi.fn(async () => cacheEntry(acquisition("same", "stream"), 0)), write: vi.fn(async () => cacheWriteResult()) },
      live: { acquire: vi.fn(async () => acquisition("same", "stream")) }
    });
    const controller = new PreviewSessionController(adapter);

    await controller.open(request);
    await controller.waitForBackground();

    expect(adapter.published.at(-1)).toMatchObject({ kind: "cached", status: "verified", current: { fingerprint: "same" } });
    expect(adapter.resources.apply).toHaveBeenCalledTimes(1);
    expect(adapter.cache.write).toHaveBeenCalledTimes(1);
    expect(adapter.cacheEvents).toEqual([expect.objectContaining({ kind: "stream-cache-ready" })]);
    expect(adapter.releases).toEqual([]);
  });

  it("applies a no-cache stream before its independently owned cache write completes", async () => {
    const write = deferred<PreviewCacheWriteResult>();
    const adapter = ports({
      cache: { read: vi.fn(async () => undefined), write: vi.fn(() => write.promise) },
      live: { acquire: vi.fn(async () => acquisition("stream", "stream")) }
    });
    const controller = new PreviewSessionController(adapter);

    await expect(controller.open(request)).resolves.toMatchObject({ kind: "opened" });
    expect(adapter.published.at(-1)).toMatchObject({ kind: "live", current: { fingerprint: "stream" } });
    expect(adapter.cacheSnapshots).toEqual([]);
    expect(adapter.cacheEvents).toEqual([]);

    write.resolve(cacheWriteResult());
    await controller.waitForBackground();
    expect(adapter.cacheSnapshots).toEqual([cacheSnapshot()]);
    expect(adapter.cacheEvents).toEqual([expect.objectContaining({ kind: "stream-cache-ready" })]);
  });

  it("retains live stream playback when its background cache write fails", async () => {
    const adapter = ports({
      cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => { throw new Error("storage unavailable"); }) },
      live: { acquire: vi.fn(async () => acquisition("stream", "stream")) }
    });
    const controller = new PreviewSessionController(adapter);

    await controller.open(request);
    await controller.waitForBackground();

    expect(adapter.published.at(-1)).toMatchObject({ kind: "live", current: { fingerprint: "stream" } });
    expect(adapter.cacheSnapshots).toEqual([]);
    expect(adapter.cacheEvents).toEqual([expect.objectContaining({ kind: "stream-cache-failed", message: "storage unavailable" })]);
  });

  it("keeps a stream live when persistence is skipped, without cache snapshot or stream event", async () => {
    const adapter = ports({
      cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => ({ kind: "skipped", reason: "over-limit" } as const)) },
      live: { acquire: vi.fn(async () => acquisition("stream", "stream")) }
    });
    const controller = new PreviewSessionController(adapter);

    await controller.open(request);
    await controller.waitForBackground();

    expect(adapter.published.at(-1)).toMatchObject({ kind: "live", current: { fingerprint: "stream" } });
    expect("cachedAt" in (adapter.published.at(-1) ?? {})).toBe(false);
    expect(adapter.cacheSnapshots).toEqual([]);
    expect(adapter.cacheEvents).toEqual([]);
  });

  it("applies an initial non-stream skip safely without a cache snapshot", async () => {
    const adapter = ports({
      cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => ({ kind: "skipped", reason: "not-cacheable" } as const)) },
      live: { acquire: vi.fn(async () => acquisition("live", "blob")) }
    });
    const controller = new PreviewSessionController(adapter);

    await expect(controller.open(request)).resolves.toMatchObject({ kind: "opened" });

    expect(adapter.published.at(-1)).toMatchObject({ kind: "live", current: { fingerprint: "live" } });
    expect(adapter.cacheSnapshots).toEqual([]);
  });

  it("keeps stale cached content on a non-stream skip and never exposes an unpersisted refresh", async () => {
    const exactCachedAt = "2026-07-18T11:00:00.000Z";
    const adapter = ports({
      cache: { read: vi.fn(async () => cacheEntry(acquisition("cached", "blob"), 0, exactCachedAt)), write: vi.fn(async () => ({ kind: "skipped", reason: "over-limit" } as const)) },
      live: { acquire: vi.fn(async () => acquisition("new", "blob")) }
    });
    const controller = new PreviewSessionController(adapter);

    await controller.open(request);
    await controller.waitForBackground();

    expect(adapter.published.at(-1)).toMatchObject({ kind: "cached", status: "refresh-skipped", current: { fingerprint: "cached" }, cachedAt: exactCachedAt });
    expect(adapter.published.some((state) => state.kind === "refresh-ready")).toBe(false);
    expect(adapter.cacheSnapshots).toEqual([]);
  });

  it("fails no-cache non-stream writes and retains stale cache when its refresh write fails", async () => {
    const initialAdapter = ports({
      cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => { throw new Error("storage unavailable"); }) },
      live: { acquire: vi.fn(async () => acquisition("live", "blob")) }
    });
    const initial = new PreviewSessionController(initialAdapter);
    await expect(initial.open(request)).resolves.toMatchObject({ kind: "failed", message: "storage unavailable" });
    expect(initialAdapter.published.at(-1)).toMatchObject({ kind: "failed" });
    expect(initialAdapter.resources.apply).not.toHaveBeenCalled();

    const exactCachedAt = "2026-07-18T10:00:00.000Z";
    const staleAdapter = ports({
      cache: { read: vi.fn(async () => cacheEntry(acquisition("cached", "blob"), 0, exactCachedAt)), write: vi.fn(async () => { throw new Error("storage unavailable"); }) },
      live: { acquire: vi.fn(async () => acquisition("new", "blob")) }
    });
    const stale = new PreviewSessionController(staleAdapter);
    await stale.open(request);
    await stale.waitForBackground();
    expect(staleAdapter.published.at(-1)).toMatchObject({ kind: "cached", status: "refresh-failed", current: { fingerprint: "cached" }, cachedAt: exactCachedAt });
    expect(staleAdapter.cacheEvents).toEqual([]);
  });

  it("publishes neither cache snapshots nor stream events after scope loss", async () => {
    const write = deferred<PreviewCacheWriteResult>();
    const writeReturned = deferred<void>();
    const adapter = ports({
      cache: {
        read: vi.fn(async () => undefined),
        write: vi.fn(async () => {
          const result = await write.promise;
          writeReturned.resolve();
          return result;
        })
      },
      live: { acquire: vi.fn(async () => acquisition("stream", "stream")) }
    });
    const controller = new PreviewSessionController(adapter);

    await controller.open(request);
    controller.invalidate();
    write.resolve(cacheWriteResult());
    await writeReturned.promise;
    await Promise.resolve();

    expect(adapter.cacheSnapshots).toEqual([]);
    expect(adapter.cacheEvents).toEqual([]);
  });

  it("does not emit a stream-cache failure after scope loss", async () => {
    const write = deferred<PreviewCacheWriteResult>();
    const writeReturned = deferred<void>();
    const adapter = ports({
      cache: {
        read: vi.fn(async () => undefined),
        write: vi.fn(async () => {
          try {
            return await write.promise;
          } finally {
            writeReturned.resolve();
          }
        })
      },
      live: { acquire: vi.fn(async () => acquisition("stream", "stream")) }
    });
    const controller = new PreviewSessionController(adapter);

    await controller.open(request);
    controller.invalidate();
    write.reject(new Error("storage unavailable"));
    await writeReturned.promise;
    await Promise.resolve();

    expect(adapter.cacheSnapshots).toEqual([]);
    expect(adapter.cacheEvents).toEqual([]);
  });

  it("treats aborted work as inert without failure publication or a failed session state", async () => {
    const aborted = new Error("aborted");
    const adapter = ports({
      failures: { classify: () => ({ kind: "aborted" }) },
      live: { acquire: vi.fn(async () => { throw aborted; }) }
    });
    const controller = new PreviewSessionController(adapter);

    await expect(controller.open(request)).resolves.toMatchObject({ kind: "superseded" });

    expect(adapter.publishedFailures).toEqual([]);
    expect(adapter.published.map((state) => state.kind)).toEqual(["opening"]);
    expect(adapter.aborts).toEqual(["abort-1"]);
  });

  it("publishes a current terminal failure once, releases the cached resource, and never publishes failed", async () => {
    const terminal = new Error("expired");
    const adapter = ports({
      cache: { read: vi.fn(async () => cacheEntry(acquisition("cached", "blob"), 0)), write: vi.fn(async () => cacheWriteResult()) },
      failures: { classify: (error) => error === terminal
        ? { kind: "session-terminal", reason: "session-expired", message: "Session expired" }
        : { kind: "ordinary", message: "unexpected" } },
      live: { acquire: vi.fn(async () => { throw terminal; }) }
    });
    const controller = new PreviewSessionController(adapter);

    await controller.open(request);
    await controller.waitForBackground();

    expect(adapter.publishedFailures).toEqual([{ kind: "session-terminal", reason: "session-expired", message: "Session expired" }]);
    expect(adapter.releases).toEqual(["resource-material-cached"]);
    expect(adapter.published.some((state) => state.kind === "failed")).toBe(false);
    expect(adapter.aborts).toEqual(["abort-1"]);
  });

  it("returns a typed terminal outcome before a preview has been applied", async () => {
    const terminal = new Error("reconnect");
    const adapter = ports({
      failures: { classify: () => ({ kind: "session-terminal", reason: "reconnect-required", message: "Reconnect required" }) },
      live: { acquire: vi.fn(async () => { throw terminal; }) }
    });
    const controller = new PreviewSessionController(adapter);

    await expect(controller.open(request)).resolves.toMatchObject({ kind: "session-terminated", reason: "reconnect-required" });
    expect(adapter.publishedFailures).toEqual([{ kind: "session-terminal", reason: "reconnect-required", message: "Reconnect required" }]);
    expect(adapter.published.some((state) => state.kind === "failed")).toBe(false);
  });

  it("publishes backend-unavailable before preserving normal no-cache and stale-cache outcomes", async () => {
    const unavailable = new Error("worker unavailable");
    const classifier = { classify: () => ({ kind: "backend-unavailable", message: "Worker unavailable" } as const) };
    const initialAdapter = ports({ failures: classifier, live: { acquire: vi.fn(async () => { throw unavailable; }) } });
    const initial = new PreviewSessionController(initialAdapter);
    await expect(initial.open(request)).resolves.toMatchObject({ kind: "failed", message: "Worker unavailable" });
    expect(initialAdapter.publishedFailures).toEqual([{ kind: "backend-unavailable", message: "Worker unavailable" }]);
    expect(initialAdapter.published.at(-1)).toMatchObject({ kind: "failed" });

    const staleAdapter = ports({
      cache: { read: vi.fn(async () => cacheEntry(acquisition("cached", "blob"), 0)), write: vi.fn(async () => cacheWriteResult()) },
      failures: classifier,
      live: { acquire: vi.fn(async () => { throw unavailable; }) }
    });
    const stale = new PreviewSessionController(staleAdapter);
    await stale.open(request);
    await stale.waitForBackground();
    expect(staleAdapter.publishedFailures).toEqual([{ kind: "backend-unavailable", message: "Worker unavailable" }]);
    expect(staleAdapter.published.at(-1)).toMatchObject({ kind: "cached", status: "refresh-failed" });
  });

  it("falls through an ordinary online cache-read failure but fails cache-only without live work", async () => {
    const cacheReadFailed = new Error("cache unavailable");
    const onlineAdapter = ports({
      cache: { read: vi.fn(async () => { throw cacheReadFailed; }), write: vi.fn(async () => cacheWriteResult()) },
      live: { acquire: vi.fn(async () => acquisition("live", "blob")) }
    });
    const online = new PreviewSessionController(onlineAdapter);
    await expect(online.open(request)).resolves.toMatchObject({ kind: "opened" });
    expect(onlineAdapter.live.acquire).toHaveBeenCalledTimes(1);
    expect(onlineAdapter.publishedFailures).toEqual([{ kind: "ordinary", message: "cache unavailable" }]);

    const offlineAdapter = ports({
      cache: { read: vi.fn(async () => { throw cacheReadFailed; }), write: vi.fn(async () => cacheWriteResult()) }
    });
    const offline = new PreviewSessionController(offlineAdapter);
    await expect(offline.open({ ...request, connectionMode: "cache-only" })).resolves.toMatchObject({ kind: "failed" });
    expect(offlineAdapter.live.acquire).not.toHaveBeenCalled();
    expect(offlineAdapter.publishedFailures).toEqual([{ kind: "ordinary", message: "cache unavailable" }]);
  });

  it("keeps detached stream persistence live for backend and terminal failures without failure publication", async () => {
    const backend = new Error("backend");
    const terminal = new Error("terminal");
    for (const [error, failure] of [
      [backend, { kind: "backend-unavailable", message: "Worker unavailable" }],
      [terminal, { kind: "session-terminal", reason: "session-expired", message: "Session expired" }]
    ] as const) {
      const adapter = ports({
        cache: { read: vi.fn(async () => undefined), write: vi.fn(async () => { throw error; }) },
        failures: { classify: () => failure },
        live: { acquire: vi.fn(async () => acquisition("stream", "stream")) }
      });
      const controller = new PreviewSessionController(adapter);

      await controller.open(request);
      await controller.waitForBackground();

      expect(adapter.published.at(-1)).toMatchObject({ kind: "live" });
      expect(adapter.publishedFailures).toEqual([]);
      expect(adapter.cacheEvents).toEqual([expect.objectContaining({ kind: "stream-cache-failed", message: failure.message })]);
    }
  });

  it("fails a no-cache live request and separates ordinary download from HEIC fallback preview", async () => {
    const failedAdapter = ports({ live: { acquire: vi.fn(async () => { throw new Error("unavailable"); }) } });
    const failed = new PreviewSessionController(failedAdapter);
    await expect(failed.open(request)).resolves.toMatchObject({ kind: "failed", message: "unavailable" });
    expect(failedAdapter.published.at(-1)).toMatchObject({ kind: "failed" });

    const ordinaryAdapter = ports();
    const ordinary = new PreviewSessionController(ordinaryAdapter);
    await expect(ordinary.open({ ...request, target: "ordinary-unsupported" })).resolves.toMatchObject({ kind: "download-original" });
    expect(ordinaryAdapter.cache.read).not.toHaveBeenCalled();
    expect(ordinaryAdapter.live.acquire).not.toHaveBeenCalled();

    const heicAdapter = ports({ live: { acquire: vi.fn(async () => ({
      snapshot: createPreviewSnapshot({ preview: { ...acquisition("x").snapshot.preview, viewer: "unsupported", unsupportedReason: "HEIC decoding unavailable" }, fingerprint: "heic", source: "inline", unsupported: "heic-fallback" })
    })) } });
    const heic = new PreviewSessionController(heicAdapter);
    await expect(heic.open({ ...request, target: "heic" })).resolves.toMatchObject({ kind: "opened" });
    expect(heicAdapter.published.at(-1)).toMatchObject({ kind: "live", current: { unsupported: "heic-fallback" } });
  });

  it("aborts and releases exactly once on replacement, close, apply, and scope loss; late outcomes stay inert", async () => {
    const pending = deferred<PreviewAcquisition>();
    const adapter = ports({ live: { acquire: vi.fn(() => pending.promise) } });
    const controller = new PreviewSessionController(adapter);
    const first = controller.open(request);
    await Promise.resolve();
    const second = controller.open({ ...request, path: "Projects/next.txt" });
    await Promise.resolve();
    expect(adapter.published.filter((state) => state.kind === "opening").map((state) => state.key.requestSequence)).toEqual([1, 2]);
    expect(adapter.aborts).toEqual(["abort-1"]);
    pending.resolve(acquisition("late", "blob"));
    await first;
    expect(adapter.published.filter((state) => state.kind === "live" && state.key.path === request.path)).toHaveLength(0);

    controller.close();
    expect(adapter.aborts).toEqual(["abort-1", "abort-2"]);
    expect(adapter.published.at(-1)).toMatchObject({ kind: "closed" });
    await second;

    const appliedAdapter = ports({ live: { acquire: vi.fn(async () => acquisition("live", "blob")) } });
    const applied = new PreviewSessionController(appliedAdapter);
    await applied.open(request);
    applied.invalidate();
    applied.invalidate();
    expect(appliedAdapter.releases).toEqual(["resource-material-live"]);
    expect(appliedAdapter.aborts).toEqual(["abort-1"]);
  });

  it("keeps Alpha to Beta to Alpha late completions inert", async () => {
    const alphaFirst = deferred<PreviewAcquisition>();
    const beta = deferred<PreviewAcquisition>();
    const alphaSecond = deferred<PreviewAcquisition>();
    let active = { accountId: "account-a", cacheNamespace: "cache-a", path: request.path };
    const adapter = ports({
      current: {
        isCurrent: (key) => key.accountId === active.accountId
          && key.cacheNamespace === active.cacheNamespace
          && key.path === active.path
      },
      live: {
        acquire: vi.fn()
          .mockImplementationOnce(() => alphaFirst.promise)
          .mockImplementationOnce(() => beta.promise)
          .mockImplementationOnce(() => alphaSecond.promise)
      }
    });
    const controller = new PreviewSessionController(adapter);

    const first = controller.open(request);
    await Promise.resolve();
    active = { accountId: "account-b", cacheNamespace: "cache-b", path: "Beta/report.txt" };
    const second = controller.open({ ...request, accountId: "account-b", cacheNamespace: "cache-b", path: "Beta/report.txt" });
    await Promise.resolve();
    active = { accountId: "account-a", cacheNamespace: "cache-a", path: request.path };
    const third = controller.open(request);
    await Promise.resolve();

    alphaFirst.resolve(acquisition("late-alpha-first", "blob"));
    beta.resolve(acquisition("late-beta", "blob"));
    alphaSecond.resolve(acquisition("current-alpha", "blob"));
    await Promise.all([first, second, third]);

    expect(adapter.published.filter((state) => state.kind === "live").map((state) => state.key.requestSequence)).toEqual([3]);
    expect(adapter.published.filter((state) => state.kind === "live").map((state) => state.current.fingerprint)).toEqual(["current-alpha"]);
  });

  it("releases a just-created resource if publication loses ownership", async () => {
    let current = true;
    let publications = 0;
    const adapter = ports({
      current: { isCurrent: () => current },
      publication: {
        publish: (state) => {
          adapter.published.push(state);
          publications += 1;
          if (publications === 2) current = false;
          return true;
        }
      },
      live: { acquire: vi.fn(async () => acquisition("live", "blob")) }
    });
    const controller = new PreviewSessionController(adapter);

    await expect(controller.open(request)).resolves.toMatchObject({ kind: "superseded" });

    expect(adapter.releases).toEqual(["resource-material-live"]);
    expect(adapter.aborts).toEqual(["abort-1"]);
  });
});
