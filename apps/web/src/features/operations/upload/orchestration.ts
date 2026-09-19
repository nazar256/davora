import { assertNever, type MutationResult } from "@davora/shared";

import type { OperationContextToken, OperationIntent } from "../policy";
import { executeUpload } from "./controller";
import {
  buildUploadPartialFailureMessage,
  buildUploadPlan,
  buildUploadSuccessMessage,
  UPLOAD_CONTEXT_CHANGED_MESSAGE,
  type UploadCandidate,
  type UploadPlan,
  type UploadSource
} from "./model";
import type { UploadFileStateEvent } from "./ports";
import type { UploadOrchestrationPorts } from "./orchestrationPorts";

export interface UploadOrchestrationInput<TFile extends UploadCandidate = UploadCandidate> {
  readonly files: readonly TFile[];
  readonly source: UploadSource;
  readonly basePath: string;
  readonly locationLabel: string;
  readonly accountId: string;
  readonly context: OperationContextToken;
}

export async function runUploadOrchestration<TFile extends UploadCandidate>(
  input: UploadOrchestrationInput<TFile>,
  ports: UploadOrchestrationPorts<TFile>
): Promise<void> {
  let uploadPlan: UploadPlan<TFile>;

  try {
    uploadPlan = buildUploadPlan(input.basePath, input.files);
  } catch (error) {
    ports.presentation.reportPlanError(error instanceof Error ? error : new Error("Upload failed."));
    return;
  }

  const uploadIntent: OperationIntent = { kind: "upload", requiresFolderCreation: uploadPlan.folders.length > 0 };
  const scope = ports.registry.acquire({
    context: input.context,
    basePath: uploadPlan.basePath,
    intent: uploadIntent
  });
  if (!scope) {
    return;
  }

  const transferIds = new Map(uploadPlan.files.map((plannedFile) => {
    const id = ports.transfers.createId();
    ports.transfers.enqueue({
      id,
      accountId: input.accountId,
      label: plannedFile.transferLabel,
      totalBytes: plannedFile.file.size
    });
    return [plannedFile.index, id] as const;
  }));
  const uploadTransferIds = new Set(transferIds.values());
  const shouldSyncUploadedSelection = uploadPlan.files.length === 1;
  const uploadedResults = new Map<number, MutationResult>();
  const publishFileState = (event: UploadFileStateEvent<TFile>) => {
    if (!scope.isCurrent()) {
      return false;
    }
    const transferId = transferIds.get(event.file.index);
    if (!transferId) {
      return false;
    }
    switch (event.kind) {
      case "preparing":
        ports.transfers.beginPreparation(transferId, event.file.file.size);
        break;
      case "preparationProgress":
        ports.transfers.reportPreparationProgress(transferId, event.loadedBytes, event.totalBytes);
        break;
      case "transferring":
        ports.transfers.beginTransfer(transferId);
        break;
      case "uploadProgress":
        ports.transfers.reportUploadProgress(transferId, event.loadedBytes, event.totalBytes);
        break;
      case "completed": {
        ports.transfers.complete(transferId);
        const result = uploadedResults.get(event.file.index);
        if (shouldSyncUploadedSelection && result) {
          ports.selection.syncWithMutation(result);
        }
        break;
      }
      default:
        assertNever(event, "upload file state event");
    }
    return scope.isCurrent();
  };

  try {
    ports.mutations.begin(input.context);
    const outcome = await executeUpload(uploadPlan, {
      signal: scope.signal,
      isCurrent: scope.isCurrent,
      createFolder: (folder) => ports.mutations.createFolder(folder, input.context, uploadIntent),
      publishFileState,
      prepareFile: (file, onProgress, signal) => ports.files.prepare(file.file, onProgress, signal),
      uploadFile: async (file, contentBase64, onProgress, signal) => {
        const uploaded = await ports.mutations.uploadFile(
          file,
          contentBase64,
          input.context,
          uploadIntent,
          onProgress,
          signal
        );
        if (uploaded.kind === "uploaded") {
          uploadedResults.set(file.index, uploaded.result);
          return { kind: "uploaded" };
        }
        return uploaded;
      },
      refreshFolder: () => ports.mutations.refreshFolder(uploadPlan.basePath)
    });

    if (outcome.kind === "completed" && scope.isCurrent()) {
      ports.presentation.reportSuccess(buildUploadSuccessMessage(
        uploadPlan.files.length,
        uploadPlan.directoryRoots.length,
        input.locationLabel,
        input.source
      ));
    } else if (outcome.kind === "failed" && scope.isCurrent()) {
      ports.presentation.reportFailure(
        outcome.completedFileCount > 0
          ? buildUploadPartialFailureMessage(outcome.completedFileCount, uploadPlan.files.length, input.locationLabel)
          : undefined,
        new Error(outcome.message)
      );
    }

    if (outcome.kind !== "completed") {
      const errorMessage = outcome.kind === "failed"
        ? outcome.message
        : UPLOAD_CONTEXT_CHANGED_MESSAGE;
      ports.transfers.failActive(uploadTransferIds, errorMessage);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Upload failed.";
    ports.transfers.failActive(uploadTransferIds, errorMessage);
    if (ports.presentation.shouldReportUnexpectedError(scope.isCurrent(), error)) {
      ports.presentation.reportUnexpectedError(error instanceof Error ? error : new Error("Upload failed."));
    }
  } finally {
    ports.mutations.finish(input.context);
    scope.release();
  }
}
