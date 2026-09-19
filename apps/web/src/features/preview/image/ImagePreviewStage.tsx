import type { KeyboardEvent, MouseEvent } from "react";

import { resolveImageEdgeNavigationIntent } from "./geometry";
import type { ImagePreviewInteraction } from "./useImagePreviewInteraction";

interface ImagePreviewStageProps {
  alt: string;
  fitMode: "fill" | "fit";
  interaction: ImagePreviewInteraction["stage"];
  onNext?: () => void;
  onPrevious?: () => void;
  src: string;
}

export function ImagePreviewStage({ alt, fitMode, interaction, onNext, onPrevious, src }: ImagePreviewStageProps) {
  const advances = Boolean(onNext);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onNext) {
      return;
    }
    if (interaction.consumeSuppressedAdvance()) {
      return;
    }
    const intent = resolveImageEdgeNavigationIntent(event.clientX, event.currentTarget.clientWidth, {
      previous: Boolean(onPrevious),
      next: true
    });
    if (intent === "previous") {
      onPrevious?.();
      return;
    }
    if (intent === "next") {
      onNext();
      return;
    }
    onNext();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === "Enter" || event.key === " ") && onNext) {
      event.preventDefault();
      onNext();
    }
  };

  return (
    <div
      aria-label={advances ? `Open next photo after ${alt}` : undefined}
      className={`preview-media-stage preview-media-stage-image${interaction.hasCustomZoom ? " preview-media-stage-image-zoomed" : ""}${advances ? " preview-media-stage-clickable" : ""}`}
      onClick={advances ? handleClick : undefined}
      onKeyDown={advances ? handleKeyDown : undefined}
      onPointerCancel={interaction.onPointerEnd}
      onPointerDown={interaction.onPointerDown}
      onPointerMove={interaction.onPointerMove}
      onPointerUp={interaction.onPointerEnd}
      onTouchCancel={interaction.onTouchEnd}
      onTouchEnd={interaction.onTouchEnd}
      onTouchMove={interaction.onTouchMove}
      onTouchStart={interaction.onTouchStart}
      onWheel={interaction.onWheel}
      ref={interaction.stageRef}
      role={advances ? "button" : undefined}
      tabIndex={advances ? 0 : undefined}
    >
      <img
        alt={alt}
        className={`media-preview media-preview-image media-preview-image-${interaction.hasCustomZoom ? "zoomed" : fitMode}`}
        onError={interaction.onImageError}
        onLoad={interaction.onImageLoad}
        src={src}
        style={interaction.imageStyle}
      />
    </div>
  );
}
