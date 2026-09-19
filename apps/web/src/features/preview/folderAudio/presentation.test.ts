import { describe, expect, it } from "vitest";

import { folderAudioBrowsePanelClassName } from "./presentation";

describe("folderAudio presentation", () => {
  it("adds has-folder-audio-player when the browse mount is visible", () => {
    expect(folderAudioBrowsePanelClassName(false)).toBe("file-browser-panel");
    expect(folderAudioBrowsePanelClassName(true)).toBe("file-browser-panel has-folder-audio-player");
  });
});
