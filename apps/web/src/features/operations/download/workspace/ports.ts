import type { FileEntry } from "@davora/shared";

import {
  createDownloadPorts,
  type CreateDownloadPortsInput,
  type DownloadBatchSource,
  type DownloadFileSources
} from "../createDownloadPorts";
import type { DownloadOrchestrationPorts } from "../orchestrationPorts";
import type { TransfersController } from "../../../transfers";

/**
 * Composition-only sources for the download workspace. App supplies concrete
 * API, browser, transfer, session, and presentation adapters; the workspace
 * and orchestration layers only see their typed feature ports.
 */
export interface DownloadWorkspaceFactoryInput {
  readonly getToken: CreateDownloadPortsInput["getToken"];
  readonly prepareDownloadFile: DownloadFileSources["prepareDownloadFile"];
  readonly fetchDownloadBlob: DownloadFileSources["fetchDownloadBlob"];
  readonly listFiles: DownloadFileSources["listFiles"];
  readonly triggerBrowserDownload: DownloadFileSources["triggerBrowserDownload"];
  readonly downloadSelectionAsZip: DownloadBatchSource["downloadSelectionAsZip"];
  readonly createTransferId: () => string;
  readonly registry: CreateDownloadPortsInput["registry"];
  readonly transfers: Pick<TransfersController, "enqueue" | "beginPreparation" | "beginTransfer" | "reportProgress" | "reportFailure" | "complete" | "completePartial" | "fail">;
  readonly context: CreateDownloadPortsInput["context"];
  readonly session: CreateDownloadPortsInput["session"];
  readonly presentation: CreateDownloadPortsInput["presentation"];
  readonly errors: CreateDownloadPortsInput["errors"];
}

export function createDownloadWorkspacePorts(
  input: DownloadWorkspaceFactoryInput
): DownloadOrchestrationPorts {
  return createDownloadPorts({
    getToken: input.getToken,
    files: {
      prepareDownloadFile: input.prepareDownloadFile,
      fetchDownloadBlob: input.fetchDownloadBlob,
      listFiles: input.listFiles,
      triggerBrowserDownload: input.triggerBrowserDownload
    },
    batch: { downloadSelectionAsZip: input.downloadSelectionAsZip },
    registry: input.registry,
    transfers: {
      createId: input.createTransferId,
      enqueue: (transfer) => input.transfers.enqueue({ ...transfer, kind: "download" }),
      beginPreparation: input.transfers.beginPreparation,
      beginTransfer: input.transfers.beginTransfer,
      reportProgress: input.transfers.reportProgress,
      reportFailure: input.transfers.reportFailure,
      complete: input.transfers.complete,
      completePartial: input.transfers.completePartial,
      fail: input.transfers.fail
    },
    context: input.context,
    session: input.session,
    presentation: input.presentation,
    errors: input.errors
  });
}

export interface DownloadWorkspaceCurrent {
  readonly accountId?: string;
  readonly accountName: string;
  readonly token?: string;
  readonly operationContextToken: import("../../policy").OperationContextToken;
  readonly cacheOnlyMode: boolean;
  readonly offline: boolean;
  hasSession(): boolean;
}

export interface DownloadWorkspaceSelection {
  readonly entries: readonly FileEntry[];
  readonly archiveInput: import("../../selection").BatchArchiveInput;
}

export interface DownloadWorkspacePolicy {
  canOperate(): boolean;
  canDownloadFocused(path: string, isFolder: boolean): boolean;
  canDownloadBatch(entryCount: number): boolean;
}

export interface UseDownloadWorkspaceInput {
  readonly current: DownloadWorkspaceCurrent;
  readonly selection: DownloadWorkspaceSelection;
  readonly policy: DownloadWorkspacePolicy;
  readonly resolveDisplayPath: (path: string) => string;
  readonly ports: DownloadOrchestrationPorts;
}
