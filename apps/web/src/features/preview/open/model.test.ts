import { describe, expect, it } from "vitest";

import type { FileEntry } from "@davora/shared";

import {
  buildMediaGalleryItems,
  buildPreviewNavigationItems,
  isMediaGalleryEntry,
  resolveAdjacentMediaItem,
  resolveOpenedMediaIndex,
  resolveUnsupportedOpenRoute,
  selectPrefetchCandidates,
  shouldSkipPrefetchForCurrentItem
} from "./model";

function entry(path: string, mimeType: string): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false, size: 1, mimeType };
}

describe("preview open model", () => {
  it("treats HEIC as a gallery entry only when the experiment is enabled", () => {
    const heic = entry("Archive/photo.heic", "image/heic");
    expect(isMediaGalleryEntry(heic, false)).toBe(false);
    expect(isMediaGalleryEntry(heic, true)).toBe(true);
  });

  it("builds gallery media items from visible folder entries", () => {
    const items = [
      entry("Archive/photo.png", "image/png"),
      entry("Archive/readme.txt", "text/plain"),
      entry("Archive/clip.mp4", "video/mp4"),
      { path: "Archive/child", name: "child", isFolder: true, size: 0, mimeType: "inode/directory" }
    ];
    expect(buildMediaGalleryItems(items, false).map((item) => item.path)).toEqual([
      "Archive/photo.png",
      "Archive/clip.mp4"
    ]);
  });

  it("limits video gallery navigation to videos when a video preview is open", () => {
    const mediaItems = [
      entry("Archive/photo.png", "image/png"),
      entry("Archive/clip.mp4", "video/mp4"),
      entry("Archive/other.mp4", "video/mp4")
    ];
    const openedVideo = entry("Archive/clip.mp4", "video/mp4");
    expect(buildPreviewNavigationItems(mediaItems, openedVideo).map((item) => item.path)).toEqual([
      "Archive/clip.mp4",
      "Archive/other.mp4"
    ]);
    expect(buildPreviewNavigationItems(mediaItems, entry("Archive/photo.png", "image/png")).map((item) => item.path))
      .toEqual(mediaItems.map((item) => item.path));
  });

  it("resolves adjacent gallery items within bounds", () => {
    const navigationItems = [
      entry("Archive/a.png", "image/png"),
      entry("Archive/b.png", "image/png")
    ];
    expect(resolveOpenedMediaIndex(navigationItems, navigationItems[1])).toBe(1);
    expect(resolveAdjacentMediaItem(navigationItems, 1, -1)?.path).toBe("Archive/a.png");
    expect(resolveAdjacentMediaItem(navigationItems, 0, -1)).toBeUndefined();
    expect(resolveAdjacentMediaItem(navigationItems, 1, 1)).toBeUndefined();
  });

  it("skips prefetch for the current video and upcoming videos", () => {
    const video = entry("Archive/clip.mp4", "video/mp4");
    const photo = entry("Archive/photo.png", "image/png");
    const audio = entry("Archive/song.mp3", "audio/mpeg");
    expect(shouldSkipPrefetchForCurrentItem(video)).toBe(true);
    expect(shouldSkipPrefetchForCurrentItem(photo)).toBe(false);
    expect(selectPrefetchCandidates([photo, video, audio], 0).map((item) => item.path)).toEqual([]);
    expect(selectPrefetchCandidates([photo, audio, video], 0).map((item) => item.path)).toEqual(["Archive/song.mp3"]);
  });

  it("routes unsupported, HEIC, and explicit-offline opens", () => {
    const unsupported = entry("Archive/archive.bin", "application/octet-stream");
    const heic = entry("Archive/photo.heic", "image/heic");
    const image = entry("Archive/photo.png", "image/png");

    expect(resolveUnsupportedOpenRoute({
      entry: unsupported,
      explicitOfflineMode: true,
      hasToken: true,
      offline: false
    })).toEqual({ kind: "explicit-offline-local" });

    expect(resolveUnsupportedOpenRoute({
      entry: heic,
      explicitOfflineMode: true,
      hasToken: true,
      offline: false
    })).toEqual({ kind: "explicit-offline-local" });

    expect(resolveUnsupportedOpenRoute({
      entry: unsupported,
      explicitOfflineMode: false,
      hasToken: true,
      offline: false
    })).toEqual({ kind: "download" });

    expect(resolveUnsupportedOpenRoute({
      entry: unsupported,
      explicitOfflineMode: false,
      hasToken: false,
      offline: true
    })).toEqual({
      kind: "preview-error",
      message: "Offline and no cached inline preview is available for this file type yet."
    });

    expect(resolveUnsupportedOpenRoute({
      entry: image,
      explicitOfflineMode: false,
      hasToken: true,
      offline: false
    })).toEqual({ kind: "continue-preview" });
  });
});
