import { describe, expect, it, vi } from "vitest";

import { createFolderAudioPreviewOpenSources } from "./createFolderAudioPreviewOpenSources";
import type { FolderAudioPlayerInteraction } from "./useFolderAudioPlayer";

function buildInteraction(overrides: Partial<FolderAudioPlayerInteraction> = {}): FolderAudioPlayerInteraction {
  return {
    playing: false,
    pause: vi.fn(),
    activate: vi.fn(),
    stage: undefined,
    ...overrides
  };
}

describe("createFolderAudioPreviewOpenSources", () => {
  it("delegates pause and activate to the current interaction", () => {
    const interaction = buildInteraction();
    const entry = { path: "Projects/chapter.m4a", name: "chapter.m4a", mimeType: "audio/mp4", isFolder: false };
    const sources = createFolderAudioPreviewOpenSources(() => interaction);

    sources.pause();
    sources.activate(entry);

    expect(interaction.pause).toHaveBeenCalledTimes(1);
    expect(interaction.activate).toHaveBeenCalledWith(entry);
  });

  it("no-ops when the interaction is unavailable", () => {
    const sources = createFolderAudioPreviewOpenSources(() => null);
    expect(() => sources.pause()).not.toThrow();
    expect(() => sources.activate({ path: "Projects/chapter.m4a", name: "chapter.m4a", isFolder: false })).not.toThrow();
  });
});
