import type { ReactNode } from "react";

import { StateBanner } from "../../../components/StateBanner";
import type { AudioPreviewInteraction } from "./types";

interface AudioPreviewStageProps {
  readonly interaction: AudioPreviewInteraction;
  readonly galleryControls?: ReactNode;
}

export function AudioPreviewStage({ interaction, galleryControls }: AudioPreviewStageProps) {
  const { stage } = interaction;
  if (!stage.effectiveSource) {
    return null;
  }

  return (
    <>
      {stage.autoplayBlocked ? (
        <div className="preview-transient-status">
          <StateBanner kind="permission" message="Autoplay was blocked by the browser. Use Play media to start playback." />
          <div className="preview-stage-actions">
            <button onClick={stage.startPlayback} type="button">Play media</button>
          </div>
        </div>
      ) : null}
      {!stage.autoplayBlocked && stage.streamSource && stage.streamState === "buffering" ? <p className="status preview-notice">Buffering media stream…</p> : null}
      {!stage.autoplayBlocked && stage.streamSource && stage.streamState === "retrying" ? <p className="status preview-notice">Stream interrupted. Retrying playback shortly ({stage.retryAttempt}/{stage.maxRetries}).</p> : null}
      {!stage.autoplayBlocked && stage.streamSource && stage.streamState === "failed" ? (
        <div className="preview-transient-status">
          <StateBanner kind="error" message="Media playback could not continue after several retries." />
          <div className="preview-stage-actions">
            <button onClick={stage.retryStreamNow} type="button">Retry playback</button>
          </div>
        </div>
      ) : null}
      <div className="preview-media-stage">
        {galleryControls}
        <audio
          autoPlay
          className="media-preview media-preview-audio"
          controls
          key={stage.audioElementKey}
          onCanPlay={stage.onCanPlay}
          onError={stage.onError}
          onEnded={stage.onEnded}
          onPause={stage.onPause}
          onPlay={stage.onPlay}
          onPlaying={stage.onPlaying}
          onWaiting={stage.onWaiting}
          ref={stage.audioRef}
          src={stage.effectiveSource}
        />
      </div>
    </>
  );
}
