import type { FilePreview, FileResponse } from "@davora/shared";

import {
  HEIC_PREVIEW_MAX_SOURCE_BYTES,
  decodeHeicPreview,
  isHeicFileName,
  isHeicLikeFile,
  isHeicMimeType
} from "../../lib/heicPreview";
import { createStreamingFileUrl, fetchOriginalFile, getFile } from "../../lib/api";

/** Local structural copies keep platform adapters independent of feature modules. */
export interface BrowserPreviewRequestKey {
  readonly accountId: string;
  readonly cacheNamespace: string;
  readonly path: string;
  readonly contextGeneration: string;
  readonly connectionMode: "online" | "cache-only";
  readonly heicPreviewEnabled: boolean;
  readonly freshnessIntervalMs: number;
  readonly cacheLimitBytes: number;
}

export interface BrowserPreviewAbortHandle {
  readonly id: string;
  readonly signal: AbortSignal;
  abort(): void;
}

export interface BrowserPreviewMaterial {
  readonly id: string;
  readonly kind: "blob" | "stream";
}

export interface BrowserPreviewResource {
  readonly id: string;
  readonly kind: "blob" | "stream";
}

export interface BrowserPreviewSnapshot {
  readonly preview: FilePreview;
  readonly fingerprint: string;
  readonly source: "inline" | "blob" | "stream";
  readonly unsupported: "none" | "heic-fallback";
}

/** True original bytes when the preview material is derived (e.g. decoded HEIC). */
export interface BrowserPreviewOriginalBlob {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly filename: string;
}

export interface BrowserPreviewCacheMetadata {
  readonly mimeType: string;
  readonly filename: string;
  /**
   * The fetched original bytes for derived materials. Cache writes persist
   * these instead of the preview material when the record is kept offline.
   */
  readonly original?: BrowserPreviewOriginalBlob;
}

export interface BrowserPreviewAcquisition {
  readonly snapshot: BrowserPreviewSnapshot;
  readonly material?: BrowserPreviewMaterial;
  /** Metadata is adapter-owned so cache writes preserve decoded HEIC facts. */
  readonly cache?: BrowserPreviewCacheMetadata;
  /** Decoded bytes that may be persisted beside a retained original. */
  readonly derivative?: { readonly blob: Blob; readonly mimeType: string; readonly filename: string };
}

export interface BrowserCachedPreviewInput extends BrowserPreviewCacheMetadata {
  readonly preview: FilePreview;
  readonly blob?: Blob;
}

export interface BrowserPreviewCachePayload extends BrowserPreviewCacheMetadata {
  readonly preview: FilePreview;
  readonly blob?: Blob;
}

export type BrowserPreviewCachePayloadResult =
  | { readonly kind: "payload"; readonly payload: BrowserPreviewCachePayload }
  | { readonly kind: "skipped"; readonly reason: "over-limit" | "not-cacheable" };

export type BrowserCachedPrefetchPreparation =
  | { readonly kind: "ready" }
  | { readonly kind: "derivative"; readonly derivative: { readonly blob: Blob; readonly mimeType: string; readonly filename: string } }
  | { readonly kind: "miss" }
  | { readonly kind: "failed" };

type StoredBrowserPreviewMaterial =
  | { readonly kind: "blob"; readonly blob: Blob }
  | { readonly kind: "stream"; readonly streamUrl: string };

let nextMaterialDiagnosticId = 1;
let nextResourceDiagnosticId = 1;

export class BrowserPreviewAbortPort {
  private nextId = 1;

  create(): BrowserPreviewAbortHandle {
    const controller = new AbortController();
    return Object.freeze({
      id: `preview-abort:${this.nextId++}`,
      signal: controller.signal,
      abort: () => controller.abort()
    });
  }
}

/**
 * Feature code sees only opaque material IDs. Browser adapters retain the
 * Blob/stream value until a resource owner applies it to a rendered preview.
 */
export class BrowserPreviewMaterialStore {
  private readonly sources = new WeakMap<BrowserPreviewMaterial, StoredBrowserPreviewMaterial>();

  blob(blob: Blob): BrowserPreviewMaterial {
    const material = Object.freeze({ id: `preview-material:${nextMaterialDiagnosticId++}`, kind: "blob" as const });
    this.sources.set(material, { kind: "blob", blob });
    return material;
  }

  stream(streamUrl: string): BrowserPreviewMaterial {
    const material = Object.freeze({ id: `preview-material:${nextMaterialDiagnosticId++}`, kind: "stream" as const });
    this.sources.set(material, { kind: "stream", streamUrl });
    return material;
  }

  source(material: BrowserPreviewMaterial): { readonly kind: "blob"; readonly blob: Blob } | { readonly kind: "stream"; readonly streamUrl: string } {
    const source = this.sources.get(material);
    if (!source) {
      throw new Error("Preview material was not created by this browser preview material store.");
    }
    return source;
  }
}

export class BrowserPreviewResourcePort {
  private readonly resources = new Map<BrowserPreviewResource, { readonly source: "blob" | "stream"; readonly url: string }>();

  constructor(private readonly materials: BrowserPreviewMaterialStore) {}

  apply(material: BrowserPreviewMaterial): BrowserPreviewResource {
    const source = this.materials.source(material);
    const url = source.kind === "blob" ? URL.createObjectURL(source.blob) : source.streamUrl;
    const resource = Object.freeze({
      id: `preview-resource:${nextResourceDiagnosticId++}`,
      kind: source.kind
    });
    this.resources.set(resource, { source: source.kind, url });
    return resource;
  }

  release(resource: BrowserPreviewResource): void {
    const existing = this.resources.get(resource);
    if (!existing) return;
    this.resources.delete(resource);
    if (existing.source === "blob") {
      URL.revokeObjectURL(existing.url);
    }
  }

  /** Rendering code may resolve a URL, but the pure session state never does. */
  url(resource: BrowserPreviewResource): string | undefined {
    return this.resources.get(resource)?.url;
  }
}

export interface PreviewTransport {
  getFile(path: string, token: string, signal?: AbortSignal): Promise<FileResponse>;
  fetchOriginalFile(path: string, token: string, signal?: AbortSignal): Promise<{ blob: Blob; mimeType: string; filename: string }>;
  createStreamingFileUrl(path: string, token: string, signal?: AbortSignal): Promise<string>;
}

export interface BrowserPreviewLiveAdapterOptions {
  /** The token stays in composition code; it never becomes part of PreviewRequestKey. */
  readonly tokenFor: (key: BrowserPreviewRequestKey) => string | undefined;
  readonly materials: BrowserPreviewMaterialStore;
  readonly transport?: PreviewTransport;
  readonly decodeHeicPreview?: (blob: Blob) => Promise<{ readonly blob: Blob; readonly mimeType: string }>;
}

function normalizeMimeType(mimeType: string | undefined): string | undefined {
  return mimeType?.split(";", 1)[0]?.trim();
}

function previewFingerprint(file: FilePreview, options: { readonly filename?: string } = {}): string {
  return JSON.stringify({
    path: file.path,
    name: file.name,
    size: file.size,
    mimeType: normalizeMimeType(file.mimeType),
    lastModified: file.lastModified,
    etag: file.etag,
    viewer: file.viewer,
    content: file.content,
    encoding: file.encoding,
    truncated: file.truncated,
    bytesRead: file.bytesRead,
    unsupportedReason: file.unsupportedReason,
    requiresOriginalBlob: file.requiresOriginalBlob,
    filename: options.filename
  });
}

function unsupportedHeicPreview(file: FilePreview, reason: string): FilePreview {
  return {
    path: file.path,
    name: file.name,
    isFolder: false,
    mimeType: file.mimeType ?? "image/heic",
    viewer: "unsupported",
    content: "",
    encoding: "none",
    truncated: false,
    bytesRead: 0,
    size: file.size,
    lastModified: file.lastModified,
    unsupportedReason: reason,
    requiresOriginalBlob: false
  };
}

function signalFor(abort: BrowserPreviewAbortHandle): AbortSignal {
  return abort.signal;
}

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

/** Keep full-file caching bounded without making cache policy part of pure state. */
export function previewFitsCacheLimit(key: BrowserPreviewRequestKey, preview: FilePreview, blob?: Blob): boolean {
  const byteSize = blob?.size ?? preview.size;
  return typeof byteSize === "number" && Number.isFinite(byteSize) && byteSize >= 0 && byteSize <= key.cacheLimitBytes;
}

const defaultTransport: PreviewTransport = { getFile, fetchOriginalFile, createStreamingFileUrl };

export class BrowserPreviewLiveAdapter {
  private readonly transport: PreviewTransport;
  private readonly decode: (blob: Blob) => Promise<{ readonly blob: Blob; readonly mimeType: string }>;

  constructor(private readonly options: BrowserPreviewLiveAdapterOptions) {
    this.transport = options.transport ?? defaultTransport;
    this.decode = options.decodeHeicPreview ?? decodeHeicPreview;
  }

  async acquire(key: BrowserPreviewRequestKey, abort: BrowserPreviewAbortHandle): Promise<BrowserPreviewAcquisition> {
    const token = this.options.tokenFor(key);
    if (!token) {
      throw new Error("A live session is required before opening this file online.");
    }
    const signal = signalFor(abort);
    const response = await this.transport.getFile(key.path, token, signal);
    if (isHeicLikeFile(response.file)) {
      return this.acquireHeic(response.file, key, token, signal);
    }
    return this.acquireStandard(response.file, key, token, signal);
  }

  /**
   * Turns validated retained-preview facts into a session acquisition. A
   * browser resource is still created only when the session applies it.
   */
  async materializeCached(
    key: BrowserPreviewRequestKey,
    input: BrowserCachedPreviewInput,
    abort: BrowserPreviewAbortHandle
  ): Promise<BrowserPreviewAcquisition | undefined> {
    const { preview, blob } = input;
    if (isHeicLikeFile(preview) && !key.heicPreviewEnabled) {
      return undefined;
    }
    if (!preview.requiresOriginalBlob) {
      return this.acquisition(preview, "inline", input);
    }
    if (blob) {
      // A record mimeType is the stored blob's own type: explicit keep-offline
      // persists the raw original, so a HEIC blob still needs local decoding.
      // The filename fallback covers retained records whose download blob was
      // stored with a generic application/octet-stream type.
      if ((isHeicMimeType(input.mimeType) || isHeicFileName(input.filename)) && key.heicPreviewEnabled) {
        return this.materializeCachedHeic(preview, input, blob, abort);
      }
      return this.acquisition(preview, "blob", input, this.options.materials.blob(blob));
    }
    if ((preview.viewer !== "audio" && preview.viewer !== "video") || key.connectionMode !== "online") {
      return undefined;
    }
    const token = this.tokenFor(key);
    const streamUrl = await this.transport.createStreamingFileUrl(key.path, token, signalFor(abort));
    return this.acquisition(preview, "stream", input, this.options.materials.stream(streamUrl));
  }

  /**
   * Pure eligibility for cache-first/prefetch decisions. In particular, this
   * never asks the Worker for a stream URL and never allocates an object URL.
   */
  isCachedUsable(key: BrowserPreviewRequestKey, retained: BrowserCachedPreviewInput): boolean {
    if (isHeicLikeFile(retained.preview) && !key.heicPreviewEnabled) {
      return false;
    }
    if (!retained.preview.requiresOriginalBlob || retained.blob) {
      return true;
    }
    return (retained.preview.viewer === "audio" || retained.preview.viewer === "video")
      && key.connectionMode === "online"
      && Boolean(this.options.tokenFor(key));
  }

  /** Prepares retained bytes for gallery navigation without allocating render material. */
  async prepareCachedForPrefetch(
    key: BrowserPreviewRequestKey,
    input: BrowserCachedPreviewInput,
    abort: BrowserPreviewAbortHandle
  ): Promise<BrowserCachedPrefetchPreparation> {
    if (!this.isCachedUsable(key, input)) return { kind: "miss" };
    const rawHeic = isHeicLikeFile(input.preview)
      && (isHeicMimeType(input.mimeType) || isHeicFileName(input.filename));
    if (!rawHeic) return { kind: "ready" };
    if (!input.blob || input.blob.size > HEIC_PREVIEW_MAX_SOURCE_BYTES) return { kind: "failed" };
    try {
      const decoded = await this.decode(input.blob);
      if (signalFor(abort).aborted) throw new DOMException("Aborted", "AbortError");
      return {
        kind: "derivative",
        derivative: {
          blob: decoded.blob,
          mimeType: decoded.mimeType,
          filename: `${input.filename}.jpg`
        }
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (signalFor(abort).aborted) throw new DOMException("Aborted", "AbortError");
      return { kind: "failed" };
    }
  }

  /**
   * Produces the persistence payload after live acquisition. Stream playback
   * remains immediate; only the optional cache write fetches its full Blob.
   */
  async cachePayload(
    key: BrowserPreviewRequestKey,
    acquisition: BrowserPreviewAcquisition,
    abort: BrowserPreviewAbortHandle
  ): Promise<BrowserPreviewCachePayloadResult> {
    const { preview, source, unsupported } = acquisition.snapshot;
    // Disabled, oversized, and decode-failed HEIC fallbacks must not pollute retention.
    if (unsupported === "heic-fallback" || (isHeicLikeFile(preview) && !key.heicPreviewEnabled)) {
      return { kind: "skipped", reason: "not-cacheable" };
    }
    const cache = acquisition.cache ?? { mimeType: preview.mimeType ?? "application/octet-stream", filename: preview.name };
    if (source === "inline") {
      return { kind: "payload", payload: { preview, ...cache } };
    }
    if (!acquisition.material) {
      return { kind: "skipped", reason: "not-cacheable" };
    }
    const material = this.options.materials.source(acquisition.material);
    if (material.kind === "blob") {
      return { kind: "payload", payload: { preview, blob: material.blob, ...cache } };
    }
    if (!previewFitsCacheLimit(key, preview)) {
      return { kind: "skipped", reason: "over-limit" };
    }
    const token = this.tokenFor(key);
    const original = await this.transport.fetchOriginalFile(key.path, token, signalFor(abort));
    return { kind: "payload", payload: { preview, blob: original.blob, mimeType: original.mimeType, filename: original.filename } };
  }

  private async acquireHeic(file: FilePreview, key: BrowserPreviewRequestKey, token: string, signal: AbortSignal): Promise<BrowserPreviewAcquisition> {
    const mimeType = file.mimeType ?? "image/heic";
    const filename = file.name;
    if (!key.heicPreviewEnabled) {
      const preview = unsupportedHeicPreview(file, "HEIC preview is experimental and disabled in this browser. Enable experimental HEIC preview in Profile & settings to try local decoding, or open/download the original file.");
      return this.acquisition(preview, "inline", { mimeType, filename }, undefined, "heic-fallback");
    }
    if (typeof file.size === "number" && file.size > HEIC_PREVIEW_MAX_SOURCE_BYTES) {
      const preview = unsupportedHeicPreview(file, `HEIC preview is limited to files up to ${Math.round(HEIC_PREVIEW_MAX_SOURCE_BYTES / (1024 * 1024))} MB.`);
      return this.acquisition(preview, "inline", { mimeType, filename }, undefined, "heic-fallback");
    }

    const original = await this.transport.fetchOriginalFile(key.path, token, signal);
    try {
      const decoded = await this.decode(original.blob);
      const preview: FilePreview = {
        ...file,
        viewer: "image",
        content: "",
        encoding: "none",
        truncated: false,
        bytesRead: 0,
        requiresOriginalBlob: true,
        unsupportedReason: undefined
      };
      return this.acquisition(
        preview,
        "blob",
        {
          mimeType: decoded.mimeType,
          filename: `${filename}.jpg`,
          // Kept-offline records must hold the true original bytes, so the
          // fetched source rides along to the cache write. A canonical HEIC
          // mime keeps reads on the decode path even when the download was
          // labeled with a generic type.
          original: { blob: original.blob, mimeType: isHeicMimeType(mimeType) ? mimeType : "image/heic", filename }
        },
        this.options.materials.blob(decoded.blob)
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const preview = unsupportedHeicPreview(file, error instanceof Error
        ? `HEIC preview could not be decoded locally: ${error.message}`
        : "HEIC preview could not be decoded locally. You can still open or download the original file.");
      return this.acquisition(preview, "inline", { mimeType: original.mimeType || mimeType, filename }, undefined, "heic-fallback");
    }
  }

  private async materializeCachedHeic(preview: FilePreview, input: BrowserCachedPreviewInput, blob: Blob, abort: BrowserPreviewAbortHandle): Promise<BrowserPreviewAcquisition> {
    const { mimeType, filename } = input;
    if (blob.size > HEIC_PREVIEW_MAX_SOURCE_BYTES) {
      const fallback = unsupportedHeicPreview(preview, `HEIC preview is limited to files up to ${Math.round(HEIC_PREVIEW_MAX_SOURCE_BYTES / (1024 * 1024))} MB.`);
      return this.acquisition(fallback, "inline", { mimeType, filename }, undefined, "heic-fallback");
    }
    try {
      const decoded = await this.decode(blob);
      const decodedPreview: FilePreview = {
        ...preview,
        viewer: "image",
        content: "",
        encoding: "none",
        truncated: false,
        bytesRead: 0,
        requiresOriginalBlob: true,
        unsupportedReason: undefined
      };
      return this.acquisition(
        decodedPreview,
        "blob",
        { mimeType: decoded.mimeType, filename: `${filename}.jpg` },
        this.options.materials.blob(decoded.blob),
        "none",
        { blob: decoded.blob, mimeType: decoded.mimeType, filename: `${filename}.jpg` }
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (signalFor(abort).aborted) throw new DOMException("Aborted", "AbortError");
      const reason = error instanceof Error
        ? `HEIC preview could not be decoded locally: ${error.message}`
        : "HEIC preview could not be decoded locally. You can still open or download the original file.";
      return this.acquisition(unsupportedHeicPreview(preview, reason), "inline", { mimeType, filename }, undefined, "heic-fallback");
    }
  }

  private async acquireStandard(file: FilePreview, key: BrowserPreviewRequestKey, token: string, signal: AbortSignal): Promise<BrowserPreviewAcquisition> {
    const mimeType = file.mimeType ?? "text/plain";
    const filename = file.name;
    if (!file.requiresOriginalBlob) {
      return this.acquisition(file, "inline", { mimeType, filename });
    }
    if (file.viewer === "audio" || file.viewer === "video") {
      const streamUrl = await this.transport.createStreamingFileUrl(key.path, token, signal);
      return this.acquisition(file, "stream", { mimeType, filename }, this.options.materials.stream(streamUrl));
    }
    const original = await this.transport.fetchOriginalFile(key.path, token, signal);
    return this.acquisition(file, "blob", { mimeType: original.mimeType, filename: original.filename }, this.options.materials.blob(original.blob));
  }

  private tokenFor(key: BrowserPreviewRequestKey): string {
    const token = this.options.tokenFor(key);
    if (!token) {
      throw new Error("A live session is required before opening this file online.");
    }
    return token;
  }

  private acquisition(
    preview: FilePreview,
    source: BrowserPreviewSnapshot["source"],
    cache: BrowserPreviewCacheMetadata,
    material?: BrowserPreviewMaterial,
    unsupported: BrowserPreviewSnapshot["unsupported"] = "none",
    derivative?: BrowserPreviewAcquisition["derivative"]
  ): BrowserPreviewAcquisition {
    return {
      snapshot: {
        preview,
        fingerprint: previewFingerprint(preview, {
          filename: cache.filename
        }),
        source,
        unsupported
      },
      ...(material ? { material } : {}),
      cache,
      ...(derivative === undefined ? {} : { derivative })
    };
  }
}
