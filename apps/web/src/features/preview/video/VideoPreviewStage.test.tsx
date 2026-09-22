import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VideoPreviewStage } from "./VideoPreviewStage";
import type { VideoPreviewInteraction } from "./useVideoPreviewInteraction";

function requireVideoElement(element: HTMLElement): HTMLVideoElement {
  if (!(element instanceof HTMLVideoElement)) {
    throw new Error("Expected an HTMLVideoElement");
  }
  return element;
}

function buildInteraction(
  overrides: Partial<VideoPreviewInteraction["stage"]> = {},
  overlay: Partial<VideoPreviewInteraction["overlay"]> = {}
): VideoPreviewInteraction {
  return {
    overlay: {
      visible: true,
      playing: false,
      notifyActivity: vi.fn(),
      ...overlay
    },
    stage: {
      videoRef: vi.fn(),
      effectiveSource: "/api/file/stream?path=Projects%2Fclip.mp4&streamToken=token",
      streamSource: true,
      streamState: "idle",
      retryAttempt: 0,
      maxRetries: 3,
      autoplayBlocked: false,
      muted: false,
      onCanPlay: vi.fn(),
      onError: vi.fn(),
      onEnded: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
      onPlaying: vi.fn(),
      onVolumeChange: vi.fn(),
      onWaiting: vi.fn(),
      startPlayback: vi.fn(),
      retryStreamNow: vi.fn(),
      ...overrides
    }
  };
}

describe("VideoPreviewStage", () => {
  afterEach(cleanup);

  it("renders inline autoplay-compatible video attributes honoring the muted binding", () => {
    const { getByLabelText } = render(<VideoPreviewStage fileName="clip.mp4" interaction={buildInteraction({ muted: true })} />);
    const video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.controls).toBe(true);
  });

  it("forwards volume changes to the interaction binding", () => {
    const onVolumeChange = vi.fn();
    const { getByLabelText } = render(
      <VideoPreviewStage fileName="clip.mp4" interaction={buildInteraction({ onVolumeChange })} />
    );
    const video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    fireEvent(video, new Event("volumechange"));
    expect(onVolumeChange).toHaveBeenCalledTimes(1);
  });

  it("binds stream notices for buffering, retry, and autoplay-blocked states", () => {
    const { rerender, queryByText } = render(
      <VideoPreviewStage fileName="clip.mp4" interaction={buildInteraction({ streamState: "buffering" })} />
    );
    expect(queryByText(/Buffering media stream/i)).toBeInTheDocument();

    rerender(
      <VideoPreviewStage
        fileName="clip.mp4"
        interaction={buildInteraction({ streamState: "retrying", retryAttempt: 2 })}
      />
    );
    expect(queryByText(/Stream interrupted\. Retrying playback shortly \(2\/3\)/i)).toBeInTheDocument();

    rerender(
      <VideoPreviewStage fileName="clip.mp4" interaction={buildInteraction({ autoplayBlocked: true })} />
    );
    expect(queryByText(/Autoplay was blocked by the browser/i)).toBeInTheDocument();
  });

  it("forwards stage pointer and key activity to the overlay", () => {
    const notifyActivity = vi.fn();
    const { container, getByLabelText } = render(
      <VideoPreviewStage fileName="clip.mp4" interaction={buildInteraction({}, { notifyActivity })} />
    );
    const video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    const stage = container.querySelector(".preview-media-stage");
    if (!(stage instanceof HTMLElement)) {
      throw new Error("Expected the media stage element.");
    }

    fireEvent.pointerDown(video);
    fireEvent.pointerMove(stage);
    fireEvent.keyDown(video);
    fireEvent.touchStart(video);
    fireEvent.click(video);
    expect(notifyActivity).toHaveBeenCalledTimes(5);
  });
});
