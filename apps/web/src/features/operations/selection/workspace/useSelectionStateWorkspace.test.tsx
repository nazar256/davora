import type { FileEntry } from "@davora/shared";
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  BatchSelectionCapture,
  FocusedSelectionCapture,
  MobileSelectionSubview,
  SelectedResourceDescriptor
} from "../model";
import type { BatchArchiveInput, BatchSelectionSummary } from "../selectors";
import {
  useSelectionStateWorkspace,
  type SelectionStateWorkspaceCommands,
  type SelectionStateWorkspaceOutput,
  type SelectionStateWorkspaceSnapshot
} from "./index";

const file = (path: string, overrides: Partial<FileEntry> = {}): FileEntry => ({
  path,
  name: path.split("/").pop() ?? path,
  isFolder: false,
  ...overrides
});

describe("useSelectionStateWorkspace", () => {
  it("exposes immutable focused/batch snapshots, typed commands, and narrow captures", () => {
    type ExpectedSnapshot = SelectionStateWorkspaceSnapshot;
    type ExpectedOutput = SelectionStateWorkspaceOutput;

    expectTypeOf<ReturnType<typeof useSelectionStateWorkspace>["snapshot"]>()
      .toEqualTypeOf<ExpectedSnapshot>();
    expectTypeOf<ReturnType<typeof useSelectionStateWorkspace>["commands"]>()
      .toEqualTypeOf<SelectionStateWorkspaceCommands>();
    expectTypeOf<ReturnType<typeof useSelectionStateWorkspace>>()
      .toEqualTypeOf<ExpectedOutput>();
    expectTypeOf<ReturnType<typeof useSelectionStateWorkspace>>()
      .not.toHaveProperty("token");
    expectTypeOf<ReturnType<typeof useSelectionStateWorkspace>>()
      .not.toHaveProperty("password");

    expectTypeOf<FocusedSelectionCapture | undefined>().toMatchTypeOf<
      ReturnType<SelectionStateWorkspaceOutput["captures"]["focused"]>
    >();
    expectTypeOf<BatchSelectionCapture>().toMatchTypeOf<
      ReturnType<SelectionStateWorkspaceOutput["captures"]["batch"]>
    >();
    expectTypeOf<SelectedResourceDescriptor>().toMatchTypeOf<
      SelectionStateWorkspaceSnapshot["focused"]["selectedEntry"]
    >();
    expectTypeOf<MobileSelectionSubview>().toMatchTypeOf<
      SelectionStateWorkspaceSnapshot["focused"]["mobileSubview"]
    >();
    expectTypeOf<BatchArchiveInput>().toMatchTypeOf<
      SelectionStateWorkspaceSnapshot["batch"]["archiveInput"]
    >();
    expectTypeOf<BatchSelectionSummary>().toMatchTypeOf<
      SelectionStateWorkspaceSnapshot["batch"]["summary"]
    >();
  });

  it("keeps focused and batch identity/version/origin/archive captures immutable and ordered", () => {
    const { result } = renderHook(() => useSelectionStateWorkspace({ accountId: "alpha" }));
    const initialSnapshot = result.current.snapshot;

    act(() => {
      result.current.commands.selectFocused(file("Projects/report.pdf", { size: 10 }));
      result.current.commands.toggleBatch(file("Projects/report.pdf", { size: 10 }), {
        kind: "browse",
        folderPath: "Projects"
      });
      result.current.commands.toggleBatch(file("Archive/notes.txt", { size: 20 }), {
        kind: "search",
        scopePath: "Projects"
      });
    });

    const focusedCapture = result.current.captures.focused();
    const batchCapture = result.current.captures.batch();
    const snapshot = result.current.snapshot;

    expect(snapshot.focused.selectedEntry).toMatchObject({ path: "Projects/report.pdf", size: 10 });
    expect(snapshot.focused.hasSelection).toBe(true);
    expect(snapshot.batch.memberships.map((membership) => membership.identity.path)).toEqual([
      "Projects/report.pdf",
      "Archive/notes.txt"
    ]);
    expect(snapshot.batch.memberships.map((membership) => membership.membershipVersion)).toEqual([1, 2]);
    expect(snapshot.batch.memberships.map((membership) => membership.origin)).toEqual([
      { kind: "browse", folderPath: "Projects" },
      { kind: "search", scopePath: "Projects" }
    ]);
    expect(snapshot.batch.archiveInput.roots.map((root) => root.archiveRoot)).toEqual([
      "report.pdf",
      "Archive/notes.txt"
    ]);
    expect(snapshot.batch.archiveInput.archiveLabel).toBe("selection");
    expect(focusedCapture).toEqual({
      identity: { accountId: "alpha", path: "Projects/report.pdf" },
      version: 1
    });
    expect(batchCapture.memberships.map((membership) => membership.membershipVersion)).toEqual([1, 2]);

    act(() => {
      result.current.commands.clearFocused();
      result.current.commands.toggleBatch(file("Archive/notes.txt"), {
        kind: "search",
        scopePath: "Projects"
      });
      result.current.commands.toggleBatch(file("Projects/renamed.txt"), {
        kind: "browse",
        folderPath: "Projects"
      });
    });

    expect(initialSnapshot.focused.selectedEntry).toBeUndefined();
    expect(initialSnapshot.batch.memberships).toEqual([]);
    expect(result.current.captures.focused()).toBeUndefined();
    expect(result.current.snapshot.batch.memberships.map((membership) => membership.identity.path)).toEqual([
      "Projects/report.pdf",
      "Projects/renamed.txt"
    ]);
    expect(result.current.snapshot.batch.memberships.map((membership) => membership.membershipVersion)).toEqual([1, 3]);
    expect(result.current.snapshot.focused.mobileSubview).toBe("actions");
  });

  it("masks account replacement synchronously and rejects stale captures from the previous account", () => {
    const { result, rerender } = renderHook(
      ({ accountId }: { accountId: string | undefined }) => useSelectionStateWorkspace({ accountId }),
      { initialProps: { accountId: "alpha" }, wrapper: StrictMode }
    );

    act(() => {
      result.current.commands.selectFocused(file("alpha.txt"));
      result.current.commands.toggleBatch(file("alpha.txt"), { kind: "browse", folderPath: "" });
    });
    const staleCommands = result.current.commands;
    const staleFocused = result.current.captures.focused();
    const staleBatch = result.current.captures.batch();

    rerender({ accountId: "beta" });
    expect(result.current.snapshot.accountId).toBe("beta");
    expect(result.current.snapshot.focused.selectedEntry).toBeUndefined();
    expect(result.current.snapshot.batch.entries).toEqual([]);

    act(() => {
      result.current.commands.selectFocused(file("beta.txt"));
      result.current.commands.toggleBatch(file("beta.txt"), { kind: "browse", folderPath: "" });
      staleCommands.clearFocusedIfCurrent(staleFocused);
      staleCommands.removeCapturedBatch(staleBatch);
    });

    expect(result.current.snapshot.focused.selectedEntry?.path).toBe("beta.txt");
    expect(result.current.snapshot.batch.entries.map((entry) => entry.path)).toEqual(["beta.txt"]);
    expect(result.current.captures.focused()?.identity.accountId).toBe("beta");
    expect(result.current.captures.batch().accountId).toBe("beta");
  });

  it("keeps first-generation APIs and capture predicates inert after Alpha-to-Beta-to-Alpha replacement", () => {
    const { result, rerender } = renderHook(
      ({ accountId }: { accountId: string | undefined }) => useSelectionStateWorkspace({ accountId }),
      { initialProps: { accountId: "alpha" } }
    );

    act(() => result.current.commands.selectFocused(file("same-path.txt")));
    const firstGeneration = result.current;
    const firstCapture = firstGeneration.captures.focused();

    rerender({ accountId: "beta" });
    rerender({ accountId: "alpha" });
    expect(result.current.snapshot.focused.selectedEntry).toBeUndefined();
    expect(firstGeneration.captures.isFocusedCurrent(firstCapture)).toBe(false);
    expect(firstGeneration.captures.focused()).toBeUndefined();

    act(() => firstGeneration.commands.selectFocused(file("stale.txt")));
    expect(result.current.snapshot.focused.selectedEntry).toBeUndefined();
  });

  it("applies select-all and scoped deselect through epoch-guarded commands", () => {
    const { result, rerender } = renderHook(
      ({ accountId }: { accountId: string | undefined }) => useSelectionStateWorkspace({ accountId }),
      { initialProps: { accountId: "alpha" } }
    );

    act(() => {
      result.current.commands.selectAllBatch(
        [file("Projects/a.txt"), file("Projects/Docs", { isFolder: true }), file("Projects/b.txt")],
        { kind: "browse", folderPath: "Projects" }
      );
    });

    expect(result.current.snapshot.batch.entries.map((entry) => entry.path)).toEqual([
      "Projects/a.txt",
      "Projects/Docs",
      "Projects/b.txt"
    ]);
    expect(result.current.snapshot.batch.memberships.map((membership) => membership.membershipVersion)).toEqual([1, 2, 3]);

    const staleCommands = result.current.commands;
    rerender({ accountId: "beta" });
    act(() => {
      staleCommands.selectAllBatch([file("stale.txt")], { kind: "browse", folderPath: "" });
      staleCommands.deselectBatchPaths(["stale.txt"]);
    });
    expect(result.current.snapshot.batch.entries).toEqual([]);

    rerender({ accountId: "alpha" });
    act(() => {
      result.current.commands.selectAllBatch(
        [file("Projects/a.txt"), file("Other/keep.txt")],
        { kind: "browse", folderPath: "Projects" }
      );
      result.current.commands.deselectBatchPaths(["Projects/a.txt", "Projects/missing.txt"]);
    });
    expect(result.current.snapshot.batch.entries.map((entry) => entry.path)).toEqual(["Other/keep.txt"]);
  });

  it("preserves selection across path/query replacement while recording the replacement in later interaction scope", () => {
    const { result } = renderHook(() => useSelectionStateWorkspace({ accountId: "alpha" }));

    act(() => {
      result.current.commands.toggleBatch(file("Projects/report.pdf"), {
        kind: "browse",
        folderPath: "Projects"
      });
    });

    expect(result.current.snapshot.batch.entries.map((entry) => entry.path)).toEqual(["Projects/report.pdf"]);
    expect(result.current.snapshot.batch.archiveInput.roots[0]?.archiveRoot).toBe("report.pdf");
    expect(result.current.snapshot.batch.memberships[0]?.origin).toEqual({ kind: "browse", folderPath: "Projects" });
  });
});
