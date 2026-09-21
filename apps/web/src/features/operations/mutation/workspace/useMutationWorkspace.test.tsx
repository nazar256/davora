import type { FileEntry, MutationResult } from "@davora/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useActionDialog, type UseActionDialogInput } from "../../delete";
import { useDestinationPicker, type UseDestinationPickerInput } from "../../destination";
import { useCopyMove, type UseCopyMoveInput } from "../../copyMove";
import type { FocusedSelectionCapture } from "../../selection";
import {
  createOperationContextToken,
  type OperationContextToken,
  type OperationEnvironment,
  type OperationIntent
} from "../../policy";
import { useMutationWorkflow, type UseMutationWorkflowInput } from "../useMutationWorkflow";
import { useMutationWorkflowLifecycle, type UseMutationWorkflowLifecycleInput } from "../useMutationWorkflowLifecycle";
import { initialMutationWorkflowState, mutationWorkflowReducer } from "../model";
import type { MutationWorkflowOrchestrationPorts } from "../createMutationWorkflowPorts";
import { buildCreateFolderActionDialogState } from "../../delete";
import { buildMovePickerInitialState } from "../../copyMove/model";
import {
  useMutationWorkspace,
  type MutationWorkspaceBridge,
  type MutationWorkspaceInput
} from "./index";

const mockedChildren = vi.hoisted<{
  lifecycle: ReturnType<typeof vi.fn<(input: UseMutationWorkflowLifecycleInput) => LifecycleChild>>;
  destination: ReturnType<typeof vi.fn<(input: UseDestinationPickerInput) => DestinationChild>>;
  workflow: ReturnType<typeof vi.fn<(input: UseMutationWorkflowInput) => WorkflowChild>>;
  actionDialog: ReturnType<typeof vi.fn<(input: UseActionDialogInput) => ActionChild>>;
  copyMove: ReturnType<typeof vi.fn<(input: UseCopyMoveInput) => CopyMoveChild>>;
  copyMoveTasks: ReturnType<typeof vi.fn<() => CopyMoveTaskRunnerChild>>;
}>(() => ({
  lifecycle: vi.fn<(input: UseMutationWorkflowLifecycleInput) => LifecycleChild>(),
  destination: vi.fn<(input: UseDestinationPickerInput) => DestinationChild>(),
  workflow: vi.fn<(input: UseMutationWorkflowInput) => WorkflowChild>(),
  actionDialog: vi.fn<(input: UseActionDialogInput) => ActionChild>(),
  copyMove: vi.fn<(input: UseCopyMoveInput) => CopyMoveChild>(),
  copyMoveTasks: vi.fn<() => CopyMoveTaskRunnerChild>()
}));

vi.mock("../useMutationWorkflowLifecycle", () => ({
  useMutationWorkflowLifecycle: mockedChildren.lifecycle
}));
vi.mock("../../destination", () => ({
  useDestinationPicker: mockedChildren.destination
}));
vi.mock("../useMutationWorkflow", () => ({
  useMutationWorkflow: mockedChildren.workflow
}));
vi.mock("../../delete", async () => {
  const actual = await vi.importActual<typeof import("../../delete")>("../../delete");
  return { ...actual, useActionDialog: mockedChildren.actionDialog };
});
vi.mock("../../copyMove", async () => {
  const actual = await vi.importActual<typeof import("../../copyMove")>("../../copyMove");
  return { ...actual, useCopyMove: mockedChildren.copyMove, useCopyMoveTaskRunner: mockedChildren.copyMoveTasks };
});

type LifecycleChild = Pick<
  ReturnType<typeof useMutationWorkflowLifecycle>,
  "state" | "currentActionDialog" | "currentDestinationPicker" |
  "setDestinationPicker" | "setPresentationError" | "hasSurface" | "dismissCurrent" |
  "beginAttempt" | "isAttemptCurrent" | "failAttempt" | "reportPartial" |
  "reportDeletePartial" | "completeActionDialog" | "completeDestination" |
  "getActiveDeleteWorkflowId" | "updateDeleteWorkflow"
> & {
  setActionDialog: ReturnType<typeof vi.fn<
    (updater: Parameters<ReturnType<typeof useMutationWorkflowLifecycle>["setActionDialog"]>[0]) => void
  >>;
};

type DestinationChild = Pick<
  ReturnType<typeof useDestinationPicker>,
  "destinationPicker" | "currentDestinationPicker" | "setDestinationPicker" | "close" |
  "closeIfCurrent" | "updateFolder" | "updateName" |
  "updateManualMode" | "updateManualPath" | "reload" | "getValidation"
>;

type WorkflowChild = Pick<
  ReturnType<typeof useMutationWorkflow>,
  "mutationBusy" | "beginMutation" | "finishMutation" | "executeMutation" |
  "syncSelectionWithMutation" | "orchestrationPorts"
>;

type ActionChild = ReturnType<typeof useActionDialog>;
type CopyMoveChild = ReturnType<typeof useCopyMove>;
type CopyMoveTaskRunnerChild = ReturnType<typeof import("../../copyMove/tasks").useCopyMoveTaskRunner>;

type InputCall<T> = {
  readonly mock: {
    readonly lastCall: readonly [T] | undefined;
  };
};

function lastCallInput<T>(mock: InputCall<T>): T {
  const call = mock.mock.lastCall;
  if (!call) throw new Error("Expected child hook to have been called");
  return call[0];
}

function entry(path: string, isFolder = false): FileEntry {
  return { path, name: path.split("/").at(-1) ?? path, isFolder, size: 1 };
}

interface ContextOverrides {
  readonly accountId?: string;
  readonly accountName?: string;
  readonly token?: string;
  readonly cacheOnlyMode?: boolean;
  readonly offline?: boolean;
  readonly operationMode?: "online" | "browser-offline" | "server-unavailable" | "explicit-offline";
  readonly currentPath?: string;
  readonly operationContextToken?: OperationContextToken;
}

function createContext(overrides: ContextOverrides = {}): MutationWorkspaceInput["context"] {
  return {
    accountId: "alpha",
    accountName: "Alpha workspace",
    token: "token-alpha",
    cacheOnlyMode: false,
    offline: false,
    operationMode: "online",
    currentPath: "Projects",
    operationContextToken: createOperationContextToken(),
    isCurrentOperationHandler: vi.fn(() => true),
    hasSession: vi.fn(() => true),
    isCurrentOperationContext: vi.fn(() => true),
    currentFocusedSelection: entry("Projects/photo.png"),
    batchSelectionEntries: [entry("Projects/photo.png"), entry("Projects/notes.txt")],
    ...overrides
  };
}

function createPolicy(mode: OperationEnvironment["mode"] = "online"): MutationWorkspaceInput["policy"] {
  const environment: OperationEnvironment = {
    mode,
    hasSession: true,
    capabilities: {
      backend: "mock",
      readOnly: false,
      search: true,
      preview: true,
      download: true,
      offlineCache: true,
      createFolder: true,
      upload: true,
      move: true,
      copy: true,
      delete: true,
      mediaPreview: true,
      markdownPreview: true,
      openedFileCache: true
    }
  };
  return {
    environment,
    isOperationAllowed: vi.fn((_intent: OperationIntent) => true),
    selection: {
      hasSelectedEntry: true,
      selectedFilePath: "Projects/photo.png",
      selectedIsFolder: false,
      batchSelectionCount: 2
    }
  };
}

function createOrchestrationPorts(): MutationWorkflowOrchestrationPorts {
  return {
    upload: {
      registry: { acquire: vi.fn() },
      transfers: {
        createId: vi.fn(),
        enqueue: vi.fn(),
        beginPreparation: vi.fn(),
        reportPreparationProgress: vi.fn(),
        beginTransfer: vi.fn(),
        reportUploadProgress: vi.fn(),
        complete: vi.fn(),
        failActive: vi.fn()
      },
      mutations: {
        begin: vi.fn(),
        finish: vi.fn(),
        createFolder: vi.fn(),
        uploadFile: vi.fn(),
        refreshFolder: vi.fn()
      },
      selection: { syncWithMutation: vi.fn() }
    },
    actionDialogSubmit: {
      context: {
        isCurrentOperationContext: vi.fn(),
        isContextAllowed: vi.fn()
      },
      session: {
        hasSession: vi.fn(),
        isUnauthorized: vi.fn(),
        isReconnectRequired: vi.fn()
      },
      mutations: { begin: vi.fn(), finish: vi.fn() },
      mutation: { execute: vi.fn() },
      api: { createFolder: vi.fn(), deleteFile: vi.fn() },
      batch: {
        executeDeleteTarget: vi.fn(),
        acceptDeleteProgress: vi.fn(),
        refreshFolder: vi.fn(),
        isDeleteWorkflowCurrent: vi.fn()
      }
    },
    copyMoveSubmit: {
      context: {
        isCurrentOperationContext: vi.fn(),
        isContextAllowed: vi.fn()
      }
    },
    copyMoveTasks: {
      registry: { acquire: vi.fn() },
      transfers: {
        createId: vi.fn(() => "transfer-task-1"),
        enqueueCopyMove: vi.fn(),
        beginTransfer: vi.fn(),
        reportItemProgress: vi.fn(),
        reportItemFailure: vi.fn(),
        complete: vi.fn(),
        completePartial: vi.fn(),
        fail: vi.fn(),
        markCanceled: vi.fn()
      },
      batch: {
        executeCopyMoveTarget: vi.fn(),
        listChildren: vi.fn(),
        deleteFolder: vi.fn(),
        refreshFolder: vi.fn()
      },
      folder: { getCurrentPath: vi.fn(() => "Projects") },
      selection: {
        removeDeletedPath: vi.fn(),
        removeDeletedFocusedPath: vi.fn()
      },
      presentation: { setStatus: vi.fn() },
      labels: { toDisplayPath: vi.fn((path: string) => path) },
      context: {
        getOperationContextToken: vi.fn(() => createOperationContextToken()),
        getAccountId: vi.fn(() => "alpha")
      },
      wait: vi.fn(async () => {}),
      createAbortHandle: vi.fn(() => {
        const controller = new AbortController();
        return { signal: controller.signal, abort: () => controller.abort() };
      })
    }
  };
}

function createWorkflowPorts() {
  return {
    api: {
      createFolder: vi.fn(async () => ({
        action: "createFolder",
        parentPath: "Projects",
        path: "Projects/New"
      } satisfies MutationResult)),
      deleteFile: vi.fn(async () => ({
        action: "delete",
        parentPath: "Projects",
        path: "Projects/photo.png"
      } satisfies MutationResult)),
      uploadFileWithProgress: vi.fn(async () => ({
        action: "upload",
        parentPath: "Projects",
        path: "Projects/upload.txt",
        item: entry("Projects/upload.txt")
      } satisfies MutationResult)),
      runCopyOrMove: vi.fn(async () => ({
        action: "copy",
        parentPath: "Projects",
        path: "Projects/photo.png",
        destinationPath: "Archive/photo.png"
      } satisfies MutationResult)),
      listChildren: vi.fn(async () => ({ items: [] }))
    },
    refresh: {
      getCurrentPath: vi.fn(() => "Projects"),
      setCurrentPath: vi.fn(),
      loadFolder: vi.fn(async () => undefined)
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
    wait: vi.fn(async () => {}),
    createAbortHandle: vi.fn(() => {
      const controller = new AbortController();
      return { signal: controller.signal, abort: () => controller.abort() };
    }),
    session: {
      resetActiveSession: vi.fn()
    },
    deleteWorkflow: {
      getActiveDeleteWorkflowId: vi.fn(),
      isAttemptCurrent: vi.fn(() => true),
      updateDeleteDialog: vi.fn(() => true)
    }
  };
}

function createPorts(): MutationWorkspaceInput["ports"] {
  return {
    workflow: createWorkflowPorts(),
    destination: {
      listing: {
        listFiles: vi.fn(async () => ({ items: [entry("Archive")] })),
        isUnauthorized: vi.fn(() => false),
        isReconnectRequired: vi.fn(() => false)
      },
      session: { resetSession: vi.fn() }
    },
    actionDialog: {
      closeNavigation: vi.fn(),
      closeMobileDetails: vi.fn(),
      pushActionSurface: vi.fn(),
      showMobileActions: vi.fn()
    },
    copyMove: {
      closeMobileDetails: vi.fn(),
      pushActionSurface: vi.fn(),
      showMobileActions: vi.fn()
    },
    selection: {
      clear: vi.fn(),
      currentFocusedSelection: vi.fn(),
      captureFocusedSelection: vi.fn<() => FocusedSelectionCapture | undefined>(),
      isFocusedSelectionCurrent: vi.fn(),
      selectFocused: vi.fn(),
      clearFocused: vi.fn(),
      clearFocusedIfCurrent: vi.fn(),
      rebindFocusedIfCurrent: vi.fn(),
      removeDeletedFocused: vi.fn(),
      getSelectedPreview: vi.fn(),
      batchSelection: {
        removeDeleted: vi.fn(),
        rebind: vi.fn(),
        retain: vi.fn(),
        clear: vi.fn()
      },
      setSelectedPreview: vi.fn(),
      closePreview: vi.fn()
    },
    navigation: {
      closeNavigation: vi.fn(),
      closeMobileDetails: vi.fn(),
      openMobileDetails: vi.fn(),
      pushActionSurface: vi.fn(),
      showMobileActions: vi.fn(),
      isNarrowScreen: false
    },
    presentation: {
      clearListError: vi.fn(),
      setActionError: vi.fn(),
      setStatus: vi.fn(),
      getAccountName: vi.fn(() => "Alpha workspace"),
      toDisplayPath: vi.fn((path: string) => path)
    }
  };
}

function createChildren(inputContext: OperationContextToken, surface: "action" | "destination" = "destination") {
  const order: string[] = [];
  const actionDialog = buildCreateFolderActionDialogState(inputContext, "New folder");
  const picker = buildMovePickerInitialState(inputContext, entry("Projects/photo.png"));
  const state = surface === "action"
    ? mutationWorkflowReducer(initialMutationWorkflowState, {
      kind: "open", identity: 1, draft: { kind: "action", dialog: actionDialog }
    })
    : mutationWorkflowReducer(initialMutationWorkflowState, {
      kind: "open", identity: 1, draft: { kind: "destination", picker }
    });
  const lifecycle: LifecycleChild = {
    state,
    currentActionDialog: surface === "action" ? actionDialog : undefined,
    currentDestinationPicker: surface === "destination" ? picker : undefined,
    setActionDialog: vi.fn(),
    setDestinationPicker: vi.fn(),
    setPresentationError: vi.fn(),
    hasSurface: vi.fn(() => true),
    dismissCurrent: vi.fn(() => order.push("action-dismiss")),
    beginAttempt: vi.fn(),
    isAttemptCurrent: vi.fn(() => true),
    failAttempt: vi.fn(),
    reportPartial: vi.fn(),
    reportDeletePartial: vi.fn(),
    completeActionDialog: vi.fn(() => true),
    completeDestination: vi.fn(() => true),
    getActiveDeleteWorkflowId: vi.fn(),
    updateDeleteWorkflow: vi.fn(() => true)
  };
  const destination: DestinationChild = {
    destinationPicker: surface === "destination" ? picker : undefined,
    currentDestinationPicker: surface === "destination" ? picker : undefined,
    setDestinationPicker: vi.fn(),
    close: vi.fn(() => order.push("destination-close")),
    closeIfCurrent: vi.fn(),
    updateFolder: vi.fn(),
    updateName: vi.fn(),
    updateManualMode: vi.fn(),
    updateManualPath: vi.fn(),
    reload: vi.fn(),
    getValidation: vi.fn(() => ({ kind: "valid" as const, destinationPath: "Archive", targets: [], conflicts: [] }))
  };
  const workflow: WorkflowChild = {
    mutationBusy: true,
    beginMutation: vi.fn(),
    finishMutation: vi.fn(),
    executeMutation: vi.fn(),
    syncSelectionWithMutation: vi.fn(),
    orchestrationPorts: createOrchestrationPorts()
  };
  const action: ActionChild = {
    openCreateFolder: vi.fn(),
    openDelete: vi.fn(),
    openDeleteSelection: vi.fn(),
    submitActionDialog: vi.fn()
  };
  const copyMove: CopyMoveChild = {
    openMove: vi.fn(),
    openCopyMove: vi.fn(),
    openCopyMoveSelection: vi.fn(),
    submitDestinationPicker: vi.fn(),
    updateConflictDecision: vi.fn(),
    applyConflictDecisionToAll: vi.fn(),
    updateConflictApplySizeRule: vi.fn(),
    dismissConflictReview: vi.fn(),
    confirmConflictReview: vi.fn(async () => {})
  };
  const copyMoveTasks: CopyMoveTaskRunnerChild = {
    enqueue: vi.fn(() => "copy-move-task-1"),
    cancelTask: vi.fn(),
    retryTask: vi.fn()
  };
  mockedChildren.lifecycle.mockReturnValue(lifecycle);
  mockedChildren.destination.mockReturnValue(destination);
  mockedChildren.workflow.mockReturnValue(workflow);
  mockedChildren.actionDialog.mockReturnValue(action);
  mockedChildren.copyMove.mockReturnValue(copyMove);
  mockedChildren.copyMoveTasks.mockReturnValue(copyMoveTasks);
  return { order, lifecycle, destination, workflow, action, copyMove, copyMoveTasks, actionDialog, picker };
}

interface InputOverrides {
  readonly context?: MutationWorkspaceInput["context"];
  readonly policy?: MutationWorkspaceInput["policy"];
  readonly ports?: MutationWorkspaceInput["ports"];
}

function createInput(overrides: InputOverrides = {}): MutationWorkspaceInput {
  return {
    context: createContext(),
    policy: createPolicy(),
    ports: createPorts(),
    ...overrides
  };
}

describe("useMutationWorkspace", () => {
  it("projects mutually exclusive tagged action and destination surfaces", () => {
    const actionInput = createInput();
    const actionChildren = createChildren(actionInput.context.operationContextToken, "action");
    const action = renderHook(() => useMutationWorkspace(actionInput));
    expect(action.result.current.state.surface).toEqual({ kind: "action" });
    expect(action.result.current.state.actionDialog).toBe(actionChildren.actionDialog);
    expect(action.result.current.state).not.toHaveProperty("destinationPicker");

    const destinationInput = createInput();
    createChildren(destinationInput.context.operationContextToken, "destination");
    const destination = renderHook(() => useMutationWorkspace(destinationInput));
    expect(destination.result.current.state.surface).toEqual({ kind: "destination" });
    expect(destination.result.current.state).not.toHaveProperty("actionDialog");
  });

  it("dismisses destination before action once and is idempotent", () => {
    const input = createInput();
    const children = createChildren(input.context.operationContextToken, "destination");
    const { result } = renderHook(() => useMutationWorkspace(input));

    act(() => {
      result.current.bridge.dismiss();
      result.current.bridge.dismiss();
    });

    expect(children.order).toEqual(["destination-close", "action-dismiss"]);
    expect(children.destination.close).toHaveBeenCalledTimes(1);
    expect(children.lifecycle.dismissCurrent).toHaveBeenCalledTimes(1);
    expect(result.current.bridge.snapshot()).toEqual({ action: false, destination: true });
  });

  it("derives destination-aware read-only state without a second surface owner", () => {
    const input = createInput();
    const children = createChildren(input.context.operationContextToken, "destination");
    const { result } = renderHook(() => useMutationWorkspace(input));

    expect(result.current.state).toMatchObject({
      busy: true,
      destinationPicker: children.destination.currentDestinationPicker,
      destinationValidation: { kind: "valid", destinationPath: "Archive" }
    });
    expect(result.current.state).not.toHaveProperty("selection");
    expect(result.current.state).not.toHaveProperty("transfers");
    expect(result.current.state).not.toHaveProperty("navigation");
  });

  it("derives child surface open/state inputs from lifecycle public setters", () => {
    const input = createInput();
    const children = createChildren(input.context.operationContextToken, "action");
    renderHook(() => useMutationWorkspace(input));

    expect(input.ports.actionDialog).not.toHaveProperty("openActionDialog");
    expect(input.ports.copyMove).not.toHaveProperty("openDestinationPicker");
    const actionInput = lastCallInput<UseActionDialogInput>(mockedChildren.actionDialog);
    const destinationInput = lastCallInput<UseDestinationPickerInput>(mockedChildren.destination);
    expect(actionInput.getCurrentActionDialog()).toBe(children.actionDialog);
    expect(actionInput.workflow).toBe(children.lifecycle);
    expect(destinationInput.setDestinationPicker).toBe(children.lifecycle.setDestinationPicker);
    actionInput.ports.opener.openActionDialog(children.actionDialog);
    expect(children.lifecycle.setActionDialog).toHaveBeenCalledWith(children.actionDialog);
  });

  it("keeps mutation presentation errors in lifecycle state instead of folder/list presentation", () => {
    const input = createInput();
    const children = createChildren(input.context.operationContextToken, "action");
    renderHook(() => useMutationWorkspace(input));

    const actionInput = lastCallInput<UseActionDialogInput>(mockedChildren.actionDialog);
    actionInput.ports.submit.presentation.setActionError("Invalid folder name");

    expect(children.lifecycle.setPresentationError).toHaveBeenCalledWith("Invalid folder name");
    expect(input.ports.presentation.setActionError).not.toHaveBeenCalled();
  });

  it("keeps opener error clearing in lifecycle state instead of the App list-error sink", () => {
    const input = createInput();
    const children = createChildren(input.context.operationContextToken, "action");
    renderHook(() => useMutationWorkspace(input));

    const actionInput = lastCallInput<UseActionDialogInput>(mockedChildren.actionDialog);
    actionInput.ports.opener.setActionError(undefined);

    expect(children.lifecycle.setPresentationError).toHaveBeenCalledWith(undefined);
    expect(input.ports.presentation.setActionError).not.toHaveBeenCalled();
  });

  it("forwards one normalized account/token/path/mode context into every child composition input", () => {
    const first = createInput();
    const firstChildren = createChildren(first.context.operationContextToken);
    const { result, rerender } = renderHook(
      (next: MutationWorkspaceInput) => useMutationWorkspace(next),
      { initialProps: first }
    );
    const secondContext = createContext({
      accountId: "beta",
      accountName: "Beta workspace",
      token: "token-beta",
      cacheOnlyMode: true,
      offline: true,
      operationMode: "explicit-offline",
      currentPath: "Archive",
      operationContextToken: createOperationContextToken()
    });
    const second = createInput({ context: secondContext, policy: createPolicy() });
    const secondChildren = createChildren(second.context.operationContextToken);
    rerender(second);

    expect(result.current.state).toMatchObject({ busy: true });
    expect(mockedChildren.lifecycle).toHaveBeenLastCalledWith({
      operationContextToken: secondContext.operationContextToken,
      currentPath: "Archive"
    });
    expect(mockedChildren.destination).toHaveBeenLastCalledWith(expect.objectContaining({
      token: "token-beta",
      cacheOnlyMode: true,
      operationContextToken: secondContext.operationContextToken
    }));
    const workflowInput = lastCallInput<UseMutationWorkflowInput>(mockedChildren.workflow);
    expect(workflowInput.operationContextToken).toBe(secondContext.operationContextToken);
    expect(workflowInput.currentPath).toBe("Archive");
    expect(workflowInput.portsInput.session.getToken()).toBe("token-beta");
    expect(workflowInput.portsInput.environment.isOffline()).toBe(true);
    const actionInput = lastCallInput<UseActionDialogInput>(mockedChildren.actionDialog);
    const copyMoveInput = lastCallInput<UseCopyMoveInput>(mockedChildren.copyMove);
    expect(actionInput.workflow).toBe(secondChildren.lifecycle);
    expect(copyMoveInput.workflow).toBe(secondChildren.lifecycle);
    expect(actionInput.isOperationAllowed).toBe(second.policy.isOperationAllowed);
    expect(copyMoveInput.isOperationAllowed).toBe(second.policy.isOperationAllowed);
    expect(actionInput.currentFocusedSelection()).toEqual(secondContext.currentFocusedSelection);
    expect(copyMoveInput.currentFocusedSelection()).toEqual(secondContext.currentFocusedSelection);
    expect(actionInput.ports.submit).toMatchObject(secondChildren.workflow.orchestrationPorts.actionDialogSubmit);
    expect(copyMoveInput.ports.submit).toMatchObject(secondChildren.workflow.orchestrationPorts.copyMoveSubmit);
    expect(firstChildren.lifecycle.dismissCurrent).not.toHaveBeenCalled();
    expect(secondChildren.lifecycle.dismissCurrent).not.toHaveBeenCalled();
  });

  it("delegates destination updates/reload and create/delete/copy/move commands exactly once", async () => {
    const input = createInput();
    const children = createChildren(input.context.operationContextToken);
    const { result } = renderHook(() => useMutationWorkspace(input));

    act(() => {
      result.current.commands.updateDestinationFolder("Archive");
      result.current.commands.updateDestinationName("renamed.txt");
      result.current.commands.updateDestinationManualMode(true);
      result.current.commands.updateDestinationManualPath("/Archive");
      result.current.commands.reloadDestinationPicker();
      result.current.commands.updateActionValue("Renamed folder");
      result.current.commands.openCreateFolder();
      result.current.commands.openDelete();
      result.current.commands.openDeleteSelection();
      result.current.commands.openMove();
      result.current.commands.openCopyMove();
      result.current.commands.openCopyMoveSelection();
    });
    await act(async () => {
      await result.current.commands.submitActionDialog();
      await result.current.commands.submitDestinationPicker("copy");
    });

    expect(children.destination.updateFolder).toHaveBeenCalledTimes(1);
    expect(children.destination.updateName).toHaveBeenCalledTimes(1);
    expect(children.destination.updateManualMode).toHaveBeenCalledTimes(1);
    expect(children.destination.updateManualPath).toHaveBeenCalledTimes(1);
    expect(children.destination.reload).toHaveBeenCalledTimes(1);
    expect(children.lifecycle.setActionDialog).toHaveBeenCalledTimes(1);
    const actionValueUpdater = children.lifecycle.setActionDialog.mock.calls[0]?.[0];
    if (typeof actionValueUpdater !== "function") throw new Error("Expected action dialog updater");
    expect(actionValueUpdater(children.actionDialog)).toMatchObject({ value: "Renamed folder" });
    expect(children.action.openCreateFolder).toHaveBeenCalledTimes(1);
    expect(children.action.openDelete).toHaveBeenCalledTimes(1);
    expect(children.action.openDeleteSelection).toHaveBeenCalledTimes(1);
    expect(children.action.submitActionDialog).toHaveBeenCalledTimes(1);
    expect(children.copyMove.openMove).toHaveBeenCalledTimes(1);
    expect(children.copyMove.openCopyMove).toHaveBeenCalledTimes(1);
    expect(children.copyMove.openCopyMoveSelection).toHaveBeenCalledTimes(1);
    expect(children.copyMove.submitDestinationPicker).toHaveBeenCalledTimes(1);
  });

  it("keeps the bridge narrow, stable, and free of workflow data", () => {
    const input = createInput();
    const firstChildren = createChildren(input.context.operationContextToken, "destination");
    const { result, rerender } = renderHook(
      (next: MutationWorkspaceInput) => useMutationWorkspace(next),
      { initialProps: input }
    );
    const bridge: MutationWorkspaceBridge = result.current.bridge;
    const replacement = createInput({ context: createContext({ currentPath: "Archive" }) });
    const replacementChildren = createChildren(replacement.context.operationContextToken, "destination");
    rerender(replacement);

    expect(result.current.bridge).toBe(bridge);
    expect(Object.keys(bridge).sort()).toEqual(["dismiss", "snapshot"]);
    expect(bridge.snapshot()).toEqual({ action: false, destination: true });
    expect(bridge.snapshot()).not.toHaveProperty("token");
    expect(bridge.snapshot()).not.toHaveProperty("error");
    expect(bridge.snapshot()).not.toHaveProperty("payload");
    expect(bridge.snapshot()).not.toHaveProperty("workflow");
    act(() => bridge.dismiss());
    expect(firstChildren.destination.close).not.toHaveBeenCalled();
    expect(replacementChildren.destination.close).toHaveBeenCalledTimes(1);
  });

  it("makes a same-account session replacement current and makes the old bridge callback target the replacement", () => {
    const first = createInput();
    const firstChildren = createChildren(first.context.operationContextToken);
    const { result, rerender } = renderHook(
      (next: MutationWorkspaceInput) => useMutationWorkspace(next),
      { initialProps: first }
    );
    const oldDismiss = result.current.bridge.dismiss;
    const secondContext = createContext({
      token: "token-replaced",
      operationContextToken: createOperationContextToken()
    });
    const second = createInput({ context: secondContext });
    const secondChildren = createChildren(second.context.operationContextToken);
    rerender(second);

    expect(mockedChildren.lifecycle).toHaveBeenLastCalledWith({
      operationContextToken: secondContext.operationContextToken,
      currentPath: secondContext.currentPath
    });
    expect(mockedChildren.destination).toHaveBeenLastCalledWith(expect.objectContaining({
      token: "token-replaced",
      operationContextToken: secondContext.operationContextToken
    }));
    const actionInput = lastCallInput<UseActionDialogInput>(mockedChildren.actionDialog);
    const copyMoveInput = lastCallInput<UseCopyMoveInput>(mockedChildren.copyMove);
    expect(actionInput.workflow).toBe(secondChildren.lifecycle);
    expect(copyMoveInput.workflow).toBe(secondChildren.lifecycle);
    expect(actionInput.isCurrentOperationHandler).toBe(secondContext.isCurrentOperationHandler);
    expect(copyMoveInput.isCurrentOperationHandler).toBe(secondContext.isCurrentOperationHandler);
    expect(actionInput.isOperationAllowed).toBe(second.policy.isOperationAllowed);
    expect(copyMoveInput.isOperationAllowed).toBe(second.policy.isOperationAllowed);
    expect(actionInput.ports.submit).toMatchObject(secondChildren.workflow.orchestrationPorts.actionDialogSubmit);
    expect(copyMoveInput.ports.submit).toMatchObject(secondChildren.workflow.orchestrationPorts.copyMoveSubmit);
    act(() => oldDismiss());
    expect(firstChildren.destination.close).not.toHaveBeenCalled();
    expect(firstChildren.lifecycle.dismissCurrent).not.toHaveBeenCalled();
    expect(secondChildren.destination.close).toHaveBeenCalledTimes(1);
    expect(secondChildren.lifecycle.dismissCurrent).toHaveBeenCalledTimes(1);
  });

  it("dispatches a stale explicit-offline callback to the latest owner", () => {
    const first = createInput();
    const firstChildren = createChildren(first.context.operationContextToken);
    const { result, rerender } = renderHook(
      (next: MutationWorkspaceInput) => useMutationWorkspace(next),
      { initialProps: first }
    );
    const oldDismiss = result.current.bridge.dismiss;
    const secondContext = createContext({
      token: "token-alpha",
      cacheOnlyMode: true,
      offline: true,
      operationMode: "explicit-offline",
      operationContextToken: createOperationContextToken()
    });
    const second = createInput({ context: secondContext, policy: createPolicy("explicit-offline") });
    const secondChildren = createChildren(second.context.operationContextToken);
    rerender(second);

    expect(mockedChildren.destination).toHaveBeenLastCalledWith(expect.objectContaining({
      cacheOnlyMode: true,
      token: "token-alpha",
      operationContextToken: secondContext.operationContextToken
    }));
    const actionInput = lastCallInput<UseActionDialogInput>(mockedChildren.actionDialog);
    const copyMoveInput = lastCallInput<UseCopyMoveInput>(mockedChildren.copyMove);
    expect(actionInput.workflow).toBe(secondChildren.lifecycle);
    expect(copyMoveInput.workflow).toBe(secondChildren.lifecycle);
    expect(actionInput.isOperationAllowed).toBe(second.policy.isOperationAllowed);
    expect(copyMoveInput.isOperationAllowed).toBe(second.policy.isOperationAllowed);
    expect(actionInput.ports.submit).toMatchObject(secondChildren.workflow.orchestrationPorts.actionDialogSubmit);
    expect(copyMoveInput.ports.submit).toMatchObject(secondChildren.workflow.orchestrationPorts.copyMoveSubmit);
    const workflowInput = lastCallInput<UseMutationWorkflowInput>(mockedChildren.workflow);
    expect(workflowInput.portsInput.environment.isOffline()).toBe(true);
    act(() => oldDismiss());
    expect(firstChildren.destination.close).not.toHaveBeenCalled();
    expect(secondChildren.destination.close).toHaveBeenCalledTimes(1);
    expect(secondChildren.lifecycle.dismissCurrent).toHaveBeenCalledTimes(1);
  });
});
