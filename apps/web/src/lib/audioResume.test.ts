import { beforeEach, describe, expect, it } from "vitest";

import {
  clearAudioPreviewPosition,
  loadAudioPreviewPosition,
  saveAudioPreviewPosition,
  type AudioPreviewResumeTarget
} from "./audioResume";

function target(accountId: string, path: string): AudioPreviewResumeTarget {
  return { accountId, path };
}

describe("audio preview resume storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores positions per account and path", () => {
    saveAudioPreviewPosition(target("account-a", "Projects/song.mp3"), 42.5);
    saveAudioPreviewPosition(target("account-b", "Projects/song.mp3"), 18.25);

    expect(loadAudioPreviewPosition(target("account-a", "Projects/song.mp3"))).toBeCloseTo(42.5);
    expect(loadAudioPreviewPosition(target("account-b", "Projects/song.mp3"))).toBeCloseTo(18.25);
    expect(loadAudioPreviewPosition(target("account-a", "Projects/other.mp3"))).toBeUndefined();
  });

  it("treats unusable values as unavailable resume state", () => {
    saveAudioPreviewPosition(target("account-a", "Projects/song.mp3"), 0);
    expect(loadAudioPreviewPosition(target("account-a", "Projects/song.mp3"))).toBeUndefined();

    localStorage.setItem("davora-audio-preview-position:account-a:Projects/song.mp3", "not-a-number");
    expect(loadAudioPreviewPosition(target("account-a", "Projects/song.mp3"))).toBeUndefined();

    saveAudioPreviewPosition(target("account-a", "Projects/song.mp3"), 15);
    clearAudioPreviewPosition(target("account-a", "Projects/song.mp3"));
    expect(loadAudioPreviewPosition(target("account-a", "Projects/song.mp3"))).toBeUndefined();
  });
});
