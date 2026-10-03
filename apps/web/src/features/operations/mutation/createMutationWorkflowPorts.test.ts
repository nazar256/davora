import type { FileEntry } from "@davora/shared";
import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../../../lib/api";
import { createOperationContextToken } from "../policy";
import { createBatchDeleteWorkflow } from "../delete/model";
import {
  createMutationOrchestrationPorts,
  createMutationRunnerPorts,
  type CreateMutationWorkflowPortsInput
} from "./createMutationWorkflowPorts";
import { issueMutationAttemptToken } from "./attempt";

function entry(path: string): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false };
}

function createInput(overrides: Partial<CreateMutationWorkflowPortsInput> = {}): CreateMutationWorkflowPortsInput {
  return {
    session: {
      getToken: vi.fn(() => "token"),
      hasActiveAccount: vi.fn(() => true),
      resetActiveSession: vi.fn()
    },
    environment: {
      isCacheOnlyBlocked: vi.fn(() => false),
      isOffline: vi.fn(() => false)
    },
    context: {
      getOperationContextToken: vi.fn(() => createOperationContextToken()),
      getAccountId: vi.fn(() => "account-1"),
      isOperationContextAllowed: vi.fn(() => true),
      isCurrentOperationContext: vi.fn(() => true)
    },
    folder: {
      getCurrentPath: vi.fn(() => ""),
      setCurrentPath: vi.fn(),
      loadFolder: vi.fn(async () => undefined)
    },
    selection: {
      currentFocusedSelection: vi.fn(() => undefined),
      captureFocusedSelection: vi.fn(() => undefined),
      isFocusedSelectionCurrent: vi.fn(() => true),
      getSelectedPreview: vi.fn(() => undefined),
      batchSelection: {
        removeDeleted: vi.fn(),
        rebind: vi.fn(),
        retain: vi.fn(),
        clear: vi.fn()
      },
      selectFocused: vi.fn(),
      clearFocused: vi.fn(),
      clearFocusedIfCurrent: vi.fn(),
      rebindFocusedIfCurrent: vi.fn(),
      removeDeletedFocused: vi.fn(),
      setSelectedPreview: vi.fn(),
      closePreview: vi.fn()
    },
    chrome: {
      closeMobileDetails: vi.fn(),
      openMobileDetails: vi.fn(),
      isNarrowScreen: false
    },
    presentation: {
      clearListError: vi.fn(),
      setStatus: vi.fn(),
      getAccountName: vi.fn(() => "Workspace"),
      toDisplayPath: vi.fn((path: string) => path)
    },
    registry: {
      acquire: vi.fn(() => ({
        signal: new AbortController().signal,
        isCurrent: () => true,
        release: vi.fn()
      }))
    },
    transfers: {
      createId: vi.fn(() => "transfer-1"),
      enqueueUpload: vi.fn(),
      enqueueCopyMove: vi.fn(),
      beginPreparation: vi.fn(),
      reportPreparationProgress: vi.fn(),
      beginTransfer: vi.fn(),
      reportUploadProgress: vi.fn(),
      reportItemProgress: vi.fn(),
      reportItemFailure: vi.fn(),
      complete: vi.fn(),
      completePartial: vi.fn(),
      fail: vi.fn(),
      markCanceled: vi.fn(),
      failActive: vi.fn()
    },
    api: {
      createFolder: vi.fn(async () => ({ action: "createFolder" as const, parentPath: "", path: "Plans" })),
      deleteFile: vi.fn(async () => ({ action: "delete" as const, parentPath: "", path: "notes.txt" })),
      uploadFileWithProgress: vi.fn(async () => ({
        action: "upload" as const,
        parentPath: "",
        path: "new.txt",
        item: entry("new.txt")
      })),
      runCopyOrMove: vi.fn(async () => ({
        action: "move" as const,
        parentPath: "",
        path: "a.txt",
        destinationPath: "b.txt"
      })),
      listChildren: vi.fn(async () => ({ completeness: "complete" as const, items: [] }))
    },
    deleteWorkflow: {
      getActiveDeleteWorkflowId: vi.fn(() => createBatchDeleteWorkflow(1, [{ path: "notes.txt", confirmName: "notes.txt" }]).id),
      isAttemptCurrent: vi.fn(() => true),
      updateDeleteDialog: vi.fn(() => true)
    },
    time: { wait: vi.fn(async () => {}) },
    request: {
      createAbortHandle: vi.fn(() => {
        const controller = new AbortController();
        return { signal: controller.signal, abort: () => controller.abort() };
      })
    },
    ...overrides
  };
}

describe("createMutationWorkflowPorts", () => {
  it("wires runner ports with session and selection sync application", () => {
    const input = createInput();
    const ports = createMutationRunnerPorts(input);

    ports.selection.applySelectionSync({ kind: "delete", path: "notes.txt" }, undefined);

    expect(input.selection.batchSelection.removeDeleted).toHaveBeenCalledWith("notes.txt");
    expect(input.selection.removeDeletedFocused).toHaveBeenCalledWith("notes.txt");
    expect(input.chrome.closeMobileDetails).toHaveBeenCalled();
  });

  it("maps upload folder refresh to sessionTerminated", async () => {
    const input = createInput({
      folder: {
        getCurrentPath: vi.fn(() => ""),
        setCurrentPath: vi.fn(),
        loadFolder: vi.fn(async () => "session-terminated" as const)
      }
    });
    const runner = {
      beginMutation: vi.fn(),
      finishMutation: vi.fn(),
      executeMutation: vi.fn(),
      syncSelectionWithMutation: vi.fn()
    };
    const ports = createMutationOrchestrationPorts(input, runner);

    await expect(ports.upload.mutations.refreshFolder("")).resolves.toEqual({ kind: "sessionTerminated" });
  });

  it("rejects batch delete progress when workflow is stale", () => {
    const input = createInput({
      deleteWorkflow: {
        getActiveDeleteWorkflowId: vi.fn(() => createBatchDeleteWorkflow(2, [{ path: "other.txt", confirmName: "other.txt" }]).id),
        isAttemptCurrent: vi.fn(() => true),
        updateDeleteDialog: vi.fn(() => true)
      }
    });
    const syncSelectionWithMutation = vi.fn();
    const ports = createMutationOrchestrationPorts(input, {
      beginMutation: vi.fn(),
      finishMutation: vi.fn(),
      executeMutation: vi.fn(),
      syncSelectionWithMutation
    });
    const context = createOperationContextToken();
    const workflow = createBatchDeleteWorkflow(1, [{ path: "notes.txt", confirmName: "notes.txt" }]);
    const dialog = { kind: "delete" as const, workflow, context };
    const progress = {
      completedTarget: { path: "notes.txt", confirmName: "notes.txt" },
      workflow
    };
    const attempt = issueMutationAttemptToken({ workflowIdentity: 1, context, path: "", pathGeneration: 0,
      ownershipGeneration: 0, mountGeneration: 1, domainIdentity: "delete:1", intent: { kind: "delete", count: 1 } });

    const accepted = ports.actionDialogSubmit.batch.acceptDeleteProgress(
      progress,
      dialog,
      () => true,
      attempt
    );

    expect(accepted).toBe(false);
    expect(syncSelectionWithMutation).not.toHaveBeenCalled();
    expect(input.deleteWorkflow.updateDeleteDialog).not.toHaveBeenCalled();
  });

  it("maps batch delete execution to sessionTerminated on unauthorized errors", async () => {
    const input = createInput({
      api: {
        createFolder: vi.fn(),
        deleteFile: vi.fn(async () => {
          throw new ApiRequestError("expired", 401);
        }),
        uploadFileWithProgress: vi.fn(),
        runCopyOrMove: vi.fn(),
        listChildren: vi.fn()
      }
    });
    const ports = createMutationOrchestrationPorts(input, {
      beginMutation: vi.fn(),
      finishMutation: vi.fn(),
      executeMutation: vi.fn(async () => {
        throw new ApiRequestError("expired", 401);
      }),
      syncSelectionWithMutation: vi.fn()
    });

    await expect(ports.actionDialogSubmit.batch.executeDeleteTarget(
      "notes.txt",
      "notes.txt",
      createOperationContextToken(),
      { kind: "delete", count: 1 },
      () => true
    )).resolves.toEqual({ kind: "sessionTerminated" });
  });

  it("does not reset the replacement session when a superseded task's listChildren gets a 401", async () => {
    const input = createInput({
      context: {
        getOperationContextToken: vi.fn(() => createOperationContextToken()),
        getAccountId: vi.fn(() => "account-1"),
        isOperationContextAllowed: vi.fn(() => true),
        isCurrentOperationContext: vi.fn(() => false)
      },
      api: {
        createFolder: vi.fn(),
        deleteFile: vi.fn(),
        uploadFileWithProgress: vi.fn(),
        runCopyOrMove: vi.fn(),
        listChildren: vi.fn(async () => {
          throw new ApiRequestError("expired", 401);
        })
      }
    });
    const ports = createMutationOrchestrationPorts(input, {
      beginMutation: vi.fn(),
      finishMutation: vi.fn(),
      executeMutation: vi.fn(),
      syncSelectionWithMutation: vi.fn()
    });

    const result = await ports.copyMoveTasks.batch.listChildren("Docs", createOperationContextToken());

    expect(result).toEqual({ kind: "failed", message: "This action was superseded." });
    expect(input.session.resetActiveSession).not.toHaveBeenCalled();
  });

  it("forwards the registry scope signal and request abort handle into copyMove task ports", () => {
    const scopeSignal = new AbortController().signal;
    const input = createInput({
      registry: {
        acquire: vi.fn(() => ({
          signal: scopeSignal,
          isCurrent: () => true,
          release: vi.fn()
        }))
      }
    });
    const ports = createMutationOrchestrationPorts(input, {
      beginMutation: vi.fn(),
      finishMutation: vi.fn(),
      executeMutation: vi.fn(),
      syncSelectionWithMutation: vi.fn()
    });

    const scope = ports.copyMoveTasks.registry.acquire({
      context: createOperationContextToken(),
      intent: { kind: "copy", count: 1 }
    });
    const handle = ports.copyMoveTasks.createAbortHandle();

    expect(scope?.signal).toBe(scopeSignal);
    expect(handle.signal.aborted).toBe(false);
    handle.abort();
    expect(handle.signal.aborted).toBe(true);
  });
});
