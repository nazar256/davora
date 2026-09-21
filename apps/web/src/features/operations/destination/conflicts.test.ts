import { describe, expect, it } from "vitest";

import type { FileEntry } from "@davora/shared";

import {
  allowedConflictDecisions,
  applyDecisionToAllConflicts,
  buildDestinationConflictReview,
  effectiveConflictDecision,
  resolveConflictDecisions,
  sizeRuleDecision,
  withApplySizeRule,
  withConflictDecision
} from "./conflicts";
import type { DestinationConflictReviewItem, DestinationPlan, PlannedDestinationConflict } from "./model";

function file(path: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false, ...overrides };
}

function folder(path: string): FileEntry {
  return file(path, { isFolder: true });
}

function conflict(
  source: FileEntry,
  existing: FileEntry,
  overrides: Partial<PlannedDestinationConflict> = {}
): PlannedDestinationConflict {
  return {
    source,
    existing,
    destinationPath: `Archive/${source.name}`,
    isSelfCollision: false,
    ...overrides
  };
}

function plan(conflicts: readonly PlannedDestinationConflict[]): Extract<DestinationPlan, { kind: "valid" }> {
  return {
    kind: "valid",
    destinationPath: "Archive",
    targets: [
      ...conflicts.map((item) => ({ source: item.source, destinationPath: item.destinationPath })),
      { source: file("clean.txt"), destinationPath: "Archive/clean.txt" }
    ],
    conflicts
  };
}

describe("allowedConflictDecisions", () => {
  it("offers merge instead of replace for folder-on-folder conflicts", () => {
    expect(allowedConflictDecisions(conflict(folder("Docs"), folder("Archive/Docs"))))
      .toEqual(["merge", "keepBoth", "skip"]);
  });

  it("offers replace for file-on-file conflicts", () => {
    expect(allowedConflictDecisions(conflict(file("a.txt"), file("Archive/a.txt"))))
      .toEqual(["replace", "keepBoth", "skip"]);
  });

  it("limits self-collisions and type mismatches to keepBoth or skip", () => {
    expect(allowedConflictDecisions(conflict(file("a.txt"), file("a.txt"), { isSelfCollision: true })))
      .toEqual(["keepBoth", "skip"]);
    expect(allowedConflictDecisions(conflict(folder("Docs"), file("Archive/Docs"))))
      .toEqual(["keepBoth", "skip"]);
    expect(allowedConflictDecisions(conflict(file("a.txt"), folder("Archive/a.txt"))))
      .toEqual(["keepBoth", "skip"]);
  });
});

describe("size rule and effective decisions", () => {
  const replaceItem = (
    sourceSize: number | undefined,
    existingSize: number | undefined
  ): DestinationConflictReviewItem => ({
    source: file("a.txt", { size: sourceSize }),
    existing: file("Archive/a.txt", { size: existingSize }),
    destinationPath: "Archive/a.txt",
    isSelfCollision: false,
    allowedDecisions: ["replace", "keepBoth", "skip"]
  });

  it("replaces when the source is larger or equal and skips otherwise", () => {
    expect(sizeRuleDecision(replaceItem(10, 4))).toBe("replace");
    expect(sizeRuleDecision(replaceItem(4, 4))).toBe("replace");
    expect(sizeRuleDecision(replaceItem(3, 4))).toBe("skip");
    expect(sizeRuleDecision(replaceItem(undefined, 4))).toBe("skip");
    expect(sizeRuleDecision(replaceItem(10, undefined))).toBe("skip");
  });

  it("never replaces items that do not allow it", () => {
    const mergeable: DestinationConflictReviewItem = {
      source: folder("Docs"),
      existing: folder("Archive/Docs"),
      destinationPath: "Archive/Docs",
      isSelfCollision: false,
      allowedDecisions: ["merge", "keepBoth", "skip"]
    };
    expect(sizeRuleDecision(mergeable)).toBe("skip");
    expect(effectiveConflictDecision(mergeable, true)).toBe("skip");
  });

  it("prefers explicit decisions over the size rule", () => {
    const item = { ...replaceItem(10, 4), decision: "keepBoth" as const };
    expect(effectiveConflictDecision(item, true)).toBe("keepBoth");
    expect(effectiveConflictDecision(replaceItem(3, 4), false)).toBe("skip");
  });
});

describe("review state transitions", () => {
  it("builds a review with size rule enabled and per-item allowed decisions", () => {
    const review = buildDestinationConflictReview(
      plan([
        conflict(file("a.txt"), file("Archive/a.txt")),
        conflict(folder("Docs"), folder("Archive/Docs"))
      ]),
      "copy"
    );

    expect(review.applySizeRule).toBe(true);
    expect(review.items).toHaveLength(2);
    expect(review.items[0]?.allowedDecisions).toEqual(["replace", "keepBoth", "skip"]);
    expect(review.items[1]?.allowedDecisions).toEqual(["merge", "keepBoth", "skip"]);
    expect(review.targets).toHaveLength(3);
  });

  it("updates only matching items and rejects decisions outside the allowed set", () => {
    const review = buildDestinationConflictReview(
      plan([
        conflict(file("a.txt"), file("Archive/a.txt")),
        conflict(folder("Docs"), folder("Archive/Docs"))
      ]),
      "copy"
    );

    const decided = withConflictDecision(review, "a.txt", "keepBoth");
    expect(decided.items[0]?.decision).toBe("keepBoth");
    expect(decided.items[1]?.decision).toBeUndefined();

    expect(withConflictDecision(review, "Docs", "replace").items[1]?.decision).toBeUndefined();
    expect(withConflictDecision(review, "unknown.txt", "skip").items[0]?.decision).toBeUndefined();
  });

  it("applies a bulk decision only where it is allowed", () => {
    const review = buildDestinationConflictReview(
      plan([
        conflict(file("a.txt"), file("Archive/a.txt")),
        conflict(folder("Docs"), folder("Archive/Docs"))
      ]),
      "copy"
    );

    const replaced = applyDecisionToAllConflicts(review, "replace");
    expect(replaced.items[0]?.decision).toBe("replace");
    expect(replaced.items[1]?.decision).toBeUndefined();

    const merged = applyDecisionToAllConflicts(review, "merge");
    expect(merged.items[0]?.decision).toBeUndefined();
    expect(merged.items[1]?.decision).toBe("merge");
  });

  it("toggles the size rule flag without touching explicit decisions", () => {
    const review = withConflictDecision(
      buildDestinationConflictReview(plan([conflict(file("a.txt"), file("Archive/a.txt"))]), "copy"),
      "a.txt",
      "keepBoth"
    );

    const toggled = withApplySizeRule(review, false);
    expect(toggled.applySizeRule).toBe(false);
    expect(toggled.items[0]?.decision).toBe("keepBoth");
  });
});

describe("resolveConflictDecisions", () => {
  it("maps decisions to target modes and collects skips", () => {
    const sourceFile = file("a.txt", { size: 10 });
    const sourceFolder = folder("Docs");
    const review = buildDestinationConflictReview(
      plan([
        conflict(sourceFile, file("Archive/a.txt", { size: 4 })),
        conflict(sourceFolder, folder("Archive/Docs")),
        conflict(file("b.txt"), file("Archive/b.txt", { size: 99 }))
      ]),
      "copy"
    );

    const resolved = resolveConflictDecisions(withConflictDecision(review, "Docs", "merge"), []);

    expect(resolved.targets).toEqual([
      { source: sourceFile, destinationPath: "Archive/a.txt", overwrite: true, merge: false },
      { source: sourceFolder, destinationPath: "Archive/Docs", overwrite: false, merge: true },
      { source: file("clean.txt"), destinationPath: "Archive/clean.txt", overwrite: false, merge: false }
    ]);
    expect(resolved.skipped).toEqual([file("b.txt")]);
  });

  it("renames keep-both targets to the smallest available suffix", () => {
    const sourceFile = file("a.txt", { size: 10 });
    const review = buildDestinationConflictReview(
      plan([conflict(sourceFile, file("Archive/a.txt", { size: 4 }))]),
      "copy"
    );

    const resolved = resolveConflictDecisions(
      withConflictDecision(review, "a.txt", "keepBoth"),
      [file("Archive/a.txt"), file("Archive/a (1).txt")]
    );

    expect(resolved.targets).toEqual([
      { source: sourceFile, destinationPath: "Archive/a (2).txt", overwrite: false, merge: false },
      { source: file("clean.txt"), destinationPath: "Archive/clean.txt", overwrite: false, merge: false }
    ]);
    expect(resolved.skipped).toEqual([]);
  });

  it("reserves earlier keep-both names so later conflicts avoid them", () => {
    const first = file("a.txt", { size: 10 });
    const second = file("b.txt", { size: 10 });
    const review = buildDestinationConflictReview(
      plan([
        conflict(first, file("Archive/a.txt", { size: 4 })),
        conflict(second, file("Archive/b.txt", { size: 4 }))
      ]),
      "copy"
    );
    const decided = withConflictDecision(withConflictDecision(review, "a.txt", "keepBoth"), "b.txt", "keepBoth");

    const resolved = resolveConflictDecisions(
      decided,
      [file("Archive/a.txt"), file("Archive/a (1).txt"), file("Archive/b.txt")]
    );

    expect(resolved.targets.map((target) => target.destinationPath)).toEqual([
      "Archive/a (2).txt",
      "Archive/b (1).txt",
      "Archive/clean.txt"
    ]);
  });

  it("restricts destructive choices when the existing entry is itself an in-flight source", () => {
    const inFlight = file("Archive/x.txt");
    const source = file("Elsewhere/x.txt", { size: 10 });
    const reviewPlan: Extract<DestinationPlan, { kind: "valid" }> = {
      kind: "valid",
      destinationPath: "Archive",
      targets: [
        { source, destinationPath: "Archive/x.txt" },
        { source: inFlight, destinationPath: "Archive/x.txt" }
      ],
      conflicts: [
        { source, existing: inFlight, destinationPath: "Archive/x.txt", isSelfCollision: false },
        { source: inFlight, existing: inFlight, destinationPath: "Archive/x.txt", isSelfCollision: true }
      ]
    };

    const review = buildDestinationConflictReview(reviewPlan, "move");

    expect(review.items[0]?.allowedDecisions).toEqual(["keepBoth", "skip"]);
    expect(review.items[1]?.allowedDecisions).toEqual(["keepBoth", "skip"]);
  });

  it("keeps both when a second conflict destructively claims an already-claimed destination", () => {
    const first = file("one/a.txt", { size: 10 });
    const second = file("two/a.txt", { size: 10 });
    const existing = file("Archive/a.txt", { size: 4 });
    const reviewPlan: Extract<DestinationPlan, { kind: "valid" }> = {
      kind: "valid",
      destinationPath: "Archive",
      targets: [
        { source: first, destinationPath: "Archive/a.txt" },
        { source: second, destinationPath: "Archive/a.txt" }
      ],
      conflicts: [
        conflict(first, existing),
        conflict(second, existing)
      ]
    };
    const review = applyDecisionToAllConflicts(buildDestinationConflictReview(reviewPlan, "copy"), "replace");

    const resolved = resolveConflictDecisions(review, [existing]);

    expect(resolved.targets.map((target) => ({
      destinationPath: target.destinationPath,
      overwrite: target.overwrite
    }))).toEqual([
      { destinationPath: "Archive/a.txt", overwrite: true },
      { destinationPath: "Archive/a (1).txt", overwrite: false }
    ]);
  });

  it("pre-reserves verbatim target names so keep-both suggestions never collide with them", () => {
    const conflicting = file("a.txt", { size: 10 });
    const verbatim = file("a (1).txt");
    const reviewPlan: Extract<DestinationPlan, { kind: "valid" }> = {
      kind: "valid",
      destinationPath: "Archive",
      targets: [
        { source: conflicting, destinationPath: "Archive/a.txt" },
        { source: verbatim, destinationPath: "Archive/a (1).txt" }
      ],
      conflicts: [conflict(conflicting, file("Archive/a.txt", { size: 4 }))]
    };
    const review = withConflictDecision(buildDestinationConflictReview(reviewPlan, "copy"), "a.txt", "keepBoth");

    const resolved = resolveConflictDecisions(review, [file("Archive/a.txt")]);

    expect(resolved.targets.map((target) => target.destinationPath)).toEqual([
      "Archive/a (2).txt",
      "Archive/a (1).txt"
    ]);
  });

  it("ignores stored decisions that are not in the allowed set", () => {
    const item: DestinationConflictReviewItem = {
      source: folder("Docs"),
      existing: folder("Archive/Docs"),
      destinationPath: "Archive/Docs",
      isSelfCollision: false,
      allowedDecisions: ["merge", "keepBoth", "skip"],
      decision: "replace"
    };

    expect(effectiveConflictDecision(item, false)).toBe("skip");
  });
});
