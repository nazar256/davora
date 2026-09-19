import { useRef } from "react";

import type { FileEntry } from "@davora/shared";

import { useDownload, type UseDownloadInput } from "../useDownload";
import type {
  DownloadWorkspaceCurrent,
  DownloadWorkspacePolicy,
  DownloadWorkspaceSelection,
  UseDownloadWorkspaceInput
} from "./ports";

interface DownloadWorkspaceSnapshot {
  readonly sourceCurrent: DownloadWorkspaceCurrent;
  readonly sourceSelection: DownloadWorkspaceSelection;
  readonly current: DownloadWorkspaceCurrent;
  readonly selection: DownloadWorkspaceSelection;
  readonly policy: DownloadWorkspacePolicy;
  readonly resolveDisplayPath: (path: string) => string;
}

function cloneEntry(entry: FileEntry): FileEntry {
  return { ...entry };
}

function captureSelection(selection: DownloadWorkspaceSelection): DownloadWorkspaceSelection {
  const entries = selection.entries.map(cloneEntry);
  return {
    entries,
    archiveInput: {
      archiveLabel: selection.archiveInput.archiveLabel,
      roots: selection.archiveInput.roots.map((root) => ({
        entry: cloneEntry(root.entry),
        archiveRoot: root.archiveRoot
      }))
    }
  };
}

function captureSnapshot(input: UseDownloadWorkspaceInput): DownloadWorkspaceSnapshot {
  return {
    sourceCurrent: input.current,
    sourceSelection: input.selection,
    current: {
      accountId: input.current.accountId,
      accountName: input.current.accountName,
      token: input.current.token,
      operationContextToken: input.current.operationContextToken,
      cacheOnlyMode: input.current.cacheOnlyMode,
      offline: input.current.offline,
      hasSession: input.current.hasSession
    },
    selection: captureSelection(input.selection),
    policy: {
      canOperate: input.policy.canOperate,
      canDownloadFocused: input.policy.canDownloadFocused,
      canDownloadBatch: input.policy.canDownloadBatch
    },
    resolveDisplayPath: input.resolveDisplayPath
  };
}

function useSnapshot(input: UseDownloadWorkspaceInput): DownloadWorkspaceSnapshot {
  const snapshotRef = useRef<DownloadWorkspaceSnapshot>();
  const previous = snapshotRef.current;
  if (previous && previous.sourceCurrent === input.current && previous.sourceSelection === input.selection) {
    return previous;
  }
  const next = captureSnapshot(input);
  snapshotRef.current = next;
  return next;
}

export interface DownloadWorkspaceCommands {
  readonly downloadFocused: (path: string, displayPath: string) => Promise<void>;
  readonly downloadBatch: () => Promise<void>;
}

export interface DownloadWorkspaceOutput {
  readonly commands: DownloadWorkspaceCommands;
}

export function useDownloadWorkspace(input: UseDownloadWorkspaceInput): DownloadWorkspaceOutput {
  const snapshot = useSnapshot(input);
  const childInput: UseDownloadInput = {
    canOperate: snapshot.policy.canOperate,
    canDownloadFocused: snapshot.policy.canDownloadFocused,
    canDownloadBatch: snapshot.policy.canDownloadBatch,
    hasSession: snapshot.current.hasSession,
    isCacheOnlyBlocked: () => snapshot.current.cacheOnlyMode,
    isOffline: () => snapshot.current.offline,
    buildFocusedInput: () => {
      if (!snapshot.current.accountId || !snapshot.current.token) {
        return undefined;
      }
      return {
        accountId: snapshot.current.accountId,
        context: snapshot.current.operationContextToken
      };
    },
    buildBatchInput: () => {
      if (!snapshot.current.accountId || !snapshot.current.token) {
        return undefined;
      }
      return {
        accountId: snapshot.current.accountId,
        accountName: snapshot.current.accountName,
        context: snapshot.current.operationContextToken
      };
    },
    getBatchEntries: () => snapshot.selection.entries,
    getBatchArchiveInput: () => snapshot.selection.archiveInput,
    resolveDisplayPath: snapshot.resolveDisplayPath,
    ports: input.ports
  };
  const commands = useDownload(childInput);
  return { commands };
}
