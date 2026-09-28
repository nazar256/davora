import { useMemo } from "react";

import { useOfflineSync } from "../useOfflineSync";
import { createOfflineSyncPorts } from "../useOfflineSyncPorts";
import type { OfflineSyncPorts } from "../orchestrationPorts";
import type { BatchArchiveInput } from "../../../operations/selection";
import {
  buildOfflineSyncLifecycleKey,
  projectOfflineSyncCanStart,
  projectOfflineSyncConfirmStage,
  normalizeOfflineSyncWorkspaceContext,
  resolveOfflineSyncArchiveInput
} from "./model";
import type {
  OfflineSyncWorkspaceInput,
  OfflineSyncWorkspaceOutput
} from "./ports";

function createWorkspacePorts(input: OfflineSyncWorkspaceInput): OfflineSyncPorts {
  const { context, authority, runtime } = input;
  return createOfflineSyncPorts({
    createAbortHandle: runtime.createAbortHandle,
    getToken: () => context.token,
    getCacheNamespace: () => context.cacheNamespace,
    listFiles: runtime.listFiles,
    cacheFolder: input.coordination.writeFolderCache,
    fetchDownloadBlob: runtime.fetchDownloadBlob,
    retention: {
      getActiveAccount: input.retention.getActiveAccount,
      toRetentionAccount: input.retention.toRetentionAccount,
      executeSnapshotCommand: input.retention.executeSnapshotCommand,
      readBlobText: runtime.readBlobText
    },
    registry: authority.registry,
    transfers: {
      createId: runtime.createTransferId,
      enqueue: input.transfers.controller.enqueue,
      requeue: input.transfers.controller.requeue,
      beginPreparation: input.transfers.controller.beginPreparation,
      beginTransfer: input.transfers.controller.beginTransfer,
      reportProgress: input.transfers.controller.reportProgress,
      reportFailure: input.transfers.controller.reportFailure,
      complete: input.transfers.controller.complete,
      completePartial: input.transfers.controller.completePartial,
      fail: input.transfers.controller.fail
    },
    transferTasks: input.transfers.tasks,
    openTransferTray: input.coordination.openTransferTray,
    presentation: {
      setStatus: input.coordination.setStatus,
      reportListError: input.coordination.reportListError,
      closeMobileDetails: input.coordination.closeMobileDetails,
      showMobileActions: input.coordination.showMobileActions
    },
    context: {
      isCurrentOperationContext: authority.isCurrentOperationContext,
      isOperationAllowed: authority.isOperationAllowed,
      getCurrentCapabilities: authority.getCurrentCapabilities,
      capabilitiesMatch: authority.capabilitiesMatch
    },
    session: { resetActiveSession: input.coordination.resetActiveSession },
    selection: { removeCaptured: input.selection.removeCaptured },
    errors: {
      isUnauthorized: runtime.isUnauthorized,
      isReconnectRequired: runtime.isReconnectRequired,
      toErrorMessage: runtime.toErrorMessage
    }
  });
}

export function useOfflineSyncWorkspace(input: OfflineSyncWorkspaceInput): OfflineSyncWorkspaceOutput {
  const context = useMemo(() => normalizeOfflineSyncWorkspaceContext(input.context), [input.context]);
  const workspaceInput = useMemo(() => ({ ...input, context }), [context, input]);
  const ports = useMemo(() => createWorkspacePorts(workspaceInput), [workspaceInput]);
  const { authority } = workspaceInput;
  const offlineSync = useOfflineSync({
    isCurrentOperationHandler: authority.isCurrentOperationHandler,
    hasSession: () => Boolean(context.accountId && context.token),
    isCacheOnlyBlocked: () => context.cacheOnlyMode,
    isOffline: () => context.browserOffline,
    isOperationAllowed: authority.isOperationAllowed,
    getOperationContextToken: () => authority.token,
    getCurrentOperationContextToken: authority.getCurrentOperationContextToken,
    isCurrentOperationContext: (captured) => authority.isCurrentOperationContext(captured),
    currentFocusedSelection: workspaceInput.selection.currentFocused,
    getAccountId: () => context.accountId,
    getAccountName: () => context.accountName,
    getCacheNamespace: () => context.cacheNamespace,
    resolveArchiveInput: (entries, archiveInput) => resolveOfflineSyncArchiveInput({
      entries,
      archive: archiveInput,
      context
    }),
    operationContextToken: authority.token,
    lifecycleKey: buildOfflineSyncLifecycleKey(context),
    ports
  });

  const canStart = offlineSync.dialog
    ? projectOfflineSyncCanStart(
        authority.environment,
        offlineSync.dialog.entries.length,
        authority.isCurrentOperationHandler()
      )
    : false;
  const stage = projectOfflineSyncConfirmStage({
    busy: offlineSync.busy,
    dialog: offlineSync.dialog,
    canStart,
    formatStorageBytes: workspaceInput.coordination.formatStorageBytes,
    onClose: offlineSync.dismiss,
    onConfirm: () => { void offlineSync.confirm(); }
  });

  return {
    snapshot: { busy: offlineSync.busy, dialog: offlineSync.dialog },
    commands: {
      open: async (entries, archive?: BatchArchiveInput, capture?) => { await offlineSync.open([...entries], archive, capture); },
      confirm: offlineSync.confirm,
      dismiss: offlineSync.dismiss,
      retry: async (task) => { offlineSync.retry(task); }
    },
    stage
  };
}
