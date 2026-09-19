import { useEffect, useState, type MouseEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Info
} from "lucide-react";

import type { FileEntry, FilePreview } from "@davora/shared";
import { basename, dirname, toDisplayPath } from "@davora/shared";

import { MarkdownPreview } from "../../../components/MarkdownPreview";
import { StateBanner } from "../../../components/StateBanner";
import { useModalFocusBoundary } from "../../../components/useModalFocusBoundary";
import { ApiRequestError } from "../../../lib/api";
import { formatFileSize, type FileSizeDisplayMode } from "../../../lib/fileSize";
import { isHeicLikeFile } from "../../../lib/heicPreview";
import { AudioPreviewStage, useAudioPreviewInteraction } from "../audio";
import {
  ImagePreviewStage,
  resolveImageEdgeNavigationIntent,
  useImagePreviewInteraction,
  type ImageNavigationIntent
} from "../image";
import { PdfPreviewStage, usePdfPreviewInteraction } from "../pdf";
import { useVideoPreviewInteraction, VideoPreviewStage } from "../video";
import {
  formatPreviewFileTimestamp,
  getPreviewNotice,
  isMediaGalleryViewer,
  isStreamingMediaViewer,
  normalizePreviewMimeType,
  requiresOriginalBlobViewer,
  resolvePreviewViewer,
  viewerHeading,
  type PreviewCacheState
} from "./model";
import type { PreviewModalRuntimePorts } from "./ports";
import { useOriginalFileOpen } from "./useOriginalFileOpen";

export interface PreviewModalStageProps {
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
  readonly imageFitMode: "fill" | "fit";
  readonly maxCacheableFileSizeBytes: number;
  readonly ports: PreviewModalRuntimePorts;
  readonly onImageFitModeChange: (mode: "fill" | "fit") => void;
  readonly onApplyRefresh?: () => void;
  readonly onDownload?: (path: string) => void;
  readonly onPrevious?: () => void;
  readonly onNext?: () => void;
  readonly onMediaPlaybackChange?: (playing: boolean) => void;
  readonly onClose: () => void;
}

export function PreviewModalStage(props: PreviewModalStageProps) {
  const [pdfPreviewFailed, setPdfPreviewFailed] = useState(false);
  const previewViewer = resolvePreviewViewer(props.file?.viewer, props.entry?.mimeType);
  const previewPath = props.file?.path ?? props.entry?.path;
  const originalFileOpen = useOriginalFileOpen({
    open: props.open,
    accountId: props.accountId,
    path: previewPath,
    token: props.token,
    ports: props.ports
  });
  const imageInteraction = useImagePreviewInteraction({
    source: { enabled: props.open && previewViewer === "image", path: props.file?.path, blobUrl: props.blobUrl },
    fitMode: props.imageFitMode,
    onFitModeChange: props.onImageFitModeChange
  });
  const pdfInteraction = usePdfPreviewInteraction({
    blobUrl: props.open && previewViewer === "pdf" && props.blobUrl ? props.blobUrl : "",
    onError: () => setPdfPreviewFailed(true),
    ports: props.ports.pdf
  });
  const videoInteraction = useVideoPreviewInteraction({
    source: {
      enabled: props.open && previewViewer === "video",
      blobUrl: props.blobUrl,
      filePath: props.file?.path
    },
    onMediaPlaybackChange: props.onMediaPlaybackChange,
    ports: props.ports.video
  });
  const audioInteraction = useAudioPreviewInteraction({
    source: {
      enabled: props.open && props.file?.viewer === "audio",
      accountId: props.accountId,
      path: props.file?.path,
      sourceUrl: props.blobUrl
    },
    onMediaPlaybackChange: props.onMediaPlaybackChange,
    ports: props.ports
  });
  const showGalleryControls = previewViewer !== "video" && isMediaGalleryViewer(previewViewer) && (props.onPrevious || props.onNext);
  const imageStageAdvances = previewViewer === "image" && Boolean(props.onNext);

  useEffect(() => {
    setPdfPreviewFailed(false);
  }, [props.file?.path, props.file?.viewer, props.blobUrl, props.open, props.ports]);

  const onNext = props.onNext;
  const previewOpen = props.open;
  const previewPorts = props.ports;

  useEffect(() => {
    if (!previewOpen || !showGalleryControls) {
      return;
    }

    return previewPorts.addWindowKeydownListener((event) => {
      const target = event.target;
      if (target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)) {
        return;
      }

      if ((event.key === " " || event.code === "Space") && imageStageAdvances && onNext) {
        event.preventDefault();
        onNext();
      }
    });
  }, [imageStageAdvances, onNext, previewOpen, previewPorts, showGalleryControls]);

  const closePreview = () => {
    originalFileOpen.cancel();
    props.onClose();
  };
  const dialogRef = useModalFocusBoundary<HTMLElement>(props.open, closePreview);

  if (!props.open) {
    return null;
  }
  const handleDownload = previewPath && props.onDownload ? () => props.onDownload?.(previewPath) : undefined;
  const displayPath = toDisplayPath(previewPath ?? props.entry?.path ?? "");
  const fileName = props.file?.name ?? props.entry?.name ?? "file";
  const previewFolderLabel = basename(dirname(previewPath ?? props.entry?.path ?? "")) || "files";
  const previewMode = viewerHeading(previewViewer);
  const previewKind = normalizePreviewMimeType(props.file?.mimeType) ?? (props.entry?.isFolder ? "Folder" : "Unknown");
  const immersivePreview = previewViewer === "image" || previewViewer === "video" || previewViewer === "pdf";
  const canOpenOriginal = Boolean(previewPath && props.token && !props.entry?.isFolder);
  const previewIsHeic = isHeicLikeFile(props.file ?? props.entry ?? {});
  const showOpenOriginalAction = canOpenOriginal && (previewViewer === "pdf" || (previewIsHeic && previewViewer === "image"));
  const openOriginalLabel = "Open or download original file";
  const openOriginalVisibleLabel = "Get original";
  const openingOriginalLabel = "Opening original…";
  const previewNotice = getPreviewNotice(props.cacheState, props.offline || Boolean(props.workerUnavailable), props.offline);
  const imagePreviewUnavailable = previewViewer === "image" && (!props.blobUrl || imageInteraction.failed);
  const mediaStreamingNote = isStreamingMediaViewer(previewViewer) && props.blobUrl
    ? props.blobUrl.startsWith("blob:")
      ? "Offline-retained media copy is playing from browser cache."
      : props.file?.size !== undefined && props.file.size <= props.maxCacheableFileSizeBytes
        ? "Streaming now. An offline cache copy continues saving in the background."
        : "Streaming-only playback. This file is above the offline cache size limit."
    : undefined;

  const renderFallbackState = (title: string, message: string) => (
    <div className="empty-state preview-empty">
      <p className="empty empty-title">{title}</p>
      <p className="status">{message}</p>
      <div className="preview-stage-actions">
        {canOpenOriginal ? <button aria-label={openOriginalLabel} disabled={originalFileOpen.opening} onClick={originalFileOpen.start} type="button">{originalFileOpen.opening ? openingOriginalLabel : openOriginalVisibleLabel}</button> : null}
        {handleDownload ? <button onClick={handleDownload} type="button">Download file</button> : null}
      </div>
    </div>
  );

  const renderGalleryControls = (variant: "overlay" | "inline" = "overlay") => {
    if (!showGalleryControls) {
      return null;
    }

    const handlePrevious = (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      props.onPrevious?.();
    };

    const handleNext = (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      props.onNext?.();
    };

    return (
      <div className={`preview-gallery-controls${variant === "inline" ? " preview-gallery-controls-inline" : " preview-gallery-controls-edge"}`}>
        {props.onPrevious ? <button aria-label="Previous media item" className="preview-gallery-button preview-gallery-button-previous" onClick={handlePrevious} title="Previous media item" type="button"><ChevronLeft aria-hidden="true" /></button> : null}
        {props.onNext ? <button aria-label="Next media item" className="preview-gallery-button preview-gallery-button-next" onClick={handleNext} title="Next media item" type="button"><ChevronRight aria-hidden="true" /></button> : null}
      </div>
    );
  };

  const runImageEdgeNavigationIntent = (intent: ImageNavigationIntent) => {
    if (intent === "previous") {
      props.onPrevious?.();
      return true;
    }

    if (intent === "next") {
      props.onNext?.();
      return true;
    }

    return false;
  };

  const handlePreviewScrimClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (previewViewer === "image") {
      if (runImageEdgeNavigationIntent(resolveImageEdgeNavigationIntent(event.clientX, event.currentTarget.clientWidth, {
        previous: Boolean(props.onPrevious),
        next: Boolean(props.onNext)
      }))) {
        return;
      }
    }

    closePreview();
  };

  const handlePreviewModalClick = (event: MouseEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || previewViewer !== "image") {
      return;
    }

    runImageEdgeNavigationIntent(resolveImageEdgeNavigationIntent(event.clientX, event.currentTarget.clientWidth, {
      previous: Boolean(props.onPrevious),
      next: Boolean(props.onNext)
    }));
  };

  return (
    <div className={`modal-scrim preview-scrim${immersivePreview ? " preview-scrim-immersive" : ""}${previewViewer === "image" ? " preview-scrim-image" : ""}`} onClick={handlePreviewScrimClick} role="presentation">
      <section ref={dialogRef} aria-label={`Preview ${fileName}`} aria-modal="true" className={`preview-modal panel${immersivePreview ? " preview-modal-immersive" : ""}`} onClick={handlePreviewModalClick} role="dialog" tabIndex={-1}>
        <header className="preview-header">
          <div className={`preview-header-context${immersivePreview ? " preview-header-context-immersive" : ""}`}>
            {immersivePreview ? (
              <button aria-label="Back to files" className="quiet-button preview-back-button" onClick={closePreview} type="button">
                <ChevronLeft aria-hidden="true" />
                <span>Back to {previewFolderLabel}</span>
              </button>
            ) : null}
            <div className="preview-title-block">
              <div className="preview-title-row">
                <h2>{fileName}</h2>
                <span className="operation-pill preview-mode-pill">{previewMode}</span>
              </div>
              <div className="preview-context-row">
                <p className="status preview-path">{displayPath || "Opening file"}</p>
                {props.offline || props.workerUnavailable ? (
                  <span className="status preview-secondary-note">
                    {props.offline
                      ? "Cached previews stay available, but changes remain disabled until you reconnect."
                      : "Cached previews stay available, but changes remain disabled until the local server is reachable again."}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className={`preview-header-actions${immersivePreview ? " preview-header-actions-immersive" : ""}${previewViewer === "image" ? " preview-header-actions-image" : ""}`}>
            {previewViewer === "video" ? (
              <div aria-label="Video navigation" className="preview-video-navigation" role="group">
                <button aria-label="Previous video" disabled={!props.onPrevious} onClick={() => props.onPrevious?.()} title="Previous video" type="button">
                  <ChevronLeft aria-hidden="true" />
                </button>
                <button aria-label="Next video" disabled={!props.onNext} onClick={() => props.onNext?.()} title="Next video" type="button">
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            ) : null}
            <details className="preview-details-disclosure">
              <summary aria-label="File details"><Info aria-hidden="true" /><span>Details</span></summary>
              <dl className="metadata preview-metadata">
                <div>
                  <dt>Kind</dt>
                  <dd>{previewKind}</dd>
                </div>
                <div>
                  <dt>Modified</dt>
                  <dd>{formatPreviewFileTimestamp(props.file?.lastModified ?? props.entry?.lastModified)}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatFileSize(props.file?.size ?? props.entry?.size, props.fileSizeDisplayMode)}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>{displayPath}</dd>
                </div>
              </dl>
            </details>
            {previewViewer === "image" ? (
              <>
                <button
                  aria-label={props.imageFitMode === "fill" && !imageInteraction.controls.hasCustomZoom ? "Fit entire image" : "Fill preview area"}
                  aria-pressed={props.imageFitMode === "fill" && !imageInteraction.controls.hasCustomZoom}
                  className="preview-fit-toggle"
                  onClick={imageInteraction.controls.toggleFitMode}
                  type="button"
                >
                  {props.imageFitMode === "fill" && !imageInteraction.controls.hasCustomZoom ? "Fit" : "Fill"}
                </button>
                <button
                  aria-label={`Show image at original size. Current zoom ${imageInteraction.controls.zoomLabel}`}
                  aria-pressed={imageInteraction.controls.zoomScale === 1}
                  className="preview-fit-toggle"
                  onClick={imageInteraction.controls.showOriginalSize}
                  type="button"
                >
                  100%
                </button>
              </>
            ) : null}
            {showOpenOriginalAction ? (
              <button
                aria-label={openOriginalLabel}
                disabled={originalFileOpen.opening}
                onClick={originalFileOpen.start}
                type="button"
              >
                <ExternalLink aria-hidden="true" />{originalFileOpen.opening ? openingOriginalLabel : openOriginalVisibleLabel}
              </button>
            ) : null}
            {handleDownload ? <button onClick={handleDownload} type="button"><Download aria-hidden="true" />Download</button> : null}
            {!immersivePreview ? <button aria-label="Back to files" className="quiet-button preview-dismiss-button" onClick={closePreview} type="button">Back</button> : null}
          </div>
        </header>

        {immersivePreview ? renderGalleryControls() : null}

        <section className={`preview-stage ${immersivePreview ? "preview-stage-immersive" : ""}`}>
          <div className={`preview-stage-shell ${immersivePreview ? "preview-stage-shell-immersive" : ""}`}>
            {props.loading ? <div className="preview-transient-status"><StateBanner kind="loading" message="Opening file…" /></div> : null}
            {previewNotice ? (
              <div className="preview-cache-status">
                <StateBanner kind={previewNotice.kind} message={previewNotice.message} />
                {props.cacheState.updateReady && props.onApplyRefresh ? (
                  <div className="preview-stage-actions">
                    <button onClick={props.onApplyRefresh} type="button">Apply refreshed version</button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {props.error ? <div className="preview-transient-status"><StateBanner kind={props.error instanceof ApiRequestError && (props.error.status === 401 || props.error.status === 403) ? "permission" : "error"} message={props.error.message} /></div> : null}
            {originalFileOpen.error ? <div className="preview-transient-status"><StateBanner kind="error" message={originalFileOpen.error} /></div> : null}
            {props.file?.truncated ? <p className="status preview-notice">Showing the first {props.file.bytesRead} bytes.</p> : null}
            {mediaStreamingNote ? <p className="status preview-notice">{mediaStreamingNote}</p> : null}
            {props.file ? (
              <>
                {props.file.viewer === "markdown" ? <div className="preview-document"><MarkdownPreview content={props.file.content} /></div> : null}
                {props.file.viewer === "text" ? <pre className="preview-text">{props.file.content}</pre> : null}
                {props.file.viewer === "image" && props.blobUrl && !imageInteraction.failed ? (
                  <ImagePreviewStage
                    alt={props.file.name}
                    fitMode={props.imageFitMode}
                    interaction={imageInteraction.stage}
                    onNext={props.onNext}
                    onPrevious={props.onPrevious}
                    src={props.blobUrl}
                  />
                ) : null}
                {props.file.viewer === "audio" ? <AudioPreviewStage galleryControls={renderGalleryControls("inline")} interaction={audioInteraction} /> : null}
                {props.file.viewer === "video" && props.blobUrl ? (
                  <VideoPreviewStage fileName={props.file.name} interaction={videoInteraction} />
                ) : null}
                {props.file.viewer === "pdf" && props.blobUrl ? (
                  <div className="preview-media-stage preview-media-stage-pdf" title={`PDF preview ${props.file.name}`}>
                    {!pdfPreviewFailed ? (
                      <PdfPreviewStage fileName={props.file.name} interaction={pdfInteraction} />
                    ) : renderFallbackState(
                      "PDF preview is unavailable right now",
                      props.file.unsupportedReason ?? "You can still open the original PDF in a new tab or download it."
                    )}
                  </div>
                ) : null}
                {(props.file.viewer === "unsupported" || imagePreviewUnavailable || (props.file.viewer === "pdf" && !props.blobUrl) || (requiresOriginalBlobViewer(props.file.viewer) && !props.blobUrl && !imagePreviewUnavailable))
                  ? renderFallbackState(
                    props.file.viewer === "pdf"
                      ? "PDF preview is unavailable right now"
                      : props.file.viewer === "image"
                        ? "Image preview is unavailable right now"
                        : "This file opens outside the preview pane",
                    props.file.unsupportedReason ?? (props.file.viewer === "pdf"
                      ? "You can still open the original PDF in a new tab or download it."
                      : props.file.viewer === "image"
                        ? "You can still open the original image in a new tab or download it."
                        : "You can still open the original file in a new tab or download it.")
                  )
                  : null}
              </>
            ) : !props.loading && !props.error ? (
              <div className="empty-state preview-empty">
                <p className="empty empty-title">Preview unavailable</p>
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </div>
  );
}
