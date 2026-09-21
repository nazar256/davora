import type { ExplicitOfflineModePorts, ExplicitOfflineTransferTerminalMessage } from "./ports";

export const EXPLICIT_OFFLINE_ENABLED_STATUS = (accountName: string): string =>
  `Explicit offline mode enabled for ${accountName}.`;

export const EXPLICIT_OFFLINE_DISABLED_STATUS = (accountName: string): string =>
  `Returning ${accountName} online.`;

export const EXPLICIT_OFFLINE_STORAGE_CORRUPT_STATUS =
  "Explicit offline mode storage is corrupt. Networking remains blocked; choose Go online to reset it.";

export const EXPLICIT_OFFLINE_STORAGE_UNAVAILABLE_STATUS =
  "Explicit offline mode storage is unavailable. Networking remains blocked; retry Go online when browser storage is available.";

export const EXPLICIT_OFFLINE_TRANSITION_FAILED_STATUS =
  "Unable to change explicit offline mode because browser storage is unavailable. The current mode is unchanged; retry when browser storage is available.";

export function explicitOfflineStorageFailureStatus(reason: "corrupt" | "unavailable"): string {
  return reason === "corrupt"
    ? EXPLICIT_OFFLINE_STORAGE_CORRUPT_STATUS
    : EXPLICIT_OFFLINE_STORAGE_UNAVAILABLE_STATUS;
}

export const EXPLICIT_OFFLINE_TRANSFER_TERMINAL_MESSAGE: ExplicitOfflineTransferTerminalMessage = Object.freeze({
  download: "Download stopped because its account or connection context changed.",
  sync: "Offline sync stopped because its account or connection context changed.",
  upload: "Upload stopped because its account or connection context changed.",
  copy: "Copy stopped because its account or connection context changed.",
  move: "Move stopped because its account or connection context changed."
});

export type ExplicitOfflineModeTransitionResult =
  | { readonly kind: "committed"; readonly enabled: boolean }
  | { readonly kind: "failed"; readonly error: Error };

/**
 * Applies the explicit-offline transition as one ordered safety transaction.
 * Persistence and the network gate always precede cleanup when entering;
 * leaving only persists and reopens the gate.
 */
export function setExplicitOfflineMode(
  account: { readonly id: string; readonly displayName: string },
  enabled: boolean,
  ports: ExplicitOfflineModePorts,
  onCommitted: () => void = () => undefined
): ExplicitOfflineModeTransitionResult {
  const read = ports.storage.read(account.id);
  const commit = !enabled && read.kind === "failed" && read.reason === "corrupt"
    ? ports.storage.reset()
    : ports.storage.commit(account.id, enabled);
  if (commit.kind === "failed") {
    return commit;
  }
  ports.network.setBlocked(enabled);
  onCommitted();
  if (!enabled) {
    ports.entry.setStatus(EXPLICIT_OFFLINE_DISABLED_STATUS(account.displayName));
    return { kind: "committed", enabled };
  }

  ports.entry.pauseFolderAudio();
  ports.entry.closeDestinationPicker();
  ports.entry.clearActionDialog();
  ports.entry.closePreview();
  ports.entry.setWorkerUnavailable(false);
  ports.entry.failActiveTransfers(account.id, EXPLICIT_OFFLINE_TRANSFER_TERMINAL_MESSAGE);
  ports.entry.setStatus(EXPLICIT_OFFLINE_ENABLED_STATUS(account.displayName));
  return { kind: "committed", enabled };
}
