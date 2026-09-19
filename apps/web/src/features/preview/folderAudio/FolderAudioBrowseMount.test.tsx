import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FolderAudioBrowseMount } from "./FolderAudioBrowseMount";
import type { FolderAudioPlayerInteraction } from "./useFolderAudioPlayer";

describe("FolderAudioBrowseMount", () => {
  it("renders nothing when the interaction has no active stage", () => {
    const interaction: FolderAudioPlayerInteraction = {
      playing: false,
      pause: vi.fn(),
      activate: vi.fn(),
      stage: undefined
    };
    const { container } = render(<FolderAudioBrowseMount interaction={interaction} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the folder audio player stage when active", () => {
    const interaction: FolderAudioPlayerInteraction = {
      playing: false,
      pause: vi.fn(),
      activate: vi.fn(),
      stage: {
        folderLabel: "Projects",
        player: {
          accountId: "alpha",
          folderPath: "Projects",
          tracks: [{ path: "Projects/chapter.m4a", name: "chapter.m4a", mimeType: "audio/mp4" }],
          currentPath: "Projects/chapter.m4a",
          positionSeconds: 0,
          dismissed: false,
          updatedAt: "2026-07-21T12:00:00.000Z"
        },
        currentTrack: { path: "Projects/chapter.m4a", name: "chapter.m4a", mimeType: "audio/mp4" },
        currentTrackIndex: 0,
        durationSeconds: 0,
        remainingSeconds: undefined,
        streamUrl: "/stream",
        playing: false,
        error: undefined,
        audioRef: () => undefined,
        audioKey: "Projects/chapter.m4a",
        onEnded: vi.fn(),
        onLoadedMetadata: vi.fn(),
        onPause: vi.fn(),
        onPlay: vi.fn(),
        onTimeUpdate: vi.fn(),
        onSeek: vi.fn(),
        onSkip: vi.fn(),
        onSelectTrack: vi.fn(),
        onTogglePlayback: vi.fn(),
        onClose: vi.fn()
      }
    };

    render(<FolderAudioBrowseMount interaction={interaction} />);
    expect(screen.getByRole("region", { name: /Audio playlist for Projects/i })).toBeInTheDocument();
  });
});
