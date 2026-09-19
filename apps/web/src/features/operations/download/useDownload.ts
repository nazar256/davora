import { useCallback, useRef } from "react";

import {
  buildOfflineDownloadBlockedMessage,
  buildServerUnavailableDownloadBlockedMessage,
  DOWNLOAD_NO_SESSION_MESSAGE
} from "./model";
import { runBatchDownloadOrchestration, runFocusedDownloadOrchestration, type BatchDownloadOrchestrationInput, type FocusedDownloadOrchestrationInput } from "./orchestration";
import type { DownloadOrchestrationPorts } from "./orchestrationPorts";

export interface UseDownloadInput {
  canOperate(): boolean;
  canDownloadFocused(path: string, isFolder: boolean): boolean;
  canDownloadBatch(entryCount: number): boolean;
  hasSession(): boolean;
  isCacheOnlyBlocked(): boolean;
  isOffline(): boolean;
  buildFocusedInput(path: string, displayPath: string): Omit<FocusedDownloadOrchestrationInput, "path" | "displayPath"> | undefined;
  buildBatchInput(): Omit<BatchDownloadOrchestrationInput, "entries" | "archiveInput" | "resolveDisplayPath"> | undefined;
  getBatchEntries(): BatchDownloadOrchestrationInput["entries"];
  getBatchArchiveInput(): BatchDownloadOrchestrationInput["archiveInput"];
  resolveDisplayPath(path: string): string;
  ports: DownloadOrchestrationPorts;
}

export function useDownload(input: UseDownloadInput) {
  const inputRef = useRef(input);
  inputRef.current = input;

  const reportBlockedDownload = () => {
    const current = inputRef.current;
    if (!current.hasSession()) {
      current.ports.presentation.reportListError(new Error(DOWNLOAD_NO_SESSION_MESSAGE));
      return;
    }
    if (current.isCacheOnlyBlocked()) {
      current.ports.presentation.reportListError(new Error(
        current.isOffline()
          ? buildOfflineDownloadBlockedMessage()
          : buildServerUnavailableDownloadBlockedMessage()
      ));
    }
  };

  const downloadFocused = useCallback(async (path: string, displayPath: string) => {
    const current = inputRef.current;
    if (!current.canOperate() || !current.canDownloadFocused(path, false)) {
      return;
    }
    if (!current.hasSession() || current.isCacheOnlyBlocked()) {
      reportBlockedDownload();
      return;
    }
    const sharedInput = current.buildFocusedInput(path, displayPath);
    if (!sharedInput) {
      return;
    }
    await runFocusedDownloadOrchestration({
      path,
      displayPath,
      ...sharedInput
    }, current.ports);
  }, []);

  const downloadBatch = useCallback(async () => {
    const current = inputRef.current;
    const entries = current.getBatchEntries();
    if (!current.canOperate() || !current.canDownloadBatch(entries.length)) {
      return;
    }
    if (entries.length === 1 && !entries[0]?.isFolder) {
      const entry = entries[0];
      await downloadFocused(entry.path, current.resolveDisplayPath(entry.path));
      return;
    }
    if (!current.hasSession() || current.isCacheOnlyBlocked()) {
      reportBlockedDownload();
      return;
    }
    const sharedInput = current.buildBatchInput();
    if (!sharedInput) {
      return;
    }
    await runBatchDownloadOrchestration({
      entries,
      archiveInput: current.getBatchArchiveInput(),
      resolveDisplayPath: current.resolveDisplayPath,
      ...sharedInput
    }, current.ports);
  }, [downloadFocused]);

  return { downloadFocused, downloadBatch };
}
