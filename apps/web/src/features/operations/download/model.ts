import type { BatchDownloadPlan } from "../../../lib/batchDownload";

export const DOWNLOAD_CONTEXT_CHANGED_MESSAGE =
  "Download stopped because its account or connection context changed.";

export const DOWNLOAD_NO_SESSION_MESSAGE = "No session available for this action.";

export function buildOfflineDownloadBlockedMessage(): string {
  return "Offline downloads are disabled. Reconnect to download files.";
}

export function buildServerUnavailableDownloadBlockedMessage(): string {
  return "Downloads are disabled while the local server is unavailable. Restore the server and retry.";
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildDownloadSelectionLabel(fileCount: number, directoryCount: number): string {
  const parts = [
    fileCount > 0 ? pluralize(fileCount, "file") : undefined,
    directoryCount > 0 ? pluralize(directoryCount, "folder") : undefined
  ].filter(Boolean);
  return parts.join(" and ") || "0 items";
}

export function buildBatchDownloadReadyMessage(plan: BatchDownloadPlan, activeAccountName: string): string {
  return `Preparing ${buildDownloadSelectionLabel(plan.selectedFileCount, plan.selectedDirectoryCount)} as ${plan.archiveName} in ${activeAccountName}.`;
}

export function buildBatchDownloadSuccessMessage(plan: BatchDownloadPlan, activeAccountName: string): string {
  const failedCount = plan.failedFiles.length;
  const baseMessage = `Downloaded ${buildDownloadSelectionLabel(plan.selectedFileCount, plan.selectedDirectoryCount)} as ${plan.archiveName} in ${activeAccountName}.`;
  if (failedCount > 0) {
    return `${baseMessage} ${buildBatchDownloadPartialSummary(plan)}.`;
  }
  return baseMessage;
}

export function buildBatchDownloadPartialSummary(plan: BatchDownloadPlan): string {
  const failedCount = plan.failedFiles.length;
  const succeededCount = Math.max(0, plan.files.length - failedCount);
  return `Downloaded ${succeededCount} of ${plan.files.length} files; ${failedCount} failed`;
}

export function buildBatchDownloadListErrorMessage(plan: BatchDownloadPlan, partialSummary: string): string {
  return `${partialSummary} Failed: ${plan.failedFiles.map((failure) => `${failure.sourcePath}: ${failure.error}`).join("; ")}`;
}
