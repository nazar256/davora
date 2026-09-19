import type { FileEntry } from "@davora/shared";
import { describe, expect, it, vi } from "vitest";

import type { SelectionSyncEffect } from "./model";
import { applySelectionSyncEffect, type SelectionSyncApplicationDeps } from "./selectionSyncApplication";

function entry(path: string): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false };
}

function createDeps(overrides: Partial<SelectionSyncApplicationDeps> = {}): SelectionSyncApplicationDeps {
  return {
    batchSelection: {
      removeDeleted: vi.fn(),
      rebind: vi.fn()
    },
    selection: {
      currentFocusedSelection: vi.fn(() => undefined),
      selectFocused: vi.fn(),
      clearFocused: vi.fn(),
      clearFocusedIfCurrent: vi.fn(),
      rebindFocusedIfCurrent: vi.fn(),
      removeDeletedFocused: vi.fn(),
      isFocusedSelectionCurrent: vi.fn(() => true),
      setSelectedPreview: vi.fn(),
      closePreview: vi.fn()
    },
    chrome: {
      closeMobileDetails: vi.fn(),
      openMobileDetails: vi.fn()
    },
    mobile: {
      isNarrowScreen: false
    },
    ...overrides
  };
}

describe("applySelectionSyncEffect", () => {
  it("clears selection, preview, and mobile chrome on delete", () => {
    const deps = createDeps();
    const effect: SelectionSyncEffect = { kind: "delete", path: "notes.txt" };

    applySelectionSyncEffect(effect, deps);

    expect(deps.batchSelection.removeDeleted).toHaveBeenCalledWith("notes.txt");
    expect(deps.selection.setSelectedPreview).toHaveBeenCalled();
    expect(deps.selection.closePreview).toHaveBeenCalled();
    expect(deps.selection.removeDeletedFocused).toHaveBeenCalledWith("notes.txt");
    expect(deps.chrome.closeMobileDetails).toHaveBeenCalled();
  });

  it("honors App-style preview adapter clear on delete (updater → undefined)", () => {
    let preview: { path: string; name: string; viewer: string } | undefined = {
      path: "notes.txt",
      name: "notes.txt",
      viewer: "text"
    };
    const deps = createDeps({
      selection: {
        currentFocusedSelection: vi.fn(() => undefined),
        selectFocused: vi.fn(),
        clearFocused: vi.fn(),
        clearFocusedIfCurrent: vi.fn(),
        rebindFocusedIfCurrent: vi.fn(),
        removeDeletedFocused: vi.fn(),
        isFocusedSelectionCurrent: vi.fn(() => true),
        setSelectedPreview: (updater) => {
          const next = updater(preview ? { path: preview.path, name: preview.name } : undefined);
          if (next === undefined) {
            preview = undefined;
            return;
          }
          if (!preview) {
            return;
          }
          preview = { ...preview, path: next.path, name: next.name };
        },
        closePreview: vi.fn()
      }
    });

    applySelectionSyncEffect({ kind: "delete", path: "notes.txt" }, deps);

    expect(preview).toBeUndefined();
  });

  it("focuses uploaded items and rebinds batch selection", () => {
    const deps = createDeps({ mobile: { isNarrowScreen: true } });
    const item = entry("new.txt");
    const effect: SelectionSyncEffect = { kind: "focus-item", item, rebindFromPath: "new.txt" };

    applySelectionSyncEffect(effect, deps);

    expect(deps.selection.selectFocused).toHaveBeenCalledWith(item);
    expect(deps.chrome.openMobileDetails).toHaveBeenCalled();
    expect(deps.batchSelection.rebind).toHaveBeenCalledWith("new.txt", item);
  });

  it("rebinds move-copy selection and updates preview when paths match", () => {
    const nextEntry = entry("Archive/notes.txt");
    const deps = createDeps();
    const effect: SelectionSyncEffect = {
      kind: "move-copy-selected",
      sourcePath: "Projects/notes.txt",
      destinationPath: "Archive/notes.txt",
      nextEntry,
      updatePreview: true,
      previewName: "notes.txt"
    };

    applySelectionSyncEffect(effect, deps);

    expect(deps.selection.selectFocused).toHaveBeenCalledWith(nextEntry);
    expect(deps.batchSelection.rebind).toHaveBeenCalledWith("Projects/notes.txt", nextEntry);
    expect(deps.selection.setSelectedPreview).toHaveBeenCalled();
  });

  it("keeps the current focused item on the upload/rebind path before a later delete clears it", () => {
    let focused: FileEntry | undefined;
    const deps = createDeps({
      selection: {
        currentFocusedSelection: () => focused,
        selectFocused: (entry) => {
          focused = entry;
        },
        clearFocused: () => { focused = undefined; },
        clearFocusedIfCurrent: vi.fn(),
        rebindFocusedIfCurrent: vi.fn(),
        removeDeletedFocused: () => { focused = undefined; },
        isFocusedSelectionCurrent: vi.fn(() => true),
        setSelectedPreview: vi.fn(),
        closePreview: vi.fn()
      }
    });
    const uploaded = entry("new.txt");

    applySelectionSyncEffect({ kind: "focus-item", item: uploaded, rebindFromPath: "new.txt" }, deps);
    expect(focused).toEqual(uploaded);

    const rebound = entry("Archive/new.txt");
    applySelectionSyncEffect({
      kind: "move-copy-selected",
      sourcePath: uploaded.path,
      destinationPath: rebound.path,
      nextEntry: rebound,
      updatePreview: false,
      previewName: rebound.name
    }, deps);
    expect(focused).toEqual(rebound);

    applySelectionSyncEffect({ kind: "delete", path: rebound.path }, deps);
    expect(focused).toBeUndefined();
  });
});
