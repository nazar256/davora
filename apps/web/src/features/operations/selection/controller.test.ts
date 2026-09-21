import { describe, expect, it, vi } from "vitest";

import type { FileEntry } from "@davora/shared";

import {
  applySelectionInteractionPlan,
  clearBatchSelection,
  toggleBatchSelectionEntry,
  toggleEntrySelection,
  toggleSelectAllEntries
} from "./controller";
import type { SelectionInteractionPorts } from "./ports";

function entry(path: string): FileEntry {
  return {
    path,
    name: path.split("/").pop() ?? path,
    isFolder: false
  };
}

function createPorts(options: {
  narrow?: boolean;
  mobileDetailsOpen?: boolean;
  searchActive?: boolean;
  currentPath?: string;
  wasBatchSelected?: boolean;
  selectedPaths?: readonly string[];
  hasSelectedPreview?: boolean;
  initialSelectedEntry?: FileEntry;
} = {}): SelectionInteractionPorts & {
  selectFocused(next: FileEntry): void;
  setMobileDetailsOpen(next: boolean): void;
  batchToggle: ReturnType<typeof vi.fn>;
  batchSelectAll: ReturnType<typeof vi.fn>;
  batchDeselectPaths: ReturnType<typeof vi.fn>;
  batchClear: ReturnType<typeof vi.fn>;
  openMobileDetails: ReturnType<typeof vi.fn>;
  closeMobileDetails: ReturnType<typeof vi.fn>;
} {
  const state = {
    selectedEntry: options.initialSelectedEntry,
    hasSelectedPreview: options.hasSelectedPreview ?? false,
    mobileDetailsOpen: options.mobileDetailsOpen ?? false,
    narrow: options.narrow ?? true,
    searchActive: options.searchActive ?? false,
    currentPath: options.currentPath ?? "Projects",
    wasBatchSelected: options.wasBatchSelected ?? false,
    selectedPaths: new Set(options.selectedPaths ?? [])
  };

  const batchToggle = vi.fn();
  const batchSelectAll = vi.fn();
  const batchDeselectPaths = vi.fn();
  const batchClear = vi.fn();
  const openMobileDetails = vi.fn();
  const closeMobileDetails = vi.fn();

  return {
    selectFocused(next: FileEntry) {
      state.selectedEntry = next;
    },
    setMobileDetailsOpen(next: boolean) {
      state.mobileDetailsOpen = next;
    },
    batchToggle,
    batchSelectAll,
    batchDeselectPaths,
    batchClear,
    openMobileDetails,
    closeMobileDetails,
    timer: {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn()
    },
    chrome: {
      isNarrowScreen: () => state.narrow,
      isMobileDetailsOpen: () => state.mobileDetailsOpen,
      openMobileDetails,
      closeMobileDetails,
    },
    focused: {
      current: () => state.selectedEntry,
      select: (next) => {
        state.selectedEntry = next;
      },
      clear: () => { state.selectedEntry = undefined; },
      hasSelectedPreview: () => state.hasSelectedPreview,
      showMobileActions: vi.fn()
    },
    batch: {
      isSelected: vi.fn((path: string) => state.selectedPaths.size > 0 ? state.selectedPaths.has(path) : state.wasBatchSelected),
      toggle: batchToggle,
      selectAll: batchSelectAll,
      deselectPaths: batchDeselectPaths,
      clear: batchClear
    },
    scope: {
      isSearchActive: () => state.searchActive,
      getCurrentPath: () => state.currentPath
    }
  };
}

describe("selection controller", () => {
  it("opens mobile details when re-tapping the same focused entry on narrow with details closed", () => {
    const item = entry("Projects/report.pdf");
    const ports = createPorts({ initialSelectedEntry: item, mobileDetailsOpen: false });

    toggleEntrySelection(item, ports);

    expect(ports.focused.current()).toBe(item);
    expect(ports.openMobileDetails).toHaveBeenCalledWith({ pushHistory: undefined });
    expect(ports.closeMobileDetails).not.toHaveBeenCalled();
  });

  it("clears focused selection when batch is cleared without preview", () => {
    const item = entry("Projects/report.pdf");
    const ports = createPorts({ initialSelectedEntry: item, hasSelectedPreview: false });

    clearBatchSelection(ports);

    expect(ports.batchClear).toHaveBeenCalledTimes(1);
    expect(ports.focused.current()).toBeUndefined();
    expect(ports.closeMobileDetails).toHaveBeenCalledTimes(1);
  });

  it("ignores batch toggle when markBatch is unavailable", () => {
    const ports = createPorts();
    const item = entry("Projects/report.pdf");

    toggleBatchSelectionEntry(item, ports, {
      isCurrentOperationHandler: () => false,
      isMarkBatchAllowed: () => true
    });

    expect(ports.batchToggle).not.toHaveBeenCalled();
  });

  it("batch toggles with search scope and syncs focused selection", () => {
    const ports = createPorts({ searchActive: true, currentPath: "Projects", wasBatchSelected: false });
    const item = entry("Projects/report.pdf");

    toggleBatchSelectionEntry(item, ports, {
      isCurrentOperationHandler: () => true,
      isMarkBatchAllowed: () => true
    });

    expect(ports.batchToggle).toHaveBeenCalledWith(item, { kind: "search", scopePath: "Projects" });
    expect(ports.focused.current()).toEqual(item);
    expect(ports.closeMobileDetails).toHaveBeenCalledTimes(1);
  });

  it("applies batch clear before focused and chrome effects", () => {
    const calls: string[] = [];
    const ports: SelectionInteractionPorts = {
      timer: {
        setTimeout: vi.fn(() => 1),
        clearTimeout: vi.fn()
      },
      batch: {
        isSelected: vi.fn(() => false),
        toggle: vi.fn(),
        selectAll: vi.fn(),
        deselectPaths: vi.fn(),
        clear: vi.fn(() => {
          calls.push("batch-clear");
        })
      },
      focused: {
        current: () => entry("Projects/report.pdf"),
        select: vi.fn(),
        clear: () => {
          calls.push("focused-clear");
        },
        hasSelectedPreview: () => false,
        showMobileActions: vi.fn()
      },
      chrome: {
        isNarrowScreen: () => true,
        isMobileDetailsOpen: () => false,
        openMobileDetails: vi.fn(),
        closeMobileDetails: () => {
          calls.push("chrome-close");
        },
      },
      scope: {
        isSearchActive: () => false,
        getCurrentPath: () => "Projects"
      }
    };

    applySelectionInteractionPlan({
      batchClear: true,
      focused: [{ kind: "clear" }],
      chrome: [{ kind: "closeMobileDetails" }]
    }, ports);

    expect(calls).toEqual(["batch-clear", "focused-clear", "chrome-close"]);
  });

  it("selects all entries with a browse origin and does not touch the focused selection", () => {
    const ports = createPorts({ currentPath: "Projects", initialSelectedEntry: entry("Projects/report.pdf") });
    const entries = [entry("Projects/a.txt"), entry("Projects/Docs")];

    const toggled = toggleSelectAllEntries(entries, ports, {
      isCurrentOperationHandler: () => true,
      isMarkBatchAllowed: () => true
    });

    expect(toggled).toBe(true);
    expect(ports.batchSelectAll).toHaveBeenCalledWith(entries, { kind: "browse", folderPath: "Projects" });
    expect(ports.batchDeselectPaths).not.toHaveBeenCalled();
    expect(ports.focused.current()).toEqual(entry("Projects/report.pdf"));
  });

  it("deselects the listed paths when every entry is already selected", () => {
    const entries = [entry("Projects/a.txt"), entry("Projects/b.txt")];
    const ports = createPorts({
      currentPath: "Projects",
      selectedPaths: ["Projects/a.txt", "Projects/b.txt"],
      initialSelectedEntry: entry("Projects/a.txt")
    });

    const toggled = toggleSelectAllEntries(entries, ports, {
      isCurrentOperationHandler: () => true,
      isMarkBatchAllowed: () => true
    });

    expect(toggled).toBe(true);
    expect(ports.batchDeselectPaths).toHaveBeenCalledWith(["Projects/a.txt", "Projects/b.txt"]);
    expect(ports.batchSelectAll).not.toHaveBeenCalled();
    expect(ports.focused.current()).toBeUndefined();
    expect(ports.closeMobileDetails).toHaveBeenCalledTimes(1);
  });

  it("keeps the focused selection on deselect-all when it is not part of the entry set", () => {
    const entries = [entry("Projects/a.txt")];
    const ports = createPorts({
      currentPath: "Projects",
      selectedPaths: ["Projects/a.txt"],
      initialSelectedEntry: entry("Other/focused.txt")
    });

    toggleSelectAllEntries(entries, ports, {
      isCurrentOperationHandler: () => true,
      isMarkBatchAllowed: () => true
    });

    expect(ports.batchDeselectPaths).toHaveBeenCalledWith(["Projects/a.txt"]);
    expect(ports.focused.current()).toEqual(entry("Other/focused.txt"));
    expect(ports.closeMobileDetails).not.toHaveBeenCalled();
  });

  it("keeps the focused selection on deselect-all while a selected preview is open", () => {
    const entries = [entry("Projects/a.txt")];
    const ports = createPorts({
      currentPath: "Projects",
      selectedPaths: ["Projects/a.txt"],
      initialSelectedEntry: entry("Projects/a.txt"),
      hasSelectedPreview: true
    });

    toggleSelectAllEntries(entries, ports, {
      isCurrentOperationHandler: () => true,
      isMarkBatchAllowed: () => true
    });

    expect(ports.batchDeselectPaths).toHaveBeenCalledTimes(1);
    expect(ports.focused.current()).toEqual(entry("Projects/a.txt"));
    expect(ports.closeMobileDetails).not.toHaveBeenCalled();
  });

  it("rejects select-all while search is active, when marking is unavailable, or without authority", () => {
    const entries = [entry("Projects/a.txt")];

    const searching = createPorts({ searchActive: true });
    expect(toggleSelectAllEntries(entries, searching, {
      isCurrentOperationHandler: () => true,
      isMarkBatchAllowed: () => true
    })).toBe(false);
    expect(searching.batchSelectAll).not.toHaveBeenCalled();

    const unmarkable = createPorts();
    expect(toggleSelectAllEntries(entries, unmarkable, {
      isCurrentOperationHandler: () => true,
      isMarkBatchAllowed: () => false
    })).toBe(false);
    expect(unmarkable.batchSelectAll).not.toHaveBeenCalled();

    const unauthorized = createPorts();
    expect(toggleSelectAllEntries(entries, unauthorized, {
      isCurrentOperationHandler: () => false,
      isMarkBatchAllowed: () => true
    })).toBe(false);
    expect(unauthorized.batchSelectAll).not.toHaveBeenCalled();

    const empty = createPorts();
    expect(toggleSelectAllEntries([], empty, {
      isCurrentOperationHandler: () => true,
      isMarkBatchAllowed: () => true
    })).toBe(false);
    expect(empty.batchSelectAll).not.toHaveBeenCalled();
    expect(empty.batchDeselectPaths).not.toHaveBeenCalled();
  });

  it("still allows deselect-all when marking becomes unavailable", () => {
    const entries = [entry("Projects/a.txt")];
    const ports = createPorts({ selectedPaths: ["Projects/a.txt"] });

    const toggled = toggleSelectAllEntries(entries, ports, {
      isCurrentOperationHandler: () => true,
      isMarkBatchAllowed: () => false
    });

    expect(toggled).toBe(true);
    expect(ports.batchDeselectPaths).toHaveBeenCalledWith(["Projects/a.txt"]);
  });
});
