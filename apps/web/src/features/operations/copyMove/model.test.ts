import type { FileEntry } from "@davora/shared";
import { describe, expect, it } from "vitest";

import { createOperationContextToken } from "../policy";
import {
  buildBatchCopyMovePartialStatus,
  buildBatchCopyMovePickerInitialState,
  buildBatchCopyMoveSuccessStatus,
  buildCopyMoveOperationLabel,
  buildDestinationPlanFromPicker,
  buildMovePickerInitialState,
  buildSingleCopyMovePickerInitialState
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
      entries: [],
      loading: false
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
      entries: [],
      loading: false
    }, "copy").kind).toBe("valid");
  });
});
