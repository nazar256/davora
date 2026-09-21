import type { FileEntry } from "@davora/shared";
import { basename, dirname } from "@davora/shared";

import type {
  DestinationConflictDecision,
  DestinationConflictReview,
  DestinationConflictReviewItem,
  DestinationOperation,
  DestinationPlan,
  PlannedDestinationConflict,
  ResolvedDestinationConflicts
} from "./model";
import { joinCanonicalDestinationPath, suggestDestinationName } from "./planner";

export function allowedConflictDecisions(conflict: PlannedDestinationConflict): readonly DestinationConflictDecision[] {
  if (conflict.isSelfCollision) {
    return ["keepBoth", "skip"];
  }
  if (conflict.source.isFolder && conflict.existing.isFolder) {
    return ["merge", "keepBoth", "skip"];
  }
  if (conflict.source.isFolder !== conflict.existing.isFolder) {
    return ["keepBoth", "skip"];
  }
  return ["replace", "keepBoth", "skip"];
}

export function sizeRuleDecision(item: DestinationConflictReviewItem): DestinationConflictDecision {
  return item.allowedDecisions.includes("replace")
    && item.source.size !== undefined
    && item.existing.size !== undefined
    && item.source.size >= item.existing.size
    ? "replace"
    : "skip";
}

export function effectiveConflictDecision(
  item: DestinationConflictReviewItem,
  applySizeRule: boolean
): DestinationConflictDecision {
  return item.decision && item.allowedDecisions.includes(item.decision)
    ? item.decision
    : applySizeRule ? sizeRuleDecision(item) : "skip";
}

export function buildDestinationConflictReview(
  plan: Extract<DestinationPlan, { kind: "valid" }>,
  operation: DestinationOperation
): DestinationConflictReview {
  const inFlightSourcePaths = new Set(plan.targets.map((target) => target.source.path));
  return {
    operation,
    destinationPath: plan.destinationPath,
    targets: plan.targets,
    items: plan.conflicts.map((conflict) => ({
      source: conflict.source,
      existing: conflict.existing,
      destinationPath: conflict.destinationPath,
      isSelfCollision: conflict.isSelfCollision,
      allowedDecisions: inFlightSourcePaths.has(conflict.existing.path)
        ? allowedConflictDecisions(conflict).filter((decision) => decision === "keepBoth" || decision === "skip")
        : allowedConflictDecisions(conflict)
    })),
    applySizeRule: true
  };
}

export function withConflictDecision(
  review: DestinationConflictReview,
  sourcePath: string,
  decision: DestinationConflictDecision
): DestinationConflictReview {
  return {
    ...review,
    items: review.items.map((item) => item.source.path === sourcePath
      && item.allowedDecisions.includes(decision)
      ? { ...item, decision }
      : item)
  };
}

export function withApplySizeRule(
  review: DestinationConflictReview,
  applySizeRule: boolean
): DestinationConflictReview {
  return { ...review, applySizeRule };
}

export function applyDecisionToAllConflicts(
  review: DestinationConflictReview,
  decision: DestinationConflictDecision
): DestinationConflictReview {
  return {
    ...review,
    items: review.items.map((item) => item.allowedDecisions.includes(decision)
      ? { ...item, decision }
      : item)
  };
}

export function resolveConflictDecisions(
  review: DestinationConflictReview,
  destinationEntries: readonly FileEntry[]
): ResolvedDestinationConflicts {
  const conflictBySourcePath = new Map(
    review.items.map((item) => [item.source.path, item] as const)
  );
  const reservedEntries = [...destinationEntries];
  const claimedDestinations = new Set<string>();
  const targets: ResolvedDestinationConflicts["targets"][number][] = [];
  const skipped: FileEntry[] = [];

  // Reserve verbatim destinations up front so generated keep-both names never
  // collide with a later in-batch target, regardless of source order.
  for (const target of review.targets) {
    if (!conflictBySourcePath.has(target.source.path)) {
      claimedDestinations.add(target.destinationPath);
      reservedEntries.push({ ...target.source, path: target.destinationPath, name: basename(target.destinationPath) });
    }
  }

  for (const target of review.targets) {
    const conflict = conflictBySourcePath.get(target.source.path);
    if (!conflict) {
      targets.push({ source: target.source, destinationPath: target.destinationPath, overwrite: false, merge: false });
      continue;
    }

    let decision = effectiveConflictDecision(conflict, review.applySizeRule);
    if ((decision === "replace" || decision === "merge") && claimedDestinations.has(target.destinationPath)) {
      // Only one destructive claim per destination; the loser keeps both.
      decision = "keepBoth";
    }
    if (decision === "skip") {
      skipped.push(target.source);
      continue;
    }
    if (decision === "keepBoth") {
      const suggestedName = suggestDestinationName(reservedEntries, basename(target.destinationPath), target.source, "copy");
      const destinationPath = joinCanonicalDestinationPath(dirname(target.destinationPath), suggestedName);
      targets.push({ source: target.source, destinationPath, overwrite: false, merge: false });
      reservedEntries.push({ ...target.source, path: destinationPath, name: suggestedName });
      claimedDestinations.add(destinationPath);
      continue;
    }
    claimedDestinations.add(target.destinationPath);
    targets.push({
      source: target.source,
      destinationPath: target.destinationPath,
      overwrite: decision === "replace",
      merge: decision === "merge"
    });
  }

  return { targets, skipped };
}
