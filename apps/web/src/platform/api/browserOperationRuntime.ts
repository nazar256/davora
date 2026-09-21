import type { FileEntry, MutationResult } from "@davora/shared";

import {
  ApiRequestError,
  copyFile,
  createFolder,
  createStreamingFileUrl,
  deleteFile,
  fetchDownloadBlob,
  listFiles,
  moveFile,
  prepareDownloadFile,
  triggerBrowserDownload,
  uploadFileWithProgress
} from "../../lib/api";
import { downloadSelectionAsZip } from "../../lib/batchDownload";
import { createBrowserUploadFileContent } from "../upload/browserUploadFileContent";

export interface OperationRuntimePort {
  readonly request: {
    createAbortHandle(): { readonly signal: AbortSignal; abort(): void };
    createTransferId(): string;
  };
  readonly mutation: {
    createFolder(parentPath: string, name: string, token: string): Promise<MutationResult>;
    deleteFile(path: string, confirmName: string, token: string): Promise<MutationResult>;
    uploadFile(input: { readonly path: string; readonly name: string; readonly mimeType: string; readonly contentBase64: string }, token: string, onProgress: (loadedBytes: number, totalBytes: number) => void, signal: AbortSignal): Promise<MutationResult>;
    copyOrMove(kind: "copy" | "move", source: string, destination: string, token: string, overwrite?: boolean): Promise<MutationResult>;
    listDestination(path: string, token: string): Promise<{ readonly items: FileEntry[] }>;
  };
  readonly download: {
    readonly prepareDownloadFile: typeof prepareDownloadFile;
    readonly fetchDownloadBlob: typeof fetchDownloadBlob;
    readonly listFiles: typeof listFiles;
    readonly triggerBrowserDownload: typeof triggerBrowserDownload;
    readonly saveDownload: typeof triggerBrowserDownload;
  };
  readonly batch: { readonly downloadSelectionAsZip: typeof downloadSelectionAsZip };
  readonly preview: {
    readonly createFileStreamUrl: (path: string, token: string, signal?: AbortSignal) => Promise<string>;
  };
  readonly uploadFiles: ReturnType<typeof createBrowserUploadFileContent>;
  isUnauthorized(error: unknown): boolean;
  isReconnectRequired(error: unknown): boolean;
  toErrorMessage(error: unknown, fallback: string): string;
}

export interface BrowserOperationRuntimeDependencies {
  readonly createFolder: typeof createFolder;
  readonly deleteFile: typeof deleteFile;
  readonly uploadFileWithProgress: typeof uploadFileWithProgress;
  readonly moveFile: typeof moveFile;
  readonly copyFile: typeof copyFile;
  readonly listFiles: typeof listFiles;
  readonly prepareDownloadFile: typeof prepareDownloadFile;
  readonly fetchDownloadBlob: typeof fetchDownloadBlob;
  readonly triggerBrowserDownload: typeof triggerBrowserDownload;
  readonly downloadSelectionAsZip: typeof downloadSelectionAsZip;
  readonly createBrowserUploadFileContent: typeof createBrowserUploadFileContent;
}

const browserOperationDependencies = {
  createFolder,
  deleteFile,
  uploadFileWithProgress,
  moveFile,
  copyFile,
  listFiles,
  prepareDownloadFile,
  fetchDownloadBlob,
  triggerBrowserDownload,
  downloadSelectionAsZip,
  createBrowserUploadFileContent
} satisfies BrowserOperationRuntimeDependencies;

export function createBrowserOperationRuntime(
  overrides: Partial<BrowserOperationRuntimeDependencies> = {}
): OperationRuntimePort {
  const dependencies = { ...browserOperationDependencies, ...overrides } satisfies BrowserOperationRuntimeDependencies;
  return {
    request: {
      createAbortHandle: () => {
        const controller = new AbortController();
        return { signal: controller.signal, abort: () => controller.abort() };
      },
      createTransferId: () => crypto.randomUUID()
    },
    mutation: {
      createFolder: (parentPath, name, token) => dependencies.createFolder({ path: parentPath, name }, token).then((response) => response.result),
      deleteFile: (path, confirmName, token) => dependencies.deleteFile({ path, confirmName }, token).then((response) => response.result),
      uploadFile: (input, token, onProgress, signal) => dependencies.uploadFileWithProgress(input, token, onProgress, signal).then((response) => response.result),
      copyOrMove: (kind, source, destination, token, overwrite) => (kind === "move" ? dependencies.moveFile : dependencies.copyFile)({ path: source, destinationPath: destination, overwrite }, token).then((response) => response.result),
      listDestination: (path, token) => dependencies.listFiles(path, token)
    },
    download: {
      prepareDownloadFile: dependencies.prepareDownloadFile,
      fetchDownloadBlob: dependencies.fetchDownloadBlob,
      listFiles: dependencies.listFiles,
      triggerBrowserDownload: dependencies.triggerBrowserDownload,
      saveDownload: dependencies.triggerBrowserDownload
    },
    batch: { downloadSelectionAsZip: dependencies.downloadSelectionAsZip },
    preview: { createFileStreamUrl: createStreamingFileUrl },
    uploadFiles: dependencies.createBrowserUploadFileContent(),
    isUnauthorized: (error) => error instanceof ApiRequestError && error.status === 401,
    isReconnectRequired: (error) => error instanceof ApiRequestError && error.code === "account_reconnect_required",
    toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback
  };
}
