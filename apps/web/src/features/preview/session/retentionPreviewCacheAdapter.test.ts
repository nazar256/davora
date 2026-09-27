import { describe, expect, it, vi } from "vitest";
import { del } from "idb-keyval";
import { Blob as NodeBlob } from "node:buffer";

import {
  createRetentionPreviewCacheAdapter,
  createRetentionPreviewPrefetchAdapter,
  type RetentionPreviewCachedInput,
  type RetentionPreviewPrefetchRuntime,
  type RetentionPreviewRuntime
} from "./retentionPreviewCacheAdapter";
import { createPreviewRequestKey, createPreviewSnapshot, type PreviewAcquisition, type PreviewRequestKey } from "./index";
import { createRetainedSnapshot, type RetainedFile, type RetentionRepository } from "../../offline/retention";
import { createOpenedFileRepository } from "../../../platform/storage/openedFileRepository";
import { BrowserPreviewLiveAdapter, BrowserPreviewMaterialStore } from "../../../platform/preview/browserPreviewAdapters";

const account = { accountId: "account-a", cacheNamespace: "cache-a" };

function key(overrides: Partial<PreviewRequestKey> = {}): PreviewRequestKey {
  return createPreviewRequestKey({
    requestSequence: 1,
    ...account,
    path: "Photos/image.png",
    contextGeneration: "session-generation",
    connectionMode: "online",
    heicPreviewEnabled: true,
    freshnessIntervalMs: 1_000,
    cacheLimitBytes: 10_000,
    ...overrides
  });
}

function preview(overrides: Partial<RetainedFile["preview"] extends infer Value ? NonNullable<Value> : never> = {}) {
  return {
    path: "Photos/image.png",
    name: "image.png",
    isFolder: false,
    mimeType: "image/png",
    size: 5,
    viewer: "image" as const,
    content: "",
    encoding: "none" as const,
    truncated: false,
    bytesRead: 0,
    requiresOriginalBlob: true,
    ...overrides
  };
}

function retainedFile(overrides: Partial<RetainedFile> = {}): RetainedFile {
  return {
    path: "Photos/image.png",
    name: "image.png",
    mimeType: "image/png",
    size: 5,
    preview: preview(),
    blobSize: 5,
    readable: true,
    normalCacheOwnership: "owned",
    cachedAt: "2026-07-18T10:00:00.000Z",
    ...overrides
  };
}

function snapshot(overrides: Partial<ReturnType<typeof createRetainedSnapshot>> = {}) {
  return createRetainedSnapshot({
    account,
    normalCache: { itemCount: 1, totalBytes: 5, limitBytes: 10_000 },
    roots: [],
    files: [],
    memberships: [],
    ...overrides
  });
}

function repository(overrides: Partial<RetentionRepository> = {}): RetentionRepository {
  const success = async () => ({ kind: "success" as const, value: snapshot() });
  return {
    readSnapshot: success,
    readPreview: vi.fn(async () => ({ kind: "success" as const, value: undefined })),
    writePreview: vi.fn(success),
    writePreviewDerivative: vi.fn(success),
    beginRoot: success,
    persistRetainedFile: success,
    completeRoot: success,
    removeRoot: success,
    clearNormalCache: success,
    purgeAccountNamespace: success,
    configureNormalCacheLimit: success,
    ...overrides
  };
}

function acquisition(source: "inline" | "blob" | "stream" = "blob"): PreviewAcquisition {
  return {
    snapshot: createPreviewSnapshot({ preview: preview(), fingerprint: "fingerprint", source }),
    ...(source === "inline" ? {} : { material: { id: "material-1", kind: source } })
  };
}

function runtime(overrides: Partial<RetentionPreviewRuntime> = {}): RetentionPreviewRuntime {
  return {
    materializeCached: vi.fn(async (_key, input) => ({
      snapshot: createPreviewSnapshot({ preview: input.preview, fingerprint: "cached", source: input.blob ? "blob" : "inline" }),
      ...(input.blob ? { material: { id: "cached-material", kind: "blob" as const } } : {})
    })),
    cachePayload: vi.fn(async () => ({ kind: "payload" as const, payload: { preview: preview(), blob: new Blob(["image"], { type: "image/png" }), mimeType: "image/png", filename: "image.png" } })),
    ...overrides
  };
}

function prefetchRuntime(overrides: Partial<RetentionPreviewPrefetchRuntime> = {}): RetentionPreviewPrefetchRuntime {
  return {
    ...runtime(),
    isCachedUsable: vi.fn(() => false),
    prepareCachedForPrefetch: vi.fn(async () => ({ kind: "miss" as const })),
    acquire: vi.fn(async () => acquisition()),
    ...overrides
  };
}

function abort(aborted = false) {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return { id: "abort-1", signal: controller.signal, abort: () => controller.abort() };
}

describe("RetentionPreviewCacheAdapter", () => {
  it("persists a materialized retained HEIC derivative against the source revision", async () => {
    const original = new Blob(["heic"], { type: "image/heic" });
    const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
    const heic = retainedFile({
      path: "Archive/photo.heic",
      name: "photo.heic",
      mimeType: "image/heic",
      preview: preview({ path: "Archive/photo.heic", name: "photo.heic", mimeType: "image/heic" }),
      normalCacheOwnership: "none"
    });
    const store = repository({
      readPreview: vi.fn(async () => ({ kind: "success" as const, value: { file: heic, blob: original, sourceRevision: "source-1" } }))
    });
    const browser = runtime({
      materializeCached: vi.fn(async (_key: PreviewRequestKey, input: RetentionPreviewCachedInput) => ({
        snapshot: createPreviewSnapshot({ preview: input.preview, fingerprint: "cached-heic", source: "blob" }),
        material: { id: "decoded", kind: "blob" as const },
        derivative: { blob: jpeg, mimeType: "image/jpeg", filename: "photo.heic.jpg" }
      }))
    });

    await createRetentionPreviewCacheAdapter(store, browser).read(key({ path: "Archive/photo.heic" }), abort());

    expect(store.writePreviewDerivative).toHaveBeenCalledWith(account, {
      path: "Archive/photo.heic",
      expectedSourceRevision: "source-1",
      blob: jpeg,
      mimeType: "image/jpeg",
      filename: "photo.heic.jpg"
    });
  });

  it("reopens a retained HEIC after repository reconstruction without decoding it again", async () => {
    vi.stubGlobal("Blob", NodeBlob);
    const retainedAccount = { accountId: "account-a", cacheNamespace: "preview-retained-heic-sidecar" };
    const original = new Blob(["heic"], { type: "image/heic" });
    const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
    const heicPreview = preview({ path: "Archive/photo.heic", name: "photo.heic", mimeType: "image/heic" });
    const request = key({ cacheNamespace: retainedAccount.cacheNamespace, path: "Archive/photo.heic", connectionMode: "cache-only" });
    const decode = vi.fn(async () => ({ blob: jpeg, mimeType: "image/jpeg" }));
    const firstRepository = createOpenedFileRepository();

    try {
      const started = await firstRepository.beginRoot(retainedAccount, { rootPath: "Archive/photo.heic", rootName: "photo.heic", kind: "file", folderRoots: [] });
      if (started.kind === "failure") throw new Error(started.message);
      const rootId = started.value.roots[0]?.id;
      if (!rootId) throw new Error("Expected retained root.");
      await firstRepository.persistRetainedFile(retainedAccount, {
        rootId,
        file: { path: "Archive/photo.heic", name: "photo.heic", mimeType: "image/heic", size: original.size, preview: heicPreview, blobSize: original.size, readable: true, normalCacheOwnership: "none" },
        blob: original
      });

      const firstRuntime = new BrowserPreviewLiveAdapter({ tokenFor: () => undefined, materials: new BrowserPreviewMaterialStore(), decodeHeicPreview: decode });
      await createRetentionPreviewCacheAdapter(firstRepository, firstRuntime).read(request, abort());
      expect(decode).toHaveBeenCalledTimes(1);

      const reloadedRuntime = new BrowserPreviewLiveAdapter({ tokenFor: () => undefined, materials: new BrowserPreviewMaterialStore(), decodeHeicPreview: decode });
      const reopened = await createRetentionPreviewCacheAdapter(createOpenedFileRepository(), reloadedRuntime).read(request, abort());
      expect(reopened?.acquisition.snapshot).toMatchObject({ source: "blob", unsupported: "none" });
      expect(decode).toHaveBeenCalledTimes(1);
    } finally {
      await firstRepository.purgeAccountNamespace(retainedAccount);
      vi.unstubAllGlobals();
    }
  });

  it("maps an account-scoped V2 preview record through runtime materialization", async () => {
    const blob = new Blob(["image"], { type: "image/png" });
    const store = repository({ readPreview: vi.fn(async () => ({ kind: "success" as const, value: { file: retainedFile(), blob } })) });
    const browser = runtime();
    const adapter = createRetentionPreviewCacheAdapter(store, browser);

    await expect(adapter.read(key(), abort())).resolves.toMatchObject({ cachedAt: "2026-07-18T10:00:00.000Z", cachedAtMs: Date.parse("2026-07-18T10:00:00.000Z"), acquisition: { snapshot: { fingerprint: "cached" } } });
    expect(store.readPreview).toHaveBeenCalledWith(account, "Photos/image.png");
    expect(browser.materializeCached).toHaveBeenCalledWith(key(), { preview: preview(), blob, mimeType: "image/png", filename: "image.png" }, expect.objectContaining({ id: "abort-1" }));
  });

  it("keeps metadata-only cached previews materializable without inventing a Blob", async () => {
    const file = retainedFile({ preview: preview({ viewer: "text", content: "cached", encoding: "utf8", requiresOriginalBlob: false }), blobSize: 0, readable: false });
    const store = repository({ readPreview: vi.fn(async () => ({ kind: "success" as const, value: { file } })) });
    const browser = runtime({ materializeCached: vi.fn(async (_key, input) => {
      expect(input.blob).toBeUndefined();
      return acquisition("inline");
    }) });

    await expect(createRetentionPreviewCacheAdapter(store, browser).read(key(), abort())).resolves.toMatchObject({ acquisition: { snapshot: { source: "inline" } } });
  });

  it("writes runtime payloads with normal preview-cache ownership and returns repository accounting", async () => {
    const blob = new Blob(["image"], { type: "image/png" });
    const persisted = snapshot({ normalCache: { itemCount: 2, totalBytes: 10, limitBytes: 10_000 } });
    const store = repository({ writePreview: vi.fn(async () => ({ kind: "success" as const, value: persisted })) });
    const browser = runtime({ cachePayload: vi.fn(async () => ({ kind: "payload" as const, payload: { preview: preview(), blob, mimeType: "image/png", filename: "image.png" } })) });

    await expect(createRetentionPreviewCacheAdapter(store, browser).write(key(), acquisition(), abort())).resolves.toEqual({ kind: "stored", snapshot: persisted.normalCache });
    expect(store.writePreview).toHaveBeenCalledWith(account, expect.objectContaining({
      blob,
      file: expect.objectContaining({ path: "Photos/image.png", name: "image.png", mimeType: "image/png", size: 5, blobSize: 5, readable: true, normalCacheOwnership: "owned" })
    }));
  });

  it("writes metadata-only payloads without fabricating a binary blob", async () => {
    const store = repository();
    const text = preview({ viewer: "text", content: "cached", encoding: "utf8", requiresOriginalBlob: false });
    const browser = runtime({ cachePayload: vi.fn(async () => ({ kind: "payload" as const, payload: { preview: text, mimeType: "text/plain", filename: "image.txt" } })) });

    await createRetentionPreviewCacheAdapter(store, browser).write(key(), acquisition("inline"), abort());
    expect(store.writePreview).toHaveBeenCalledWith(account, {
      file: expect.objectContaining({ path: "Photos/image.png", name: "image.txt", mimeType: "text/plain", blobSize: 0, readable: false, normalCacheOwnership: "owned" })
    });
  });

  it("round-trips an inline metadata-only preview through the real V2 repository", async () => {
    const namespace = "preview-adapter-inline-round-trip";
    const inline = preview({ viewer: "text", content: "retained inline text", encoding: "utf8", requiresOriginalBlob: false });
    const browser = runtime({
      cachePayload: vi.fn(async () => ({ kind: "payload" as const, payload: { preview: inline, mimeType: "text/plain", filename: "image.txt" } })),
      materializeCached: vi.fn(async (_key, input) => ({ snapshot: createPreviewSnapshot({ preview: input.preview, fingerprint: input.preview.content, source: "inline" }) }))
    });
    const repository = createOpenedFileRepository();
    const adapter = createRetentionPreviewCacheAdapter(repository, browser);
    const requestKey = key({ cacheNamespace: namespace });

    await del(`davora-opened-file:index:${namespace}`);
    try {
      await adapter.write(requestKey, acquisition("inline"), abort());
      await expect(adapter.read(requestKey, abort())).resolves.toMatchObject({ acquisition: { snapshot: { preview: { content: "retained inline text" }, source: "inline" } } });
      expect(browser.materializeCached).toHaveBeenCalledWith(requestKey, {
        preview: inline,
        mimeType: "text/plain",
        filename: "image.txt"
      }, expect.objectContaining({ id: "abort-1" }));
    } finally {
      await del(`davora-opened-file:index:${namespace}`);
    }
  });

  it("probes cached retained facts without materialization and skips gallery live work on a cache hit", async () => {
    const store = repository({ readPreview: vi.fn(async () => ({ kind: "success" as const, value: { file: retainedFile() } })) });
    const browser = prefetchRuntime({
      isCachedUsable: vi.fn(() => true),
      prepareCachedForPrefetch: vi.fn(async () => ({ kind: "ready" as const }))
    });
    const cache = createRetentionPreviewCacheAdapter(store, browser);
    const prefetch = createRetentionPreviewPrefetchAdapter(cache, browser);

    await expect(prefetch.probe(key(), abort())).resolves.toBe(true);
    await expect(prefetch.prefetch(key(), { accept: () => true }, abort())).resolves.toEqual({ kind: "cached" });
    expect(browser.isCachedUsable).toHaveBeenCalledTimes(1);
    expect(browser.prepareCachedForPrefetch).toHaveBeenCalledTimes(1);
    expect(browser.materializeCached).not.toHaveBeenCalled();
    expect(browser.acquire).not.toHaveBeenCalled();
    expect(store.writePreview).not.toHaveBeenCalled();
  });

  it("pre-renders a cached retained HEIC and persists its derivative without live acquisition", async () => {
    const original = new Blob(["heic"], { type: "image/heic" });
    const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
    const heic = retainedFile({
      path: "Archive/photo.heic",
      name: "photo.heic",
      mimeType: "image/heic",
      preview: preview({ path: "Archive/photo.heic", name: "photo.heic", mimeType: "image/heic" }),
      normalCacheOwnership: "none"
    });
    const store = repository({
      readPreview: vi.fn(async () => ({ kind: "success" as const, value: { file: heic, blob: original, sourceRevision: "source-1" } }))
    });
    const browser = prefetchRuntime({
      prepareCachedForPrefetch: vi.fn(async () => ({
        kind: "derivative" as const,
        derivative: { blob: jpeg, mimeType: "image/jpeg", filename: "photo.heic.jpg" }
      }))
    });
    const prefetch = createRetentionPreviewPrefetchAdapter(createRetentionPreviewCacheAdapter(store, browser), browser);

    await expect(prefetch.prefetch(key({ path: "Archive/photo.heic", connectionMode: "cache-only" }), { accept: () => true }, abort()))
      .resolves.toEqual({ kind: "persisted" });

    expect(store.writePreviewDerivative).toHaveBeenCalledWith(account, {
      path: "Archive/photo.heic",
      expectedSourceRevision: "source-1",
      blob: jpeg,
      mimeType: "image/jpeg",
      filename: "photo.heic.jpg"
    });
    expect(browser.acquire).not.toHaveBeenCalled();
    expect(browser.materializeCached).not.toHaveBeenCalled();
  });

  it("persists an accepted gallery acquisition through the cache adapter", async () => {
    const store = repository();
    const browser = prefetchRuntime({
      acquire: vi.fn(async () => acquisition("inline")),
      cachePayload: vi.fn(async () => ({ kind: "payload" as const, payload: { preview: preview({ viewer: "text", content: "gallery", encoding: "utf8", requiresOriginalBlob: false }), mimeType: "text/plain", filename: "gallery.txt" } }))
    });
    const prefetch = createRetentionPreviewPrefetchAdapter(createRetentionPreviewCacheAdapter(store, browser), browser);
    const accept = vi.fn(() => true);

    await expect(prefetch.prefetch(key(), { accept }, abort())).resolves.toEqual({ kind: "persisted" });
    expect(accept).toHaveBeenCalledWith(acquisition("inline"));
    expect(store.writePreview).toHaveBeenCalledWith(account, expect.objectContaining({ file: expect.objectContaining({ name: "gallery.txt", normalCacheOwnership: "owned" }) }));
  });

  it("stores stream prefetch metadata without invoking the interactive original-Blob cache payload", async () => {
    const store = repository();
    const stream = acquisition("stream");
    const browser = prefetchRuntime({
      acquire: vi.fn(async () => stream),
      cachePayload: vi.fn(async () => { throw new Error("interactive stream fetch must not run"); })
    });
    const prefetch = createRetentionPreviewPrefetchAdapter(createRetentionPreviewCacheAdapter(store, browser), browser);

    await expect(prefetch.prefetch(key(), { accept: () => true }, abort())).resolves.toEqual({ kind: "persisted" });
    expect(browser.cachePayload).not.toHaveBeenCalled();
    expect(store.writePreview).toHaveBeenCalledWith(account, {
      file: expect.objectContaining({ path: "Photos/image.png", blobSize: 0, readable: false, normalCacheOwnership: "owned" })
    });
  });

  it("keeps interactive stream writes on their existing runtime cache-payload path", async () => {
    const store = repository();
    const browser = prefetchRuntime({ cachePayload: vi.fn(async () => ({ kind: "payload" as const, payload: { preview: preview(), blob: new Blob(["original"]), mimeType: "image/png", filename: "image.png" } })) });
    const cache = createRetentionPreviewCacheAdapter(store, browser);

    await cache.write(key(), acquisition("stream"), abort());
    expect(browser.cachePayload).toHaveBeenCalledOnce();
    expect(store.writePreview).toHaveBeenCalledWith(account, expect.objectContaining({ blob: expect.any(Blob) }));
  });

  it("returns superseded without a repository write when acceptance loses current ownership", async () => {
    const store = repository();
    const browser = prefetchRuntime({ acquire: vi.fn(async () => acquisition("inline")) });
    const cache = createRetentionPreviewCacheAdapter(store, browser);
    const prefetch = createRetentionPreviewPrefetchAdapter(cache, browser);
    const cancelled = abort();

    await expect(prefetch.prefetch(key(), { accept: () => { cancelled.abort(); return true; } }, cancelled)).resolves.toEqual({ kind: "superseded" });
    expect(store.writePreview).not.toHaveBeenCalled();
    expect(browser.cachePayload).not.toHaveBeenCalled();
  });

  it("preserves runtime-provided HEIC decode metadata", async () => {
    const decoded = new Blob(["jpeg"], { type: "image/jpeg" });
    const store = repository();
    const browser = runtime({ cachePayload: vi.fn(async () => ({ kind: "payload" as const, payload: { preview: preview({ path: "Archive/photo.heic", name: "photo.heic", mimeType: "image/heic" }), blob: decoded, mimeType: "image/jpeg", filename: "photo.heic.jpg" } })) });
    const adapter = createRetentionPreviewCacheAdapter(store, browser);

    await adapter.write(key({ path: "Archive/photo.heic" }), acquisition(), abort());
    expect(store.writePreview).toHaveBeenCalledWith({ ...account }, expect.objectContaining({
      blob: decoded,
      file: expect.objectContaining({ path: "Archive/photo.heic", mimeType: "image/jpeg", name: "photo.heic.jpg", blobSize: decoded.size })
    }));
  });

  it("forwards a retained-original variant when the payload carries original bytes", async () => {
    const decoded = new Blob(["jpeg"], { type: "image/jpeg" });
    const original = new Blob(["heic"], { type: "image/heic" });
    const heicPreview = preview({ path: "Archive/photo.heic", name: "photo.heic", mimeType: "image/heic" });
    const store = repository();
    const browser = runtime({
      cachePayload: vi.fn(async () => ({
        kind: "payload" as const,
        payload: {
          preview: heicPreview,
          blob: decoded,
          mimeType: "image/jpeg",
          filename: "photo.heic.jpg",
          original: { blob: original, mimeType: "image/heic", filename: "photo.heic" }
        }
      }))
    });
    const adapter = createRetentionPreviewCacheAdapter(store, browser);

    await adapter.write(key({ path: "Archive/photo.heic" }), acquisition(), abort());
    const writeCall = vi.mocked(store.writePreview).mock.calls[0];
    const input = writeCall?.[1];
    expect(writeCall?.[0]).toEqual(account);
    expect(input?.file).toMatchObject({ path: "Archive/photo.heic", name: "photo.heic.jpg", mimeType: "image/jpeg", blobSize: decoded.size });
    expect(input?.blob).toBe(decoded);
    expect(input?.retainedOriginal?.blob).toBe(original);
    expect(input?.retainedOriginal?.file).toMatchObject({ path: "Archive/photo.heic", name: "photo.heic", mimeType: "image/heic", size: original.size, blobSize: original.size, readable: true, preview: heicPreview });
  });

  it("persists original bytes for a retained file while a normal cache entry keeps the decoded payload", async () => {
    vi.stubGlobal("Blob", NodeBlob);
    const namespace = "preview-adapter-retained-original";
    const decoded = new Blob(["jpeg"], { type: "image/jpeg" });
    const original = new Blob(["heic"], { type: "image/heic" });
    const heicPreview = preview({ path: "Archive/photo.heic", name: "photo.heic", mimeType: "image/heic" });
    const browser = runtime({
      cachePayload: vi.fn(async () => ({
        kind: "payload" as const,
        payload: {
          preview: heicPreview,
          blob: decoded,
          mimeType: "image/jpeg",
          filename: "photo.heic.jpg",
          original: { blob: original, mimeType: "image/heic", filename: "photo.heic" }
        }
      }))
    });
    const repository = createOpenedFileRepository();
    const adapter = createRetentionPreviewCacheAdapter(repository, browser);
    const retainedAccount = { accountId: "account-a", cacheNamespace: `${namespace}-retained` };
    const cachedAccount = { accountId: "account-a", cacheNamespace: `${namespace}-cached` };
    const retainedKey = key({ cacheNamespace: retainedAccount.cacheNamespace, path: "Archive/photo.heic" });
    const cachedKey = key({ cacheNamespace: cachedAccount.cacheNamespace, path: "Archive/photo.heic" });

    try {
      const root = await repository.beginRoot(retainedAccount, { rootPath: "Archive/photo.heic", rootName: "photo.heic", kind: "file", folderRoots: [] });
      if (root.kind === "failure") throw new Error(root.message);
      const rootId = root.value.roots[0]?.id;
      if (rootId === undefined) throw new Error("Expected a retained root.");
      await repository.persistRetainedFile(retainedAccount, {
        rootId,
        file: { path: "Archive/photo.heic", name: "photo.heic", mimeType: "image/heic", size: original.size, preview: heicPreview, blobSize: original.size, readable: true, normalCacheOwnership: "none" },
        blob: original
      });

      await adapter.write(retainedKey, acquisition(), abort());
      const retained = await repository.readPreview(retainedAccount, "Archive/photo.heic");
      if (retained.kind === "failure" || !retained.value) throw new Error("Expected the retained record to stay readable.");
      expect(retained.value.blob).toEqual(original);
      expect(retained.value.file).toMatchObject({ name: "photo.heic", mimeType: "image/heic", blobSize: original.size });

      await adapter.write(cachedKey, acquisition(), abort());
      const cached = await repository.readPreview(cachedAccount, "Archive/photo.heic");
      if (cached.kind === "failure" || !cached.value) throw new Error("Expected the cached record to stay readable.");
      expect(cached.value.blob).toEqual(decoded);
      expect(cached.value.file).toMatchObject({ name: "photo.heic.jpg", mimeType: "image/jpeg", blobSize: decoded.size });
    } finally {
      vi.unstubAllGlobals();
      await repository.purgeAccountNamespace(retainedAccount);
      await repository.purgeAccountNamespace(cachedAccount);
    }
  });

  it("returns an oversized runtime skip without any repository read or write", async () => {
    const store = repository({ readSnapshot: vi.fn(async () => ({ kind: "success" as const, value: snapshot() })) });
    const browser = runtime({ cachePayload: vi.fn(async () => ({ kind: "skipped" as const, reason: "over-limit" as const })) });

    await expect(createRetentionPreviewCacheAdapter(store, browser).write(key(), acquisition("stream"), abort())).resolves.toEqual({ kind: "skipped", reason: "over-limit" });
    expect(store.writePreview).not.toHaveBeenCalled();
    expect(store.readSnapshot).not.toHaveBeenCalled();
  });

  it("throws typed retention failures without leaking repository details into callers", async () => {
    const store = repository({ readPreview: vi.fn(async () => ({ kind: "failure" as const, message: "IndexedDB unavailable" })) });

    await expect(createRetentionPreviewCacheAdapter(store, runtime()).read(key(), abort())).rejects.toMatchObject({ name: "RetentionPreviewCacheError", message: "IndexedDB unavailable" });
  });

  it("does no repository or runtime work after abort and retains account namespace mapping", async () => {
    const store = repository();
    const browser = runtime();
    const adapter = createRetentionPreviewCacheAdapter(store, browser);

    await expect(adapter.read(key({ accountId: "account-b", cacheNamespace: "cache-b" }), abort(true))).rejects.toMatchObject({ name: "AbortError" });
    await expect(adapter.write(key({ accountId: "account-b", cacheNamespace: "cache-b" }), acquisition(), abort(true))).rejects.toMatchObject({ name: "AbortError" });
    expect(store.readPreview).not.toHaveBeenCalled();
    expect(store.writePreview).not.toHaveBeenCalled();
    expect(browser.materializeCached).not.toHaveBeenCalled();
    expect(browser.cachePayload).not.toHaveBeenCalled();
  });
});
