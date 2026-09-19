import type { FilePreview } from "@davora/shared";

import type { PreviewCacheState } from "../shell";
import type { PreviewSessionState } from "./model";

export interface PendingPreviewUpdate {
  readonly file: FilePreview;
  readonly blob?: Blob;
}

export const DEFAULT_PREVIEW_CACHE_STATE: PreviewCacheState = {
  source: "none",
  refreshing: false,
  stale: false,
  updateReady: false
};

export interface PreviewUiPublication {
  readonly selected: FilePreview | undefined;
  readonly previewOpen: boolean;
  readonly loadingPreview: boolean;
  readonly previewError: Error | undefined;
  readonly pendingPreviewUpdate: PendingPreviewUpdate | undefined;
  readonly previewCacheState: PreviewCacheState;
  readonly clearOpenedEntry: boolean;
}

export function mapPreviewSessionPublication(state: PreviewSessionState): PreviewUiPublication {
  switch (state.kind) {
    case "closed":
      return {
        selected: undefined,
        previewOpen: false,
        loadingPreview: false,
        previewError: undefined,
        pendingPreviewUpdate: undefined,
        previewCacheState: DEFAULT_PREVIEW_CACHE_STATE,
        clearOpenedEntry: true
      };
    case "opening":
      return {
        selected: undefined,
        previewOpen: true,
        loadingPreview: true,
        previewError: undefined,
        pendingPreviewUpdate: undefined,
        previewCacheState: DEFAULT_PREVIEW_CACHE_STATE,
        clearOpenedEntry: false
      };
    case "cached":
      return {
        selected: state.current.preview,
        previewOpen: true,
        loadingPreview: false,
        previewError: undefined,
        pendingPreviewUpdate: undefined,
        previewCacheState: {
          source: "cache",
          ...(state.cachedAt === undefined ? {} : { cachedAt: state.cachedAt }),
          refreshing: state.status === "refreshing",
          stale: state.status === "cache-only" || state.status === "refresh-failed" || state.status === "refresh-skipped",
          updateReady: false
        },
        clearOpenedEntry: false
      };
    case "live":
      return {
        selected: state.current.preview,
        previewOpen: true,
        loadingPreview: false,
        previewError: undefined,
        pendingPreviewUpdate: undefined,
        previewCacheState: { source: "live", refreshing: false, stale: false, updateReady: false },
        clearOpenedEntry: false
      };
    case "refresh-ready":
      return {
        selected: state.current.preview,
        previewOpen: true,
        loadingPreview: false,
        previewError: undefined,
        pendingPreviewUpdate: { file: state.next.preview },
        previewCacheState: {
          source: "cache",
          ...(state.cachedAt === undefined ? {} : { cachedAt: state.cachedAt }),
          refreshing: false,
          stale: true,
          updateReady: true
        },
        clearOpenedEntry: false
      };
    case "failed":
      return {
        selected: undefined,
        previewOpen: true,
        loadingPreview: false,
        previewError: new Error(state.message),
        pendingPreviewUpdate: undefined,
        previewCacheState: DEFAULT_PREVIEW_CACHE_STATE,
        clearOpenedEntry: false
      };
  }
}
