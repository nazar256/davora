import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FolderAudioPlayerStage } from "./FolderAudioPlayerStage";
import type { FolderAudioPlayerInteraction } from "./useFolderAudioPlayer";

function buildInteraction(overrides: Partial<NonNullable<FolderAudioPlayerInteraction["stage"]>> = {}): FolderAudioPlayerInteraction {
  const stage = {
    folderLabel: "Projects",
    player: {
      accountId: "alpha",
      folderPath: "Projects",
      tracks: [{ path: "Projects/chapter.m4a", name: "chapter.m4a" }],
      currentPath: "Projects/chapter.m4a",
      positionSeconds: 12,
      durationSeconds: 180,
      dismissed: false,
      updatedAt: "2026-07-21T12:00:00.000Z"
    },
    currentTrack: { path: "Projects/chapter.m4a", name: "chapter.m4a" },
    currentTrackIndex: 0,
    durationSeconds: 180,
    remainingSeconds: 168,
    streamUrl: "/api/file/stream?path=Projects%2Fchapter.m4a&streamToken=token",
    playing: false,
    error: undefined,
    audioRef: vi.fn(),
    audioKey: "/api/file/stream?path=Projects%2Fchapter.m4a&streamToken=token",
    onEnded: vi.fn(),
    onLoadedMetadata: vi.fn(),
    onPause: vi.fn(),
    onPlay: vi.fn(),
    onTimeUpdate: vi.fn(),
    onSeek: vi.fn(),
    onSkip: vi.fn(),
    onSelectTrack: vi.fn(),
    onTogglePlayback: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };

  return {
    playing: stage.playing,
    pause: vi.fn(),
    activate: vi.fn(),
    stage
  };
}

describe("FolderAudioPlayerStage", () => {
  afterEach(cleanup);

  it("renders the compact folder playlist player with transport controls", () => {
    const { getByRole, getByText } = render(<FolderAudioPlayerStage interaction={buildInteraction()} />);
    expect(getByRole("region", { name: /Audio playlist for Projects/i })).toBeInTheDocument();
    expect(getByText("chapter.m4a")).toBeInTheDocument();
    expect(getByRole("button", { name: /Play folder audio/i })).toBeInTheDocument();
    expect(getByRole("button", { name: /Skip back 15 seconds/i })).toBeInTheDocument();
    expect(getByRole("button", { name: /Skip forward 15 seconds/i })).toBeInTheDocument();
  });

  it("surfaces stream and autoplay errors without retry affordances", () => {
    const { rerender, getByText } = render(
      <FolderAudioPlayerStage interaction={buildInteraction({ error: "Audio stream is unavailable right now.", streamUrl: undefined })} />
    );
    expect(getByText(/Audio stream is unavailable right now/i)).toBeInTheDocument();

    rerender(
      <FolderAudioPlayerStage interaction={buildInteraction({ error: "Playback was blocked by the browser. Use Play to try again." })} />
    );
    expect(getByText(/Playback was blocked by the browser/i)).toBeInTheDocument();
  });
});
