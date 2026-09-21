import type { FileEntry } from "@davora/shared";
import { describe, expect, it } from "vitest";

import {
  captureBatchSelection,
  clearBatchSelection,
  createBatchSelectionState,
  rebindBatchSelection,
  removeBatchSelectionPaths,
  removeCapturedSelection,
  removeDeletedPath,
  replaceBatchSelectionAccount,
  retainBatchSelectionPaths,
  selectAllBatchEntries,
  toggleBatchSelection
} from "./model";

const file = (path: string, overrides: Partial<FileEntry> = {}): FileEntry => ({
  path,
  name: path.split("/").pop() ?? path,
  isFolder: false,
  mimeType: "text/plain",
  ...overrides
});

const browseOrigin = { kind: "browse" as const, folderPath: "" };
const searchOrigin = { kind: "search" as const, scopePath: "" };

describe("batch selection model", () => {
  it("toggles canonical resources by account and path in deterministic insertion order", () => {
    let state = createBatchSelectionState("alpha");
    state = toggleBatchSelection(state, "alpha", file("Projects/report.txt"), browseOrigin).state;
    state = toggleBatchSelection(state, "alpha", file("Archive/report.txt"), searchOrigin).state;

    expect(state.memberships.map((item) => item.descriptor.path)).toEqual(["Projects/report.txt", "Archive/report.txt"]);
    expect(state.memberships.map((item) => item.membershipVersion)).toEqual([1, 2]);

    const removed = toggleBatchSelection(state, "alpha", file("Projects/report.txt"), browseOrigin);
    expect(removed.outcome).toBe("removed");
    expect(removed.state.memberships.map((item) => item.descriptor.path)).toEqual(["Archive/report.txt"]);

    const readded = toggleBatchSelection(removed.state, "alpha", file("Projects/report.txt"), browseOrigin);
    expect(readded.state.memberships.map((item) => item.descriptor.path)).toEqual(["Archive/report.txt", "Projects/report.txt"]);
    expect(readded.state.memberships[1]?.membershipVersion).toBe(3);
  });

  it("rejects wrong-account and invalid or noncanonical resources without partial mutation", () => {
    const state = toggleBatchSelection(createBatchSelectionState("alpha"), "alpha", file("資料/report.txt"), browseOrigin).state;

    for (const invalid of ["../secret.txt", "/Projects/report.txt", "Projects//report.txt", "Projects/report.txt/"]) {
      const transition = toggleBatchSelection(state, "alpha", file(invalid), browseOrigin);
      expect(transition.outcome).toBe("rejected");
      expect(transition.state).toBe(state);
    }
    expect(toggleBatchSelection(state, "beta", file("other.txt"), browseOrigin)).toEqual({ state, outcome: "rejected" });
  });

  it("clears on account replacement while keeping membership versions monotonic", () => {
    let state = toggleBatchSelection(createBatchSelectionState("alpha"), "alpha", file("one.txt"), browseOrigin).state;
    state = clearBatchSelection(state, "alpha");
    state = toggleBatchSelection(state, "alpha", file("two.txt"), browseOrigin).state;
    state = replaceBatchSelectionAccount(state, "beta");
    state = toggleBatchSelection(state, "beta", file("three.txt"), browseOrigin).state;

    expect(state.accountId).toBe("beta");
    expect(state.memberships).toHaveLength(1);
    expect(state.memberships[0]?.membershipVersion).toBe(3);
  });

  it("preserves order, origin, and membership version when metadata is rebound", () => {
    let state = createBatchSelectionState("alpha");
    state = toggleBatchSelection(state, "alpha", file("one.txt", { size: 1 }), searchOrigin).state;
    state = toggleBatchSelection(state, "alpha", file("two.txt"), browseOrigin).state;

    state = rebindBatchSelection(state, "alpha", "one.txt", file("renamed.txt", { size: 9 }));

    expect(state.memberships.map((item) => item.descriptor.path)).toEqual(["renamed.txt", "two.txt"]);
    expect(state.memberships[0]).toMatchObject({ membershipVersion: 1, origin: searchOrigin, descriptor: { size: 9 } });
  });

  it("removes only captured memberships that have not been removed and re-added", () => {
    let state = createBatchSelectionState("alpha");
    state = toggleBatchSelection(state, "alpha", file("one.txt"), browseOrigin).state;
    state = toggleBatchSelection(state, "alpha", file("two.txt"), browseOrigin).state;
    const capture = captureBatchSelection(state);

    state = toggleBatchSelection(state, "alpha", file("one.txt"), browseOrigin).state;
    state = toggleBatchSelection(state, "alpha", file("one.txt"), browseOrigin).state;
    state = toggleBatchSelection(state, "alpha", file("three.txt"), browseOrigin).state;
    state = rebindBatchSelection(state, "alpha", "two.txt", file("two.txt", { size: 20 }));

    const afterCompletion = removeCapturedSelection(state, capture);
    expect(afterCompletion.memberships.map((item) => item.descriptor.path)).toEqual(["one.txt", "three.txt"]);
  });

  it("removes deleted exact resources and true descendants without removing prefix siblings", () => {
    let state = createBatchSelectionState("alpha");
    for (const entry of [file("Docs", { isFolder: true }), file("Docs/a.txt"), file("Docs/Sub/b.txt"), file("Docs-old/c.txt")]) {
      state = toggleBatchSelection(state, "alpha", entry, browseOrigin).state;
    }

    state = removeDeletedPath(state, "alpha", "Docs");
    expect(state.memberships.map((item) => item.descriptor.path)).toEqual(["Docs-old/c.txt"]);
  });

  it("selects all entries in display order with consecutive membership versions", () => {
    let state = createBatchSelectionState("alpha");
    state = selectAllBatchEntries(state, "alpha", [file("a.txt"), file("Docs", { isFolder: true }), file("b.txt")], browseOrigin);

    expect(state.memberships.map((item) => [item.descriptor.path, item.membershipVersion])).toEqual([
      ["a.txt", 1],
      ["Docs", 2],
      ["b.txt", 3]
    ]);
    expect(state.memberships.every((item) => item.origin.kind === "browse" && item.origin.folderPath === browseOrigin.folderPath)).toBe(true);
  });

  it("adds only missing entries and keeps existing membership identity, version and origin", () => {
    let state = createBatchSelectionState("alpha");
    state = toggleBatchSelection(state, "alpha", file("b.txt"), searchOrigin).state;
    state = toggleBatchSelection(state, "alpha", file("other.txt"), searchOrigin).state;

    const next = selectAllBatchEntries(state, "alpha", [file("a.txt"), file("b.txt"), file("c.txt")], browseOrigin);
    expect(next.memberships.map((item) => [item.descriptor.path, item.membershipVersion, item.origin.kind])).toEqual([
      ["b.txt", 1, "search"],
      ["other.txt", 2, "search"],
      ["a.txt", 3, "browse"],
      ["c.txt", 4, "browse"]
    ]);
  });

  it("returns the same state when every entry is already selected or no valid entry is given", () => {
    let state = createBatchSelectionState("alpha");
    state = selectAllBatchEntries(state, "alpha", [file("a.txt"), file("b.txt")], browseOrigin);

    expect(selectAllBatchEntries(state, "alpha", [file("a.txt"), file("b.txt")], browseOrigin)).toBe(state);
    expect(selectAllBatchEntries(state, "alpha", [], browseOrigin)).toBe(state);
    expect(selectAllBatchEntries(state, "alpha", [file("")], browseOrigin)).toBe(state);
  });

  it("rejects select-all for a different account or invalid origin", () => {
    const state = createBatchSelectionState("alpha");
    expect(selectAllBatchEntries(state, "beta", [file("a.txt")], browseOrigin)).toBe(state);
    expect(selectAllBatchEntries(state, "alpha", [file("a.txt")], { kind: "folder", folderPath: "/" } as never)).toBe(state);
  });

  it("removes only the listed paths and preserves other selections in order", () => {
    let state = createBatchSelectionState("alpha");
    state = selectAllBatchEntries(state, "alpha", [file("a.txt"), file("b.txt"), file("Docs", { isFolder: true }), file("c.txt")], browseOrigin);
    state = toggleBatchSelection(state, "alpha", file("other/x.txt"), browseOrigin).state;

    const next = removeBatchSelectionPaths(state, "alpha", ["/b.txt", "Docs", "missing.txt"]);
    expect(next.memberships.map((item) => item.descriptor.path)).toEqual(["a.txt", "c.txt", "other/x.txt"]);
  });

  it("returns the same state when removal targets no membership, the account differs, or no paths are given", () => {
    let state = createBatchSelectionState("alpha");
    state = toggleBatchSelection(state, "alpha", file("a.txt"), browseOrigin).state;

    expect(removeBatchSelectionPaths(state, "alpha", ["missing.txt"])).toBe(state);
    expect(removeBatchSelectionPaths(state, "beta", ["a.txt"])).toBe(state);
    expect(removeBatchSelectionPaths(state, "alpha", [])).toBe(state);
  });

  it("retains failed paths in their prior order with their original membership identity", () => {
    let state = createBatchSelectionState("alpha");
    for (const entry of [file("one.txt"), file("two.txt"), file("three.txt")]) {
      state = toggleBatchSelection(state, "alpha", entry, browseOrigin).state;
    }

    state = retainBatchSelectionPaths(state, "alpha", ["three.txt", "one.txt"]);
    expect(state.memberships.map((item) => [item.descriptor.path, item.membershipVersion])).toEqual([
      ["one.txt", 1],
      ["three.txt", 3]
    ]);
  });
});
