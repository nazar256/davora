import type { PlannedUploadFile, UploadCandidate, UploadFolderTarget } from "./model";

export type FolderCreationResult =
  | { readonly kind: "created" }
  | { readonly kind: "alreadyExists" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "sessionTerminated" };

export type FilePreparationResult =
  | { readonly kind: "prepared"; readonly contentBase64: string }
  | { readonly kind: "failed"; readonly message: string };

export type UploadFileResult =
  | { readonly kind: "uploaded" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "sessionTerminated" };

export type UploadRefreshResult =
  | { readonly kind: "completed" }
  | { readonly kind: "sessionTerminated" };

export type UploadFileStateEvent<TFile extends UploadCandidate = UploadCandidate> =
  | { readonly kind: "preparing"; readonly file: PlannedUploadFile<TFile> }
  | { readonly kind: "preparationProgress"; readonly file: PlannedUploadFile<TFile>; readonly loadedBytes: number; readonly totalBytes: number }
  | { readonly kind: "transferring"; readonly file: PlannedUploadFile<TFile> }
  | { readonly kind: "uploadProgress"; readonly file: PlannedUploadFile<TFile>; readonly loadedBytes: number; readonly totalBytes: number }
  | { readonly kind: "completed"; readonly file: PlannedUploadFile<TFile> };

export interface UploadExecutionPorts<TFile extends UploadCandidate = UploadCandidate> {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  createFolder(folder: UploadFolderTarget): Promise<FolderCreationResult>;
  publishFileState(event: UploadFileStateEvent<TFile>): boolean;
  prepareFile(
    file: PlannedUploadFile<TFile>,
    onProgress: (loadedBytes: number, totalBytes: number) => boolean,
    signal: AbortSignal
  ): Promise<FilePreparationResult>;
  uploadFile(
    file: PlannedUploadFile<TFile>,
    contentBase64: string,
    onProgress: (loadedBytes: number, totalBytes: number) => boolean,
    signal: AbortSignal
  ): Promise<UploadFileResult>;
  refreshFolder(): Promise<UploadRefreshResult>;
}
