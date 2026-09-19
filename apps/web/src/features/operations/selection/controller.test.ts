import { describe, expect, it, vi } from "vitest";

import type { FileEntry } from "@davora/shared";

import {
  applySelectionInteractionPlan,
  clearBatchSelection,
  toggleBatchSelectionEntry,
  toggleEntrySelection
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
  hasSelectedPreview?: boolean;
  initialSelectedEntry?: FileEntry;
} = {}): SelectionInteractionPorts & {
  selectFocused(next: FileEntry): void;
  setMobileDetailsOpen(next: boolean): void;
  batchToggle: ReturnType<typeof vi.fn>;
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
    wasBatchSelected: options.wasBatchSelected ?? false
  };

  const batchToggle = vi.fn();
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
      isSelected: vi.fn(() => state.wasBatchSelected),
      toggle: batchToggle,
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
});
