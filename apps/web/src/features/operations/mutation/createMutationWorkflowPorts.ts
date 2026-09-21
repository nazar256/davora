import type { FileEntry, MutationResult } from "@davora/shared";
import { dirname } from "@davora/shared";

import { ApiRequestError } from "../../../lib/api";

import type { DestinationOperation } from "../destination";
import type { ActionDialogOrchestrationPorts } from "../delete/orchestrationPorts";
import type { CopyMoveOrchestrationPorts } from "../copyMove/orchestrationPorts";
import type { UploadOrchestrationPorts, UploadMutationResult } from "../upload/orchestrationPorts";
import type { UploadRefreshResult } from "../upload/ports";
import type { OperationContextToken, OperationIntent } from "../policy";
import type { MutationAttemptToken } from "./attempt";
import type { BatchDeleteWorkflow, DeleteWorkflowId } from "../delete/model";
import type { DeleteProgress } from "../delete/ports";
import type { BatchCopyMoveOperation } from "../copyMove/model";
import type { UploadCandidate, UploadFolderTarget } from "../upload/model";
import { applySelectionSyncEffect } from "./selectionSyncApplication";
import type { MutationRunnerPorts } from "./ports";
import type { FocusedSelectionCapture } from "../selection";
import {
  isMutationReconnectRequired,
  isMutationSessionTerminated,
  isMutationUnauthorized
} from "./sessionErrors";
import {
  BATCH_MUTATION_EXECUTE_OPTIONS,
  executeBatchMutationTarget,
  mapFolderLoadResult,
  type BatchMutationExecutor,
  type FolderLoadResult
} from "./workflowAdapters";

export interface MutationRegistrySource {
  acquire(input: {
    readonly context: OperationContextToken;
    readonly basePath: string;
    readonly intent: OperationIntent;
  }): {
    readonly signal: AbortSignal;
    isCurrent(): boolean;
    release(): void;
  } | undefined;
  acquireForDownload?(input: {
    readonly context: OperationContextToken;
    readonly intent: OperationIntent;
  }): {
    readonly signal: AbortSignal;
    isRegistered(): boolean;
    isOwned(): boolean;
    release(): void;
  };
}

export interface MutationTransferSource {
  createId(): string;
  enqueueUpload(input: {
    readonly id: string;
    readonly accountId: string;
    readonly label: string;
    readonly totalBytes: number;
  }): void;
  beginPreparation(id: string, totalBytes: number): void;
  reportPreparationProgress(id: string, loadedBytes: number, totalBytes: number): void;
  beginTransfer(id: string): void;
  reportUploadProgress(id: string, loadedBytes: number, totalBytes: number): void;
  complete(id: string): void;
  failActive(ids: ReadonlySet<string>, message: string): void;
}

export interface MutationSelectionSources {
  currentFocusedSelection(): FileEntry | undefined;
  captureFocusedSelection(): FocusedSelectionCapture | undefined;
  isFocusedSelectionCurrent(capture: FocusedSelectionCapture): boolean;
  selectFocused(entry: FileEntry): void;
  clearFocused(): void;
  clearFocusedIfCurrent(capture: FocusedSelectionCapture): void;
  rebindFocusedIfCurrent(capture: FocusedSelectionCapture, entry: FileEntry): void;
  removeDeletedFocused(path: string): void;
  getSelectedPreview(): { readonly path: string; readonly name: string } | undefined;
  batchSelection: {
    removeDeleted(path: string): void;
    rebind(fromPath: string, item: FileEntry): void;
    retain(paths: readonly string[]): void;
    clear(): void;
  };
  setSelectedPreview(
    updater: (previous: { readonly path: string; readonly name: string } | undefined) => {
      readonly path: string;
      readonly name: string;
    } | undefined
  ): void;
  closePreview(): void;
}

export interface MutationChromeSources {
  closeMobileDetails(): void;
  openMobileDetails(): void;
  isNarrowScreen: boolean;
}

export interface MutationFolderSources {
  getCurrentPath(): string;
  setCurrentPath(path: string): void;
  loadFolder(
    path: string,
    options?: { readonly preferCache?: boolean; readonly announceStatus?: boolean }
  ): Promise<FolderLoadResult>;
}

export interface MutationSessionSources {
  getToken(): string | undefined;
  hasActiveAccount(): boolean;
  resetActiveSession(message: string, reconnectRequired?: boolean): void;
}

export interface MutationDeleteWorkflowSources {
  getActiveDeleteWorkflowId(): DeleteWorkflowId | undefined;
  isAttemptCurrent(attempt: MutationAttemptToken): boolean;
  updateDeleteDialog(attempt: MutationAttemptToken, workflow: BatchDeleteWorkflow): boolean;
}

export interface MutationApiSources {
  createFolder(parentPath: string, name: string, token: string): Promise<MutationResult>;
  deleteFile(path: string, confirmName: string, token: string): Promise<MutationResult>;
  uploadFileWithProgress(
    input: {
      readonly path: string;
      readonly name: string;
      readonly mimeType: string;
      readonly contentBase64: string;
    },
    token: string,
    onProgress: (loadedBytes: number, totalBytes: number) => void,
    signal: AbortSignal
  ): Promise<MutationResult>;
  runCopyOrMove(
    operation: DestinationOperation,
    sourcePath: string,
    destinationPath: string,
    token: string,
    overwrite?: boolean
  ): Promise<MutationResult>;
  listChildren(path: string, token: string): Promise<{ readonly items: readonly FileEntry[] }>;
}

export interface CreateMutationWorkflowPortsInput {
  readonly session: MutationSessionSources;
  readonly environment: {
    isCacheOnlyBlocked(): boolean;
    isOffline(): boolean;
  };
  readonly context: {
    getOperationContextToken(): OperationContextToken;
    isOperationContextAllowed(context: OperationContextToken, intent: OperationIntent): boolean;
    isCurrentOperationContext(context: OperationContextToken): boolean;
  };
  readonly folder: MutationFolderSources;
  readonly selection: MutationSelectionSources;
  readonly chrome: MutationChromeSources;
  readonly presentation: {
    clearListError(): void;
    setStatus(message: string): void;
    getAccountName(): string;
    toDisplayPath(path: string): string;
  };
  readonly registry: MutationRegistrySource;
  readonly transfers: MutationTransferSource;
  readonly api: MutationApiSources;
  readonly deleteWorkflow: MutationDeleteWorkflowSources;
}

export interface MutationRunnerCallbacks {
  readonly beginMutation: (context: OperationContextToken, owner?: object) => void;
  readonly finishMutation: (context: OperationContextToken, owner?: object) => void;
  readonly executeMutation: BatchMutationExecutor["execute"];
  readonly syncSelectionWithMutation: (result: MutationResult) => void;
}

export interface MutationWorkflowOrchestrationPorts {
  readonly upload: Pick<UploadOrchestrationPorts, "registry" | "transfers" | "mutations" | "selection">;
  readonly actionDialogSubmit: Pick<
    ActionDialogOrchestrationPorts,
    "context" | "session" | "mutations" | "mutation" | "api" | "batch"
  >;
  readonly copyMoveSubmit: Pick<
    CopyMoveOrchestrationPorts,
    "context" | "session" | "mutations" | "mutation" | "api" | "batch"
  >;
}

function createSessionErrorApi(token: string | undefined) {
  return {
    rejectMissingSession(): never {
      throw new Error("No session available for this action.");
    },
  getToken(): string {
      if (!token) {
        throw new Error("No session available for this action.");
      }
      return token;
    }
  };
}

export function createMutationRunnerPorts(input: CreateMutationWorkflowPortsInput): MutationRunnerPorts {
  return {
    session: {
      hasSession: () => Boolean(input.session.getToken() && input.session.hasActiveAccount()),
      isUnauthorized: isMutationUnauthorized,
      isReconnectRequired: isMutationReconnectRequired,
      resetExpired: (message) => {
        input.session.resetActiveSession(message);
      },
      resetReconnectRequired: (message) => {
        input.session.resetActiveSession(message, true);
      }
    },
    environment: {
      isCacheOnlyBlocked: input.environment.isCacheOnlyBlocked,
      isOffline: input.environment.isOffline
    },
    context: {
      getOperationContextToken: input.context.getOperationContextToken,
      isContextAllowed: input.context.isOperationContextAllowed
    },
    folder: {
      getCurrentPath: input.folder.getCurrentPath,
      navigateToPath: input.folder.setCurrentPath,
      refreshFolder: async (path) => {
        await input.folder.loadFolder(path, { preferCache: false, announceStatus: false });
      }
    },
    selection: {
      currentFocusedSelection: input.selection.currentFocusedSelection,
      captureFocusedSelection: input.selection.captureFocusedSelection,
      isFocusedSelectionCurrent: input.selection.isFocusedSelectionCurrent,
      getSelectedPreview: input.selection.getSelectedPreview,
      applySelectionSync: (effect, capture) => {
        applySelectionSyncEffect(effect, {
          batchSelection: input.selection.batchSelection,
          selection: {
            currentFocusedSelection: input.selection.currentFocusedSelection,
            selectFocused: input.selection.selectFocused,
            clearFocused: input.selection.clearFocused,
            clearFocusedIfCurrent: input.selection.clearFocusedIfCurrent,
            rebindFocusedIfCurrent: input.selection.rebindFocusedIfCurrent,
            removeDeletedFocused: input.selection.removeDeletedFocused,
            isFocusedSelectionCurrent: input.selection.isFocusedSelectionCurrent,
            setSelectedPreview: input.selection.setSelectedPreview,
            closePreview: input.selection.closePreview
          },
          chrome: {
            closeMobileDetails: input.chrome.closeMobileDetails,
            openMobileDetails: input.chrome.openMobileDetails
          },
          mobile: { isNarrowScreen: input.chrome.isNarrowScreen }
        }, capture);
      }
    },
    presentation: {
      clearListError: input.presentation.clearListError,
      setStatus: input.presentation.setStatus,
      getAccountName: input.presentation.getAccountName,
      toDisplayPath: input.presentation.toDisplayPath
    }
  };
}

function createUploadMutationsPort<TFile extends UploadCandidate = UploadCandidate>(
  input: CreateMutationWorkflowPortsInput,
  runner: MutationRunnerCallbacks
): UploadOrchestrationPorts<TFile>["mutations"] {
  return {
    begin: runner.beginMutation,
    finish: runner.finishMutation,
    createFolder: async (folder: UploadFolderTarget, context, intent) => {
      const token = input.session.getToken();
      if (!token) {
        return { kind: "sessionTerminated" };
      }
      try {
        await runner.executeMutation(
          () => input.api.createFolder(folder.parentPath, folder.name, token),
          { ...BATCH_MUTATION_EXECUTE_OPTIONS, context, intent }
        );
        return { kind: "created" };
      } catch (error) {
        if (isMutationSessionTerminated(error)) {
          return { kind: "sessionTerminated" };
        }
        if (error instanceof ApiRequestError && error.code === "conflict") {
          return { kind: "alreadyExists" };
        }
        return {
          kind: "failed",
          message: error instanceof Error ? error.message : "Unable to create upload folder."
        };
      }
    },
    uploadFile: async (file, contentBase64, context, intent, onProgress, signal) => {
      const token = input.session.getToken();
      if (!token) {
        return { kind: "sessionTerminated" };
      }
      try {
        const result = await runner.executeMutation(
          () => input.api.uploadFileWithProgress({
            path: file.destinationParentPath,
            name: file.file.name,
            mimeType: file.file.type || "application/octet-stream",
            contentBase64
          }, token, onProgress, signal),
          { ...BATCH_MUTATION_EXECUTE_OPTIONS, context, intent }
        );
        return { kind: "uploaded", result } satisfies UploadMutationResult;
      } catch (error) {
        if (isMutationSessionTerminated(error)) {
          return { kind: "sessionTerminated" };
        }
        return {
          kind: "failed",
          message: error instanceof Error ? error.message : "Upload failed."
        };
      }
    },
    refreshFolder: async (basePath) => {
      const result = await input.folder.loadFolder(basePath, { preferCache: false, announceStatus: false });
      return mapFolderLoadResult(result) satisfies UploadRefreshResult;
    }
  };
}

function createSharedSubmitPorts(
  input: CreateMutationWorkflowPortsInput,
  runner: MutationRunnerCallbacks
) {
  return {
    context: {
      isCurrentOperationContext: input.context.isCurrentOperationContext,
      isContextAllowed: input.context.isOperationContextAllowed
    },
    session: {
      hasSession: () => Boolean(input.session.getToken()),
      isUnauthorized: isMutationUnauthorized,
      isReconnectRequired: isMutationReconnectRequired
    },
    mutations: {
      begin: runner.beginMutation,
      finish: runner.finishMutation
    },
    mutation: {
      execute: runner.executeMutation
    }
  };
}

export function createMutationOrchestrationPorts(
  input: CreateMutationWorkflowPortsInput,
  runner: MutationRunnerCallbacks
): MutationWorkflowOrchestrationPorts {
  const shared = createSharedSubmitPorts(input, runner);
  const sessionApi = createSessionErrorApi(input.session.getToken());

  return {
    upload: {
      registry: {
        acquire: ({ context, basePath, intent }) => {
          const scope = input.registry.acquire({ context, basePath, intent });
          if (!scope) {
            return undefined;
          }
          return {
            signal: scope.signal,
            isCurrent: () => scope.isCurrent(),
            release: () => {
              scope.release();
            }
          };
        }
      },
      transfers: {
        createId: () => input.transfers.createId(),
        enqueue: (enqueueInput) => {
          input.transfers.enqueueUpload(enqueueInput);
        },
        beginPreparation: (id, totalBytes) => {
          input.transfers.beginPreparation(id, totalBytes);
        },
        reportPreparationProgress: (id, loadedBytes, totalBytes) => {
          input.transfers.reportPreparationProgress(id, loadedBytes, totalBytes);
        },
        beginTransfer: (id) => {
          input.transfers.beginTransfer(id);
        },
        reportUploadProgress: (id, loadedBytes, totalBytes) => {
          input.transfers.reportUploadProgress(id, loadedBytes, totalBytes);
        },
        complete: (id) => {
          input.transfers.complete(id);
        },
        failActive: (ids, message) => {
          input.transfers.failActive(ids, message);
        }
      },
      mutations: createUploadMutationsPort(input, runner),
      selection: {
        syncWithMutation: runner.syncSelectionWithMutation
      }
    },
    actionDialogSubmit: {
      ...shared,
      api: {
        createFolder: (parentPath, name) => {
          return Promise.resolve(input.api.createFolder(parentPath, name, sessionApi.getToken()));
        },
        deleteFile: (targetPath, confirmName) => {
          return Promise.resolve(input.api.deleteFile(targetPath, confirmName, sessionApi.getToken()));
        }
      },
      batch: {
        executeDeleteTarget: async (targetPath, confirmName, context, intent, isAttemptCurrent) => {
          return executeBatchMutationTarget(
            Boolean(input.session.getToken()),
            { execute: runner.executeMutation },
            () => input.api.deleteFile(targetPath, confirmName, sessionApi.getToken()),
            context,
            intent,
            "Unable to complete this action.",
            isAttemptCurrent
          );
        },
        acceptDeleteProgress: (progress: DeleteProgress, dialog, actionStillCurrent, attempt) => {
          const workflowStillCurrent = input.deleteWorkflow.getActiveDeleteWorkflowId() === dialog.workflow.id
            && input.deleteWorkflow.isAttemptCurrent(attempt) && actionStillCurrent();
          if (!workflowStillCurrent) {
            return false;
          }
          runner.syncSelectionWithMutation({
            action: "delete",
            parentPath: dirname(progress.completedTarget.path),
            path: progress.completedTarget.path
          });
          return input.deleteWorkflow.updateDeleteDialog(attempt, progress.workflow);
        },
        refreshFolder: async (path) => {
          const result = await input.folder.loadFolder(path, {
            preferCache: false,
            announceStatus: false
          });
          return mapFolderLoadResult(result);
        },
        isDeleteWorkflowCurrent: (workflowId) => input.deleteWorkflow.getActiveDeleteWorkflowId() === workflowId
      }
    },
    copyMoveSubmit: {
      ...shared,
      api: {
        runCopyOrMove: (operation, sourcePath, destinationPath, overwrite) => {
          return Promise.resolve(input.api.runCopyOrMove(
            operation,
            sourcePath,
            destinationPath,
            sessionApi.getToken(),
            overwrite
          ));
        }
      },
      batch: {
        executeCopyMoveTarget: async (operation: BatchCopyMoveOperation, sourcePath, destinationPath, overwrite, context, intent, isAttemptCurrent) => {
          return executeBatchMutationTarget(
            Boolean(input.session.getToken()),
            { execute: runner.executeMutation },
            () => input.api.runCopyOrMove(operation, sourcePath, destinationPath, sessionApi.getToken(), overwrite),
            context,
            intent,
            "Unable to complete this item.",
            isAttemptCurrent
          );
        },
        listChildren: async (path, context) => {
          if (!input.session.getToken()) {
            return { kind: "sessionTerminated" };
          }
          try {
            const listing = await input.api.listChildren(path, sessionApi.getToken());
            if (!input.context.isCurrentOperationContext(context)) {
              return { kind: "failed", message: "This action was superseded." };
            }
            return { kind: "completed", entries: listing.items };
          } catch (error) {
            if (isMutationUnauthorized(error)) {
              input.session.resetActiveSession("Session expired. Create a fresh session for this account.");
              return { kind: "sessionTerminated" };
            }
            if (isMutationReconnectRequired(error)) {
              input.session.resetActiveSession("This account needs to be reconnected before completing mutations.", true);
              return { kind: "sessionTerminated" };
            }
            return {
              kind: "failed",
              message: error instanceof Error ? error.message : "Unable to read the destination folder."
            };
          }
        },
        deleteFolder: async (path, confirmName, context, intent, isAttemptCurrent) => {
          return executeBatchMutationTarget(
            Boolean(input.session.getToken()),
            { execute: runner.executeMutation },
            () => input.api.deleteFile(path, confirmName, sessionApi.getToken()),
            context,
            intent,
            "Unable to remove the emptied source folder.",
            isAttemptCurrent
          );
        },
        refreshFolder: async (path) => {
          const result = await input.folder.loadFolder(path, {
            preferCache: false,
            announceStatus: false
          });
          return mapFolderLoadResult(result);
        }
      }
    }
  };
}
