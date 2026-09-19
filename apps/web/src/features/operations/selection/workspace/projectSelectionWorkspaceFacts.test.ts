import { describe, expect, it } from "vitest";

import { buildFileEntry, buildFilePreview } from "../../../../test/files";
import { projectOperationSelectionFacts } from "./projectSelectionWorkspaceFacts";

describe("projectOperationSelectionFacts", () => {
  it("owns selected identity and batch count facts for operation policy", () => {
    const entry = buildFileEntry("Projects/report.pdf");
    expect(projectOperationSelectionFacts({
      focusedEntry: entry,
      selectedPreview: buildFilePreview(entry.path),
      batchCount: 0
    })).toEqual({
      hasSelectedEntry: true,
      selectedFilePath: "Projects/report.pdf",
      selectedIsFolder: false,
      batchSelectionCount: 0
    });

    expect(projectOperationSelectionFacts({
      focusedEntry: entry,
      selectedPreview: undefined,
      batchCount: 2
    })).toEqual({
      hasSelectedEntry: false,
      selectedFilePath: undefined,
      selectedIsFolder: false,
      batchSelectionCount: 2
    });

    expect(projectOperationSelectionFacts({
      focusedEntry: entry,
      selectedPreview: undefined,
      batchCount: 0
    })).toMatchObject({
      hasSelectedEntry: true,
      selectedFilePath: "Projects/report.pdf",
      selectedIsFolder: false
    });
  });
});
