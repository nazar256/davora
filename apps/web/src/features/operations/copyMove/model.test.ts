import type { FileEntry } from "@davora/shared";
import { describe, expect, it } from "vitest";

import { createOperationContextToken } from "../policy";
import {
  buildBatchCopyMovePartialActionError,
  buildBatchCopyMovePartialStatus,
  buildBatchCopyMovePickerInitialState,
  buildBatchCopyMoveSuccessStatus,
  buildCopyMoveOperationLabel,
  buildDestinationPlanFromPicker,
  buildMovePickerInitialState,
  buildSingleCopyMovePickerInitialState,
  deriveRetainedFailedEntries,
  shouldCloseDestinationPickerAfterSubmit,
  shouldRetainDestinationPickerAfterPartialBatch,
  type BatchCopyMoveFailure
} from "./model";

function entry(path: string, isFolder = false): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder };
}

describe("copyMove model helpers", () => {
  it("builds operation labels", () => {
    expect(buildCopyMoveOperationLabel("copy")).toBe("Copied");
    expect(buildCopyMoveOperationLabel("move")).toBe("Moved");
  });

  it("builds batch success and partial messages", () => {
    expect(buildBatchCopyMoveSuccessStatus("Copied", 2, "Archive", "Workspace", (path) => `/${path}`))
      .toBe("Copied 2 selected items to /Archive in Workspace.");
    expect(buildBatchCopyMovePartialStatus("Moved", 1, 2, 1, "Workspace"))
      .toBe("Moved 1 of 2 selected items; 1 failed in Workspace.");
    expect(buildBatchCopyMovePartialActionError("Copied", 1, 2, [
      { entry: entry("notes.txt"), message: "rejected" }
    ])).toBe("Copied 1 of 2 selected items; 1 failed. notes.txt: rejected");
  });

  it("derives retained failed entries and picker decisions", () => {
    const sourceEntriesByPath = new Map([
      ["a.txt", entry("a.txt")],
      ["b.txt", entry("b.txt")]
    ]);
    const failures: BatchCopyMoveFailure[] = [
      { target: { sourcePath: "b.txt", destinationPath: "Archive/b.txt" }, message: "failed" }
    ];
    expect(deriveRetainedFailedEntries(sourceEntriesByPath, failures)).toEqual([
      { entry: entry("b.txt"), message: "failed" }
    ]);
    expect(shouldCloseDestinationPickerAfterSubmit(true)).toBe(true);
    expect(shouldCloseDestinationPickerAfterSubmit(false)).toBe(false);
    expect(shouldRetainDestinationPickerAfterPartialBatch()).toBe(true);
  });

  it("builds initial picker states", () => {
    const context = createOperationContextToken();
    const selected = entry("Projects/roadmap.txt");
    expect(buildMovePickerInitialState(context, selected)).toMatchObject({
      context,
      kind: "move",
      sourceEntries: [selected],
      folderPath: "Projects",
      name: "roadmap.txt"
    });
    expect(buildSingleCopyMovePickerInitialState(context, selected)).toMatchObject({
      kind: "copyMove",
      sourceEntries: [selected]
    });
    expect(buildBatchCopyMovePickerInitialState(context, [selected], "Archive")).toMatchObject({
      kind: "copyMove",
      batch: true,
      folderPath: "Archive",
      sourceEntries: [selected]
    });
  });

  it("builds destination plans from picker snapshots", () => {
    const context = createOperationContextToken();
    const selected = entry("Projects/roadmap.txt");
    expect(buildDestinationPlanFromPicker({
      context,
      kind: "copyMove",
      sourceEntries: [],
      batch: false,
      folderPath: "Projects",
      name: "roadmap.txt",
      nameEdited: false,
      manualPath: "Projects/roadmap.txt",
      manualMode: false,
      entries: []
    }, "copy")).toEqual({ kind: "invalid", destinationPath: "", message: "No selected item." });
    expect(buildDestinationPlanFromPicker({
      context,
      kind: "copyMove",
      sourceEntries: [selected],
      batch: false,
      folderPath: "Archive",
      name: "roadmap.txt",
      nameEdited: false,
      manualPath: "Archive/roadmap.txt",
      manualMode: false,
      entries: []
    }, "copy").kind).toBe("valid");
  });
});
