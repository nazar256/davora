import type { FileEntry } from "@davora/shared";

import type {
  BatchCopyMoveFailure,
  BatchCopyMoveInput,
  BatchCopyMoveOutcome,
  CopyMoveSettledItem
} from "./model";
import type { BatchCopyMovePorts, FolderListResult } from "./ports";

function outcome(
  kind: BatchCopyMoveOutcome["kind"],
  input: BatchCopyMoveInput,
  completedCount: number,
  skippedCount: number,
  failures: readonly BatchCopyMoveFailure[]
): BatchCopyMoveOutcome {
  return { kind, completedCount, skippedCount, totalCount: input.targets.length, failures: [...failures] };
}

function settle(ports: BatchCopyMovePorts, item: CopyMoveSettledItem): void {
  ports.onItemSettled?.(item);
}

function joinPath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

interface MergeChildrenResult {
  readonly kind: "settled";
  readonly allDone: boolean;
  readonly failures: readonly string[];
  readonly skippedCount: number;
}

interface MergeResult {
  readonly terminal?: "superseded" | "sessionTerminated" | "canceled";
  readonly children?: MergeChildrenResult;
}

/** An interrupted await means the scope aborted (superseded) or the user cancelled. */
function interruptedTerminal(ports: BatchCopyMovePorts): NonNullable<MergeResult["terminal"]> {
  return ports.isCancelled?.() ? "canceled" : "superseded";
}

/**
 * Recursively combines a source folder into an existing destination folder.
 * Nested folder-on-folder conflicts recurse; nested file conflicts follow the
 * size rule; type mismatches and unknown sizes are skipped. For moves the
 * emptied source folder is deleted only after every child settled done.
 */
async function executeMergeFolder(
  input: BatchCopyMoveInput,
  source: FileEntry,
  destinationPath: string,
  ports: BatchCopyMovePorts
): Promise<MergeResult> {
  if (!ports.isCurrent()) return { terminal: "superseded" };
  if (ports.isCancelled?.()) return { terminal: "canceled" };

  const sourceListing = await ports.listChildren(source.path);
  if (sourceListing.kind !== "completed") {
    return mergeListingFailure(sourceListing, ports);
  }
  const destinationListing = await ports.listChildren(destinationPath);
  if (destinationListing.kind !== "completed") {
    return mergeListingFailure(destinationListing, ports);
  }

  const existingByName = new Map(destinationListing.entries.map((entry) => [entry.name, entry] as const));
  const discovered = sourceListing.entries.map((child) => ({
    sourcePath: child.path,
    destinationPath: joinPath(destinationPath, child.name),
    isFolder: child.isFolder,
    size: child.size
  }));
  if (discovered.length > 0) {
    ports.onItemsDiscovered?.(discovered);
  }

  let allDone = true;
  const failures: string[] = [];
  let skippedCount = 0;

  for (const child of sourceListing.entries) {
    if (!ports.isCurrent()) return { terminal: "superseded" };
    if (ports.isCancelled?.()) return { terminal: "canceled" };

    const childDestination = joinPath(destinationPath, child.name);
    const existing = existingByName.get(child.name);
    const settledItem = {
      sourcePath: child.path,
      destinationPath: childDestination,
      isFolder: child.isFolder,
      size: child.size
    };

    if (existing && existing.isFolder !== child.isFolder) {
      allDone = false;
      skippedCount += 1;
      const message = `Skipped ${child.path}: destination has a ${existing.isFolder ? "folder" : "file"} with the same name.`;
      settle(ports, { ...settledItem, status: "skipped", error: message });
      continue;
    }

    if (child.isFolder && existing?.isFolder) {
      const nested = await executeMergeFolder(input, child, childDestination, ports);
      if (nested.terminal) return { terminal: nested.terminal };
      const nestedChildren = nested.children!;
      skippedCount += nestedChildren.skippedCount;
      failures.push(...nestedChildren.failures);
      if (nestedChildren.failures.length > 0) {
        settle(ports, { ...settledItem, status: "failed", error: nestedChildren.failures.join("; ") });
        allDone = false;
      } else {
        settle(ports, { ...settledItem, status: "done" });
        allDone = allDone && nestedChildren.allDone;
      }
      continue;
    }

    if (!child.isFolder && existing && !existing.isFolder) {
      const replace = Boolean(input.applySizeRule)
        && child.size !== undefined
        && existing.size !== undefined
        && child.size >= existing.size;
      if (!replace) {
        allDone = false;
        skippedCount += 1;
        settle(ports, { ...settledItem, status: "skipped", error: `Skipped ${child.path}: destination file kept.` });
        continue;
      }
      const overwritten = await ports.executeTarget(input.operation, {
        source: child,
        destinationPath: childDestination,
        mode: "overwrite"
      });
      if (settleLeaf(overwritten, settledItem, failures, ports)) {
        allDone = false;
      }
      if (overwritten.kind === "sessionTerminated") return { terminal: "sessionTerminated" };
      if (overwritten.kind === "interrupted") return { terminal: interruptedTerminal(ports) };
      continue;
    }

    const result = await ports.executeTarget(input.operation, {
      source: child,
      destinationPath: childDestination,
      mode: "write"
    });
    if (settleLeaf(result, settledItem, failures, ports)) {
      allDone = false;
    }
    if (result.kind === "sessionTerminated") return { terminal: "sessionTerminated" };
    if (result.kind === "interrupted") return { terminal: interruptedTerminal(ports) };
  }

  if (input.operation === "move" && allDone) {
    const remaining = await ports.listChildren(source.path);
    if (remaining.kind === "sessionTerminated") return { terminal: "sessionTerminated" };
    if (remaining.kind === "interrupted") return { terminal: interruptedTerminal(ports) };
    if (remaining.kind !== "completed") {
      failures.push(`${source.path}: ${remaining.message}`);
      allDone = false;
    } else if (remaining.entries.length > 0) {
      allDone = false;
    } else {
      const removed = await ports.deleteFolder(source.path, source.name);
      if (removed.kind === "sessionTerminated") return { terminal: "sessionTerminated" };
      if (removed.kind === "interrupted") return { terminal: interruptedTerminal(ports) };
      if (removed.kind === "failed") {
        failures.push(`${source.path}: ${removed.message}`);
        allDone = false;
      }
    }
  }

  return {
    children: { kind: "settled", allDone, failures, skippedCount }
  };
}

function mergeListingFailure(
  listing: Exclude<FolderListResult, { kind: "completed" }>,
  ports: BatchCopyMovePorts
): MergeResult {
  if (listing.kind === "sessionTerminated") return { terminal: "sessionTerminated" };
  if (listing.kind === "interrupted") return { terminal: interruptedTerminal(ports) };
  return { children: { kind: "settled", allDone: false, failures: [listing.message], skippedCount: 0 } };
}

/** Returns true when the leaf failed. */
function settleLeaf(
  result: Awaited<ReturnType<BatchCopyMovePorts["executeTarget"]>>,
  settledItem: Omit<CopyMoveSettledItem, "status" | "error">,
  failures: string[],
  ports: BatchCopyMovePorts
): boolean {
  if (result.kind === "failed") {
    failures.push(`${settledItem.sourcePath}: ${result.message}`);
    settle(ports, { ...settledItem, status: "failed", error: result.message });
    return true;
  }
  if (result.kind === "sessionTerminated" || result.kind === "interrupted") {
    return true;
  }
  settle(ports, { ...settledItem, status: "done" });
  return false;
}

export async function executeBatchCopyMove(
  input: BatchCopyMoveInput,
  ports: BatchCopyMovePorts
): Promise<BatchCopyMoveOutcome> {
  let completedCount = 0;
  let skippedCount = input.skipped?.length ?? 0;
  const failures: BatchCopyMoveFailure[] = [];

  for (const skipped of input.skipped ?? []) {
    settle(ports, {
      sourcePath: skipped.path,
      destinationPath: "",
      isFolder: skipped.isFolder,
      size: skipped.size,
      status: "skipped"
    });
  }

  /** Cancellation refreshes the visible folder so already-applied moves/copies settle into the listing. */
  const canceledOutcome = async (): Promise<BatchCopyMoveOutcome> => {
    skippedCount += input.targets.length - completedCount - failures.length;
    if (ports.isCurrent()) {
      const refreshResult = await ports.refreshFolder();
      if (!ports.isCurrent()) {
        return outcome("superseded", input, completedCount, skippedCount, failures);
      }
      if (refreshResult.kind === "sessionTerminated") {
        return outcome("sessionTerminated", input, completedCount, skippedCount, failures);
      }
    }
    return outcome("canceled", input, completedCount, skippedCount, failures);
  };

  /** An interrupted await settles as canceled when the user cancelled, otherwise superseded. */
  const interruptedOutcome = (): BatchCopyMoveOutcome =>
    ports.isCancelled?.() && ports.isCurrent()
      ? outcome("canceled", input, completedCount, skippedCount, failures)
      : outcome("superseded", input, completedCount, skippedCount, failures);

  for (const target of input.targets) {
    if (!ports.isCurrent()) {
      return outcome("superseded", input, completedCount, skippedCount, failures);
    }
    if (ports.isCancelled?.()) {
      return canceledOutcome();
    }

    if (target.mode === "merge") {
      const merge = await executeMergeFolder(input, target.source, target.destinationPath, ports);
      if (merge.terminal === "superseded") {
        return outcome("superseded", input, completedCount, skippedCount, failures);
      }
      if (merge.terminal === "sessionTerminated") {
        return outcome("sessionTerminated", input, completedCount, skippedCount, failures);
      }
      if (merge.terminal === "canceled") {
        return canceledOutcome();
      }
      const children = merge.children!;
      skippedCount += children.skippedCount;
      if (children.failures.length > 0) {
        failures.push({ sourcePath: target.source.path, message: children.failures.join("; ") });
        settle(ports, {
          sourcePath: target.source.path,
          destinationPath: target.destinationPath,
          isFolder: true,
          size: target.source.size,
          status: "failed",
          error: children.failures.join("; ")
        });
      } else {
        completedCount += 1;
        settle(ports, {
          sourcePath: target.source.path,
          destinationPath: target.destinationPath,
          isFolder: true,
          size: target.source.size,
          status: children.allDone ? "done" : "skipped"
        });
      }
      continue;
    }

    const result = await ports.executeTarget(input.operation, target);
    if (!ports.isCurrent()) {
      return outcome("superseded", input, completedCount, skippedCount, failures);
    }

    if (result.kind === "interrupted") {
      return ports.isCancelled?.() ? canceledOutcome() : interruptedOutcome();
    }
    if (result.kind === "sessionTerminated") {
      return outcome("sessionTerminated", input, completedCount, skippedCount, failures);
    }
    if (result.kind === "failed") {
      failures.push({ sourcePath: target.source.path, message: result.message });
      settle(ports, {
        sourcePath: target.source.path,
        destinationPath: target.destinationPath,
        isFolder: target.source.isFolder,
        size: target.source.size,
        status: "failed",
        error: result.message
      });
    } else {
      completedCount += 1;
      settle(ports, {
        sourcePath: target.source.path,
        destinationPath: target.destinationPath,
        isFolder: target.source.isFolder,
        size: target.source.size,
        status: "done"
      });
    }
  }

  if (!ports.isCurrent()) {
    return outcome("superseded", input, completedCount, skippedCount, failures);
  }
  if (ports.isCancelled?.()) {
    return canceledOutcome();
  }
  const refreshResult = await ports.refreshFolder();
  if (!ports.isCurrent()) {
    return outcome("superseded", input, completedCount, skippedCount, failures);
  }
  if (refreshResult.kind === "interrupted") {
    return interruptedOutcome();
  }
  if (refreshResult.kind === "sessionTerminated") {
    return outcome("sessionTerminated", input, completedCount, skippedCount, failures);
  }

  return outcome(failures.length > 0 ? "partial" : "completed", input, completedCount, skippedCount, failures);
}
