import { retainedBatchRootPath } from "../retention";
import type { OfflineSyncEntrySnapshot, OfflineSyncRootKind } from "./model";

export const OFFLINE_SYNC_NO_SESSION_MESSAGE = "No session available for offline sync.";

export function buildOfflineSyncBlockedMessage(offline: boolean): string {
  return offline
    ? "Reconnect before adding new offline sync items."
    : "Restore the local server before adding new offline sync items.";
}

export const OFFLINE_SYNC_ESTIMATE_ERROR_FALLBACK = "Unable to estimate storage before sync.";

export const OFFLINE_SYNC_CONTEXT_CHANGED_MESSAGE =
  "Offline sync stopped because its account or connection context changed.";

export const OFFLINE_SYNC_SESSION_EXPIRED_MESSAGE =
  "Session expired. Create a fresh session for this account.";

export const OFFLINE_SYNC_RECONNECT_REQUIRED_MESSAGE =
  "This account needs to be reconnected before syncing files.";

export const OFFLINE_SYNC_SUPERSEDED_MESSAGE = "Offline sync was superseded.";

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export interface OfflineSyncRootLabels {
  readonly rootKind: OfflineSyncRootKind;
  readonly rootPath: string;
  readonly rootName: string;
  readonly offlineFolderRoots: readonly string[];
  readonly dedupeKey: string;
}

export function deriveOfflineSyncRootLabels(entries: readonly OfflineSyncEntrySnapshot[]): OfflineSyncRootLabels {
  const rootKind: OfflineSyncRootKind = entries.length > 1 ? "batch" : entries[0]?.isFolder ? "folder" : "file";
  const rootPath = entries.length === 1 ? entries[0]?.path ?? "" : retainedBatchRootPath(entries.map((entry) => entry.path));
  const rootName = entries.length === 1 ? entries[0]?.name ?? "Offline item" : `${pluralize(entries.length, "item")} offline batch`;
  const offlineFolderRoots = entries.filter((entry) => entry.isFolder).map((entry) => entry.path);
  return {
    rootKind,
    rootPath,
    rootName,
    offlineFolderRoots,
    dedupeKey: `sync:${rootPath}`
  };
}

export function buildOfflineSyncAlreadyRunningStatus(rootName: string): string {
  return `Offline sync is already running for ${rootName}.`;
}

export function buildOfflineSyncStartedStatus(rootName: string, accountName: string): string {
  return `Started offline sync for ${rootName} in ${accountName}. You can keep browsing while it runs.`;
}

export function buildOfflineSyncPartialTransferMessage(failureCount: number): string {
  return `${failureCount} file${failureCount === 1 ? "" : "s"} failed to sync.`;
}

export function buildOfflineSyncPartialStatus(
  completedCount: number,
  totalCount: number,
  accountName: string
): string {
  return `Synced ${completedCount} of ${totalCount} files for offline use in ${accountName}.`;
}

export function buildOfflineSyncCompletedStatus(rootName: string, accountName: string): string {
  return `Kept ${rootName} offline on this device for ${accountName}.`;
}
