import type { FilePreview, FileResponse } from "@davora/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserPreviewAbortPort,
  BrowserPreviewLiveAdapter,
  BrowserPreviewMaterialStore,
  BrowserPreviewResourcePort,
  isAbortError,
  previewFitsCacheLimit,
  type PreviewTransport
} from "./browserPreviewAdapters";
import {
  PreviewSessionController,
  createPreviewSnapshot,
  type PreviewRequestKey
} from "../../features/preview/session";

interface ObjectUrlMocks {
  readonly create: ReturnType<typeof vi.fn>;
  readonly revoke: ReturnType<typeof vi.fn>;
  restore(): void;
}

let activeObjectUrlMocks: ObjectUrlMocks | undefined;

function installObjectUrlMocks(): ObjectUrlMocks {
  const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const create = vi.fn(() => "blob:preview");
  const revoke = vi.fn(() => undefined);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revoke });
  const mocks: ObjectUrlMocks = {
    create,
    revoke,
    restore() {
      if (createDescriptor) Object.defineProperty(URL, "createObjectURL", createDescriptor);
      else Reflect.deleteProperty(URL, "createObjectURL");
      if (revokeDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
      else Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  };
  activeObjectUrlMocks = mocks;
  return mocks;
}

afterEach(() => {
  activeObjectUrlMocks?.restore();
  activeObjectUrlMocks = undefined;
});

function key(overrides: Partial<PreviewRequestKey> = {}): PreviewRequestKey {
  return {
    requestSequence: 1,
    accountId: "account-a",
    cacheNamespace: "cache-a",
    path: "Photos/image.png",
    contextGeneration: "session-a",
    connectionMode: "online",
    heicPreviewEnabled: true,
    freshnessIntervalMs: 1_000,
    cacheLimitBytes: 1_024,
    ...overrides
  };
}

function preview(overrides: Partial<FilePreview> = {}): FilePreview {
  return {
    path: "Photos/image.png",
    name: "image.png",
    isFolder: false,
    mimeType: "image/png",
    size: 32,
    viewer: "image",
    content: "",
    encoding: "none",
    truncated: false,
    bytesRead: 0,
    requiresOriginalBlob: true,
    ...overrides
  };
}

function transport(file: FilePreview): PreviewTransport {
  return {
    getFile: vi.fn(async (): Promise<FileResponse> => ({ file })),
    fetchOriginalFile: vi.fn(async () => ({ blob: new Blob(["image"], { type: "image/png" }), mimeType: "image/png", filename: file.name })),
    createStreamingFileUrl: vi.fn(async () => "https://worker.example/api/file/stream?token=short-lived")
  };
}

describe("browser preview runtime adapters", () => {
  it("classifies inline, blob, and stream previews without exposing their source values to session state", async () => {
    const materials = new BrowserPreviewMaterialStore();
    const abort = new BrowserPreviewAbortPort().create();

    const inlineTransport = transport(preview({ viewer: "text", content: "notes", encoding: "utf8", requiresOriginalBlob: false }));
    const inline = await new BrowserPreviewLiveAdapter({ tokenFor: () => "token", materials, transport: inlineTransport }).acquire(key(), abort);
    expect(inline.snapshot.source).toBe("inline");
    expect(inline.material).toBeUndefined();
    expect(inline.snapshot.fingerprint).toContain("notes");

    const blobTransport = transport(preview());
    const blob = await new BrowserPreviewLiveAdapter({ tokenFor: () => "token", materials, transport: blobTransport }).acquire(key(), abort);
    expect(blob.snapshot.source).toBe("blob");
    expect(blob.material?.kind).toBe("blob");
    expect(materials.source(blob.material!)).toMatchObject({ kind: "blob" });

    const streamTransport = transport(preview({ path: "Music/song.mp3", name: "song.mp3", mimeType: "audio/mpeg", viewer: "audio" }));
    const stream = await new BrowserPreviewLiveAdapter({ tokenFor: () => "token", materials, transport: streamTransport }).acquire(key({ path: "Music/song.mp3" }), abort);
    expect(stream.snapshot.source).toBe("stream");
    expect(stream.material?.kind).toBe("stream");
    expect(materials.source(stream.material!)).toMatchObject({ kind: "stream" });
    expect(streamTransport.fetchOriginalFile).not.toHaveBeenCalled();
  });

  it("gives a cached blob copy and a live stream of the same media file an identical fingerprint", async () => {
    const materials = new BrowserPreviewMaterialStore();
    const video = preview({ path: "Videos/clip.mp4", name: "clip.mp4", mimeType: "video/mp4", viewer: "video", size: 512 });
    const videoKey = key({ path: video.path });
    const adapter = new BrowserPreviewLiveAdapter({ tokenFor: () => "token", materials, transport: transport(video) });
    const abort = new BrowserPreviewAbortPort().create();

    const live = await adapter.acquire(videoKey, abort);
    expect(live.snapshot.source).toBe("stream");

    const cached = await adapter.materializeCached(videoKey, {
      preview: video,
      blob: new Blob(["video"], { type: "video/mp4" }),
      mimeType: "video/mp4",
      filename: "clip.mp4"
    }, abort);
    expect(cached?.snapshot.source).toBe("blob");
    expect(cached?.snapshot.fingerprint).toBe(live.snapshot.fingerprint);

    const changed = await adapter.materializeCached(videoKey, {
      preview: { ...video, etag: "different-etag" },
      blob: new Blob(["video"], { type: "video/mp4" }),
      mimeType: "video/mp4",
      filename: "clip.mp4"
    }, abort);
    expect(changed?.snapshot.fingerprint).not.toBe(live.snapshot.fingerprint);
  });

  it("preserves HEIC disabled, size-guard, decoder-fallback, and abort paths", async () => {
    const materials = new BrowserPreviewMaterialStore();
    const heic = preview({ path: "Archive/photo.heic", name: "photo.heic", mimeType: "image/heic" });
    const disabledTransport = transport(heic);
    const disabled = await new BrowserPreviewLiveAdapter({ tokenFor: () => "token", materials, transport: disabledTransport })
      .acquire(key({ path: heic.path, heicPreviewEnabled: false }), new BrowserPreviewAbortPort().create());
    expect(disabled.snapshot.unsupported).toBe("heic-fallback");
    expect(disabled.snapshot.preview.viewer).toBe("unsupported");
    expect(disabledTransport.fetchOriginalFile).not.toHaveBeenCalled();

    const tooLargeTransport = transport(preview({ ...heic, size: 26 * 1024 * 1024 }));
    const tooLarge = await new BrowserPreviewLiveAdapter({ tokenFor: () => "token", materials, transport: tooLargeTransport })
      .acquire(key({ path: heic.path }), new BrowserPreviewAbortPort().create());
    expect(tooLarge.snapshot.preview.unsupportedReason).toMatch(/limited/i);
    expect(tooLargeTransport.fetchOriginalFile).not.toHaveBeenCalled();

    const failingTransport = transport(heic);
    const fallback = await new BrowserPreviewLiveAdapter({
      tokenFor: () => "token",
      materials,
      transport: failingTransport,
      decodeHeicPreview: async () => { throw new Error("Decoder rejected this image."); }
    }).acquire(key({ path: heic.path }), new BrowserPreviewAbortPort().create());
    expect(fallback.snapshot.preview.unsupportedReason).toMatch(/could not be decoded/i);

    const abortedTransport: PreviewTransport = {
      ...transport(heic),
      getFile: async () => { throw new DOMException("Aborted", "AbortError"); }
    };
    await expect(new BrowserPreviewLiveAdapter({ tokenFor: () => "token", materials, transport: abortedTransport })
      .acquire(key({ path: heic.path }), new BrowserPreviewAbortPort().create()))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("materializes eligible cached text, Blob, and online media while rejecting unsafe cache facts", async () => {
    const materials = new BrowserPreviewMaterialStore();
    const text = preview({ viewer: "text", content: "cached", encoding: "utf8", requiresOriginalBlob: false });
    const image = preview();
    const media = preview({ path: "Music/song.mp3", name: "song.mp3", mimeType: "audio/mpeg", viewer: "audio" });
    const runtimeTransport = transport(media);
    const runtime = new BrowserPreviewLiveAdapter({ tokenFor: () => "token", materials, transport: runtimeTransport });
    const abort = new BrowserPreviewAbortPort().create();

    const cachedText = await runtime.materializeCached(key(), { preview: text, mimeType: "text/plain", filename: "image.png" }, abort);
    expect(cachedText).toMatchObject({ snapshot: { source: "inline" } });
    expect(cachedText?.material).toBeUndefined();

    const imageBlob = new Blob(["cached-image"], { type: "image/png" });
    const cachedImage = await runtime.materializeCached(key(), { preview: image, blob: imageBlob, mimeType: "image/png", filename: "image.png" }, abort);
    expect(cachedImage?.snapshot.source).toBe("blob");
    expect(materials.source(cachedImage!.material!)).toMatchObject({ kind: "blob", blob: imageBlob });
    await expect(runtime.materializeCached(key(), { preview: image, mimeType: "image/png", filename: "image.png" }, abort)).resolves.toBeUndefined();

    const cachedMedia = await runtime.materializeCached(key({ path: media.path }), { preview: media, mimeType: "audio/mpeg", filename: media.name }, abort);
    expect(cachedMedia?.snapshot.source).toBe("stream");
    expect(runtimeTransport.createStreamingFileUrl).toHaveBeenCalledWith(media.path, "token", abort.signal);
    await expect(runtime.materializeCached(key({ path: media.path, connectionMode: "cache-only" }), { preview: media, mimeType: "audio/mpeg", filename: media.name }, abort)).resolves.toBeUndefined();

    const decodedHeic = preview({ path: "Archive/photo.heic", name: "photo.heic", mimeType: "image/heic" });
    await expect(runtime.materializeCached(key({ path: decodedHeic.path, heicPreviewEnabled: false }), {
      preview: decodedHeic,
      blob: new Blob(["jpeg"], { type: "image/jpeg" }),
      mimeType: "image/jpeg",
      filename: "photo.heic.jpg"
    }, abort)).resolves.toBeUndefined();
  });

  it("reports cached prefetch eligibility without allocating a stream or object URL", () => {
    const materials = new BrowserPreviewMaterialStore();
    const image = preview();
    const media = preview({ path: "Music/song.mp3", name: "song.mp3", mimeType: "audio/mpeg", viewer: "audio" });
    const runtimeTransport = transport(media);
    const runtime = new BrowserPreviewLiveAdapter({ tokenFor: () => "token", materials, transport: runtimeTransport });
    const { create } = installObjectUrlMocks();

    expect(runtime.isCachedUsable(key(), {
      preview: preview({ viewer: "text", content: "cached", encoding: "utf8", requiresOriginalBlob: false }),
      mimeType: "text/plain",
      filename: "notes.txt"
    })).toBe(true);
    expect(runtime.isCachedUsable(key(), { preview: image, mimeType: "image/png", filename: image.name })).toBe(false);
    expect(runtime.isCachedUsable(key(), { preview: image, blob: new Blob(["image"], { type: "image/png" }), mimeType: "image/png", filename: image.name })).toBe(true);
    expect(runtime.isCachedUsable(key({ path: media.path }), { preview: media, mimeType: "audio/mpeg", filename: media.name })).toBe(true);
    expect(runtime.isCachedUsable(key({ path: media.path, connectionMode: "cache-only" }), { preview: media, mimeType: "audio/mpeg", filename: media.name })).toBe(false);
    expect(runtime.isCachedUsable(key({ path: "Archive/photo.heic", heicPreviewEnabled: false }), {
      preview: preview({ path: "Archive/photo.heic", name: "photo.heic", mimeType: "image/heic" }),
      blob: new Blob(["jpeg"], { type: "image/jpeg" }),
      mimeType: "image/jpeg",
      filename: "photo.heic.jpg"
    })).toBe(false);
    expect(runtimeTransport.createStreamingFileUrl).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("builds cache payloads from Blob material and fetches stream originals with the same signal", async () => {
    const materials = new BrowserPreviewMaterialStore();
    const media = preview({ path: "Music/song.mp3", name: "song.mp3", mimeType: "audio/mpeg", viewer: "audio", size: 32 });
    const runtimeTransport = transport(media);
    runtimeTransport.fetchOriginalFile = vi.fn(async () => ({ blob: new Blob(["audio"], { type: "audio/mpeg" }), mimeType: "audio/mpeg", filename: media.name }));
    const runtime = new BrowserPreviewLiveAdapter({ tokenFor: () => "token", materials, transport: runtimeTransport });
    const abort = new BrowserPreviewAbortPort().create();
    const liveStream = await runtime.acquire(key({ path: media.path }), abort);

    const streamedPayload = await runtime.cachePayload(key({ path: media.path }), liveStream, abort);
    expect(streamedPayload).toMatchObject({ kind: "payload", payload: { mimeType: "audio/mpeg", filename: media.name } });
    expect(runtimeTransport.fetchOriginalFile).toHaveBeenCalledWith(media.path, "token", abort.signal);

    const imageBlob = new Blob(["image"], { type: "image/png" });
    const cachedBlob = await runtime.cachePayload(key(), {
      snapshot: { preview: preview(), fingerprint: "image", source: "blob", unsupported: "none" },
      material: materials.blob(imageBlob),
      cache: { mimeType: "image/png", filename: "image.png" }
    }, abort);
    expect(cachedBlob).toMatchObject({ kind: "payload", payload: { blob: imageBlob, mimeType: "image/png", filename: "image.png" } });

    const heic = preview({ path: "Archive/photo.heic", name: "photo.heic", mimeType: "image/heic" });
    const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
    const decoded = await new BrowserPreviewLiveAdapter({
      tokenFor: () => "token",
      materials,
      transport: transport(heic),
      decodeHeicPreview: async () => ({ blob: jpeg, mimeType: "image/jpeg" })
    }).acquire(key({ path: heic.path }), abort);
    const decodedPayload = await runtime.cachePayload(key({ path: heic.path }), decoded, abort);
    expect(decodedPayload).toMatchObject({ kind: "payload", payload: { blob: jpeg, mimeType: "image/jpeg", filename: "photo.heic.jpg" } });

    const tooLarge = await new BrowserPreviewLiveAdapter({
      tokenFor: () => "token",
      materials,
      transport: transport(preview({ ...heic, size: 26 * 1024 * 1024 }))
    }).acquire(key({ path: heic.path }), abort);
    await expect(runtime.cachePayload(key({ path: heic.path }), tooLarge, abort))
      .resolves.toEqual({ kind: "skipped", reason: "not-cacheable" });

    const decodeFailed = await new BrowserPreviewLiveAdapter({
      tokenFor: () => "token",
      materials,
      transport: transport(heic),
      decodeHeicPreview: async () => { throw new Error("Decoder rejected this image."); }
    }).acquire(key({ path: heic.path }), abort);
    await expect(runtime.cachePayload(key({ path: heic.path }), decodeFailed, abort))
      .resolves.toEqual({ kind: "skipped", reason: "not-cacheable" });
  });

  it("returns an over-limit skip without fetching an original or allocating a resource", async () => {
    const materials = new BrowserPreviewMaterialStore();
    const oversized = preview({ path: "Music/large.mp3", name: "large.mp3", mimeType: "audio/mpeg", viewer: "audio", size: 1_025 });
    const runtimeTransport = transport(oversized);
    const runtime = new BrowserPreviewLiveAdapter({ tokenFor: () => "token", materials, transport: runtimeTransport });
    const abort = new BrowserPreviewAbortPort().create();
    const { create } = installObjectUrlMocks();
    const acquisition = await runtime.acquire(key({ path: oversized.path, cacheLimitBytes: 1_024 }), abort);

    await expect(runtime.cachePayload(key({ path: oversized.path, cacheLimitBytes: 1_024 }), acquisition, abort))
      .resolves.toEqual({ kind: "skipped", reason: "over-limit" });
    expect(runtimeTransport.fetchOriginalFile).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("preserves AbortError while cache materialization fetches a stream original", async () => {
    const materials = new BrowserPreviewMaterialStore();
    const media = preview({ path: "Music/song.mp3", name: "song.mp3", mimeType: "audio/mpeg", viewer: "audio", size: 32 });
    const abortedTransport: PreviewTransport = {
      ...transport(media),
      fetchOriginalFile: async (_path, _token, signal) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        throw new DOMException("Aborted", "AbortError");
      }
    };
    const runtime = new BrowserPreviewLiveAdapter({ tokenFor: () => "token", materials, transport: abortedTransport });
    const abort = new BrowserPreviewAbortPort().create();
    const acquisition = await runtime.acquire(key({ path: media.path }), abort);

    await expect(runtime.cachePayload(key({ path: media.path }), acquisition, abort)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("creates and releases Blob URLs once, and drops stream values without revocation", () => {
    const materials = new BrowserPreviewMaterialStore();
    const { create, revoke } = installObjectUrlMocks();
    const resources = new BrowserPreviewResourcePort(materials);

    const blobResource = resources.apply(materials.blob(new Blob(["preview"], { type: "image/png" })));
    expect(resources.url(blobResource)).toBe("blob:preview");
    resources.release(blobResource);
    resources.release(blobResource);
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:preview");

    const streamResource = resources.apply(materials.stream("https://worker.example/stream"));
    expect(resources.url(streamResource)).toBe("https://worker.example/stream");
    resources.release(streamResource);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("keeps material payloads private and rejects foreign or lookalike handles", () => {
    const first = new BrowserPreviewMaterialStore();
    const second = new BrowserPreviewMaterialStore();
    const material = first.blob(new Blob(["private"], { type: "image/png" }));
    const foreign = second.blob(new Blob(["foreign"], { type: "image/png" }));
    const lookalike = { id: material.id, kind: material.kind };

    expect(Object.keys(material).sort()).toEqual(["id", "kind"]);
    expect(JSON.stringify(material)).not.toContain("private");
    expect(material.id).not.toBe(foreign.id);
    expect(() => first.source(foreign)).toThrow(/not created by this browser preview material store/i);
    expect(() => first.source(lookalike)).toThrow(/not created by this browser preview material store/i);
  });

  it("keys resources by exact handle identity and rejects foreign or lookalike ownership", () => {
    const firstMaterials = new BrowserPreviewMaterialStore();
    const secondMaterials = new BrowserPreviewMaterialStore();
    const firstResources = new BrowserPreviewResourcePort(firstMaterials);
    const secondResources = new BrowserPreviewResourcePort(secondMaterials);
    const { create, revoke } = installObjectUrlMocks();
    const firstMaterial = firstMaterials.blob(new Blob(["first"]));
    const foreignMaterial = secondMaterials.blob(new Blob(["foreign"]));

    expect(() => firstResources.apply(foreignMaterial)).toThrow(/not created by this browser preview material store/i);
    const firstResource = firstResources.apply(firstMaterial);
    const foreignResource = secondResources.apply(foreignMaterial);
    const lookalike = { id: firstResource.id, kind: firstResource.kind };

    expect(firstResource.id).not.toBe(foreignResource.id);
    expect(firstResources.url(foreignResource)).toBeUndefined();
    expect(firstResources.url(lookalike)).toBeUndefined();
    firstResources.release(foreignResource);
    firstResources.release(lookalike);
    expect(revoke).not.toHaveBeenCalled();
    firstResources.release(firstResource);
    firstResources.release(firstResource);
    expect(create).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:preview");
  });

  it("does not create an object URL for a pending stale-cache refresh", async () => {
    const materials = new BrowserPreviewMaterialStore();
    const { create } = installObjectUrlMocks();
    const resources = new BrowserPreviewResourcePort(materials);
    const cached = createPreviewSnapshot({
      preview: preview({ viewer: "text", content: "cached", encoding: "utf8", requiresOriginalBlob: false }),
      fingerprint: "cached",
      source: "inline"
    });
    const next = createPreviewSnapshot({ preview: preview(), fingerprint: "live", source: "blob" });
    const controller = new PreviewSessionController({
      cache: {
        read: async () => ({ acquisition: { snapshot: cached }, cachedAt: "1970-01-01T00:00:00.000Z", cachedAtMs: 0 }),
        write: async () => ({ kind: "stored", snapshot: { itemCount: 1, totalBytes: 4, limitBytes: 1_024 } })
      },
      live: {
        acquire: async () => ({ snapshot: next, material: materials.blob(new Blob(["live"], { type: "image/png" })) })
      },
      abort: new BrowserPreviewAbortPort(),
      resources,
      current: { isCurrent: () => true },
      failures: { classify: () => ({ kind: "ordinary", message: "unused" }) },
      failurePublication: { publishFailure: () => true },
      publication: { publish: () => true },
      cachePublication: { publishSnapshot: () => true, publishEvent: () => true },
      clock: { now: () => 100 }
    });

    await controller.open({ ...key({ freshnessIntervalMs: 1 }), target: "previewable" });
    await controller.waitForBackground();

    expect(create).not.toHaveBeenCalled();
  });

  it("keeps cache limits and AbortError classification explicit at the platform boundary", () => {
    expect(previewFitsCacheLimit(key({ cacheLimitBytes: 32 }), preview({ size: 32 }))).toBe(true);
    expect(previewFitsCacheLimit(key({ cacheLimitBytes: 31 }), preview({ size: 32 }))).toBe(false);
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
    expect(isAbortError(Object.assign(new Error("Aborted"), { name: "AbortError" }))).toBe(true);
    expect(isAbortError(new Error("other"))).toBe(false);
  });
});
