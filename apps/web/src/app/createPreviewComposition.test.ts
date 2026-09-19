import type { FileResponse } from "@davora/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RetentionRepository } from "../features/offline/retention";
import { createPreviewRequestKey } from "../features/preview/session";
import { createPreviewComposition } from "./createPreviewComposition";

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

function restoreProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
  } else {
    Reflect.deleteProperty(target, key);
  }
}

function repository(overrides: Partial<RetentionRepository> = {}): RetentionRepository {
  const unsupported = async () => { throw new Error("not used"); };
  return {
    readSnapshot: unsupported,
    readPreview: vi.fn(async () => ({ kind: "success" as const, value: undefined })),
    writePreview: unsupported,
    beginRoot: unsupported,
    persistRetainedFile: unsupported,
    completeRoot: unsupported,
    removeRoot: unsupported,
    clearNormalCache: unsupported,
    purgeAccountNamespace: unsupported,
    configureNormalCacheLimit: unsupported,
    ...overrides
  };
}

function key() {
  return createPreviewRequestKey({
    requestSequence: 9,
    accountId: "account-a",
    cacheNamespace: "cache-a",
    path: "Docs/readme.txt",
    contextGeneration: "generation-a",
    connectionMode: "online",
    heicPreviewEnabled: true,
    freshnessIntervalMs: 1_000,
    cacheLimitBytes: 10_000
  });
}

const inlineResponse: FileResponse = {
  file: {
    path: "Docs/readme.txt",
    name: "readme.txt",
    isFolder: false,
    mimeType: "text/plain",
    size: 5,
    viewer: "text",
    content: "hello",
    encoding: "utf8",
    truncated: false,
    bytesRead: 5,
    requiresOriginalBlob: false
  }
};

describe("createPreviewComposition", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn() });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreProperty(URL, "createObjectURL", originalCreateObjectUrl);
    restoreProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  });

  it("creates isolated material, resource, live, abort, failure, prefetch, and clock adapters per session", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_726_000_000_000);
    const composition = createPreviewComposition({ retentionRepository: repository() });
    const tokenFor = vi.fn(() => "session-token");
    const first = composition.session.createSessionAdapters({ tokenFor });
    const second = composition.session.createSessionAdapters({ tokenFor });

    expect(first).not.toBe(second);
    expect(first.live).not.toBe(second.live);
    expect(first.resources).not.toBe(second.resources);
    expect(first.abort).not.toBe(second.abort);
    expect(first.failures).not.toBe(second.failures);
    expect(first.prefetch).not.toBe(second.prefetch);
    expect(first.clock).not.toBe(second.clock);
    expect(first.abort.create().id).toBe("preview-abort:1");
    expect(second.abort.create().id).toBe("preview-abort:1");
    expect(first.clock.now()).toBe(1_726_000_000_000);
    expect(first.failures.classify(new DOMException("aborted", "AbortError"))).toEqual({ kind: "aborted" });
  });

  it("converts browser request identity back to the public request key without exposing the token", async () => {
    const getFile = vi.fn(async () => inlineResponse);
    const tokenFor = vi.fn(() => "session-token");
    const composition = createPreviewComposition({
      retentionRepository: repository(),
      previewTransport: {
        getFile,
        fetchOriginalFile: vi.fn(),
        createStreamingFileUrl: vi.fn()
      }
    });
    const adapters = composition.session.createSessionAdapters({ tokenFor });
    const requestKey = key();

    await adapters.live.acquire(requestKey, adapters.abort.create());

    expect(tokenFor).toHaveBeenCalledWith({ ...requestKey, requestSequence: 0 });
    expect(getFile).toHaveBeenCalledWith(requestKey.path, "session-token", expect.any(AbortSignal));
    expect(JSON.stringify(requestKey)).not.toContain("session-token");
  });

  it("releases Blob resources once and never revokes stream URLs", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const getFile = vi.fn(async (path: string): Promise<FileResponse> => ({
      file: {
        ...inlineResponse.file,
        path,
        name: path.endsWith(".mp4") ? "clip.mp4" : "photo.png",
        mimeType: path.endsWith(".mp4") ? "video/mp4" : "image/png",
        viewer: path.endsWith(".mp4") ? "video" : "image",
        content: "",
        encoding: "none",
        requiresOriginalBlob: true
      }
    }));
    const composition = createPreviewComposition({
      retentionRepository: repository(),
      previewTransport: {
        getFile,
        fetchOriginalFile: vi.fn(async () => ({
          blob: new Blob(["image"], { type: "image/png" }),
          mimeType: "image/png",
          filename: "photo.png"
        })),
        createStreamingFileUrl: vi.fn(async () => "https://stream.test/token")
      }
    });
    const adapters = composition.session.createSessionAdapters({ tokenFor: () => "session-token" });
    const blobAcquisition = await adapters.live.acquire(key(), adapters.abort.create());
    const streamAcquisition = await adapters.live.acquire(
      createPreviewRequestKey({ ...key(), path: "Media/clip.mp4", requestSequence: 10 }),
      adapters.abort.create()
    );
    if (!blobAcquisition.material || !streamAcquisition.material) throw new Error("Expected preview materials.");
    const blobResource = adapters.resources.apply(blobAcquisition.material);
    const streamResource = adapters.resources.apply(streamAcquisition.material);
    adapters.resources.release(blobResource);
    adapters.resources.release(blobResource);
    adapters.resources.release(streamResource);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    expect(adapters.resolveResourceUrl(streamResource)).toBeUndefined();
  });

  it("wires the account-scoped retention cache and preserves disabled-HEIC cache skipping", async () => {
    const heicPreview = {
      ...inlineResponse.file,
      path: "Photos/source.heic",
      name: "source.heic",
      mimeType: "image/heic",
      viewer: "image" as const,
      content: "",
      encoding: "none" as const,
      requiresOriginalBlob: true
    };
    const readPreview = vi.fn(async () => ({
      kind: "success" as const,
      value: {
        file: {
          path: heicPreview.path,
          name: heicPreview.name,
          mimeType: heicPreview.mimeType,
          size: heicPreview.size ?? 4,
          preview: heicPreview,
          blobSize: 4,
          readable: true,
          normalCacheOwnership: "owned" as const,
          cachedAt: "2026-07-22T10:00:00.000Z"
        },
        blob: new Blob(["heic"], { type: "image/heic" })
      }
    }));
    const composition = createPreviewComposition({ retentionRepository: repository({ readPreview }) });
    const wired = composition;
    const adapters = wired.session.createSessionAdapters({ tokenFor: () => "session-token" });
    const requestKey = createPreviewRequestKey({
      ...key(),
      path: heicPreview.path,
      heicPreviewEnabled: false,
      requestSequence: 11
    });

    await expect(adapters.cache.read(requestKey, adapters.abort.create())).resolves.toBeUndefined();
    expect(readPreview).toHaveBeenCalledWith(
      { accountId: "account-a", cacheNamespace: "cache-a" },
      "Photos/source.heic"
    );
    expect(composition.modal).toBeDefined();
  });
});
