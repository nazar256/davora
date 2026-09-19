import type { FileEntry } from "@davora/shared";
import { describe, expect, it } from "vitest";

import {
  captureBatchSelection,
  clearBatchSelection,
  createBatchSelectionState,
  rebindBatchSelection,
  removeCapturedSelection,
  removeDeletedPath,
  replaceBatchSelectionAccount,
  retainBatchSelectionPaths,
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
