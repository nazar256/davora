import type { VideoPreviewInteraction } from "./useVideoPreviewInteraction";

interface VideoPreviewStageProps {
  fileName: string;
  interaction: VideoPreviewInteraction;
}

export function VideoPreviewStage({ fileName, interaction }: VideoPreviewStageProps) {
  const { stage } = interaction;
  if (!stage.effectiveSource) {
    return null;
  }

  return (
    <div className="preview-media-stage">
      {stage.autoplayBlocked ? (
        <div className="preview-transient-status">
          <p className="banner-state permission">Autoplay was blocked by the browser. Use Play media to start playback.</p>
          <div className="preview-stage-actions">
            <button onClick={stage.startPlayback} type="button">Play media</button>
          </div>
        </div>
      ) : null}
      {!stage.autoplayBlocked && stage.streamSource && stage.streamState === "buffering" ? (
        <p className="status preview-notice">Buffering media stream…</p>
      ) : null}
      {!stage.autoplayBlocked && stage.streamSource && stage.streamState === "retrying" ? (
        <p className="status preview-notice">
          Stream interrupted. Retrying playback shortly ({stage.retryAttempt}/{stage.maxRetries}).
        </p>
      ) : null}
      {!stage.autoplayBlocked && stage.streamSource && stage.streamState === "failed" ? (
        <div className="preview-transient-status">
          <p className="banner-state error">Media playback could not continue after several retries.</p>
          <div className="preview-stage-actions">
            <button onClick={stage.retryStreamNow} type="button">Retry playback</button>
          </div>
        </div>
      ) : null}
      <video
        aria-label={`Video preview ${fileName}`}
        autoPlay
        className="media-preview media-preview-video"
        controls
        key={stage.effectiveSource}
        muted
        onCanPlay={stage.onCanPlay}
        onEnded={stage.onEnded}
        onError={stage.onError}
        onPause={stage.onPause}
        onPlay={stage.onPlay}
        onPlaying={stage.onPlaying}
        onWaiting={stage.onWaiting}
        playsInline
        ref={stage.videoRef}
        src={stage.effectiveSource}
      />
    </div>
  );
}
