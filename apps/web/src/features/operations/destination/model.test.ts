import type { FileEntry } from "@davora/shared";
import { describe, expect, it } from "vitest";

import { createOperationContextToken } from "../policy";
import {
  applyDestinationListingSuccess,
  buildDestinationPlanFromPicker,
  matchesDestinationListing,
  reloadDestinationPickerFolder,
  updateDestinationPickerFolder,
  updateDestinationPickerManualMode,
  updateDestinationPickerManualPath,
  updateDestinationPickerName
} from "./pickerState";
import type { DestinationPickerState } from "./model";

function entry(path: string, isFolder = false): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder };
}

function basePicker(overrides: Partial<DestinationPickerState> = {}): DestinationPickerState {
  const context = createOperationContextToken();
  return {
    context,
    kind: "copyMove",
    sourceEntries: [entry("Projects/report.txt")],
    batch: false,
    folderPath: "Archive",
    name: "report.txt",
    nameEdited: false,
    manualPath: "Archive/report.txt",
    manualMode: false,
    entries: [],
    loading: true,
    reloadKey: 0,
    ...overrides
  };
}

describe("destination picker model", () => {
  it("updates folder drafts and bumps reloadKey", () => {
    const picker = basePicker();
    const next = updateDestinationPickerFolder(picker, "Shared");
    expect(next).toMatchObject({
      folderPath: "Shared",
      manualPath: "Shared/report.txt",
      entries: [],
      loading: true,
      reloadKey: 1,
      error: undefined
    });
  });

  it("preserves edited names when changing folders", () => {
    const picker = basePicker({ name: "renamed.txt", nameEdited: true });
    const next = updateDestinationPickerFolder(picker, "Shared");
    expect(next.name).toBe("renamed.txt");
    expect(next.manualPath).toBe("Shared/renamed.txt");
  });

  it("updates manual path drafts and triggers reload in manual mode", () => {
    const picker = basePicker({ manualMode: true });
    const next = updateDestinationPickerManualPath(picker, "Shared/custom.txt");
    expect(next).toMatchObject({
      manualPath: "Shared/custom.txt",
      entries: [],
      loading: true,
      error: undefined
    });
  });

  it("marks names as edited and rebuilds manual paths", () => {
    const picker = basePicker();
    const next = updateDestinationPickerName(picker, "final.txt");
    expect(next).toMatchObject({
      name: "final.txt",
      nameEdited: true,
      manualPath: "Archive/final.txt"
    });
  });

  it("switches manual mode while preserving batch folder paths", () => {
    const batch = basePicker({
      batch: true,
      folderPath: "Archive",
      manualPath: "Archive",
      name: ""
    });
    const next = updateDestinationPickerManualMode(batch, true);
    expect(next.manualMode).toBe(true);
    expect(next.manualPath).toBe("Archive");
  });

  it("reloads destination folders by incrementing reloadKey", () => {
    const picker = basePicker({ reloadKey: 2, entries: [entry("Archive/existing.txt")] });
    const next = reloadDestinationPickerFolder(picker);
    expect(next).toMatchObject({
      entries: [],
      loading: true,
      reloadKey: 3,
      error: undefined
    });
  });

  it("suggests non-conflicting copy names only when the name was not edited", () => {
    const source = entry("Projects/report.txt");
    const entries = [entry("Archive/report.txt")];
    const next = applyDestinationListingSuccess(basePicker({
      kind: "copy",
      sourceEntries: [source],
      folderPath: "Archive"
    }), entries, "complete");
    expect(next.name).toBe("report (1).txt");
    expect(next.manualPath).toBe("Archive/report (1).txt");
  });

  it("does not suggest copy names after manual edits", () => {
    const source = entry("Projects/report.txt");
    const entries = [entry("Archive/report.txt")];
    const next = applyDestinationListingSuccess(basePicker({
      kind: "copy",
      sourceEntries: [source],
      folderPath: "Archive",
      nameEdited: true
    }), entries, "complete");
    expect(next.name).toBe("report.txt");
  });

  it("matches destination listings using captured folder paths and context tokens", () => {
    const context = createOperationContextToken();
    const staleContext = createOperationContextToken();
    const picker = basePicker({ context, folderPath: "Archive" });
    const isCurrent = (left: typeof context, right: typeof context) => left === right;
    expect(matchesDestinationListing(picker, context, "Archive", isCurrent, context)).toBe(true);
    expect(matchesDestinationListing(picker, context, "Shared", isCurrent, context)).toBe(false);
    expect(matchesDestinationListing({ ...picker, context: staleContext }, context, "Archive", isCurrent, context)).toBe(false);
  });

  it("builds planner validation outcomes from picker snapshots", () => {
    const picker = basePicker({
      entries: [entry("Archive/existing.txt")],
      loading: false
    });
    expect(buildDestinationPlanFromPicker(picker, "copy").kind).toBe("valid");
    expect(buildDestinationPlanFromPicker({
      ...picker,
      sourceEntries: [entry("Archive/existing.txt")],
      name: "existing.txt"
    }, "move").kind).toBe("invalid");
  });
});
