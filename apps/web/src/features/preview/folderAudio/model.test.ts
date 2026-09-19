import { describe, expect, it } from "vitest";

import {
  AUDIO_SKIP_SECONDS,
  buildAudioPlaylistTracks,
  folderAudioStorageKey,
  formatPlaybackTime,
  isAudioFileEntry,
  normalizeAudioPlaylistState,
  resolveCurrentFolderAudioPlayer,
  resolveRemainingSeconds,
  resolveTrackDuration,
  toAudioPlaylistTrack
} from "./model";

describe("folder audio model", () => {
  it("builds stable playlist storage keys", () => {
    expect(folderAudioStorageKey("alpha", "Projects")).toBe("davora-folder-audio:alpha:Projects");
    expect(folderAudioStorageKey("alpha", "Projects/Привіт")).toBe(
      "davora-folder-audio:alpha:Projects%2F%D0%9F%D1%80%D0%B8%D0%B2%D1%96%D1%82"
    );
  });

  it("detects audio entries and normalizes playlist tracks", () => {
    expect(isAudioFileEntry({ path: "Projects/chapter.m4a", name: "chapter.m4a", mimeType: "audio/mp4" })).toBe(true);
    expect(isAudioFileEntry({ path: "Projects/clip.mp4", name: "clip.mp4", mimeType: "video/mp4" })).toBe(false);
    expect(toAudioPlaylistTrack({ path: "Projects/chapter.m4a", name: "chapter.m4a", mimeType: "audio/mp4", size: 18 })).toEqual({
      path: "Projects/chapter.m4a",
      name: "chapter.m4a",
      mimeType: "audio/mp4",
      size: 18
    });
  });

  it("normalizes persisted playlist state and rejects invalid payloads", () => {
    expect(normalizeAudioPlaylistState(null)).toBeUndefined();
    expect(normalizeAudioPlaylistState({ accountId: "alpha" })).toBeUndefined();
    expect(normalizeAudioPlaylistState({
      accountId: "alpha",
      folderPath: "Projects",
      currentPath: "Projects/chapter.m4a",
      tracks: [{ path: "Projects/chapter.m4a", name: "chapter.m4a" }],
      positionSeconds: -4,
      durationSeconds: 180,
      dismissed: false,
      updatedAt: "2026-07-21T12:00:00.000Z"
    })).toMatchObject({
      accountId: "alpha",
      folderPath: "Projects",
      currentPath: "Projects/chapter.m4a",
      positionSeconds: 0,
      durationSeconds: 180,
      dismissed: false
    });
  });

  it("builds folder playlists from visible audio rows", () => {
    const chapter = { path: "Projects/chapter.m4a", name: "chapter.m4a", mimeType: "audio/mp4" };
    const visibleItems = [
      chapter,
      { path: "Projects/clip.mp4", name: "clip.mp4", mimeType: "video/mp4", isFolder: false },
      { path: "Projects/notes.txt", name: "notes.txt", mimeType: "text/plain" }
    ];
    expect(buildAudioPlaylistTracks(visibleItems, chapter)).toEqual([
      { path: "Projects/chapter.m4a", name: "chapter.m4a", mimeType: "audio/mp4" }
    ]);
    expect(buildAudioPlaylistTracks(visibleItems, {
      path: "Projects/hidden.m4a",
      name: "hidden.m4a",
      mimeType: "audio/mp4"
    })).toEqual([
      { path: "Projects/chapter.m4a", name: "chapter.m4a", mimeType: "audio/mp4" },
      { path: "Projects/hidden.m4a", name: "hidden.m4a", mimeType: "audio/mp4" }
    ]);
  });

  it("formats playback time and resolves active player selectors", () => {
    const player = normalizeAudioPlaylistState({
      accountId: "alpha",
      folderPath: "Projects",
      currentPath: "Projects/chapter.m4a",
      tracks: [{ path: "Projects/chapter.m4a", name: "chapter.m4a" }],
      positionSeconds: 42,
      durationSeconds: 180,
      dismissed: false,
      updatedAt: "2026-07-21T12:00:00.000Z"
    })!;

    expect(formatPlaybackTime(undefined)).toBe("0:00");
    expect(formatPlaybackTime(65)).toBe("1:05");
    expect(resolveCurrentFolderAudioPlayer(player, "alpha", "Projects")).toEqual(player);
    expect(resolveCurrentFolderAudioPlayer({ ...player, dismissed: true }, "alpha", "Projects")).toBeUndefined();
    expect(resolveTrackDuration(player)).toBe(180);
    expect(resolveRemainingSeconds(player)).toBe(138);
    expect(AUDIO_SKIP_SECONDS).toBe(15);
  });
});
