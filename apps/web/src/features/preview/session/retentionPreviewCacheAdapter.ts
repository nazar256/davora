import type {
  RetainedFile,
  RetainedSnapshot,
  RetentionRepository,
  RetentionResult
} from "../../offline/retention";
import type { PreviewRequestKey } from "./model";
import type {
  PreviewAbortHandle,
  PreviewAcquisition,
  PreviewCacheEntry,
  PreviewCachePort,
  PreviewCacheSnapshot,
  PreviewCacheWriteResult
} from "./ports";

/**
 * Structural runtime boundary supplied by the browser-preview adapter at the
 * composition root. It deliberately contains no storage or account policy.
 */
export interface RetentionPreviewRuntime {
  materializeCached(
    key: PreviewRequestKey,
    input: { readonly preview: NonNullable<RetainedFile["preview"]>; readonly blob?: Blob; readonly mimeType: string; readonly filename: string },
    abort: RetentionPreviewRuntimeAbort
  ): Promise<PreviewAcquisition | undefined>;
  cachePayload(
    key: PreviewRequestKey,
    acquisition: PreviewAcquisition,
    abort: RetentionPreviewRuntimeAbort
  ): Promise<RetentionPreviewCachePayloadResult>;
}

export interface RetentionPreviewCachePayload {
  readonly preview: NonNullable<RetainedFile["preview"]>;
  readonly blob?: Blob;
  readonly mimeType: string;
  readonly filename: string;
}

export type RetentionPreviewCachePayloadResult =
  | { readonly kind: "payload"; readonly payload: RetentionPreviewCachePayload }
  | { readonly kind: "skipped"; readonly reason: "over-limit" | "not-cacheable" };

export interface RetentionPreviewCachedInput {
  readonly preview: NonNullable<RetainedFile["preview"]>;
  readonly blob?: Blob;
  readonly mimeType: string;
  readonly filename: string;
}

/** Runtime facts needed for gallery prefetch without resource allocation. */
export interface RetentionPreviewPrefetchRuntime extends RetentionPreviewRuntime {
  isCachedUsable(key: PreviewRequestKey, retained: RetentionPreviewCachedInput): boolean;
  acquire(key: PreviewRequestKey, abort: RetentionPreviewRuntimeAbort): Promise<PreviewAcquisition>;
}

export interface PreviewPrefetchPort {
  probe(key: PreviewRequestKey, abort: PreviewAbortHandle): Promise<boolean>;
  prefetch(
    key: PreviewRequestKey,
    policy: { readonly accept: (acquisition: PreviewAcquisition) => boolean },
    abort: PreviewAbortHandle
  ): Promise<{ readonly kind: "cached" | "persisted" | "skipped" | "superseded" }>;
}

/** Browser runtime work must receive a real signal, while Worker A stays DOM-free. */
export interface RetentionPreviewRuntimeAbort extends PreviewAbortHandle {
  readonly signal: AbortSignal;
}

export class RetentionPreviewCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetentionPreviewCacheError";
  }
}

function accountFor(key: PreviewRequestKey) {
  return { accountId: key.accountId, cacheNamespace: key.cacheNamespace };
}

function isAborted(abort: PreviewAbortHandle): boolean {
  return (abort as Partial<RetentionPreviewRuntimeAbort>).signal?.aborted === true;
}

function assertNotAborted(abort: PreviewAbortHandle): void {
  if (isAborted(abort)) {
    throw new DOMException("Preview request was aborted.", "AbortError");
  }
}

function runtimeAbort(abort: PreviewAbortHandle): RetentionPreviewRuntimeAbort {
  const signal = (abort as Partial<RetentionPreviewRuntimeAbort>).signal;
  if (!signal) {
    throw new RetentionPreviewCacheError("Preview runtime requires an abort signal.");
  }
  return abort as RetentionPreviewRuntimeAbort;
}

function unwrap<T>(result: RetentionResult<T>): T {
  if (result.kind === "failure") {
    throw new RetentionPreviewCacheError(result.message);
  }
  return result.value;
}

function cacheSnapshot(snapshot: RetainedSnapshot): PreviewCacheSnapshot {
  return Object.freeze({
    itemCount: snapshot.normalCache.itemCount,
    totalBytes: snapshot.normalCache.totalBytes,
    limitBytes: snapshot.normalCache.limitBytes
  });
}

function cachedAtMs(file: RetainedFile): number {
  const parsed = Date.parse(file.cachedAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function byteSize(size: number | undefined, blob: Blob | undefined): number {
  if (blob) return blob.size;
  return typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : 0;
}

function writeFile(payload: RetentionPreviewCachePayload): RetainedFile {
  const size = byteSize(payload.preview.size, payload.blob);
  return Object.freeze({
    path: payload.preview.path,
    name: payload.filename,
    mimeType: payload.mimeType,
    size,
    preview: payload.preview,
    blobSize: payload.blob?.size ?? 0,
    readable: payload.blob !== undefined,
    normalCacheOwnership: "owned"
  });
}

function cachedInput(stored: NonNullable<Awaited<ReturnType<RetentionRepository["readPreview"]>> extends RetentionResult<infer Value> ? Value : never>): RetentionPreviewCachedInput | undefined {
  if (!stored.file.preview) return undefined;
  return {
    preview: stored.file.preview,
    ...(stored.blob === undefined ? {} : { blob: stored.blob }),
    mimeType: stored.file.mimeType,
    filename: stored.file.name
  };
}

function prefetchStreamFile(acquisition: PreviewAcquisition): RetainedFile {
  const preview = acquisition.snapshot.preview;
  const size = byteSize(preview.size, undefined);
  return Object.freeze({
    path: preview.path,
    name: preview.name,
    mimeType: preview.mimeType ?? "application/octet-stream",
    size,
    preview,
    blobSize: 0,
    readable: false,
    normalCacheOwnership: "owned"
  });
}

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

/**
 * Feature-owned PreviewCachePort implementation over the public retention
 * repository. Storage remains behind RetentionRepository and browser values
 * remain behind RetentionPreviewRuntime.
 */
export class RetentionPreviewCacheAdapter implements PreviewCachePort {
  constructor(
    private readonly repository: RetentionRepository,
    private readonly runtime: RetentionPreviewRuntime
  ) {}

  async read(key: PreviewRequestKey, abort: PreviewAbortHandle): Promise<PreviewCacheEntry | undefined> {
    assertNotAborted(abort);
    const stored = unwrap(await this.repository.readPreview(accountFor(key), key.path));
    assertNotAborted(abort);
    if (!stored) {
      return undefined;
    }
    const input = cachedInput(stored);
    if (!input) return undefined;
    const acquisition = await this.runtime.materializeCached(key, input, runtimeAbort(abort));
    assertNotAborted(abort);
    return acquisition === undefined ? undefined : Object.freeze({
      acquisition,
      ...(stored.file.cachedAt === undefined ? {} : { cachedAt: stored.file.cachedAt }),
      cachedAtMs: cachedAtMs(stored.file)
    });
  }

  async write(key: PreviewRequestKey, acquisition: PreviewAcquisition, abort: PreviewAbortHandle): Promise<PreviewCacheWriteResult> {
    assertNotAborted(abort);
    const result = await this.runtime.cachePayload(key, acquisition, runtimeAbort(abort));
    assertNotAborted(abort);
    if (result.kind === "skipped") {
      return Object.freeze({ kind: "skipped", reason: result.reason });
    }
    const snapshot = unwrap(await this.repository.writePreview(accountFor(key), {
      file: writeFile(result.payload),
      ...(result.payload.blob === undefined ? {} : { blob: result.payload.blob })
    }));
    assertNotAborted(abort);
    return Object.freeze({ kind: "stored", snapshot: cacheSnapshot(snapshot) });
  }

  /** Reads only persistent preview facts; no browser material or stream URL is allocated. */
  async probe(key: PreviewRequestKey, runtime: Pick<RetentionPreviewPrefetchRuntime, "isCachedUsable">, abort: PreviewAbortHandle): Promise<boolean> {
    assertNotAborted(abort);
    const stored = unwrap(await this.repository.readPreview(accountFor(key), key.path));
    assertNotAborted(abort);
    const input = stored === undefined ? undefined : cachedInput(stored);
    return input !== undefined && runtime.isCachedUsable(key, input);
  }

  /**
   * Gallery stream prefetch stores metadata only. Interactive stream writes
   * still use `write`, whose runtime cache payload fetches the original Blob.
   */
  async writePrefetch(key: PreviewRequestKey, acquisition: PreviewAcquisition, abort: PreviewAbortHandle): Promise<PreviewCacheWriteResult> {
    assertNotAborted(abort);
    if (acquisition.snapshot.source !== "stream") {
      return this.write(key, acquisition, abort);
    }
    const snapshot = unwrap(await this.repository.writePreview(accountFor(key), {
      file: prefetchStreamFile(acquisition)
    }));
    assertNotAborted(abort);
    return Object.freeze({ kind: "stored", snapshot: cacheSnapshot(snapshot) });
  }
}

export class RetentionPreviewPrefetchAdapter implements PreviewPrefetchPort {
  constructor(
    private readonly cache: RetentionPreviewCacheAdapter,
    private readonly runtime: RetentionPreviewPrefetchRuntime
  ) {}

  probe(key: PreviewRequestKey, abort: PreviewAbortHandle): Promise<boolean> {
    return this.cache.probe(key, this.runtime, abort);
  }

  async prefetch(
    key: PreviewRequestKey,
    policy: { readonly accept: (acquisition: PreviewAcquisition) => boolean },
    abort: PreviewAbortHandle
  ): Promise<{ readonly kind: "cached" | "persisted" | "skipped" | "superseded" }> {
    try {
      if (await this.probe(key, abort)) {
        return Object.freeze({ kind: "cached" });
      }
      assertNotAborted(abort);
      const acquisition = await this.runtime.acquire(key, runtimeAbort(abort));
      if (isAborted(abort)) return Object.freeze({ kind: "superseded" });
      if (!policy.accept(acquisition)) return Object.freeze({ kind: "skipped" });
      if (isAborted(abort)) return Object.freeze({ kind: "superseded" });
      await this.cache.writePrefetch(key, acquisition, abort);
      return isAborted(abort) ? Object.freeze({ kind: "superseded" }) : Object.freeze({ kind: "persisted" });
    } catch (error) {
      return Object.freeze({ kind: isAbort(error) || isAborted(abort) ? "superseded" : "skipped" });
    }
  }
}

export function createRetentionPreviewCacheAdapter(
  repository: RetentionRepository,
  runtime: RetentionPreviewRuntime
): RetentionPreviewCacheAdapter {
  return new RetentionPreviewCacheAdapter(repository, runtime);
}

export function createRetentionPreviewPrefetchAdapter(
  cache: RetentionPreviewCacheAdapter,
  runtime: RetentionPreviewPrefetchRuntime
): RetentionPreviewPrefetchAdapter {
  return new RetentionPreviewPrefetchAdapter(cache, runtime);
}
