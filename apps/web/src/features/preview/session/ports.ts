import type { PreviewRequestKey, PreviewSessionState, PreviewSnapshot } from "./model";

/** Opaque adapter-owned content. It may wrap a Blob or a short-lived stream URL. */
export interface PreviewMaterial {
  readonly id: string;
  readonly kind: "blob" | "stream";
}

/** Applied adapter resource. Its URL/value never enters the pure state model. */
export interface PreviewResource {
  readonly id: string;
  readonly kind: "blob" | "stream";
}

export interface PreviewAcquisition {
  readonly snapshot: PreviewSnapshot;
  readonly material?: PreviewMaterial;
}

export interface PreviewCacheEntry {
  readonly acquisition: PreviewAcquisition;
  /** Exact persisted timestamp for UI display; not used for freshness math. */
  readonly cachedAt?: string;
  /** Validated numeric epoch milliseconds used only for freshness math. */
  readonly cachedAtMs: number;
}

/** Public cache accounting facts, deliberately independent of storage internals. */
export interface PreviewCacheSnapshot {
  readonly itemCount: number;
  readonly totalBytes: number;
  readonly limitBytes: number;
}

export type PreviewCacheWriteResult =
  | { readonly kind: "stored"; readonly snapshot: PreviewCacheSnapshot }
  | { readonly kind: "skipped"; readonly reason: "over-limit" | "not-cacheable" };

export type PreviewCacheEvent =
  | { readonly kind: "stream-cache-ready"; readonly key: PreviewRequestKey; readonly snapshot: PreviewCacheSnapshot }
  | { readonly kind: "stream-cache-failed"; readonly key: PreviewRequestKey; readonly message: string };

export type PreviewFailure =
  | { readonly kind: "aborted" }
  | { readonly kind: "session-terminal"; readonly reason: "session-expired" | "reconnect-required"; readonly message: string }
  | { readonly kind: "backend-unavailable"; readonly message: string }
  | { readonly kind: "ordinary"; readonly message: string };

/** Structural so the feature has no DOM AbortController dependency. */
export interface PreviewAbortHandle {
  readonly id: string;
  abort(): void;
}

export interface PreviewCachePort {
  read(key: PreviewRequestKey, abort: PreviewAbortHandle): Promise<PreviewCacheEntry | undefined>;
  write(key: PreviewRequestKey, acquisition: PreviewAcquisition, abort: PreviewAbortHandle): Promise<PreviewCacheWriteResult>;
}

/**
 * A runtime adapter owns live metadata, original-blob, and stream acquisition.
 * The pure controller only receives a typed, already-classified acquisition.
 */
export interface PreviewLivePort {
  acquire(key: PreviewRequestKey, abort: PreviewAbortHandle): Promise<PreviewAcquisition>;
}

export interface PreviewAbortPort {
  create(): PreviewAbortHandle;
}

export interface PreviewResourcePort {
  apply(material: PreviewMaterial): PreviewResource;
  release(resource: PreviewResource): void;
}

export interface PreviewCurrentPort {
  isCurrent(key: PreviewRequestKey): boolean;
}

/** Maps adapter/runtime failures without coupling the feature to API error classes. */
export interface PreviewFailureClassifier {
  classify(error: unknown): PreviewFailure;
}

/** Emits an already-classified current failure for the composition root. */
export interface PreviewFailurePublicationPort {
  publishFailure(key: PreviewRequestKey, failure: Exclude<PreviewFailure, { readonly kind: "aborted" }>): boolean;
}

/** Publish pairs pure state with an optional adapter-owned applied resource. */
export interface PreviewPublicationPort {
  publish(state: PreviewSessionState, resource?: PreviewResource): boolean;
}

export interface PreviewCachePublicationPort {
  publishSnapshot(key: PreviewRequestKey, snapshot: PreviewCacheSnapshot): boolean;
  publishEvent(event: PreviewCacheEvent): boolean;
}

export interface PreviewClockPort {
  now(): number;
}

export interface PreviewSessionPorts {
  readonly cache: PreviewCachePort;
  readonly live: PreviewLivePort;
  readonly abort: PreviewAbortPort;
  readonly resources: PreviewResourcePort;
  readonly current: PreviewCurrentPort;
  readonly failures: PreviewFailureClassifier;
  readonly failurePublication: PreviewFailurePublicationPort;
  readonly publication: PreviewPublicationPort;
  readonly cachePublication: PreviewCachePublicationPort;
  readonly clock: PreviewClockPort;
}
