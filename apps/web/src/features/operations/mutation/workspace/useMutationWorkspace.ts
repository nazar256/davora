import { useCallback, useMemo, useRef } from "react";

import {
  useActionDialog,
  type ActionDialogPorts
} from "../../delete";
import {
  useDestinationPicker,
} from "../../destination";
import {
  useCopyMove,
  useCopyMoveTaskRunner,
  type CopyMovePorts
} from "../../copyMove";
import {
  useMutationWorkflow
} from "../useMutationWorkflow";
import { useMutationWorkflowLifecycle } from "../useMutationWorkflowLifecycle";
import type { CreateMutationWorkflowPortsInput } from "../createMutationWorkflowPorts";
import {
  type MutationWorkspaceBridge,
  type MutationWorkspaceBridgeSnapshot,
  type MutationWorkspaceCommands,
  type MutationWorkspaceInput,
  type MutationWorkspaceOutput,
  type MutationWorkspacePorts,
  type MutationWorkspaceState
} from "./ports";

function isCurrentContext(
  input: MutationWorkspaceInput,
  context: Parameters<MutationWorkspaceInput["context"]["isCurrentOperationContext"]>[0],
  expected = input.context.operationContextToken
): boolean {
  return input.context.isCurrentOperationContext(context, expected);
}

function createMutationWorkflowPortsInput(
  input: MutationWorkspaceInput,
  ports: MutationWorkspacePorts,
  lifecycle: ReturnType<typeof useMutationWorkflowLifecycle>
): CreateMutationWorkflowPortsInput {
  const selection = ports.selection;
  return {
    session: {
      getToken: () => input.context.token,
      hasActiveAccount: input.context.hasSession,
      resetActiveSession: ports.workflow.session.resetActiveSession
    },
    environment: {
      isCacheOnlyBlocked: () => input.context.cacheOnlyMode,
      isOffline: () => input.context.offline
    },
    context: {
      getOperationContextToken: () => input.context.operationContextToken,
      getAccountId: () => input.context.accountId,
      isOperationContextAllowed: (context, intent) =>
        isCurrentContext(input, context) && input.policy.isOperationAllowed(intent),
      isCurrentOperationContext: (context) => isCurrentContext(input, context)
    },
    folder: {
      getCurrentPath: ports.workflow.refresh.getCurrentPath,
      setCurrentPath: ports.workflow.refresh.setCurrentPath,
      loadFolder: ports.workflow.refresh.loadFolder
    },
    selection: {
      currentFocusedSelection: selection.currentFocusedSelection,
      captureFocusedSelection: selection.captureFocusedSelection,
      isFocusedSelectionCurrent: selection.isFocusedSelectionCurrent,
      getSelectedPreview: selection.getSelectedPreview,
      batchSelection: {
        removeDeleted: selection.batchSelection.removeDeleted,
        rebind: selection.batchSelection.rebind,
        retain: selection.batchSelection.retain,
        clear: selection.batchSelection.clear
      },
      selectFocused: selection.selectFocused,
      clearFocused: selection.clearFocused,
      clearFocusedIfCurrent: selection.clearFocusedIfCurrent,
      rebindFocusedIfCurrent: selection.rebindFocusedIfCurrent,
      removeDeletedFocused: selection.removeDeletedFocused,
      setSelectedPreview: selection.setSelectedPreview,
      closePreview: selection.closePreview
    },
    chrome: ports.navigation,
    presentation: ports.presentation,
    registry: ports.workflow.registry,
    transfers: ports.workflow.transfers,
    api: ports.workflow.api,
    time: { wait: ports.workflow.wait },
    request: { createAbortHandle: ports.workflow.createAbortHandle },
    deleteWorkflow: {
      getActiveDeleteWorkflowId: lifecycle.getActiveDeleteWorkflowId,
      isAttemptCurrent: lifecycle.isAttemptCurrent,
      updateDeleteDialog: lifecycle.updateDeleteWorkflow
    }
  };
}

export function useMutationWorkspace(input: MutationWorkspaceInput): MutationWorkspaceOutput {
  const lifecycle = useMutationWorkflowLifecycle({
    operationContextToken: input.context.operationContextToken,
    currentPath: input.context.currentPath
  });
  const setPresentationError = lifecycle.setPresentationError;
  const setActionDialog = lifecycle.setActionDialog;
  const workflowPortsInput = useMemo(
    () => createMutationWorkflowPortsInput(input, input.ports, lifecycle),
    [input, lifecycle]
  );
  const workflow = useMutationWorkflow({
    operationContextToken: input.context.operationContextToken,
    currentPath: input.context.currentPath,
    portsInput: workflowPortsInput
  });
  const setMutationActionError = useCallback((message: string | undefined) => {
    setPresentationError(message);
  }, [setPresentationError]);
  const destination = useDestinationPicker({
    cacheOnlyMode: input.context.cacheOnlyMode,
    token: input.context.token,
    operationContextToken: input.context.operationContextToken,
    isCurrentOperationContext: (context, expected) => isCurrentContext(input, context, expected),
    onClearActionError: () => setMutationActionError(undefined),
    destinationPicker: lifecycle.currentDestinationPicker,
    setDestinationPicker: lifecycle.setDestinationPicker,
    ports: input.ports.destination
  });

  const actionDialog = useActionDialog({
    isCurrentOperationHandler: input.context.isCurrentOperationHandler,
    hasSession: input.context.hasSession,
    isOperationAllowed: input.policy.isOperationAllowed,
    getOperationContextToken: () => input.context.operationContextToken,
    isCurrentOperationContext: (context) => isCurrentContext(input, context),
    getCurrentActionDialog: () => lifecycle.currentActionDialog,
    currentFocusedSelection: () => input.context.currentFocusedSelection,
    getBatchSelectionEntries: () => input.context.batchSelectionEntries,
    getCurrentPath: () => input.context.currentPath,
    getAccountName: input.ports.presentation.getAccountName,
    workflow: lifecycle,
    ports: {
      opener: {
        ...input.ports.actionDialog,
        setActionError: setMutationActionError,
        openActionDialog: lifecycle.setActionDialog
      },
      submit: {
        ...workflow.orchestrationPorts.actionDialogSubmit,
        selection: { clear: input.ports.selection.clear },
        presentation: {
          setActionError: setMutationActionError,
          setStatus: input.ports.presentation.setStatus,
          closeMobileDetails: input.ports.navigation.closeMobileDetails,
          clearFocused: input.ports.selection.clearFocused
        },
        labels: { toDisplayPath: input.ports.presentation.toDisplayPath }
      }
    } satisfies ActionDialogPorts
  });

  const copyMoveTasks = useCopyMoveTaskRunner(workflow.orchestrationPorts.copyMoveTasks);
  const copyMove = useCopyMove({
    isCurrentOperationHandler: input.context.isCurrentOperationHandler,
    hasSession: input.context.hasSession,
    isOperationAllowed: input.policy.isOperationAllowed,
    getOperationContextToken: () => input.context.operationContextToken,
    isCurrentOperationContext: (context) => isCurrentContext(input, context),
    getCurrentDestinationPicker: () => lifecycle.currentDestinationPicker,
    setDestinationPicker: lifecycle.setDestinationPicker,
    currentFocusedSelection: () => input.context.currentFocusedSelection,
    getBatchSelectionEntries: () => input.context.batchSelectionEntries,
    getCurrentPath: () => input.context.currentPath,
    getAccountName: input.ports.presentation.getAccountName,
    getAccountId: () => input.context.accountId,
    workflow: lifecycle,
    ports: {
      opener: {
        ...input.ports.copyMove,
        setActionError: setMutationActionError,
        openDestinationPicker: lifecycle.setDestinationPicker
      },
      submit: {
        context: workflow.orchestrationPorts.copyMoveSubmit.context,
        presentation: {
          setActionError: setMutationActionError,
          setStatus: input.ports.presentation.setStatus
        },
        labels: { toDisplayPath: input.ports.presentation.toDisplayPath },
        tasks: { enqueue: copyMoveTasks.enqueue }
      }
    } satisfies CopyMovePorts
  });

  let state: MutationWorkspaceState;
  if (lifecycle.state.kind !== "idle" && lifecycle.state.kind !== "completed"
    && lifecycle.state.draft.kind === "action") {
    state = {
      ...lifecycle.state,
      busy: workflow.mutationBusy,
      surface: { kind: "action" },
      actionDialog: lifecycle.state.draft.dialog
    };
  } else if (lifecycle.state.kind !== "idle" && lifecycle.state.kind !== "completed"
    && lifecycle.state.draft.kind === "destination") {
    state = {
      ...lifecycle.state,
      busy: workflow.mutationBusy,
      surface: { kind: "destination" },
      destinationPicker: lifecycle.state.draft.picker,
      destinationValidation: destination.getValidation()
    };
  } else {
    state = {
      ...lifecycle.state,
      busy: workflow.mutationBusy,
      surface: { kind: "none" }
    };
  }

  const updateActionValue = useCallback((value: string) => {
    setActionDialog((previous) => previous?.kind === "createFolder"
      ? { ...previous, value }
      : previous);
  }, [setActionDialog]);

  const commands: MutationWorkspaceCommands = {
    uploadOrchestration: workflow.orchestrationPorts.upload,
    updateDestinationFolder: destination.updateFolder,
    updateDestinationName: destination.updateName,
    updateDestinationManualMode: destination.updateManualMode,
    updateDestinationManualPath: destination.updateManualPath,
    reloadDestinationPicker: destination.reload,
    updateActionValue,
    openCreateFolder: actionDialog.openCreateFolder,
    openDelete: actionDialog.openDelete,
    openDeleteSelection: actionDialog.openDeleteSelection,
    openMove: copyMove.openMove,
    openCopyMove: copyMove.openCopyMove,
    openCopyMoveSelection: copyMove.openCopyMoveSelection,
    submitActionDialog: actionDialog.submitActionDialog,
    submitDestinationPicker: copyMove.submitDestinationPicker,
    updateConflictDecision: copyMove.updateConflictDecision,
    applyConflictDecisionToAll: copyMove.applyConflictDecisionToAll,
    updateConflictApplySizeRule: copyMove.updateConflictApplySizeRule,
    dismissConflictReview: copyMove.dismissConflictReview,
    confirmConflictReview: copyMove.confirmConflictReview,
    cancelTransferTask: copyMoveTasks.cancelTask,
    retryTransferTask: copyMoveTasks.retryTask
  };

  const currentOwnerRef = useRef<{
    readonly context: MutationWorkspaceInput["context"];
    readonly lifecycle: typeof lifecycle;
    readonly destination: typeof destination;
    readonly path: string;
    readonly identity?: number;
    dismissed: boolean;
  }>();
  const previousOwner = currentOwnerRef.current;
  const ownerIdentity = lifecycle.state.kind === "idle" || lifecycle.state.kind === "completed"
    ? undefined
    : lifecycle.state.identity;
  if (!previousOwner
    || previousOwner.context.operationContextToken !== input.context.operationContextToken
    || previousOwner.path !== input.context.currentPath
    || previousOwner.identity !== ownerIdentity) {
    currentOwnerRef.current = { context: input.context, lifecycle, destination, path: input.context.currentPath, identity: ownerIdentity, dismissed: false };
  } else {
    currentOwnerRef.current = { ...previousOwner, context: input.context, lifecycle, destination, path: input.context.currentPath, identity: ownerIdentity };
  }

  const bridgeRef = useRef<MutationWorkspaceBridge>();
  if (!bridgeRef.current) {
    bridgeRef.current = {
      snapshot: (): MutationWorkspaceBridgeSnapshot => {
        const owner = currentOwnerRef.current;
        return {
          action: Boolean(owner?.lifecycle.currentActionDialog),
          destination: Boolean(owner?.lifecycle.currentDestinationPicker)
        };
      },
      dismiss: () => {
        const owner = currentOwnerRef.current;
        if (!owner || owner.dismissed) return;
        owner.dismissed = true;
        if (owner.lifecycle.currentDestinationPicker) owner.destination.close();
        owner.lifecycle.dismissCurrent();
      }
    };
  }

  return { state, commands, bridge: bridgeRef.current };
}
