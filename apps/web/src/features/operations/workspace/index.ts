import { useMemo } from "react";

import { getViewerKind } from "@davora/shared";

import { projectDeleteDialogCanConfirm, projectOperationRenderCapabilities } from "../policy";
import { useMutationWorkspace } from "../mutation/workspace/useMutationWorkspace";
import { createDownloadWorkspacePorts, useDownloadWorkspace } from "../download/workspace";
import { useUploadInteraction } from "../upload/useUploadInteraction";
import { projectOperationSelectionFacts } from "../selection/workspace/projectSelectionWorkspaceFacts";
import type { MutationWorkspacePorts } from "../mutation/workspace";
import type { OperationExecutionWorkspaceInput, OperationExecutionWorkspaceOutput } from "./ports";

export * from "./ports";
export { useOperationAuthorityWorkspace } from "./useOperationAuthorityWorkspace";

export function useOperationExecutionWorkspace(input: OperationExecutionWorkspaceInput): OperationExecutionWorkspaceOutput {
  const operationContext = input.authority;
  const selectionFacts = projectOperationSelectionFacts({
    focusedEntry: input.selection.focusedEntry,
    selectedPreview: input.selection.selectedPreview,
    batchCount: input.selection.batchSelectionEntries.length
  });
  const mutationWorkspace = useMutationWorkspace({
    context: {
      accountId: input.context.accountId,
      accountName: input.context.accountName,
      token: input.context.token,
      cacheOnlyMode: input.context.cacheOnlyMode,
      offline: input.context.browserOffline,
      operationMode: operationContext.environment.mode,
      currentPath: input.context.currentPath,
      operationContextToken: operationContext.token,
      isCurrentOperationHandler: operationContext.isCurrentOperationHandler,
      hasSession: () => Boolean(input.context.token),
      isCurrentOperationContext: (context, expected) => operationContext.isCurrentOperationContext(context, expected),
      currentFocusedSelection: input.selection.focusedEntry,
      batchSelectionEntries: input.selection.batchSelectionEntries
    },
    policy: {
      environment: operationContext.environment,
      isOperationAllowed: operationContext.isOperationAllowed,
      selection: { ...selectionFacts, batchSelectionCount: input.selection.batchSelectionEntries.length }
    },
    ports: {
      workflow: {
        session: input.coordination.session,
        refresh: input.coordination.refresh,
        wait: input.runtime.time.wait,
        createAbortHandle: input.runtime.request.createAbortHandle,
        registry: {
          acquire: ({ context, basePath, intent }) => {
            const scope = operationContext.registry.acquire({
              context,
              intent,
              ...(basePath === undefined ? {} : { path: basePath, ownership: { checkPath: basePath } }),
              rejectUnlessImmediateOwner: true
            });
            return scope ? { signal: scope.signal, isCurrent: scope.isCurrent, release: scope.release } : undefined;
          }
        },
        transfers: {
          createId: input.runtime.request.createTransferId,
          enqueueUpload: ({ id, accountId, label, totalBytes }) => input.coordination.transfers.enqueue({ id, accountId, kind: "upload", label, loadedBytes: 0, totalBytes }),
          enqueueCopyMove: ({ id, accountId, kind, label, totalItems }) => input.coordination.transfers.enqueue({ id, accountId, kind, label, loadedBytes: 0, totalItems }),
          beginPreparation: (id, totalBytes) => input.coordination.transfers.beginPreparation(id, { loadedBytes: 0, totalBytes }),
          reportPreparationProgress: (id, loadedBytes, totalBytes) => input.coordination.transfers.reportProgress(id, "preparing", loadedBytes, totalBytes),
          beginTransfer: (id) => input.coordination.transfers.beginTransfer(id, { loadedBytes: 0, totalBytes: null }),
          reportUploadProgress: (id, loadedBytes, totalBytes) => input.coordination.transfers.reportProgress(id, "transferring", loadedBytes, totalBytes),
          reportItemProgress: input.coordination.transfers.reportItemProgress,
          reportItemFailure: input.coordination.transfers.reportFailure,
          complete: input.coordination.transfers.complete,
          completePartial: input.coordination.transfers.completePartial,
          fail: input.coordination.transfers.fail,
          markCanceled: input.coordination.transfers.markCanceled,
          failActive: input.coordination.transfers.failActiveTasks
        },
        api: {
          createFolder: input.runtime.mutation.createFolder,
          deleteFile: input.runtime.mutation.deleteFile,
          uploadFileWithProgress: input.runtime.mutation.uploadFile,
          runCopyOrMove: (operation, source, destination, token, overwrite) => input.runtime.mutation.copyOrMove(operation, source, destination, token, overwrite),
          listChildren: (path, token) => input.runtime.mutation.listDestination(path, token)
        }
      },
      destination: {
        listing: {
          listFiles: input.runtime.mutation.listDestination,
          isUnauthorized: input.runtime.isUnauthorized,
          isReconnectRequired: input.runtime.isReconnectRequired
        },
        session: { resetSession: input.coordination.session.resetActiveSession }
      },
      actionDialog: {
        closeNavigation: input.coordination.navigation.closeNavigation,
        closeMobileDetails: input.coordination.navigation.closeMobileDetails,
        pushActionSurface: input.coordination.navigation.pushActionSurface,
        showMobileActions: input.selection.focused.showMobileActions
      },
      copyMove: {
        closeMobileDetails: input.coordination.navigation.closeMobileDetails,
        pushActionSurface: input.coordination.navigation.pushActionSurface,
        showMobileActions: input.selection.focused.showMobileActions
      },
      selection: {
        clear: input.selection.clearBatch,
        currentFocusedSelection: input.selection.focused.current,
        captureFocusedSelection: input.selection.focused.capture,
        isFocusedSelectionCurrent: input.selection.focused.isCurrent,
        selectFocused: input.selection.focused.select,
        clearFocused: input.selection.focused.clear,
        clearFocusedIfCurrent: input.selection.focused.clearIfCurrent,
        rebindFocusedIfCurrent: input.selection.focused.rebindIfCurrent,
        removeDeletedFocused: input.selection.focused.removeDeleted,
        getSelectedPreview: input.selection.selectedPreviewPort.get,
        batchSelection: {
          removeDeleted: input.selection.batch.removeDeleted,
          rebind: input.selection.batch.rebind,
          retain: input.selection.batch.retain,
          clear: input.selection.batch.clear
        },
        setSelectedPreview: input.selection.selectedPreviewPort.set,
        closePreview: input.selection.selectedPreviewPort.closePreview
      },
      navigation: {
        ...input.coordination.navigation,
        showMobileActions: input.selection.focused.showMobileActions,
        isNarrowScreen: input.context.isNarrowScreen
      },
      presentation: {
        ...input.coordination.presentation,
        setActionError: (message) => message ? input.coordination.presentation.reportListError(new Error(message)) : input.coordination.presentation.clearListError()
      }
    } satisfies MutationWorkspacePorts
  });
  const mutationState = mutationWorkspace.state;
  const destinationSourceCount = mutationState.destinationPicker?.sourceEntries.length;
  const capabilities = useMemo(() => projectOperationRenderCapabilities({
    environment: operationContext.environment,
    selection: projectOperationSelectionFacts({
      focusedEntry: input.selection.focusedEntry,
      selectedPreview: input.selection.selectedPreview,
      batchCount: input.selection.batchSelectionEntries.length
    }),
    destinationSourceCount
  }), [destinationSourceCount, input.selection.batchSelectionEntries.length, input.selection.focusedEntry, input.selection.selectedPreview, operationContext.environment]);
  const downloadWorkspacePorts = createDownloadWorkspacePorts({
    getToken: () => input.context.token,
    ...input.runtime.download,
    downloadSelectionAsZip: input.runtime.batch.downloadSelectionAsZip,
    createTransferId: input.runtime.request.createTransferId,
    registry: operationContext.registry,
    transfers: input.coordination.transfers,
    context: { isOperationContextAllowed: operationContext.isOperationContextAllowed },
    session: input.coordination.session,
    presentation: { reportStatus: input.coordination.presentation.setStatus, reportListError: input.coordination.presentation.reportListError },
    errors: {
      isUnauthorized: input.runtime.isUnauthorized,
      isReconnectRequired: input.runtime.isReconnectRequired,
      toErrorMessage: input.runtime.toErrorMessage
    }
  });
  const download = useDownloadWorkspace({
    current: {
      accountId: input.context.accountId,
      accountName: input.context.accountName,
      token: input.context.token,
      operationContextToken: operationContext.token,
      cacheOnlyMode: input.context.cacheOnlyMode,
      offline: input.context.browserOffline,
      hasSession: () => Boolean(input.context.accountId && input.context.token)
    },
    selection: { entries: input.selection.batchSelectionEntries, archiveInput: input.selection.archiveInput },
    policy: {
      canOperate: operationContext.isCurrentOperationHandler,
      canDownloadFocused: (path, isFolder) => operationContext.isOperationAllowed({ kind: "downloadFocused", present: Boolean(path), isFolder }),
      canDownloadBatch: (count) => operationContext.isOperationAllowed({ kind: "downloadBatch", count })
    },
    resolveDisplayPath: input.coordination.presentation.toDisplayPath,
    ports: downloadWorkspacePorts
  }).commands;
  const upload = useUploadInteraction({
    dropAllowed: !mutationState.busy && operationContext.isOperationAllowedForRender({ kind: "upload", requiresFolderCreation: false }),
    canUpload: () => !mutationState.busy && operationContext.isCurrentOperationHandler() && Boolean(input.context.accountId && input.context.token) && operationContext.isOperationAllowed({ kind: "upload", requiresFolderCreation: false }),
    canDrop: () => !mutationState.busy && operationContext.isCurrentOperationHandler() && Boolean(input.context.accountId && input.context.token) && operationContext.isOperationAllowed({ kind: "upload", requiresFolderCreation: false }),
    buildOrchestrationInput: (files, source) => input.context.accountId && input.context.token ? {
      files, source, basePath: input.context.currentPath, locationLabel: input.coordination.presentation.toDisplayPath(input.context.currentPath), accountId: input.context.accountId, context: operationContext.token
    } : undefined,
    ports: {
      ...mutationWorkspace.commands.uploadOrchestration,
      presentation: {
        reportPlanError: input.coordination.presentation.reportListError,
        reportSuccess: input.coordination.presentation.setStatus,
        reportFailure: (partialStatusMessage, error) => { if (partialStatusMessage) input.coordination.presentation.setStatus(partialStatusMessage); input.coordination.presentation.reportListError(error); },
        reportUnexpectedError: input.coordination.presentation.reportListError,
        shouldReportUnexpectedError: (current, error) => current && !input.runtime.isUnauthorized(error)
      },
      files: input.runtime.uploadFiles
    }
  });
  const token = input.context.token;
  const resolvePreviewUrl = useMemo(() => async (entry: { path: string; mimeType?: string }) => {
    if (!token || getViewerKind(entry.mimeType) !== "image") {
      return undefined;
    }
    try {
      return await input.runtime.preview.createFileStreamUrl(entry.path, token);
    } catch {
      return undefined;
    }
  }, [input.runtime, token]);
  const stage = {
    state: mutationState,
    busy: mutationState.busy,
    canCreateFolder: capabilities.canCreateFolder,
    canConfirmDelete: mutationState.actionDialog?.kind === "delete"
      ? projectDeleteDialogCanConfirm(operationContext.environment, mutationState.actionDialog.workflow.unresolvedTargets.length)
      : false,
    canSubmitDestinationCopy: capabilities.canSubmitDestinationCopy,
    canSubmitDestinationMove: capabilities.canSubmitDestinationMove,
    currentLocationLabel: input.coordination.presentation.toDisplayPath(input.context.currentPath),
    destinationValidationMessage: mutationState.destinationValidation?.kind === "invalid" ? mutationState.destinationValidation.message : undefined,
    onActionValueChange: mutationWorkspace.commands.updateActionValue,
    onClose: mutationWorkspace.bridge.dismiss,
    onDestinationFolderChange: mutationWorkspace.commands.updateDestinationFolder,
    onDestinationManualModeChange: mutationWorkspace.commands.updateDestinationManualMode,
    onDestinationManualPathChange: mutationWorkspace.commands.updateDestinationManualPath,
    onDestinationNameChange: mutationWorkspace.commands.updateDestinationName,
    onDestinationReload: mutationWorkspace.commands.reloadDestinationPicker,
    onSubmitAction: (event: import("react").FormEvent<HTMLFormElement>) => { void mutationWorkspace.commands.submitActionDialog(event); },
    onSubmitDestination: (operation: import("../destination").DestinationOperation, event?: import("react").FormEvent<HTMLFormElement>) => { void mutationWorkspace.commands.submitDestinationPicker(operation, event); },
    onConflictDecisionChange: mutationWorkspace.commands.updateConflictDecision,
    onConflictApplyToAll: mutationWorkspace.commands.applyConflictDecisionToAll,
    onConflictApplySizeRuleChange: mutationWorkspace.commands.updateConflictApplySizeRule,
    onConflictConfirm: () => { void mutationWorkspace.commands.confirmConflictReview(); },
    onConflictBack: mutationWorkspace.commands.dismissConflictReview,
    resolvePreviewUrl
  } satisfies OperationExecutionWorkspaceOutput["mutation"]["stage"];
  const commands: OperationExecutionWorkspaceOutput["commands"] = {
    openCreateFolder: mutationWorkspace.commands.openCreateFolder,
    openDelete: mutationWorkspace.commands.openDelete,
    openDeleteSelection: mutationWorkspace.commands.openDeleteSelection,
    openMove: mutationWorkspace.commands.openMove,
    openCopyMove: mutationWorkspace.commands.openCopyMove,
    openCopyMoveSelection: mutationWorkspace.commands.openCopyMoveSelection
  };
  return {
    authority: operationContext,
    mutation: {
      state: mutationState,
      bridge: mutationWorkspace.bridge,
      stage,
      cancelTransferTask: mutationWorkspace.commands.cancelTransferTask,
      retryTransferTask: mutationWorkspace.commands.retryTransferTask
    },
    download,
    upload,
    capabilities,
    commands,
  };
}
