import { parseNormalizedPath, type FileEntry } from "@davora/shared";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type {
  SelectionStateWorkspaceCommands,
  SelectionStateWorkspaceCaptures,
  SelectionStateWorkspaceOutput
} from "./ports";
import { SelectionWorkspaceEpoch } from "./ports";
import { projectSelectionStateBindings, type SelectionStateBindings } from "./projectSelectionStateBindings";

function entry(path: string): FileEntry {
  return { path, name: path.split("/").at(-1) ?? path, isFolder: false, size: 1, lastModified: "2026-01-01T00:00:00.000Z" };
}

function selectedEntry(path: string) {
  return { ...entry(path), path: parseNormalizedPath(path) };
}

function workspace(): {
  output: SelectionStateWorkspaceOutput;
  commands: SelectionStateWorkspaceCommands;
  captures: SelectionStateWorkspaceCaptures;
  batchEntries: FileEntry[];
} {
  const focused = selectedEntry("Projects/focused.txt");
  const batchEntries = [entry("Projects/batch.txt")];
  const commands = {
    selectFocused: vi.fn(), toggleFocused: vi.fn(), clearFocused: vi.fn(), clearFocusedIfCurrent: vi.fn(),
    rebindFocusedIfCurrent: vi.fn(), removeDeletedFocused: vi.fn(), showMobileActions: vi.fn(), showMobileDetails: vi.fn(),
    toggleBatch: vi.fn(), selectAllBatch: vi.fn(), deselectBatchPaths: vi.fn(), clearBatch: vi.fn(), rebindBatch: vi.fn(), removeDeletedBatch: vi.fn(), retainBatch: vi.fn(), removeCapturedBatch: vi.fn()
  } satisfies SelectionStateWorkspaceCommands;
  const captures = {
    focused: vi.fn(() => ({ identity: { accountId: "alpha", path: focused.path }, version: 1 })),
    batch: vi.fn(() => ({ accountId: "alpha", memberships: [] })),
    isBatchSelected: vi.fn((path: string) => path === "Projects/batch.txt"),
    isFocusedCurrent: vi.fn(() => true)
  } satisfies SelectionStateWorkspaceCaptures;
  const output = {
    epoch: SelectionWorkspaceEpoch.create(),
    snapshot: {
      accountId: "alpha",
      focused: { selectedEntry: focused, mobileSubview: "actions", hasSelection: true },
      batch: {
        memberships: [], entries: batchEntries,
        archiveInput: { archiveLabel: "Projects", roots: [] },
        summary: { count: 1, fileCount: 1, folderCount: 0, knownFileSizeBytes: 1, unknownSizeCount: 0 }
      }
    },
    commands,
    captures
  } satisfies SelectionStateWorkspaceOutput;
  return { output, commands, captures, batchEntries };
}

describe("projectSelectionStateBindings", () => {
  it("exposes only selection state, commands, and captures", () => {
    expectTypeOf<SelectionStateBindings>().not.toHaveProperty("token");
    expectTypeOf<SelectionStateBindings>().not.toHaveProperty("password");
    expectTypeOf<SelectionStateBindings["focused"]["select"]>().toEqualTypeOf<SelectionStateWorkspaceCommands["selectFocused"]>();
    expectTypeOf<SelectionStateBindings["batch"]["capture"]>().toEqualTypeOf<SelectionStateWorkspaceCaptures["batch"]>();
  });

  it("projects the focused and batch facades without changing callback identities", () => {
    const { output, commands, captures } = workspace();
    const bindings = projectSelectionStateBindings(output);
    expect(bindings.focused.selectedEntry).toBe(output.snapshot.focused.selectedEntry);
    expect(bindings.focused.mobileSubview).toBe("actions");
    expect(bindings.focused.hasSelection).toBe(true);
    expect(bindings.focused.select).toBe(commands.selectFocused);
    expect(bindings.focused.clear).toBe(commands.clearFocused);
    expect(bindings.focused.clearIfCurrent).toBe(commands.clearFocusedIfCurrent);
    expect(bindings.focused.rebindIfCurrent).toBe(commands.rebindFocusedIfCurrent);
    expect(bindings.focused.removeDeleted).toBe(commands.removeDeletedFocused);
    expect(bindings.focused.showMobileActions).toBe(commands.showMobileActions);
    expect(bindings.focused.showMobileDetails).toBe(commands.showMobileDetails);
    expect(bindings.focused.capture).toBe(captures.focused);
    expect(bindings.focused.isCurrent).toBe(captures.isFocusedCurrent);
    expect(bindings.batch.entries).toEqual(output.snapshot.batch.entries);
    expect(bindings.batch.entries).not.toBe(output.snapshot.batch.entries);
    expect(bindings.batch.archiveInput).toBe(output.snapshot.batch.archiveInput);
    expect(bindings.batch.summary).toBe(output.snapshot.batch.summary);
    expect(bindings.batch.memberships).toBe(output.snapshot.batch.memberships);
    expect(bindings.batch.toggle).toBe(commands.toggleBatch);
    expect(bindings.batch.selectAll).toBe(commands.selectAllBatch);
    expect(bindings.batch.deselectPaths).toBe(commands.deselectBatchPaths);
    expect(bindings.batch.clear).toBe(commands.clearBatch);
    expect(bindings.batch.removeDeleted).toBe(commands.removeDeletedBatch);
    expect(bindings.batch.rebind).toBe(commands.rebindBatch);
    expect(bindings.batch.retain).toBe(commands.retainBatch);
    expect(bindings.batch.removeCaptured).toBe(commands.removeCapturedBatch);
    expect(bindings.batch.isSelected).toBe(captures.isBatchSelected);
    expect(bindings.batch.capture).toBe(captures.batch);
  });

  it("keeps current() tied to the render snapshot and preserves batch order", () => {
    const { output, batchEntries } = workspace();
    const bindings = projectSelectionStateBindings(output);
    expect(bindings.focused.current()).toBe(output.snapshot.focused.selectedEntry);
    expect(bindings.batch.entries.map(({ path }) => path)).toEqual(["Projects/batch.txt"]);
    batchEntries.push(entry("Projects/second.txt"));
    expect(bindings.batch.entries.map(({ path }) => path)).toEqual(["Projects/batch.txt"]);
  });
});
