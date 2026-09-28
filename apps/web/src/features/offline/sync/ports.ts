import type {
  OfflineSyncArchiveInput,
  OfflineSyncJob,
  OfflineSyncPlan,
  OfflineSyncPlannedFile
} from "./model";

export type OfflineSyncCancellationReason = "aborted" | "superseded";

export type OfflineSyncOwnership =
  | { readonly kind: "current" }
  | { readonly kind: "cancelled"; readonly reason: OfflineSyncCancellationReason };

type PortFailure =
  | { readonly kind: "ordinaryFailure"; readonly message: string }
  | {
      readonly kind: "sessionTerminal";
      readonly reason: "unauthorized" | "reconnectRequired";
      readonly message: string;
    }
  | { readonly kind: "cancelled"; readonly reason: OfflineSyncCancellationReason };

export type OfflineSyncValueResult<T> = { readonly kind: "success"; readonly value: T } | PortFailure;
export type OfflineSyncActionResult = { readonly kind: "success" } | PortFailure;

export interface OfflineSyncDownload<TDownloaded> {
  readonly value: TDownloaded;
  readonly byteSize: number;
}

/** Persisted state of a file already retained under the sync root. */
export interface OfflineSyncRetainedMember {
  readonly blobSize: number;
  readonly readable: boolean;
}

export type OfflineSyncExecutionFact =
  | { readonly kind: "preparing"; readonly totalBytes?: number }
  | { readonly kind: "transferring"; readonly totalBytes?: number }
  | {
      readonly kind: "progress";
      readonly sourcePath: string;
      readonly persistedBytes: number;
      readonly inFlightBytes: number;
      readonly displayBytes: number;
      readonly totalBytes?: number;
    }
  | {
      readonly kind: "fileFailure";
      readonly failure: { readonly sourcePath: string; readonly stage: "download" | "persistence"; readonly error: string };
    };

export interface OfflineSyncExecutionPorts<TDownloaded, TSummary> {
  readonly signal: AbortSignal;
  checkOwnership(job: OfflineSyncJob): OfflineSyncOwnership;
  resolvePlan(input: OfflineSyncArchiveInput, signal: AbortSignal): Promise<OfflineSyncValueResult<OfflineSyncPlan>>;
  /**
   * Files already retained under the job's root, keyed by normalized path.
   * Used to skip re-downloading bytes a previous attempt already persisted.
   */
  readRetainedMembers(job: OfflineSyncJob, signal: AbortSignal): Promise<OfflineSyncValueResult<ReadonlyMap<string, OfflineSyncRetainedMember>>>;
  download(
    file: OfflineSyncPlannedFile,
    onProgress: (loadedBytes: number, totalBytes?: number) => boolean,
    signal: AbortSignal
  ): Promise<OfflineSyncValueResult<OfflineSyncDownload<TDownloaded>>>;
  persistOffline(
    job: OfflineSyncJob,
    file: OfflineSyncPlannedFile,
    downloaded: TDownloaded,
    signal: AbortSignal
  ): Promise<OfflineSyncActionResult>;
  markRootComplete(job: OfflineSyncJob, signal: AbortSignal): Promise<OfflineSyncActionResult>;
  readSummary(cacheNamespace: string, signal: AbortSignal): Promise<OfflineSyncValueResult<TSummary>>;
  publish(fact: OfflineSyncExecutionFact): boolean;
}
