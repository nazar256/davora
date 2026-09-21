import { describe, expect, it, vi } from "vitest";

import type { FileEntry } from "@davora/shared";

import { executeBatchCopyMove } from "./controller";
import type { BatchCopyMoveInput, BatchCopyMoveOperation, BatchCopyMoveTarget } from "./model";
import type { BatchCopyMovePorts, FolderListResult, TargetExecutionResult } from "./ports";

function file(path: string, overrides: Partial<FileEntry> = {}): FileEntry {
  const name = path.split("/").pop() ?? path;
  return { path, name, isFolder: false, ...overrides };
}

function target(sourcePath: string, mode: BatchCopyMoveTarget["mode"] = "write"): BatchCopyMoveTarget {
  const source = file(sourcePath);
  return Object.freeze({ source, destinationPath: `Archive/${source.name}`, mode });
}

function input(targets: readonly BatchCopyMoveTarget[], overrides: Partial<BatchCopyMoveInput> = {}): BatchCopyMoveInput {
  return Object.freeze({ operation: "copy", targets: Object.freeze([...targets]), ...overrides });
}

function ports(overrides: Partial<BatchCopyMovePorts> = {}): BatchCopyMovePorts {
  return {
    isCurrent: () => true,
    executeTarget: vi.fn(async () => ({ kind: "completed" } as const)),
    listChildren: vi.fn(async (): Promise<FolderListResult> => ({ kind: "completed", entries: [] })),
    deleteFolder: vi.fn(async () => ({ kind: "completed" } as const)),
    refreshFolder: vi.fn(async () => ({ kind: "completed" } as const)),
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("executeBatchCopyMove", () => {
  it("executes targets in source order and refreshes exactly once", async () => {
    const calls: string[] = [];
    const adapter = ports({
      executeTarget: vi.fn(async (_operation: BatchCopyMoveOperation, current: BatchCopyMoveTarget) => {
        calls.push(current.source.path);
        return { kind: "completed" } as const;
      })
    });

    const result = await executeBatchCopyMove(input([target("a.txt"), target("b.txt")]), adapter);

    expect(calls).toEqual(["a.txt", "b.txt"]);
    expect(adapter.refreshFolder).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "completed", completedCount: 2, skippedCount: 0, totalCount: 2, failures: [] });
  });

  it("forwards move as the selected operation with the target mode", async () => {
    const adapter = ports();
    const move = target("a.txt", "overwrite");

    await executeBatchCopyMove({ operation: "move", targets: [move] }, adapter);

    expect(adapter.executeTarget).toHaveBeenCalledWith("move", move);
  });

  it("continues after ordinary failures and preserves their order", async () => {
    const outcomes: TargetExecutionResult[] = [
      { kind: "failed", message: "first failed" },
      { kind: "completed" },
      { kind: "failed", message: "third failed" }
    ];
    const adapter = ports({ executeTarget: vi.fn(async () => outcomes.shift() ?? ({ kind: "completed" } as const)) });
    const targets = [target("a.txt"), target("b.txt"), target("c.txt")];

    const result = await executeBatchCopyMove(input(targets), adapter);

    expect(result).toEqual({
      kind: "partial",
      completedCount: 1,
      skippedCount: 0,
      totalCount: 3,
      failures: [
        { sourcePath: "a.txt", message: "first failed" },
        { sourcePath: "c.txt", message: "third failed" }
      ]
    });
    expect(adapter.executeTarget).toHaveBeenCalledTimes(3);
    expect(adapter.refreshFolder).toHaveBeenCalledTimes(1);
  });

  it("reports pre-resolved skipped sources without executing them", async () => {
    const settled: string[] = [];
    const adapter = ports({
      onItemSettled: (item) => { settled.push(`${item.sourcePath}:${item.status}`); }
    });

    const result = await executeBatchCopyMove(
      input([target("a.txt")], { skipped: [file("b.txt"), file("dir", { isFolder: true })] }),
      adapter
    );

    expect(result).toEqual({ kind: "completed", completedCount: 1, skippedCount: 2, totalCount: 1, failures: [] });
    expect(adapter.executeTarget).toHaveBeenCalledTimes(1);
    expect(settled).toEqual(["b.txt:skipped", "dir:skipped", "a.txt:done"]);
  });

  it("refreshes once and reports partial when every target fails", async () => {
    const adapter = ports({ executeTarget: vi.fn(async () => ({ kind: "failed", message: "failed" } as const)) });

    const result = await executeBatchCopyMove(input([target("a.txt"), target("b.txt")]), adapter);

    expect(result).toMatchObject({ kind: "partial", completedCount: 0, totalCount: 2 });
    expect(result.failures).toHaveLength(2);
    expect(adapter.refreshFolder).toHaveBeenCalledTimes(1);
  });

  it("stops immediately on terminal execution without refreshing", async () => {
    const adapter = ports({ executeTarget: vi.fn(async () => ({ kind: "sessionTerminated" } as const)) });

    const result = await executeBatchCopyMove(input([target("a.txt"), target("b.txt")]), adapter);

    expect(result.kind).toBe("sessionTerminated");
    expect(adapter.executeTarget).toHaveBeenCalledTimes(1);
    expect(adapter.refreshFolder).not.toHaveBeenCalled();
  });

  it("retains prior progress and failures when a later target terminates the session", async () => {
    const outcomes: TargetExecutionResult[] = [
      { kind: "completed" },
      { kind: "failed", message: "ordinary failure" },
      { kind: "sessionTerminated" },
      { kind: "completed" }
    ];
    const adapter = ports({ executeTarget: vi.fn(async () => outcomes.shift() ?? ({ kind: "completed" } as const)) });

    const result = await executeBatchCopyMove(input([target("a.txt"), target("b.txt"), target("c.txt"), target("d.txt")]), adapter);

    expect(result).toEqual({
      kind: "sessionTerminated",
      completedCount: 1,
      skippedCount: 0,
      totalCount: 4,
      failures: [{ sourcePath: "b.txt", message: "ordinary failure" }]
    });
    expect(adapter.executeTarget).toHaveBeenCalledTimes(3);
    expect(adapter.refreshFolder).not.toHaveBeenCalled();
  });

  it("marks remaining targets skipped when cancelled mid-run", async () => {
    let cancelled = false;
    const adapter = ports({
      isCancelled: () => cancelled,
      executeTarget: vi.fn(async () => {
        cancelled = true;
        return { kind: "completed" } as const;
      })
    });

    const result = await executeBatchCopyMove(input([target("a.txt"), target("b.txt"), target("c.txt")]), adapter);

    expect(result).toEqual({ kind: "canceled", completedCount: 1, skippedCount: 2, totalCount: 3, failures: [] });
    expect(adapter.executeTarget).toHaveBeenCalledTimes(1);
    expect(adapter.refreshFolder).not.toHaveBeenCalled();
  });

  it("reports terminal refresh after all target results", async () => {
    const adapter = ports({ refreshFolder: vi.fn(async () => ({ kind: "sessionTerminated" } as const)) });

    const result = await executeBatchCopyMove(input([target("a.txt")]), adapter);

    expect(result).toEqual({ kind: "sessionTerminated", completedCount: 1, skippedCount: 0, totalCount: 1, failures: [] });
  });

  it("does nothing when already superseded", async () => {
    const adapter = ports({ isCurrent: () => false });

    const result = await executeBatchCopyMove(input([target("a.txt")]), adapter);

    expect(result.kind).toBe("superseded");
    expect(adapter.executeTarget).not.toHaveBeenCalled();
    expect(adapter.refreshFolder).not.toHaveBeenCalled();
  });

  it("makes a completed request inert when superseded while it is pending", async () => {
    let current = true;
    const pending = deferred<TargetExecutionResult>();
    const adapter = ports({
      isCurrent: () => current,
      executeTarget: vi.fn(() => pending.promise)
    });
    const resultPromise = executeBatchCopyMove(input([target("a.txt"), target("b.txt")]), adapter);
    current = false;
    pending.resolve({ kind: "completed" });

    const result = await resultPromise;

    expect(result).toEqual({ kind: "superseded", completedCount: 0, skippedCount: 0, totalCount: 2, failures: [] });
    expect(adapter.executeTarget).toHaveBeenCalledTimes(1);
    expect(adapter.refreshFolder).not.toHaveBeenCalled();
  });

  it("makes a refresh result inert when superseded while refresh is pending", async () => {
    let current = true;
    const pending = deferred<{ kind: "completed" }>();
    const adapter = ports({
      isCurrent: () => current,
      refreshFolder: vi.fn(() => pending.promise)
    });
    const resultPromise = executeBatchCopyMove(input([target("a.txt")]), adapter);
    await vi.waitFor(() => expect(adapter.refreshFolder).toHaveBeenCalledTimes(1));
    current = false;
    pending.resolve({ kind: "completed" });

    expect(await resultPromise).toEqual({ kind: "superseded", completedCount: 1, skippedCount: 0, totalCount: 1, failures: [] });
  });

  it("does not mutate frozen input", async () => {
    const targets = [target("a.txt"), target("b.txt")];
    const request = input(targets);

    await executeBatchCopyMove(request, ports());

    expect(request.targets).toEqual(targets);
  });

  describe("merge targets", () => {
    const folder = (path: string): FileEntry => file(path, { isFolder: true });
    const mergeTarget = (path: string): BatchCopyMoveTarget => ({
      source: folder(path),
      destinationPath: `Archive/${path.split("/").pop()}`,
      mode: "merge"
    });

    it("copies missing children into the destination and keeps both folders", async () => {
      const adapter = ports({
        listChildren: vi.fn(async (path: string): Promise<FolderListResult> => ({
          kind: "completed",
          entries: path === "Src" ? [file("Src/new.txt")] : []
        }))
      });

      const result = await executeBatchCopyMove(input([mergeTarget("Src")]), adapter);

      expect(adapter.executeTarget).toHaveBeenCalledWith("copy", {
        source: file("Src/new.txt"),
        destinationPath: "Archive/Src/new.txt",
        mode: "write"
      });
      expect(adapter.deleteFolder).not.toHaveBeenCalled();
      expect(result).toMatchObject({ kind: "completed", completedCount: 1 });
    });

    it("replaces nested files only when the size rule allows it", async () => {
      const adapter = ports({
        listChildren: vi.fn(async (path: string): Promise<FolderListResult> => ({
          kind: "completed",
          entries: path === "Src"
            ? [file("Src/a.txt", { size: 10 }), file("Src/b.txt", { size: 5 })]
            : [file("Archive/Src/a.txt", { size: 4 }), file("Archive/Src/b.txt", { size: 9 })]
        }))
      });

      const result = await executeBatchCopyMove(input([mergeTarget("Src")], { applySizeRule: true }), adapter);

      expect(adapter.executeTarget).toHaveBeenCalledTimes(1);
      expect(adapter.executeTarget).toHaveBeenCalledWith("copy", {
        source: file("Src/a.txt", { size: 10 }),
        destinationPath: "Archive/Src/a.txt",
        mode: "overwrite"
      });
      expect(result).toMatchObject({ kind: "completed", completedCount: 1, skippedCount: 1 });
    });

    it("skips type mismatches without executing them", async () => {
      const settled: string[] = [];
      const adapter = ports({
        listChildren: vi.fn(async (path: string): Promise<FolderListResult> => ({
          kind: "completed",
          entries: path === "Src" ? [file("Src/item", { size: 3 })] : [folder("Archive/Src/item")]
        })),
        onItemSettled: (item) => { settled.push(`${item.sourcePath}:${item.status}`); }
      });

      const result = await executeBatchCopyMove(input([mergeTarget("Src")]), adapter);

      expect(adapter.executeTarget).not.toHaveBeenCalled();
      expect(settled).toEqual(["Src/item:skipped", "Src:skipped"]);
      expect(result).toMatchObject({ kind: "completed", completedCount: 1, skippedCount: 1 });
    });

    it("reports nested failures as a target failure", async () => {
      const adapter = ports({
        listChildren: vi.fn(async (path: string): Promise<FolderListResult> => ({
          kind: "completed",
          entries: path === "Src" ? [file("Src/a.txt")] : []
        })),
        executeTarget: vi.fn(async () => ({ kind: "failed", message: "denied" } as const))
      });

      const result = await executeBatchCopyMove(input([mergeTarget("Src")]), adapter);

      expect(result).toMatchObject({
        kind: "partial",
        completedCount: 0,
        failures: [{ sourcePath: "Src", message: "Src/a.txt: denied" }]
      });
    });

    it("deletes emptied source folders for moves once all children settle", async () => {
      const srcLists: FolderListResult[] = [
        { kind: "completed", entries: [file("Src/a.txt")] },
        { kind: "completed", entries: [] }
      ];
      const adapter = ports({
        listChildren: vi.fn(async (path: string): Promise<FolderListResult> => (
          path === "Src" ? srcLists.shift() ?? { kind: "completed", entries: [] } : { kind: "completed", entries: [] }
        ))
      });

      const result = await executeBatchCopyMove({ ...input([mergeTarget("Src")]), operation: "move" }, adapter);

      expect(adapter.deleteFolder).toHaveBeenCalledWith("Src", "Src");
      expect(result).toMatchObject({ kind: "completed", completedCount: 1 });
    });

    it("keeps the source folder when the pre-delete listing still shows entries", async () => {
      const srcLists: FolderListResult[] = [
        { kind: "completed", entries: [file("Src/a.txt")] },
        { kind: "completed", entries: [file("Src/stray.txt")] }
      ];
      const settled: string[] = [];
      const adapter = ports({
        listChildren: vi.fn(async (path: string): Promise<FolderListResult> => (
          path === "Src" ? srcLists.shift() ?? { kind: "completed", entries: [] } : { kind: "completed", entries: [] }
        )),
        onItemSettled: (item) => { settled.push(`${item.sourcePath}:${item.status}`); }
      });

      const result = await executeBatchCopyMove({ ...input([mergeTarget("Src")]), operation: "move" }, adapter);

      expect(adapter.deleteFolder).not.toHaveBeenCalled();
      expect(settled).toEqual(["Src/a.txt:done", "Src:skipped"]);
      expect(result).toMatchObject({ kind: "completed", completedCount: 1, skippedCount: 0 });
    });

    it("reports a failure and keeps the source when the pre-delete listing fails", async () => {
      const srcLists: FolderListResult[] = [
        { kind: "completed", entries: [file("Src/a.txt")] },
        { kind: "failed", message: "listing went away" }
      ];
      const adapter = ports({
        listChildren: vi.fn(async (path: string): Promise<FolderListResult> => (
          path === "Src" ? srcLists.shift() ?? { kind: "completed", entries: [] } : { kind: "completed", entries: [] }
        ))
      });

      const result = await executeBatchCopyMove({ ...input([mergeTarget("Src")]), operation: "move" }, adapter);

      expect(adapter.deleteFolder).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        kind: "partial",
        failures: [{ sourcePath: "Src", message: "Src: listing went away" }]
      });
    });

    it("keeps the source folder for moves when a child is skipped", async () => {
      const adapter = ports({
        listChildren: vi.fn(async (path: string): Promise<FolderListResult> => ({
          kind: "completed",
          entries: path === "Src" ? [file("Src/a.txt", { size: 1 })] : [file("Archive/Src/a.txt", { size: 5 })]
        }))
      });

      await executeBatchCopyMove({ ...input([mergeTarget("Src")], { applySizeRule: true }), operation: "move" }, adapter);

      expect(adapter.deleteFolder).not.toHaveBeenCalled();
    });

    it("recurses into nested folder conflicts", async () => {
      const adapter = ports({
        listChildren: vi.fn(async (path: string): Promise<FolderListResult> => {
          if (path === "Src") return { kind: "completed", entries: [folder("Src/sub")] };
          if (path === "Archive/Src") return { kind: "completed", entries: [folder("Archive/Src/sub")] };
          if (path === "Src/sub") return { kind: "completed", entries: [file("Src/sub/deep.txt")] };
          return { kind: "completed", entries: [] };
        })
      });

      const result = await executeBatchCopyMove(input([mergeTarget("Src")]), adapter);

      expect(adapter.executeTarget).toHaveBeenCalledWith("copy", {
        source: file("Src/sub/deep.txt"),
        destinationPath: "Archive/Src/sub/deep.txt",
        mode: "write"
      });
      expect(result).toMatchObject({ kind: "completed", completedCount: 1 });
    });
  });
});
