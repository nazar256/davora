// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioPreviewStage } from "./AudioPreviewStage";
import type { AudioPreviewInteraction } from "./types";

function interaction(overrides: Partial<AudioPreviewInteraction["stage"]> = {}): AudioPreviewInteraction {
  return {
    stage: {
      audioRef: vi.fn(),
      audioElementKey: "audio-key",
      effectiveSource: "blob:track",
      streamSource: false,
      streamState: "idle",
      retryAttempt: 0,
      maxRetries: 3,
      autoplayBlocked: false,
      onCanPlay: vi.fn(),
      onWaiting: vi.fn(),
      onError: vi.fn(),
      onPlay: vi.fn(),
      onPlaying: vi.fn(),
      onPause: vi.fn(),
      onEnded: vi.fn(),
      startPlayback: vi.fn(),
      retryStreamNow: vi.fn(),
      ...overrides
    }
  };
}

describe("AudioPreviewStage", () => {
  afterEach(cleanup);

  it("preserves the modal audio element and gallery slot contract", () => {
    render(<AudioPreviewStage galleryControls={<div data-testid="gallery" />} interaction={interaction()} />);
    const audio = document.querySelector("audio.media-preview-audio");
    expect(audio).toHaveAttribute("src", "blob:track");
    expect(audio).toHaveAttribute("autoplay");
    expect(audio).toHaveAttribute("controls");
    expect(audio).toHaveClass("media-preview", "media-preview-audio");
    expect(screen.getByTestId("gallery")).toBeInTheDocument();
  });

  it("renders blocked-autoplay and retry actions from declarative bindings", () => {
    const startPlayback = vi.fn();
    const retryStreamNow = vi.fn();
    render(
      <AudioPreviewStage
        interaction={interaction({
          autoplayBlocked: true,
          startPlayback,
          streamSource: true,
          streamState: "failed",
          retryStreamNow
        })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Play media" }));
    expect(startPlayback).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Retry playback" })).not.toBeInTheDocument();
  });
});
