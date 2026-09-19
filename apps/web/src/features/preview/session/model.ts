import type { FilePreview } from "@davora/shared";

export type PreviewConnectionMode = "online" | "cache-only";
export type PreviewTarget = "previewable" | "ordinary-unsupported" | "heic";
export type PreviewSource = "inline" | "blob" | "stream";
export type PreviewUnsupported = "none" | "heic-fallback";

export interface PreviewRequestKeyInput {
  readonly requestSequence: number;
  readonly accountId: string;
  readonly cacheNamespace: string;
  readonly path: string;
  /** Opaque account/session context generation. Never a credential or stream token. */
  readonly contextGeneration: string;
  readonly connectionMode: PreviewConnectionMode;
  readonly heicPreviewEnabled: boolean;
  readonly freshnessIntervalMs: number;
  readonly cacheLimitBytes: number;
}

/**
 * Complete ownership identity for one preview acquisition. Keep credentials,
 * request headers, and stream URLs outside this pure model.
 */
export interface PreviewRequestKey extends PreviewRequestKeyInput {
  readonly path: string;
}

export interface PreviewSnapshotInput {
  readonly preview: FilePreview;
  readonly fingerprint: string;
  readonly source: PreviewSource;
  readonly unsupported?: PreviewUnsupported;
}

/** A renderable preview fact with no browser resource or URL. */
export interface PreviewSnapshot {
  readonly preview: FilePreview;
  readonly fingerprint: string;
  readonly source: PreviewSource;
  readonly unsupported: PreviewUnsupported;
}

export type CachedPreviewStatus = "fresh" | "cache-only" | "refreshing" | "refresh-failed" | "refresh-skipped" | "verified";

export type PreviewSessionState =
  | { readonly kind: "closed" }
  | { readonly kind: "opening"; readonly key: PreviewRequestKey }
  | { readonly kind: "cached"; readonly key: PreviewRequestKey; readonly current: PreviewSnapshot; readonly status: CachedPreviewStatus; readonly cachedAt?: string }
  | { readonly kind: "live"; readonly key: PreviewRequestKey; readonly current: PreviewSnapshot }
  | { readonly kind: "refresh-ready"; readonly key: PreviewRequestKey; readonly current: PreviewSnapshot; readonly next: PreviewSnapshot; readonly cachedAt?: string }
  | { readonly kind: "failed"; readonly key: PreviewRequestKey; readonly message: string };

export interface PreviewOpenRequest extends Omit<PreviewRequestKeyInput, "requestSequence"> {
  readonly target: PreviewTarget;
}

export function normalizePreviewPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

export function createPreviewRequestKey(input: PreviewRequestKeyInput): PreviewRequestKey {
  return Object.freeze({
    requestSequence: input.requestSequence,
    accountId: input.accountId,
    cacheNamespace: input.cacheNamespace,
    path: normalizePreviewPath(input.path),
    contextGeneration: input.contextGeneration,
    connectionMode: input.connectionMode,
    heicPreviewEnabled: input.heicPreviewEnabled,
    freshnessIntervalMs: input.freshnessIntervalMs,
    cacheLimitBytes: input.cacheLimitBytes
  });
}

export function samePreviewRequestKey(left: PreviewRequestKey, right: PreviewRequestKey): boolean {
  return left.requestSequence === right.requestSequence
    && left.accountId === right.accountId
    && left.cacheNamespace === right.cacheNamespace
    && left.path === right.path
    && left.contextGeneration === right.contextGeneration
    && left.connectionMode === right.connectionMode
    && left.heicPreviewEnabled === right.heicPreviewEnabled
    && left.freshnessIntervalMs === right.freshnessIntervalMs
    && left.cacheLimitBytes === right.cacheLimitBytes;
}

function snapshotFilePreview(preview: FilePreview): FilePreview {
  return Object.freeze({ ...preview });
}

export function createPreviewSnapshot(input: PreviewSnapshotInput): PreviewSnapshot {
  return Object.freeze({
    preview: snapshotFilePreview(input.preview),
    fingerprint: input.fingerprint,
    source: input.source,
    unsupported: input.unsupported ?? "none"
  });
}

export function closedPreviewSession(): PreviewSessionState {
  return Object.freeze({ kind: "closed" });
}

/** Re-snapshots externally supplied state before it crosses the publication port. */
export function createPreviewSessionState(input: PreviewSessionState): PreviewSessionState {
  switch (input.kind) {
    case "closed":
      return closedPreviewSession();
    case "opening":
      return Object.freeze({ kind: "opening", key: createPreviewRequestKey(input.key) });
    case "cached":
      return Object.freeze({
        kind: "cached",
        key: createPreviewRequestKey(input.key),
        current: createPreviewSnapshot(input.current),
        status: input.status,
        ...(input.cachedAt === undefined ? {} : { cachedAt: input.cachedAt })
      });
    case "live":
      return Object.freeze({
        kind: "live",
        key: createPreviewRequestKey(input.key),
        current: createPreviewSnapshot(input.current)
      });
    case "refresh-ready":
      return Object.freeze({
        kind: "refresh-ready",
        key: createPreviewRequestKey(input.key),
        current: createPreviewSnapshot(input.current),
        next: createPreviewSnapshot(input.next),
        ...(input.cachedAt === undefined ? {} : { cachedAt: input.cachedAt })
      });
    case "failed":
      return Object.freeze({ kind: "failed", key: createPreviewRequestKey(input.key), message: input.message });
  }
}
