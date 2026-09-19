import { ApiRequestError, fetchDownloadBlob, listFiles } from "../../lib/api";

export interface OfflineSyncRuntimeAbortHandle {
  readonly signal: AbortSignal;
  abort(): void;
}

export interface OfflineSyncRuntimeDownloadOptions {
  readonly onProgress?: (loadedBytes: number, totalBytes?: number) => void;
  readonly signal?: AbortSignal;
}

export interface BrowserOfflineSyncRuntime {
  createAbortHandle(): OfflineSyncRuntimeAbortHandle;
  createTransferId(): string;
  listFiles(path: string, token: string, signal?: AbortSignal): ReturnType<typeof listFiles>;
  fetchDownloadBlob(path: string, token: string, options?: OfflineSyncRuntimeDownloadOptions): ReturnType<typeof fetchDownloadBlob>;
  readBlobText(blob: Blob): Promise<string>;
  isUnauthorized(error: unknown): boolean;
  isReconnectRequired(error: unknown): boolean;
  toErrorMessage(error: unknown, fallback: string): string;
}

export type OfflineSyncRuntimePort = BrowserOfflineSyncRuntime;

export interface BrowserOfflineSyncRuntimeDependencies {
  readonly listFiles: typeof listFiles;
  readonly fetchDownloadBlob: typeof fetchDownloadBlob;
}

const browserOfflineSyncDependencies = {
  listFiles,
  fetchDownloadBlob
} satisfies BrowserOfflineSyncRuntimeDependencies;

export function createBrowserOfflineSyncRuntime(
  overrides: Partial<BrowserOfflineSyncRuntimeDependencies> = {}
): BrowserOfflineSyncRuntime {
  const dependencies = { ...browserOfflineSyncDependencies, ...overrides } satisfies BrowserOfflineSyncRuntimeDependencies;
  return {
    createAbortHandle: () => new AbortController(),
    createTransferId: () => crypto.randomUUID(),
    listFiles: (path, token, signal) => dependencies.listFiles(path, token, signal),
    fetchDownloadBlob: (path, token, options = {}) => dependencies.fetchDownloadBlob(path, token, options),
    readBlobText: async (blob) => typeof blob.text === "function" ? blob.text() : "",
    isUnauthorized: (error) => error instanceof ApiRequestError && error.status === 401,
    isReconnectRequired: (error) => error instanceof ApiRequestError && error.code === "account_reconnect_required",
    toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback
  };
}
