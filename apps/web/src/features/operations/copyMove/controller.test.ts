import { describe, expect, it, vi } from "vitest";

import { executeBatchCopyMove } from "./controller";
import type { BatchCopyMoveInput, BatchCopyMoveOperation, BatchCopyMoveTarget } from "./model";
import type { BatchCopyMovePorts, TargetExecutionResult } from "./ports";

function target(sourcePath: string): BatchCopyMoveTarget {
  return Object.freeze({ sourcePath, destinationPath: `Archive/${sourcePath}` });
}

function input(targets: readonly BatchCopyMoveTarget[]): BatchCopyMoveInput {
  return Object.freeze({ operation: "copy", targets: Object.freeze([...targets]) });
}

function ports(overrides: Partial<BatchCopyMovePorts> = {}): BatchCopyMovePorts {
  return {
    isCurrent: () => true,
    executeTarget: vi.fn(async () => ({ kind: "completed" } as const)),
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
        calls.push(current.sourcePath);
        return { kind: "completed" } as const;
      })
    });

    const result = await executeBatchCopyMove(input([target("a.txt"), target("b.txt")]), adapter);

    expect(calls).toEqual(["a.txt", "b.txt"]);
    expect(adapter.refreshFolder).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "completed", completedCount: 2, totalCount: 2, failures: [] });
  });

  it("forwards move as the selected operation", async () => {
    const adapter = ports();

    await executeBatchCopyMove({ operation: "move", targets: [target("a.txt")] }, adapter);

    expect(adapter.executeTarget).toHaveBeenCalledWith("move", { sourcePath: "a.txt", destinationPath: "Archive/a.txt" });
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
      totalCount: 3,
      failures: [
        { target: targets[0], message: "first failed" },
        { target: targets[2], message: "third failed" }
      ]
    });
    expect(adapter.executeTarget).toHaveBeenCalledTimes(3);
    expect(adapter.refreshFolder).toHaveBeenCalledTimes(1);
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
    const targets = [target("a.txt"), target("b.txt"), target("c.txt"), target("d.txt")];
    const adapter = ports({ executeTarget: vi.fn(async () => outcomes.shift() ?? ({ kind: "completed" } as const)) });

    const result = await executeBatchCopyMove(input(targets), adapter);

    expect(result).toEqual({
      kind: "sessionTerminated",
      completedCount: 1,
      totalCount: 4,
      failures: [{ target: targets[1], message: "ordinary failure" }]
    });
    expect(adapter.executeTarget).toHaveBeenCalledTimes(3);
    expect(adapter.refreshFolder).not.toHaveBeenCalled();
  });

  it("reports terminal refresh after all target results", async () => {
    const adapter = ports({ refreshFolder: vi.fn(async () => ({ kind: "sessionTerminated" } as const)) });

    const result = await executeBatchCopyMove(input([target("a.txt")]), adapter);

    expect(result).toEqual({ kind: "sessionTerminated", completedCount: 1, totalCount: 1, failures: [] });
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

    expect(result).toEqual({ kind: "superseded", completedCount: 0, totalCount: 2, failures: [] });
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

    expect(await resultPromise).toEqual({ kind: "superseded", completedCount: 1, totalCount: 1, failures: [] });
  });

  it("does not mutate frozen input", async () => {
    const targets = [target("a.txt"), target("b.txt")];
    const request = input(targets);

    await executeBatchCopyMove(request, ports());

    expect(request.targets).toEqual(targets);
  });
});
