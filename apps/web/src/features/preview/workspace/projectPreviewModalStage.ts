import type { FileEntry, FilePreview } from "@davora/shared";

import type { ApiRequestError } from "../../../lib/api";
import type { FileSizeDisplayMode } from "../../../lib/fileSize";
import type { PreviewCacheState, PreviewModalRuntimePorts, PreviewModalStageProps } from "../shell";

export interface PreviewModalStageProjectionInput {
  readonly open: boolean;
  readonly accountId?: string;
  readonly entry?: FileEntry;
  readonly file?: FilePreview;
  readonly blobUrl?: string;
  readonly offline: boolean;
  readonly workerUnavailable?: boolean;
  readonly loading: boolean;
  readonly error?: Error | ApiRequestError;
  readonly token?: string;
  readonly cacheState: PreviewCacheState;
  readonly fileSizeDisplayMode: FileSizeDisplayMode;
  readonly imageFitMode: PreviewModalStageProps["imageFitMode"];
  readonly videoMuted: PreviewModalStageProps["videoMuted"];
  readonly maxCacheableFileSizeBytes: number;
  readonly ports: PreviewModalRuntimePorts;
  readonly onImageFitModeChange: PreviewModalStageProps["onImageFitModeChange"];
  readonly onVideoMutedChange: PreviewModalStageProps["onVideoMutedChange"];
  readonly onApplyRefresh?: PreviewModalStageProps["onApplyRefresh"];
  readonly onDownload?: PreviewModalStageProps["onDownload"];
  readonly onPrevious?: PreviewModalStageProps["onPrevious"];
  readonly onNext?: PreviewModalStageProps["onNext"];
  readonly onMediaPlaybackChange?: PreviewModalStageProps["onMediaPlaybackChange"];
  readonly onClose: PreviewModalStageProps["onClose"];
}

/** Purely binds workspace state and semantic callbacks to the shell Stage contract. */
export function projectPreviewModalStage(input: PreviewModalStageProjectionInput): PreviewModalStageProps {
  return {
    open: input.open,
    accountId: input.accountId,
    entry: input.entry,
    file: input.file,
    blobUrl: input.blobUrl,
    offline: input.offline,
    workerUnavailable: input.workerUnavailable,
    loading: input.loading,
    error: input.error,
    token: input.token,
    cacheState: input.cacheState,
    fileSizeDisplayMode: input.fileSizeDisplayMode,
    imageFitMode: input.imageFitMode,
    videoMuted: input.videoMuted,
    maxCacheableFileSizeBytes: input.maxCacheableFileSizeBytes,
    ports: input.ports,
    onImageFitModeChange: input.onImageFitModeChange,
    onVideoMutedChange: input.onVideoMutedChange,
    onApplyRefresh: input.onApplyRefresh,
    onDownload: input.onDownload,
    onPrevious: input.onPrevious,
    onNext: input.onNext,
    onMediaPlaybackChange: input.onMediaPlaybackChange,
    onClose: input.onClose
  };
}
