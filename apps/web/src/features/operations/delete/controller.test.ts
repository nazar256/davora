import { describe, expect, it, vi } from "vitest";

import { executeBatchDelete } from "./controller";
import { createBatchDeleteWorkflow, type BatchDeleteWorkflow, type DeleteTarget } from "./model";
import type { BatchDeletePorts, DeleteExecutionResult } from "./ports";

const target = (path: string): DeleteTarget => ({ path, confirmName: path.split("/").at(-1) ?? path });

function ports(overrides: Partial<BatchDeletePorts> = {}): BatchDeletePorts {
  return {
    isCurrent: () => true,
    executeTarget: vi.fn(async () => ({ kind: "completed" } as const)),
    acceptProgress: vi.fn(() => true),
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

describe("executeBatchDelete", () => {
  it("executes deepest-first, accepts each success once, and refreshes once", async () => {
    const workflow = createBatchDeleteWorkflow(1, [target("Docs"), target("Peer"), target("Docs/a.txt")]);
    const adapter = ports();

    const result = await executeBatchDelete(workflow, adapter);

    expect(vi.mocked(adapter.executeTarget).mock.calls.map(([item]) => item.path)).toEqual(["Docs/a.txt", "Docs", "Peer"]);
    expect(adapter.acceptProgress).toHaveBeenCalledTimes(3);
    expect(adapter.refreshFolder).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ kind: "completed", completedCount: 3, totalCount: 3 });
    expect(result.workflow.unresolvedTargets).toEqual([]);
  });

  it("stops at the first ordinary failure and keeps failed plus unattempted targets in display order", async () => {
    const workflow = createBatchDeleteWorkflow(2, [target("Docs"), target("Peer"), target("Docs/a.txt")]);
    const outcomes: DeleteExecutionResult[] = [{ kind: "completed" }, { kind: "failed", message: "parent failed" }];
    const adapter = ports({ executeTarget: vi.fn(async () => outcomes.shift() ?? ({ kind: "completed" } as const)) });

    const result = await executeBatchDelete(workflow, adapter);

    expect(result.kind).toBe("failed");
    expect(result.workflow.unresolvedTargets.map((item) => item.path)).toEqual(["Docs", "Peer"]);
    expect(adapter.executeTarget).toHaveBeenCalledTimes(2);
    expect(adapter.acceptProgress).toHaveBeenCalledTimes(1);
    expect(adapter.refreshFolder).not.toHaveBeenCalled();
  });

  it("stops without progress when the first target fails", async () => {
    const adapter = ports({ executeTarget: vi.fn(async () => ({ kind: "failed", message: "failed first" } as const)) });

    const result = await executeBatchDelete(createBatchDeleteWorkflow(11, [target("a.txt"), target("b.txt")]), adapter);

    expect(result).toMatchObject({ kind: "failed", completedCount: 0, message: "failed first" });
    expect(result.workflow.unresolvedTargets.map((item) => item.path)).toEqual(["a.txt", "b.txt"]);
    expect(adapter.executeTarget).toHaveBeenCalledTimes(1);
    expect(adapter.acceptProgress).not.toHaveBeenCalled();
  });

  it("retries only the unresolved queue in deterministic execution order", async () => {
    const initial = createBatchDeleteWorkflow(3, [target("Docs"), target("Peer"), target("Docs/a.txt")]);
    const firstOutcomes: DeleteExecutionResult[] = [{ kind: "completed" }, { kind: "failed", message: "parent failed" }];
    const first = await executeBatchDelete(initial, ports({
      executeTarget: vi.fn(async () => firstOutcomes.shift() ?? ({ kind: "completed" } as const))
    }));
    const retryAdapter = ports();

    await executeBatchDelete(first.workflow, retryAdapter);

    expect(vi.mocked(retryAdapter.executeTarget).mock.calls.map(([item]) => item.path)).toEqual(["Docs", "Peer"]);
  });

  it.each([0, 1])("stops on session termination at execution index %i", async (terminalIndex) => {
    let index = 0;
    const adapter = ports({
      executeTarget: vi.fn(async () => index++ === terminalIndex ? { kind: "sessionTerminated" } as const : { kind: "completed" } as const)
    });

    const result = await executeBatchDelete(createBatchDeleteWorkflow(4, [target("a.txt"), target("b.txt")]), adapter);

    expect(result.kind).toBe("sessionTerminated");
    expect(adapter.executeTarget).toHaveBeenCalledTimes(terminalIndex + 1);
    expect(adapter.refreshFolder).not.toHaveBeenCalled();
  });

  it("does nothing when superseded before execution", async () => {
    const adapter = ports({ isCurrent: () => false });

    const result = await executeBatchDelete(createBatchDeleteWorkflow(5, [target("a.txt")]), adapter);

    expect(result.kind).toBe("superseded");
    expect(adapter.executeTarget).not.toHaveBeenCalled();
  });

  it("makes a pending request inert after supersession", async () => {
    let current = true;
    const pending = deferred<DeleteExecutionResult>();
    const adapter = ports({ isCurrent: () => current, executeTarget: vi.fn(() => pending.promise) });
    const resultPromise = executeBatchDelete(createBatchDeleteWorkflow(6, [target("a.txt")]), adapter);
    current = false;
    pending.resolve({ kind: "completed" });

    const result = await resultPromise;

    expect(result.kind).toBe("superseded");
    expect(adapter.acceptProgress).not.toHaveBeenCalled();
    expect(result.workflow.unresolvedTargets.map((item) => item.path)).toEqual(["a.txt"]);
  });

  it("stops when current progress cannot be accepted", async () => {
    const adapter = ports({ acceptProgress: vi.fn(() => false) });

    const result = await executeBatchDelete(createBatchDeleteWorkflow(7, [target("a.txt"), target("b.txt")]), adapter);

    expect(result.kind).toBe("superseded");
    expect(adapter.executeTarget).toHaveBeenCalledTimes(1);
    expect(adapter.refreshFolder).not.toHaveBeenCalled();
  });

  it("preserves accepted progress when superseded immediately afterward", async () => {
    let current = true;
    const adapter = ports({
      isCurrent: () => current,
      acceptProgress: vi.fn(() => {
        current = false;
        return true;
      })
    });

    const result = await executeBatchDelete(createBatchDeleteWorkflow(12, [target("a.txt"), target("b.txt")]), adapter);

    expect(result.kind).toBe("superseded");
    expect(result.workflow.unresolvedTargets.map((item) => item.path)).toEqual(["b.txt"]);
    expect(adapter.executeTarget).toHaveBeenCalledTimes(1);
  });

  it("returns terminal refresh only after all progress was accepted", async () => {
    const adapter = ports({ refreshFolder: vi.fn(async () => ({ kind: "sessionTerminated" } as const)) });

    const result = await executeBatchDelete(createBatchDeleteWorkflow(8, [target("a.txt")]), adapter);

    expect(result.kind).toBe("sessionTerminated");
    expect(result.workflow.unresolvedTargets).toEqual([]);
  });

  it("makes a pending refresh inert after supersession", async () => {
    let current = true;
    const pending = deferred<{ kind: "completed" }>();
    const adapter = ports({ isCurrent: () => current, refreshFolder: vi.fn(() => pending.promise) });
    const resultPromise = executeBatchDelete(createBatchDeleteWorkflow(9, [target("a.txt")]), adapter);
    await vi.waitFor(() => expect(adapter.refreshFolder).toHaveBeenCalledTimes(1));
    current = false;
    pending.resolve({ kind: "completed" });

    expect((await resultPromise).kind).toBe("superseded");
  });

  it("passes an immutable updated workflow to progress acceptance", async () => {
    const accepted: BatchDeleteWorkflow[] = [];
    const original = createBatchDeleteWorkflow(10, [target("a.txt"), target("b.txt")]);
    await executeBatchDelete(original, ports({ acceptProgress: (progress) => {
      accepted.push(progress.workflow);
      return true;
    } }));

    expect(accepted.map((workflow) => workflow.unresolvedTargets.length)).toEqual([1, 0]);
    expect(original.unresolvedTargets).toHaveLength(2);
  });
});
