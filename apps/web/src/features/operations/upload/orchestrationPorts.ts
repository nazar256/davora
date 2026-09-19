import type { MutationResult } from "@davora/shared";

import type { OperationContextToken, OperationIntent } from "../policy";
import type { PlannedUploadFile, UploadCandidate, UploadFolderTarget } from "./model";
import type {
  FilePreparationResult,
  FolderCreationResult,
  UploadFileResult,
  UploadRefreshResult
} from "./ports";

export interface UploadRequestScope {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  release(): void;
}

export interface UploadRegistryPort {
  acquire(input: {
    readonly context: OperationContextToken;
    readonly basePath: string;
    readonly intent: OperationIntent;
  }): UploadRequestScope | undefined;
}

export interface UploadTransferPort {
  createId(): string;
  enqueue(input: { readonly id: string; readonly accountId: string; readonly label: string; readonly totalBytes: number }): void;
  beginPreparation(id: string, totalBytes: number): void;
  reportPreparationProgress(id: string, loadedBytes: number, totalBytes: number): void;
  beginTransfer(id: string): void;
  reportUploadProgress(id: string, loadedBytes: number, totalBytes: number): void;
  complete(id: string): void;
  failActive(ids: ReadonlySet<string>, message: string): void;
}

export type UploadMutationResult =
  | { readonly kind: "uploaded"; readonly result: MutationResult }
  | Exclude<UploadFileResult, { readonly kind: "uploaded" }>;

export interface UploadMutationPort<TFile extends UploadCandidate = UploadCandidate> {
  begin(context: OperationContextToken): void;
  finish(context: OperationContextToken): void;
  createFolder(
    folder: UploadFolderTarget,
    context: OperationContextToken,
    intent: OperationIntent
  ): Promise<FolderCreationResult>;
  uploadFile(
    file: PlannedUploadFile<TFile>,
    contentBase64: string,
    context: OperationContextToken,
    intent: OperationIntent,
    onProgress: (loadedBytes: number, totalBytes: number) => void,
    signal: AbortSignal
  ): Promise<UploadMutationResult>;
  refreshFolder(basePath: string): Promise<UploadRefreshResult>;
}

export interface UploadSelectionPort {
  syncWithMutation(result: MutationResult): void;
}

export interface UploadPresentationPort {
  reportPlanError(error: Error): void;
  reportSuccess(message: string): void;
  reportFailure(partialStatusMessage: string | undefined, error: Error): void;
  reportUnexpectedError(error: Error): void;
  shouldReportUnexpectedError(isCurrent: boolean, error: unknown): boolean;
}

export interface UploadFileContentPort<TFile extends UploadCandidate = UploadCandidate> {
  prepare(
    file: TFile,
    onProgress: (loadedBytes: number, totalBytes: number) => boolean,
    signal: AbortSignal
  ): Promise<FilePreparationResult>;
}

export interface UploadOrchestrationPorts<TFile extends UploadCandidate = UploadCandidate> {
  readonly registry: UploadRegistryPort;
  readonly transfers: UploadTransferPort;
  readonly mutations: UploadMutationPort<TFile>;
  readonly selection: UploadSelectionPort;
  readonly presentation: UploadPresentationPort;
  readonly files: UploadFileContentPort<TFile>;
}
