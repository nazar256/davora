import type { FileEntry } from "@davora/shared";
import { describe, expect, it, vi } from "vitest";

import type { SelectionInteractionWorkspaceCommands } from "./ports";
import { projectFileListSelectionBindings } from "./projectSelectionFileListBindings";

const item: FileEntry = { path: "Projects/report.pdf", name: "report.pdf", isFolder: false };

function interaction(): SelectionInteractionWorkspaceCommands {
  return {
    toggleEntrySelection: vi.fn(),
    toggleBatchSelectionEntry: vi.fn(),
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
      isNarrowScreen: true
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
});
