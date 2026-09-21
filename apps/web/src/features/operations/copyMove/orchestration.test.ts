import type { FileEntry, MutationResult } from "@davora/shared";
import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../../../lib/api";
import { createOperationContextToken } from "../policy";
import type { CopyMovePickerSnapshot } from "./model";
import { runCopyMoveSubmitOrchestration } from "./orchestration";
import type { CopyMoveOrchestrationPorts } from "./orchestrationPorts";
import type { TargetExecutionResult } from "./ports";
import { issueMutationAttemptToken } from "../mutation/attempt";

function ownership(context = createOperationContextToken()) {
  const attempt = issueMutationAttemptToken({
    workflowIdentity: 1, context, path: "", pathGeneration: 0, ownershipGeneration: 0,
    mountGeneration: 1, domainIdentity: "test", intent: { kind: "copy", count: 1 }
  });
  return {
    ownerPath: "",
    attempt,
    isAttemptCurrent: vi.fn(() => true),
    failAttempt: vi.fn(),
    reportPartial: vi.fn(),
    completeDestination: vi.fn(() => true)
  };
}

function mutationResult(path: string, destinationPath: string): MutationResult {
  return { action: "copy", parentPath: "", path, destinationPath };
}

function entry(path: string): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false };
}

function resolved(source: FileEntry, destinationPath: string, options: { overwrite?: boolean; merge?: boolean } = {}) {
  return { source, destinationPath, overwrite: options.overwrite ?? false, merge: options.merge ?? false };
}

function picker(overrides: Partial<CopyMovePickerSnapshot> = {}): CopyMovePickerSnapshot {
  const context = overrides.context ?? createOperationContextToken();
  return {
    context,
    kind: "copyMove",
    sourceEntries: [entry("notes.txt")],
    batch: false,
    folderPath: "Archive",
    name: "notes.txt",
    nameEdited: false,
    manualPath: "Archive/notes.txt",
    manualMode: false,
    entries: [],
    loading: false,
    ...overrides
  };
}

type MutableFixture = CopyMoveOrchestrationPorts & {
  setContextAllowed(next: boolean): void;
  mutationCalls: string[];
};

function ports(overrides: Partial<CopyMoveOrchestrationPorts> = {}): MutableFixture {
  const mutationCalls: string[] = [];
  let contextAllowed = true;
  const defaultPorts: CopyMoveOrchestrationPorts = {
    context: {
      isCurrentOperationContext: vi.fn(() => true),
      isContextAllowed: vi.fn(() => contextAllowed)
    },
    session: {
      hasSession: vi.fn(() => true),
      isUnauthorized: vi.fn((error: unknown) => error instanceof ApiRequestError && error.status === 401),
      isReconnectRequired: vi.fn((error: unknown) => error instanceof ApiRequestError && error.code === "account_reconnect_required")
    },
    mutations: {
      begin: vi.fn(() => { mutationCalls.push("begin"); }),
      finish: vi.fn(() => { mutationCalls.push("finish"); })
    },
    mutation: {
      execute: vi.fn(async (runner: () => Promise<MutationResult>) => {
        mutationCalls.push("single");
        return runner();
      })
    },
    api: {
      runCopyOrMove: vi.fn(async () => mutationResult("notes.txt", "Archive/notes.txt"))
    },
    batch: {
      executeCopyMoveTarget: vi.fn(async () => ({ kind: "completed" } as const)),
      listChildren: vi.fn(async () => ({ kind: "completed", entries: [] } as const)),
      deleteFolder: vi.fn(async () => ({ kind: "completed" } as const)),
      refreshFolder: vi.fn(async () => ({ kind: "completed" } as const))
    },
    selection: {
      retainFailedPaths: vi.fn(),
      clear: vi.fn()
    },
    destinationPicker: {
      closeIfCurrent: vi.fn()
    },
    presentation: {
      setActionError: vi.fn(),
      setStatus: vi.fn(),
      closeMobileDetails: vi.fn(),
      clearFocused: vi.fn()
    },
    labels: {
      toDisplayPath: (path: string) => `/${path}`
    }
  };

  const fixture: MutableFixture = {
    ...defaultPorts,
    ...overrides,
    context: { ...defaultPorts.context, ...overrides.context },
    session: { ...defaultPorts.session, ...overrides.session },
    mutations: { ...defaultPorts.mutations, ...overrides.mutations },
    mutation: { ...defaultPorts.mutation, ...overrides.mutation },
    api: { ...defaultPorts.api, ...overrides.api },
    batch: { ...defaultPorts.batch, ...overrides.batch },
    selection: { ...defaultPorts.selection, ...overrides.selection },
    destinationPicker: { ...defaultPorts.destinationPicker, ...overrides.destinationPicker },
    presentation: { ...defaultPorts.presentation, ...overrides.presentation },
    labels: { ...defaultPorts.labels, ...overrides.labels },
    mutationCalls,
    setContextAllowed(next: boolean) {
      contextAllowed = next;
    }
  };

  fixture.context.isContextAllowed = vi.fn(() => contextAllowed);

  return fixture;
}

describe("runCopyMoveSubmitOrchestration", () => {
  it("submits a single copy through executeMutation and closes the picker", async () => {
    const adapter = ports();
    const currentPicker = picker();

    const owner = ownership(currentPicker.context);
    await runCopyMoveSubmitOrchestration({
      operation: "copy",
      picker: currentPicker,
      destinationPath: "Archive/notes.txt",
      targets: [resolved(entry("notes.txt"), "Archive/notes.txt")],
      skipped: [],
      applySizeRule: true,
      accountName: "Workspace",
      ...owner
    }, adapter);

    expect(adapter.mutation.execute).toHaveBeenCalledTimes(1);
    expect(adapter.api.runCopyOrMove).toHaveBeenCalledWith("copy", "notes.txt", "Archive/notes.txt", false);
    expect(owner.completeDestination).toHaveBeenCalledWith(owner.attempt, currentPicker.context);
    expect(adapter.mutations.begin).not.toHaveBeenCalled();
  });

  it("completes batch copy and clears selection on success", async () => {
    const adapter = ports();
    const currentPicker = picker({ batch: true, sourceEntries: [entry("a.txt"), entry("b.txt")] });
    const owner = ownership(currentPicker.context);
    await runCopyMoveSubmitOrchestration({
      operation: "copy",
      picker: currentPicker,
      destinationPath: "Archive",
      targets: [
        resolved(entry("a.txt"), "Archive/a.txt"),
        resolved(entry("b.txt"), "Archive/b.txt")
      ],
      skipped: [],
      applySizeRule: true,
      accountName: "Workspace",
      ...owner
    }, adapter);

    expect(adapter.mutations.begin).toHaveBeenCalledTimes(1);
    expect(adapter.mutations.finish).toHaveBeenCalledTimes(1);
    expect(adapter.selection.clear).toHaveBeenCalledTimes(1);
    expect(adapter.presentation.setStatus).toHaveBeenCalledWith("Copied 2 selected items to /Archive in Workspace.");
  });

  it("retains failed batch entries and keeps the picker on partial outcomes", async () => {
    const attemptedSources: string[] = [];
    const adapter = ports({
      batch: {
        executeCopyMoveTarget: vi.fn(async (_operation: "copy" | "move", sourcePath: string): Promise<TargetExecutionResult> => {
          attemptedSources.push(sourcePath);
          return sourcePath === "b.txt" || sourcePath === "c.txt"
            ? { kind: "failed", message: "failed" }
            : { kind: "completed" };
        }),
        listChildren: vi.fn(async () => ({ kind: "completed", entries: [] } as const)),
        deleteFolder: vi.fn(async () => ({ kind: "completed" } as const)),
        refreshFolder: vi.fn(async () => ({ kind: "completed" } as const))
      }
    });
    const currentPicker = picker({
      batch: true,
      sourceEntries: [entry("a.txt"), entry("b.txt"), entry("c.txt")]
    });

    const owner = ownership(currentPicker.context);
    await runCopyMoveSubmitOrchestration({
      operation: "copy",
      picker: currentPicker,
      destinationPath: "Archive",
      targets: [
        resolved(entry("a.txt"), "Archive/a.txt"),
        resolved(entry("b.txt"), "Archive/b.txt"),
        resolved(entry("c.txt"), "Archive/c.txt")
      ],
      skipped: [],
      applySizeRule: true,
      accountName: "Workspace",
      ...owner
    }, adapter);

    expect(adapter.selection.retainFailedPaths).toHaveBeenCalledWith(["b.txt", "c.txt"]);
    expect(adapter.destinationPicker.closeIfCurrent).not.toHaveBeenCalled();
    expect(owner.reportPartial).toHaveBeenCalledWith(
      owner.attempt,
      expect.stringContaining("Copied 1 of 3 selected items; 2 failed."),
      [expect.objectContaining({ path: "b.txt" }), expect.objectContaining({ path: "c.txt" })]
    );
    expect(attemptedSources).toEqual(["a.txt", "b.txt", "c.txt"]);

    const retryPicker = picker({ batch: true, sourceEntries: [entry("b.txt"), entry("c.txt")] });
    const retryOwner = ownership(retryPicker.context);
    const originalExecute = vi.mocked(adapter.batch.executeCopyMoveTarget);
    originalExecute.mockImplementation(async (_operation, sourcePath, _destinationPath) => {
      attemptedSources.push(sourcePath);
      return { kind: "completed" };
    });
    attemptedSources.length = 0;
    await runCopyMoveSubmitOrchestration({
      operation: "copy",
      picker: retryPicker,
      destinationPath: "Archive",
      targets: [
        resolved(entry("b.txt"), "Archive/b.txt"),
        resolved(entry("c.txt"), "Archive/c.txt")
      ],
      skipped: [],
      applySizeRule: true,
      accountName: "Workspace",
      ...retryOwner
    }, adapter);

    expect(adapter.batch.executeCopyMoveTarget).toHaveBeenNthCalledWith(
      4,
      "copy",
      "b.txt",
      "Archive/b.txt",
      false,
      retryPicker.context,
      { kind: "copy", count: 2 },
      expect.any(Function)
    );
    expect(adapter.batch.executeCopyMoveTarget).toHaveBeenLastCalledWith(
      "copy",
      "c.txt",
      "Archive/c.txt",
      false,
      retryPicker.context,
      { kind: "copy", count: 2 },
      expect.any(Function)
    );
    expect(attemptedSources).toEqual(["b.txt", "c.txt"]);
  });

  it("no-ops superseded batch outcomes", async () => {
    const adapter = ports({
      batch: {
        executeCopyMoveTarget: vi.fn(async () => ({ kind: "completed" } as const)),
        listChildren: vi.fn(async () => ({ kind: "completed", entries: [] } as const)),
        deleteFolder: vi.fn(async () => ({ kind: "completed" } as const)),
        refreshFolder: vi.fn(async () => ({ kind: "completed" } as const))
      }
    });
    adapter.setContextAllowed(false);

    const currentPicker = picker({ batch: true, sourceEntries: [entry("a.txt")] });
    await runCopyMoveSubmitOrchestration({
      operation: "copy",
      picker: currentPicker,
      destinationPath: "Archive",
      targets: [resolved(entry("a.txt"), "Archive/a.txt")],
      skipped: [],
      applySizeRule: true,
      accountName: "Workspace",
      ...ownership(currentPicker.context)
    }, adapter);

    expect(adapter.selection.clear).not.toHaveBeenCalled();
    expect(adapter.destinationPicker.closeIfCurrent).not.toHaveBeenCalled();
  });

  it("closes the picker on session termination only when still current", async () => {
    const adapter = ports({
      batch: {
        executeCopyMoveTarget: vi.fn(async () => ({ kind: "sessionTerminated" } as const)),
        listChildren: vi.fn(async () => ({ kind: "completed", entries: [] } as const)),
        deleteFolder: vi.fn(async () => ({ kind: "completed" } as const)),
        refreshFolder: vi.fn(async () => ({ kind: "completed" } as const))
      }
    });
    const currentPicker = picker({ batch: true, sourceEntries: [entry("a.txt")] });

    const owner = ownership(currentPicker.context);
    await runCopyMoveSubmitOrchestration({
      operation: "copy",
      picker: currentPicker,
      destinationPath: "Archive",
      targets: [resolved(entry("a.txt"), "Archive/a.txt")],
      skipped: [],
      applySizeRule: true,
      accountName: "Workspace",
      ...owner
    }, adapter);

    expect(adapter.destinationPicker.closeIfCurrent).toHaveBeenCalledWith(currentPicker.context);
  });

  it("surfaces single-item errors without swallowing unauthorized failures", async () => {
    const adapter = ports({
      mutation: {
        execute: vi.fn(async () => {
          throw new Error("ordinary failure");
        })
      }
    });

    const currentPicker = picker({ kind: "move" });
    const owner = ownership(currentPicker.context);
    await runCopyMoveSubmitOrchestration({
      operation: "move",
      picker: currentPicker,
      destinationPath: "Archive/notes.txt",
      targets: [resolved(entry("notes.txt"), "Archive/notes.txt")],
      skipped: [],
      applySizeRule: true,
      accountName: "Workspace",
      ...owner
    }, adapter);

    expect(owner.failAttempt).toHaveBeenCalledWith(owner.attempt, "ordinary failure");
  });

  it("does not set action errors for unauthorized single-item failures", async () => {
    const adapter = ports({
      mutation: {
        execute: vi.fn(async () => {
          throw new ApiRequestError("token-alpha", 401, "session_invalid");
        })
      }
    });

    const currentPicker = picker();
    const owner = ownership(currentPicker.context);
    await runCopyMoveSubmitOrchestration({
      operation: "copy",
      picker: currentPicker,
      destinationPath: "Archive/notes.txt",
      targets: [resolved(entry("notes.txt"), "Archive/notes.txt")],
      skipped: [],
      applySizeRule: true,
      accountName: "Workspace",
      ...owner
    }, adapter);

    expect(adapter.presentation.setActionError).not.toHaveBeenCalled();
    expect(adapter.presentation.setStatus).not.toHaveBeenCalledWith(expect.stringContaining("token-alpha"));
    expect(owner.failAttempt).not.toHaveBeenCalled();
  });
});
