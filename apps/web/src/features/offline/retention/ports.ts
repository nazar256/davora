import type { RetainedFile, RetainedRootInput, RetainedSnapshot, RetentionAccount } from "./model";

export type RetentionResult<T> =
  | { readonly kind: "success"; readonly value: T }
  | { readonly kind: "failure"; readonly message: string };

export interface RetentionPreviewWrite {
  readonly file: RetainedFile;
  readonly blob?: Blob;
}

export interface RetentionPreviewRead {
  readonly file: RetainedFile;
  readonly blob?: Blob;
}

export interface RetainedFilePersistence {
  readonly rootId: string;
  readonly file: RetainedFile;
  readonly blob?: Blob;
}

/**
 * The feature's complete browser-persistence boundary.  Platform adapters own
 * serialized storage, Blob handling, validation, migration, and eviction.
 */
export interface RetentionRepository {
  readonly defaultCacheLimitBytes?: number;
  readSnapshot(account: RetentionAccount): Promise<RetentionResult<RetainedSnapshot>>;
  readPreview(account: RetentionAccount, path: string): Promise<RetentionResult<RetentionPreviewRead | undefined>>;
  writePreview(account: RetentionAccount, input: RetentionPreviewWrite): Promise<RetentionResult<RetainedSnapshot>>;
  beginRoot(account: RetentionAccount, root: RetainedRootInput): Promise<RetentionResult<RetainedSnapshot>>;
  persistRetainedFile(account: RetentionAccount, input: RetainedFilePersistence): Promise<RetentionResult<RetainedSnapshot>>;
  completeRoot(account: RetentionAccount, rootId: string): Promise<RetentionResult<RetainedSnapshot>>;
  removeRoot(account: RetentionAccount, rootId: string): Promise<RetentionResult<RetainedSnapshot>>;
  clearNormalCache(account: RetentionAccount): Promise<RetentionResult<RetainedSnapshot>>;
  purgeAccountNamespace(account: RetentionAccount, knownAccounts?: readonly RetentionAccount[]): Promise<RetentionResult<RetainedSnapshot>>;
  configureNormalCacheLimit(account: RetentionAccount, limitBytes: number): Promise<RetentionResult<RetainedSnapshot>>;
}

export interface RetentionUIPorts {
  clearFolderCacheForPath(cacheNamespace: string, folderPath: string): void;
  clearFolderAndSearchCache(cacheNamespace: string, options?: { preserveFolderPaths?: string[] }): void;
  clearSelectionChrome(): void;
  setStatus(message: string): void;
}

export interface RetentionPresentationPorts {
  formatCacheLimitStatus(limitBytes: number, accountName: string): string;
  formatRemoveOfflineCopyStatus(rootName: string): string;
  formatClearCacheStatus(accountName: string): string;
}

export interface UseRetentionPorts {
  readonly repository: RetentionRepository;
  readonly ui: RetentionUIPorts;
  readonly presentation: RetentionPresentationPorts;
  toRetentionAccount(account: { id: string; cacheNamespace: string }): RetentionAccount;
  readonly defaultCacheLimitBytes: number;
}
