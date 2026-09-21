import type { FileEntry } from "@davora/shared";
import { describe, expect, it, vi } from "vitest";

import type { SelectionInteractionWorkspaceCommands } from "./ports";
import { projectFileListSelectionBindings } from "./projectSelectionFileListBindings";

const item: FileEntry = { path: "Projects/report.pdf", name: "report.pdf", isFolder: false };

function interaction(): SelectionInteractionWorkspaceCommands {
  return {
    toggleEntrySelection: vi.fn(),
    toggleBatchSelectionEntry: vi.fn(),
    toggleSelectAllEntries: vi.fn(() => true),
    clearBatchSelection: vi.fn(),
    startRowLongPressSelection: vi.fn(),
    clearRowLongPressTimer: vi.fn(),
    clearRowOpenSuppression: vi.fn(),
    getRowOpenSuppressed: vi.fn(() => false)
  };
}

describe("projectFileListSelectionBindings", () => {
  it("owns selection mode, membership, row suppression, and interaction forwarding", () => {
    const commands = interaction();
    const bindings = projectFileListSelectionBindings({
      focusedEntry: item,
      batchCount: 1,
      isBatchSelected: (path) => path === item.path,
      interaction: commands,
      isNarrowScreen: true,
      selectAllItems: [item],
      searchActive: false,
      canMarkForBatchDownload: true
    });

    expect(bindings.batchModeActive).toBe(true);
    expect(bindings.selectionModeActive).toBe(true);
    expect(bindings.isItemBatchSelected(item)).toBe(true);
    expect(bindings.isItemBatchSelected({ ...item, path: "Other/file.txt" })).toBe(false);
    expect(bindings.isItemSelected(item)).toBe(true);
    expect(bindings.isItemSelected({ ...item, path: "Other/file.txt" })).toBe(false);
    expect(bindings.suppressNarrowScreenContextMenu).toBe(true);
    expect(bindings.onToggleEntrySelection).toBe(commands.toggleEntrySelection);
    expect(bindings.onToggleBatchSelection).toBe(commands.toggleBatchSelectionEntry);
    expect(bindings.onRowPointerDown).toBe(commands.startRowLongPressSelection);
    expect(bindings.onRowPointerCancel).toBe(commands.clearRowLongPressTimer);
    expect(bindings.onRowPointerLeave).toBe(commands.clearRowLongPressTimer);
    expect(bindings.onRowPointerUp).toBe(commands.clearRowLongPressTimer);
    expect(bindings.getRowOpenSuppressed).toBe(commands.getRowOpenSuppressed);
    expect(bindings.clearRowOpenSuppression).toBe(commands.clearRowOpenSuppression);
  });

  it("projects select-all state and forwards the toggle to the interaction command", () => {
    const commands = interaction();
    const entries = [item, { ...item, path: "Projects/other.txt", name: "other.txt" }];
    const bindings = projectFileListSelectionBindings({
      batchCount: 1,
      isBatchSelected: (path) => path === item.path,
      interaction: commands,
      isNarrowScreen: false,
      selectAllItems: entries,
      searchActive: false,
      canMarkForBatchDownload: true
    });

    expect(bindings.selectAllState).toBe("partial");
    expect(bindings.canSelectAll).toBe(true);
    expect(bindings.canDeselectAll).toBe(false);

    bindings.onToggleSelectAll();
    expect(commands.toggleSelectAllEntries).toHaveBeenCalledWith(entries);
  });

  it("keeps deselect-all enabled when every entry is selected and marking is unavailable", () => {
    const bindings = projectFileListSelectionBindings({
      batchCount: 1,
      isBatchSelected: () => true,
      interaction: interaction(),
      isNarrowScreen: false,
      selectAllItems: [item],
      searchActive: false,
      canMarkForBatchDownload: false
    });

    expect(bindings.selectAllState).toBe("all");
    expect(bindings.canSelectAll).toBe(false);
    expect(bindings.canDeselectAll).toBe(true);
  });

  it("disables deselect-all while search is active even when every entry is selected", () => {
    const bindings = projectFileListSelectionBindings({
      batchCount: 1,
      isBatchSelected: () => true,
      interaction: interaction(),
      isNarrowScreen: false,
      selectAllItems: [item],
      searchActive: true,
      canMarkForBatchDownload: false
    });

    expect(bindings.selectAllState).toBe("all");
    expect(bindings.canDeselectAll).toBe(false);
  });

  it.each([
    { label: "search is active", searchActive: true, canMarkForBatchDownload: true, items: [item] },
    { label: "marking is unavailable", searchActive: false, canMarkForBatchDownload: false, items: [item] },
    { label: "the folder is empty", searchActive: false, canMarkForBatchDownload: true, items: [] as FileEntry[] }
  ])("disables select-all while $label", ({ searchActive, canMarkForBatchDownload, items }) => {
    const bindings = projectFileListSelectionBindings({
      batchCount: 0,
      isBatchSelected: () => false,
      interaction: interaction(),
      isNarrowScreen: false,
      selectAllItems: items,
      searchActive,
      canMarkForBatchDownload
    });

    expect(bindings.canSelectAll).toBe(false);
    expect(bindings.canDeselectAll).toBe(false);
    expect(bindings.selectAllState).toBe("none");
  });
});
