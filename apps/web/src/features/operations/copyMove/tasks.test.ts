import type { FileEntry } from "@davora/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createOperationContextToken } from "../policy";
import type { BatchCopyMoveTarget } from "./model";
import type { FolderListResult, FolderRefreshResult, TargetExecutionResult } from "./ports";
import {
  DEFAULT_COPY_MOVE_MAX_RETRIES,
  runCopyMoveTask,
  useCopyMoveTaskRunner,
  type CopyMoveTaskPorts,
  type CopyMoveTaskSpec
} from "./tasks";

function entry(path: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false, ...overrides };
}

function target(path: string, destinationPath: string, mode: BatchCopyMoveTarget["mode"] = "write", overrides: Partial<FileEntry> = {}): BatchCopyMoveTarget {
  return { source: entry(path, overrides), destinationPath, mode };
}

function spec(overrides: Partial<CopyMoveTaskSpec> = {}): CopyMoveTaskSpec {
  return {
    operation: "copy",
    targets: [target("notes.txt", "Archive/notes.txt")],
    skipped: [],
    applySizeRule: true,
    destinationPath: "Archive",
    accountId: "account-1",
    accountName: "Workspace",
    context: createOperationContextToken(),
    intent: { kind: "copy", count: 1 },
    label: "notes.txt",
    ...overrides
  };
}

interface PortFixture {
  ports: CopyMoveTaskPorts;
  scope: { signal: AbortSignal; isCurrent: () => boolean; release: ReturnType<typeof vi.fn> };
  setScopeCurrent(next: boolean): void;
  abortScope(): void;
  transferCalls: { method: string; args: unknown[] }[];
  delays: number[];
  statuses: string[];
  removed: string[];
  removedFocused: string[];
}

function ports(overrides: {
  acquire?: CopyMoveTaskPorts["registry"]["acquire"];
  execute?: CopyMoveTaskPorts["batch"]["executeCopyMoveTarget"];
  listChildren?: CopyMoveTaskPorts["batch"]["listChildren"];
  deleteFolder?: CopyMoveTaskPorts["batch"]["deleteFolder"];
  refreshFolder?: CopyMoveTaskPorts["batch"]["refreshFolder"];
  wait?: CopyMoveTaskPorts["wait"];
} = {}): PortFixture {
  let scopeCurrent = true;
  const scopeController = new AbortController();
  const scope = { signal: scopeController.signal, isCurrent: () => scopeCurrent, release: vi.fn() };
  const transferCalls: { method: string; args: unknown[] }[] = [];
  const delays: number[] = [];
  const statuses: string[] = [];
  const removed: string[] = [];
  const removedFocused: string[] = [];
  const record = (method: string) => (...args: unknown[]) => {
    transferCalls.push({ method, args });
  };

  return {
    scope,
    setScopeCurrent(next: boolean) {
      scopeCurrent = next;
    },
    abortScope() {
      scopeCurrent = false;
      scopeController.abort();
    },
    transferCalls,
    delays,
    statuses,
    removed,
    removedFocused,
    ports: {
      registry: {
        acquire: overrides.acquire ?? vi.fn(() => scope)
      },
      transfers: {
        createId: () => "task-1",
        enqueueCopyMove: record("enqueueCopyMove"),
        beginTransfer: record("beginTransfer"),
        reportItemProgress: record("reportItemProgress"),
        reportItemFailure: record("reportItemFailure"),
        complete: record("complete"),
        completePartial: record("completePartial"),
        fail: record("fail"),
        markCanceled: record("markCanceled")
      },
      batch: {
        executeCopyMoveTarget: overrides.execute ?? vi.fn(async (): Promise<TargetExecutionResult> => ({ kind: "completed" })),
        listChildren: overrides.listChildren ?? vi.fn(async (): Promise<FolderListResult> => ({ completeness: "complete" as const, kind: "completed", entries: [] })),
        deleteFolder: overrides.deleteFolder ?? vi.fn(async (): Promise<TargetExecutionResult> => ({ kind: "completed" })),
        refreshFolder: overrides.refreshFolder ?? vi.fn(async (): Promise<FolderRefreshResult> => ({ kind: "completed" }))
      },
      folder: { getCurrentPath: () => "Projects" },
      selection: {
        removeDeletedPath: (path: string) => { removed.push(path); },
        removeDeletedFocusedPath: (path: string) => { removedFocused.push(path); }
      },
      presentation: { setStatus: (message: string) => { statuses.push(message); } },
      labels: { toDisplayPath: (path: string) => `/${path}` },
      context: {
        getOperationContextToken: () => createOperationContextToken(),
        getAccountId: () => "account-1"
      },
      wait: overrides.wait ?? (async (delayMs: number) => {
        delays.push(delayMs);
      }),
      createAbortHandle: () => {
        const controller = new AbortController();
        return { signal: controller.signal, abort: () => controller.abort() };
      }
    }
  };
}

const callsOf = (fixture: PortFixture, method: string) => fixture.transferCalls.filter((call) => call.method === method);

describe("runCopyMoveTask", () => {
  it("runs a copy task end-to-end: enqueue, item progress, completion status, selection removal", async () => {
    const fixture = ports();
    const taskSpec = spec({
      targets: [
        target("a.txt", "Archive/a.txt"),
        target("b.txt", "Archive/b.txt")
      ],
      intent: { kind: "copy", count: 2 },
      label: "2 items"
    });

    await runCopyMoveTask(taskSpec, "task-1", () => false, fixture.ports);

    const execute = vi.mocked(fixture.ports.batch.executeCopyMoveTarget);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledWith("copy", "a.txt", "Archive/a.txt", false, taskSpec.context, taskSpec.intent, expect.any(Function));

    expect(callsOf(fixture, "beginTransfer")).toHaveLength(1);
    expect(callsOf(fixture, "reportItemProgress")).toEqual([
      { method: "reportItemProgress", args: ["task-1", 1, 2] },
      { method: "reportItemProgress", args: ["task-1", 2, 2] }
    ]);
    expect(callsOf(fixture, "complete")).toHaveLength(1);
    expect(fixture.statuses).toEqual(["Copied 2 selected items to /Archive in Workspace."]);
    expect(fixture.removed).toEqual(["a.txt", "b.txt"]);
    expect(fixture.removedFocused).toEqual([]);
    expect(fixture.scope.release).toHaveBeenCalledTimes(1);
  });

  it("clears the focused selection for completed move sources", async () => {
    const fixture = ports();
    await runCopyMoveTask(spec({
      operation: "move",
      targets: [target("notes.txt", "Archive/notes.txt")],
      intent: { kind: "move", count: 1 }
    }), "task-1", () => false, fixture.ports);

    expect(fixture.removed).toEqual(["notes.txt"]);
    expect(fixture.removedFocused).toEqual(["notes.txt"]);
    expect(fixture.statuses).toEqual(["Moved 1 selected item to /Archive in Workspace."]);
  });

  it("keeps failed sources selected and completes the task as partial", async () => {
    const fixture = ports({
      execute: vi.fn(async (_operation, sourcePath): Promise<TargetExecutionResult> => sourcePath === "b.txt"
        ? { kind: "failed", message: "denied", retryable: false }
        : { kind: "completed" })
    });
    await runCopyMoveTask(spec({
      targets: [
        target("a.txt", "Archive/a.txt"),
        target("b.txt", "Archive/b.txt")
      ],
      intent: { kind: "copy", count: 2 },
      label: "2 items"
    }), "task-1", () => false, fixture.ports);

    expect(callsOf(fixture, "completePartial")).toEqual([{
      method: "completePartial",
      args: ["task-1", [{ sourcePath: "b.txt", error: "denied" }], "Copied 1 of 2 selected items; 1 failed in Workspace."]
    }]);
    expect(callsOf(fixture, "complete")).toHaveLength(0);
    expect(fixture.removed).toEqual(["a.txt"]);
    expect(fixture.statuses).toEqual(["Copied 1 of 2 selected items; 1 failed in Workspace."]);
    expect(callsOf(fixture, "reportItemFailure")).toEqual([
      { method: "reportItemFailure", args: ["task-1", { sourcePath: "b.txt", error: "denied" }] }
    ]);
  });

  it("retries retryable failures up to the default limit with increasing delays", async () => {
    let attempts = 0;
    const fixture = ports({
      execute: vi.fn(async (): Promise<TargetExecutionResult> => {
        attempts += 1;
        return attempts < 3 ? { kind: "failed", message: "throttled", retryable: true } : { kind: "completed" };
      })
    });
    await runCopyMoveTask(spec(), "task-1", () => false, fixture.ports);

    expect(vi.mocked(fixture.ports.batch.executeCopyMoveTarget)).toHaveBeenCalledTimes(3);
    expect(fixture.delays).toEqual([250, 500]);
    expect(callsOf(fixture, "complete")).toHaveLength(1);
  });

  it("gives up after the default retry limit and reports the item failure", async () => {
    const fixture = ports({
      execute: vi.fn(async (): Promise<TargetExecutionResult> => ({ kind: "failed", message: "throttled", retryable: true }))
    });
    await runCopyMoveTask(spec(), "task-1", () => false, fixture.ports);

    expect(vi.mocked(fixture.ports.batch.executeCopyMoveTarget)).toHaveBeenCalledTimes(1 + DEFAULT_COPY_MOVE_MAX_RETRIES);
    expect(fixture.delays).toEqual([250, 500, 750]);
    expect(callsOf(fixture, "completePartial")).toHaveLength(1);
  });

  it("does not retry non-retryable failures", async () => {
    const fixture = ports({
      execute: vi.fn(async (): Promise<TargetExecutionResult> => ({ kind: "failed", message: "conflict", retryable: false }))
    });
    await runCopyMoveTask(spec(), "task-1", () => false, fixture.ports);

    expect(vi.mocked(fixture.ports.batch.executeCopyMoveTarget)).toHaveBeenCalledTimes(1);
    expect(fixture.delays).toEqual([]);
  });

  it("honours an explicit maxRetries override", async () => {
    const fixture = ports({
      execute: vi.fn(async (): Promise<TargetExecutionResult> => ({ kind: "failed", message: "throttled", retryable: true }))
    });
    await runCopyMoveTask(spec({ maxRetries: 1, retryDelayMs: 10 }), "task-1", () => false, fixture.ports);

    expect(vi.mocked(fixture.ports.batch.executeCopyMoveTarget)).toHaveBeenCalledTimes(2);
    expect(fixture.delays).toEqual([10]);
  });

  it("marks the task canceled when the user cancels between items", async () => {
    let canceled = false;
    const fixture = ports({
      execute: vi.fn(async (_operation, sourcePath): Promise<TargetExecutionResult> => {
        if (sourcePath === "a.txt") {
          canceled = true;
        }
        return { kind: "completed" };
      })
    });
    await runCopyMoveTask(spec({
      targets: [target("a.txt", "Archive/a.txt"), target("b.txt", "Archive/b.txt")],
      intent: { kind: "copy", count: 2 },
      label: "2 items"
    }), "task-1", () => canceled, fixture.ports);

    expect(vi.mocked(fixture.ports.batch.executeCopyMoveTarget)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fixture.ports.batch.refreshFolder)).toHaveBeenCalledTimes(1);
    expect(callsOf(fixture, "markCanceled")).toEqual([{
      method: "markCanceled",
      args: ["task-1", "Copy canceled after 1 of 2 items in Workspace."]
    }]);
    expect(fixture.statuses).toEqual(["Copy canceled after 1 of 2 items in Workspace."]);
    expect(fixture.removed).toEqual(["a.txt"]);
    expect(fixture.scope.release).toHaveBeenCalledTimes(1);
  });

  it("fails the task when the session terminates mid-run", async () => {
    const fixture = ports({
      execute: vi.fn(async (): Promise<TargetExecutionResult> => ({ kind: "sessionTerminated" }))
    });
    await runCopyMoveTask(spec(), "task-1", () => false, fixture.ports);

    expect(callsOf(fixture, "fail")).toEqual([{
      method: "fail",
      args: ["task-1", "Session expired before the task finished."]
    }]);
    expect(callsOf(fixture, "complete")).toHaveLength(0);
  });

  it("fails the task when its operation scope is superseded mid-run", async () => {
    const fixture = ports({
      execute: vi.fn(async (): Promise<TargetExecutionResult> => {
        fixture.setScopeCurrent(false);
        return { kind: "completed" };
      })
    });
    await runCopyMoveTask(spec(), "task-1", () => false, fixture.ports);

    expect(callsOf(fixture, "fail")).toEqual([{
      method: "fail",
      args: ["task-1", "The task stopped because the session changed."]
    }]);
    expect(fixture.statuses).toEqual([]);
    expect(fixture.scope.release).toHaveBeenCalledTimes(1);
  });

  it("acquires a path-independent operation scope so navigation cannot cancel the task", async () => {
    const fixture = ports();
    const taskSpec = spec();
    await runCopyMoveTask(taskSpec, "task-1", () => false, fixture.ports);

    expect(fixture.ports.registry.acquire).toHaveBeenCalledWith({
      context: taskSpec.context,
      intent: taskSpec.intent
    });
  });

  it("stops retrying and cancels remaining targets when cancelled during retry backoff", async () => {
    let canceled = false;
    const fixture = ports({
      execute: vi.fn(async (_operation, sourcePath): Promise<TargetExecutionResult> => (
        sourcePath === "a.txt" ? { kind: "failed", message: "throttled", retryable: true } : { kind: "completed" }
      )),
      wait: async (delayMs: number) => {
        canceled = true;
        fixture.delays.push(delayMs);
      }
    });

    await runCopyMoveTask(spec({
      targets: [target("a.txt", "Archive/a.txt"), target("b.txt", "Archive/b.txt")],
      intent: { kind: "copy", count: 2 },
      label: "2 items"
    }), "task-1", () => canceled, fixture.ports);

    expect(vi.mocked(fixture.ports.batch.executeCopyMoveTarget)).toHaveBeenCalledTimes(1);
    expect(fixture.delays).toEqual([250]);
    expect(callsOf(fixture, "markCanceled")).toHaveLength(1);
  });

  it("reaches a terminal canceled state when the user cancels a hung in-flight request", async () => {
    const controller = new AbortController();
    const execute = vi.fn((): Promise<TargetExecutionResult> => new Promise(() => {}));
    const fixture = ports({ execute });
    const task = runCopyMoveTask(
      spec(), "task-1", () => controller.signal.aborted, fixture.ports, undefined, controller.signal
    );

    await vi.waitFor(() => expect(execute).toHaveBeenCalled());
    controller.abort();
    await task;

    expect(callsOf(fixture, "markCanceled")).toHaveLength(1);
    expect(callsOf(fixture, "fail")).toHaveLength(0);
    expect(fixture.scope.release).toHaveBeenCalledTimes(1);
  });

  it("fails a hung task when its operation scope is aborted mid-request", async () => {
    const execute = vi.fn((): Promise<TargetExecutionResult> => new Promise(() => {}));
    const fixture = ports({ execute });
    const task = runCopyMoveTask(spec(), "task-1", () => false, fixture.ports);

    await vi.waitFor(() => expect(execute).toHaveBeenCalled());
    fixture.abortScope();
    await task;

    expect(callsOf(fixture, "fail")).toEqual([{
      method: "fail",
      args: ["task-1", "The task stopped because the session changed."]
    }]);
    expect(fixture.scope.release).toHaveBeenCalledTimes(1);
  });

  it("fails immediately when no operation scope can be acquired", async () => {
    const fixture = ports({ acquire: vi.fn(() => undefined) });
    await runCopyMoveTask(spec(), "task-1", () => false, fixture.ports);

    expect(callsOf(fixture, "fail")).toEqual([{
      method: "fail",
      args: ["task-1", "The session changed before the task could start."]
    }]);
    expect(vi.mocked(fixture.ports.batch.executeCopyMoveTarget)).not.toHaveBeenCalled();
  });

  it("fails the ledger entry instead of rejecting when scope acquisition throws", async () => {
    const fixture = ports({ acquire: vi.fn(() => { throw new Error("registry exploded"); }) });
    await runCopyMoveTask(spec(), "task-1", () => false, fixture.ports);

    expect(callsOf(fixture, "fail")).toEqual([{
      method: "fail",
      args: ["task-1", "registry exploded"]
    }]);
    expect(vi.mocked(fixture.ports.batch.executeCopyMoveTarget)).not.toHaveBeenCalled();
  });

  it("reports an all-skipped plan without executing targets", async () => {
    const fixture = ports();
    await runCopyMoveTask(spec({
      targets: [],
      skipped: [entry("notes.txt")],
      intent: { kind: "copy", count: 1 }
    }), "task-1", () => false, fixture.ports);

    expect(vi.mocked(fixture.ports.batch.executeCopyMoveTarget)).not.toHaveBeenCalled();
    expect(callsOf(fixture, "complete")).toHaveLength(1);
    expect(fixture.statuses).toEqual(["Nothing copied — 1 item skipped in Workspace."]);
  });

  it("executes merge targets recursively and deletes the emptied source on move", async () => {
    const children: Record<string, FileEntry[]> = {
      "Docs": [entry("Docs/a.txt")],
      "Archive/Docs": []
    };
    const execute = vi.fn(async (_operation, sourcePath: string): Promise<TargetExecutionResult> => {
      children["Docs"] = children["Docs"]?.filter((item) => item.path !== sourcePath) ?? [];
      return { kind: "completed" };
    });
    const deleteFolder = vi.fn(async (): Promise<TargetExecutionResult> => ({ kind: "completed" }));
    const fixture = ports({
      execute,
      deleteFolder,
      listChildren: vi.fn(async (path: string): Promise<FolderListResult> => ({ completeness: "complete" as const, kind: "completed", entries: children[path] ?? [] }))
    });
    await runCopyMoveTask(spec({
      operation: "move",
      targets: [target("Docs", "Archive/Docs", "merge", { isFolder: true })],
      intent: { kind: "move", count: 1 }
    }), "task-1", () => false, fixture.ports);

    expect(execute).toHaveBeenCalledWith("move", "Docs/a.txt", "Archive/Docs/a.txt", false, expect.anything(), expect.anything(), expect.any(Function));
    expect(deleteFolder).toHaveBeenCalledWith("Docs", "Docs", expect.anything(), expect.anything(), expect.any(Function));
    expect(callsOf(fixture, "complete")).toHaveLength(1);
    expect(fixture.removed).toEqual(["Docs"]);
    expect(fixture.removedFocused).toEqual(["Docs"]);
  });

  it("passes overwrite for overwrite-mode targets", async () => {
    const fixture = ports();
    await runCopyMoveTask(spec({
      targets: [target("notes.txt", "Archive/notes.txt", "overwrite")]
    }), "task-1", () => false, fixture.ports);

    expect(vi.mocked(fixture.ports.batch.executeCopyMoveTarget)).toHaveBeenCalledWith(
      "copy", "notes.txt", "Archive/notes.txt", true, expect.anything(), expect.anything(), expect.any(Function)
    );
  });
});

describe("useCopyMoveTaskRunner", () => {
  it("enqueues a transfer draft and runs the task to completion", async () => {
    const fixture = ports();
    const { result } = renderHook(() => useCopyMoveTaskRunner(fixture.ports));

    act(() => {
      result.current.enqueue(spec());
    });

    expect(callsOf(fixture, "enqueueCopyMove")).toEqual([{
      method: "enqueueCopyMove",
      args: [{ id: "task-1", accountId: "account-1", kind: "copy", label: "notes.txt", totalItems: 1 }]
    }]);
    await waitFor(() => expect(callsOf(fixture, "complete")).toHaveLength(1));
    expect(fixture.statuses).toEqual(["Copied 1 selected item to /Archive in Workspace."]);
  });

  it("cancels an active task through its retained flag", async () => {
    let resolveExecute: (() => void) | undefined;
    const execute = vi.fn(async (): Promise<TargetExecutionResult> => {
      await new Promise<void>((resolve) => {
        resolveExecute = resolve;
      });
      return { kind: "completed" };
    });
    const fixture = ports({ execute });
    const { result } = renderHook(() => useCopyMoveTaskRunner(fixture.ports));

    act(() => {
      result.current.enqueue(spec({ targets: [target("a.txt", "Archive/a.txt"), target("b.txt", "Archive/b.txt")] }));
    });
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.cancelTask("task-1");
    });
    await act(async () => {
      resolveExecute?.();
    });

    await waitFor(() => expect(callsOf(fixture, "markCanceled")).toHaveLength(1));
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("retries only unfinished targets under the current operation context", async () => {
    const fixture = ports({
      execute: vi.fn(async (_operation, sourcePath): Promise<TargetExecutionResult> => sourcePath === "b.txt"
        ? { kind: "failed", message: "denied", retryable: false }
        : { kind: "completed" })
    });
    const { result } = renderHook(() => useCopyMoveTaskRunner(fixture.ports));

    act(() => {
      result.current.enqueue(spec({
        targets: [target("a.txt", "Archive/a.txt"), target("b.txt", "Archive/b.txt")],
        label: "2 items"
      }));
    });
    await waitFor(() => expect(callsOf(fixture, "completePartial")).toHaveLength(1));

    const execute = vi.mocked(fixture.ports.batch.executeCopyMoveTarget);
    execute.mockImplementation(async (): Promise<TargetExecutionResult> => ({ kind: "completed" }));
    act(() => {
      result.current.retryTask("task-1");
    });

    await waitFor(() => expect(callsOf(fixture, "enqueueCopyMove")).toHaveLength(2));
    await waitFor(() => expect(callsOf(fixture, "complete")).toHaveLength(1));
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenLastCalledWith("copy", "b.txt", "Archive/b.txt", false, expect.anything(), expect.anything(), expect.any(Function));

    const acquire = vi.mocked(fixture.ports.registry.acquire);
    expect(acquire.mock.calls[1]?.[0]?.context).not.toBe(acquire.mock.calls[0]?.[0]?.context);
  });

  it("refuses to retry a task that is still running", async () => {
    let resolveExecute: (() => void) | undefined;
    const execute = vi.fn(async (): Promise<TargetExecutionResult> => {
      await new Promise<void>((resolve) => {
        resolveExecute = resolve;
      });
      return { kind: "completed" };
    });
    const fixture = ports({ execute });
    const { result } = renderHook(() => useCopyMoveTaskRunner(fixture.ports));

    act(() => {
      result.current.enqueue(spec());
    });
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.retryTask("task-1");
    });
    expect(callsOf(fixture, "enqueueCopyMove")).toHaveLength(1);

    await act(async () => {
      resolveExecute?.();
    });
    await waitFor(() => expect(callsOf(fixture, "complete")).toHaveLength(1));
    expect(callsOf(fixture, "enqueueCopyMove")).toHaveLength(1);
  });

  it("ignores a repeated retry for the same settled task entry", async () => {
    const fixture = ports({
      execute: vi.fn(async (): Promise<TargetExecutionResult> => ({ kind: "failed", message: "denied", retryable: false }))
    });
    const { result } = renderHook(() => useCopyMoveTaskRunner(fixture.ports));

    act(() => {
      result.current.enqueue(spec());
    });
    await waitFor(() => expect(callsOf(fixture, "completePartial")).toHaveLength(1));

    const execute = vi.mocked(fixture.ports.batch.executeCopyMoveTarget);
    execute.mockImplementation(async (): Promise<TargetExecutionResult> => ({ kind: "completed" }));
    act(() => {
      result.current.retryTask("task-1");
      result.current.retryTask("task-1");
    });

    await waitFor(() => expect(callsOf(fixture, "complete")).toHaveLength(1));
    expect(callsOf(fixture, "enqueueCopyMove")).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("retries the unfinished targets of a canceled task", async () => {
    const runnerRef: { current?: { cancelTask(id: string): void } } = {};
    const fixture = ports({
      execute: vi.fn(async (_operation, sourcePath): Promise<TargetExecutionResult> => {
        if (sourcePath === "a.txt") {
          runnerRef.current?.cancelTask("task-1");
        }
        return { kind: "completed" };
      })
    });
    const { result } = renderHook(() => useCopyMoveTaskRunner(fixture.ports));
    runnerRef.current = result.current;

    act(() => {
      result.current.enqueue(spec({ targets: [target("a.txt", "Archive/a.txt"), target("b.txt", "Archive/b.txt")] }));
    });
    await waitFor(() => expect(callsOf(fixture, "markCanceled")).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const execute = vi.mocked(fixture.ports.batch.executeCopyMoveTarget);
    execute.mockImplementation(async (): Promise<TargetExecutionResult> => ({ kind: "completed" }));
    act(() => {
      result.current.retryTask("task-1");
    });

    await waitFor(() => expect(callsOf(fixture, "complete")).toHaveLength(1));
    expect(execute).toHaveBeenLastCalledWith("copy", "b.txt", "Archive/b.txt", false, expect.anything(), expect.anything(), expect.any(Function));
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("refuses to retry a task for a different account", async () => {
    const fixture = ports({
      execute: vi.fn(async (): Promise<TargetExecutionResult> => ({ kind: "failed", message: "denied", retryable: false }))
    });
    fixture.ports.context.getAccountId = () => "account-2";
    const { result } = renderHook(() => useCopyMoveTaskRunner(fixture.ports));

    act(() => {
      result.current.enqueue(spec());
    });
    await waitFor(() => expect(callsOf(fixture, "completePartial")).toHaveLength(1));

    act(() => {
      result.current.retryTask("task-1");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callsOf(fixture, "enqueueCopyMove")).toHaveLength(1);
  });

  it("refuses to retry a fully settled task", async () => {
    const fixture = ports();
    const { result } = renderHook(() => useCopyMoveTaskRunner(fixture.ports));

    act(() => {
      result.current.enqueue(spec());
    });
    await waitFor(() => expect(callsOf(fixture, "complete")).toHaveLength(1));

    act(() => {
      result.current.retryTask("task-1");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callsOf(fixture, "enqueueCopyMove")).toHaveLength(1);
  });
});
