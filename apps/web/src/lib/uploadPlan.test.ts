import { describe, expect, it } from "vitest";

import { buildUploadSelectionPlan } from "./uploadPlan";

describe("buildUploadSelectionPlan", () => {
  it("keeps direct file uploads in the current folder without extra directories", () => {
    const plan = buildUploadSelectionPlan("Projects", [
      { name: "roadmap.txt", size: 5, type: "text/plain" },
      { name: "notes.md", size: 8, type: "text/markdown" }
    ]);

    expect(plan.includesDirectories).toBe(false);
    expect(plan.foldersToCreate).toEqual([]);
    expect(plan.directoryRoots).toEqual([]);
    expect(plan.files.map((file) => file.destinationPath)).toEqual([
      "Projects/roadmap.txt",
      "Projects/notes.md"
    ]);
  });

  it("preserves nested relative paths for directory selections and creates parent folders once", () => {
    const plan = buildUploadSelectionPlan("Archive", [
      { name: "song.mp3", size: 10, type: "audio/mpeg", webkitRelativePath: "Mixtape/song.mp3" },
      { name: "cover.png", size: 12, type: "image/png", webkitRelativePath: "Mixtape/assets/cover.png" },
      { name: "credits.txt", size: 3, type: "text/plain", webkitRelativePath: "Mixtape/assets/credits/credits.txt" }
    ]);

    expect(plan.includesDirectories).toBe(true);
    expect(plan.directoryRoots).toEqual(["Mixtape"]);
    expect(plan.foldersToCreate).toEqual([
      "Archive/Mixtape",
      "Archive/Mixtape/assets",
      "Archive/Mixtape/assets/credits"
    ]);
    expect(plan.files.map((file) => ({ parent: file.destinationParentPath, path: file.destinationPath }))).toEqual([
      { parent: "Archive/Mixtape", path: "Archive/Mixtape/song.mp3" },
      { parent: "Archive/Mixtape/assets", path: "Archive/Mixtape/assets/cover.png" },
      { parent: "Archive/Mixtape/assets/credits", path: "Archive/Mixtape/assets/credits/credits.txt" }
    ]);
  });

  it("rejects path traversal hidden inside webkitRelativePath", () => {
    expect(() => buildUploadSelectionPlan("", [
      { name: "secret.txt", size: 1, type: "text/plain", webkitRelativePath: "folder/../secret.txt" }
    ])).toThrow(/Path traversal is not allowed/i);
  });
});
