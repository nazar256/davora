import type { FileEntry } from "@davora/shared";

import type { OperationContextToken, OperationIntent } from "../policy";
import type { BatchArchiveInput } from "../selection";
import {
  buildBatchDownloadListErrorMessage,
  buildBatchDownloadPartialSummary,
  buildBatchDownloadReadyMessage,
  buildBatchDownloadSuccessMessage,
  buildDownloadSelectionLabel,
  DOWNLOAD_CONTEXT_CHANGED_MESSAGE
} from "./model";
import type { DownloadOrchestrationPorts } from "./orchestrationPorts";

export interface FocusedDownloadOrchestrationInput {
  readonly path: string;
  readonly displayPath: string;
  readonly accountId: string;
  readonly context: OperationContextToken;
}

export interface BatchDownloadOrchestrationInput {
  readonly entries: readonly FileEntry[];
  readonly archiveInput: BatchArchiveInput;
  readonly accountId: string;
  readonly accountName: string;
  readonly context: OperationContextToken;
  readonly resolveDisplayPath: (path: string) => string;
}

const SESSION_EXPIRED_MESSAGE = "Session expired. Create a fresh session for this account.";
const RECONNECT_REQUIRED_MESSAGE = "This account needs to be reconnected before downloading files.";

export async function runFocusedDownloadOrchestration(
  input: FocusedDownloadOrchestrationInput,
  ports: DownloadOrchestrationPorts
): Promise<void> {
  const downloadIntent: OperationIntent = { kind: "downloadFocused", present: Boolean(input.path), isFolder: false };
  const scope = ports.registry.acquire({ context: input.context, intent: downloadIntent });
  const transferId = ports.transfers.createId();

  ports.transfers.enqueue({
    id: transferId,
    accountId: input.accountId,
    label: input.displayPath
  });

  try {
    ports.transfers.beginTransfer(transferId);
    const prepared = await ports.files.prepareDownload(input.path, {
      onProgress: (loadedBytes, totalBytes) => {
        if (scope.isOwned()) {
          ports.transfers.reportProgress(transferId, loadedBytes, totalBytes);
        }
      },
      signal: scope.signal
    });
    if (!scope.isRegistered()) {
      return;
    }
    if (!scope.isOwned()) {
      ports.transfers.fail(transferId, DOWNLOAD_CONTEXT_CHANGED_MESSAGE);
      return;
    }
    ports.files.triggerBrowserDownload(prepared.blob, prepared.filename);
    ports.transfers.complete(transferId);
  } catch (error) {
    if (!scope.isRegistered()) {
      return;
    }
    if (scope.signal.aborted || !scope.isOwned()) {
      ports.transfers.fail(transferId, DOWNLOAD_CONTEXT_CHANGED_MESSAGE);
      return;
    }
    if (scope.isOwned() && ports.errors.isUnauthorized(error)) {
      ports.session.terminateExpired(SESSION_EXPIRED_MESSAGE);
      return;
    }
    if (scope.isOwned() && ports.errors.isReconnectRequired(error)) {
      ports.session.terminateReconnectRequired(RECONNECT_REQUIRED_MESSAGE);
      return;
    }
    ports.transfers.fail(transferId, ports.errors.toErrorMessage(error, "Unable to download file."));
    if (scope.isOwned()) {
      ports.presentation.reportListError(error instanceof Error ? error : new Error("Unable to download file."));
    }
  } finally {
    scope.release();
  }
}

export async function runBatchDownloadOrchestration(
  input: BatchDownloadOrchestrationInput,
  ports: DownloadOrchestrationPorts
): Promise<void> {
  if (input.entries.length === 1 && !input.entries[0]?.isFolder) {
    const entry = input.entries[0];
    await runFocusedDownloadOrchestration({
      path: entry.path,
      displayPath: input.resolveDisplayPath(entry.path),
      accountId: input.accountId,
      context: input.context
    }, ports);
    return;
  }

  const downloadIntent: OperationIntent = { kind: "downloadBatch", count: input.entries.length };
  const scope = ports.registry.acquire({ context: input.context, intent: downloadIntent });
  const isRegistered = () => scope.isRegistered();
  const downloadStillCurrent = () => scope.isRegistered()
    && scope.isOwned()
    && ports.context.isCurrent(input.context, downloadIntent);
  let transferId: string | undefined;
  const fileCount = input.entries.filter((entry) => !entry.isFolder).length;
  const directoryCount = input.entries.filter((entry) => entry.isFolder).length;

  try {
    if (!isRegistered() || !downloadStillCurrent()) {
      return;
    }
    transferId = ports.transfers.createId();
    const id = transferId;
    ports.transfers.enqueue({
      id,
      accountId: input.accountId,
      label: `${buildDownloadSelectionLabel(fileCount, directoryCount)} selected`
    });
    ports.transfers.beginPreparation(id);
    const { blob, plan } = await ports.batch.downloadSelectionAsZip({
      roots: input.archiveInput.roots,
      archiveLabel: input.archiveInput.archiveLabel,
      listFiles: (path) => downloadStillCurrent()
        ? ports.files.listFiles(path, { signal: scope.signal })
        : Promise.reject(new Error(DOWNLOAD_CONTEXT_CHANGED_MESSAGE)),
      fetchFile: (path, callbacks) => downloadStillCurrent()
        ? ports.files.fetchBlob(path, { ...callbacks, signal: scope.signal })
        : Promise.reject(new Error(DOWNLOAD_CONTEXT_CHANGED_MESSAGE)),
      onPlanReady: (plan) => {
        if (!downloadStillCurrent()) {
          return;
        }
        ports.transfers.beginTransfer(id, {
          label: plan.archiveName,
          loadedBytes: 0,
          totalBytes: plan.totalBytes
        });
        if (downloadStillCurrent()) {
          ports.presentation.reportStatus(buildBatchDownloadReadyMessage(plan, input.accountName));
        }
      },
      onFileProgress: (loadedBytes, totalBytes) => {
        if (downloadStillCurrent()) {
          ports.transfers.reportProgress(id, loadedBytes, totalBytes);
        }
      },
      onArchiveProgress: () => {
        if (downloadStillCurrent()) {
          ports.transfers.beginPreparation(id, { loadedBytes: 0, totalBytes: null });
        }
      },
      onFileFailed: (failure) => {
        if (downloadStillCurrent()) {
          ports.transfers.reportFailure(id, failure);
        }
      }
    });

    if (!isRegistered()) {
      return;
    }
    if (!downloadStillCurrent()) {
      ports.transfers.fail(id, DOWNLOAD_CONTEXT_CHANGED_MESSAGE);
      return;
    }
    ports.files.triggerBrowserDownload(blob, plan.archiveName);
    if (!isRegistered()) {
      return;
    }
    if (!downloadStillCurrent()) {
      ports.transfers.fail(id, DOWNLOAD_CONTEXT_CHANGED_MESSAGE);
      return;
    }
    const hasFailures = plan.failedFiles.length > 0;
    const partialSummary = hasFailures ? `${buildBatchDownloadPartialSummary(plan)}.` : undefined;
    if (hasFailures) {
      ports.transfers.completePartial(id, plan.failedFiles, partialSummary ?? "Some files failed.", { label: plan.archiveName });
    } else {
      ports.transfers.complete(id, { label: plan.archiveName });
    }
    if (downloadStillCurrent()) {
      ports.presentation.reportStatus(buildBatchDownloadSuccessMessage(plan, input.accountName));
    }
    if (hasFailures && partialSummary && downloadStillCurrent()) {
      ports.presentation.reportListError(new Error(buildBatchDownloadListErrorMessage(plan, partialSummary)));
    }
  } catch (error) {
    if (!transferId || !isRegistered()) {
      return;
    }
    if (!downloadStillCurrent()) {
      ports.transfers.fail(transferId, DOWNLOAD_CONTEXT_CHANGED_MESSAGE);
      return;
    }
    if (ports.errors.isUnauthorized(error)) {
      ports.session.terminateExpired(SESSION_EXPIRED_MESSAGE);
      return;
    }
    if (ports.errors.isReconnectRequired(error)) {
      ports.session.terminateReconnectRequired(RECONNECT_REQUIRED_MESSAGE);
      return;
    }
    ports.transfers.fail(transferId, ports.errors.toErrorMessage(error, "Unable to prepare download."));
    if (downloadStillCurrent()) {
      ports.presentation.reportListError(error instanceof Error ? error : new Error("Unable to prepare download."));
    }
  } finally {
    scope.release();
  }
}
