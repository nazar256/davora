import { useCallback, useEffect, useRef, useState } from "react";

import { executeRetentionCommand } from "./controller";
import type { RetainedRootSummary, RetainedSnapshot, RetentionAccount } from "./model";
import { selectRequiredOfflineAncestors } from "./model";
import type { RetentionCommand } from "./controller";
import type { UseRetentionPorts } from "./ports";

type SnapshotCommand = Exclude<RetentionCommand, { readonly kind: "readPreview" }>;

interface RetentionOwner {
  readonly contextKey: string;
  readonly token: symbol;
  mounted: boolean;
}

export interface UseRetentionInput {
  readonly activeAccount?: { readonly id: string; readonly cacheNamespace: string };
  readonly cacheNamespace?: string;
  readonly accountName: string;
  readonly ports: UseRetentionPorts;
}

export function useRetention(input: UseRetentionInput) {
  const [cacheSummary, setCacheSummary] = useState(() => ({
    itemCount: 0,
    totalBytes: 0,
    limitBytes: input.ports.defaultCacheLimitBytes
  }));
  const [retentionSnapshot, setRetentionSnapshot] = useState<RetainedSnapshot>();

  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const contextKey = `${input.activeAccount?.id ?? ""}\u0000${input.cacheNamespace ?? ""}`;
  const committedOwnerRef = useRef<RetentionOwner>();
  useEffect(() => {
    const owner: RetentionOwner = { contextKey, token: Symbol("retention-owner"), mounted: true };
    committedOwnerRef.current = owner;
    return () => {
      owner.mounted = false;
      if (committedOwnerRef.current === owner) {
        committedOwnerRef.current = undefined;
      }
    };
  }, [contextKey]);

  const applyRetentionSnapshot = useCallback((snapshot: RetainedSnapshot) => {
    setRetentionSnapshot(snapshot);
    setCacheSummary(snapshot.normalCache);
  }, []);

  const retentionStillCurrent = useCallback((
    account: RetentionAccount,
    operationIsCurrent: () => boolean = () => true,
    capturedOwner?: RetentionOwner
  ) => {
    const owner = committedOwnerRef.current;
    return operationIsCurrent()
      && owner !== undefined
      && owner.mounted
      && owner.contextKey === contextKey
      && (capturedOwner === undefined || owner === capturedOwner)
      && inputRef.current.activeAccount?.id === account.accountId
      && inputRef.current.cacheNamespace === account.cacheNamespace;
  }, [contextKey]);

  const publishCacheSummary = useCallback((summary: RetainedSnapshot["normalCache"]) => {
    setCacheSummary(summary);
  }, []);

  const executeSnapshotCommand = useCallback(async (
    command: SnapshotCommand,
    operationIsCurrent: () => boolean = () => true,
    capturedOwner: RetentionOwner | undefined = committedOwnerRef.current
  ) => {
    const account = command.account;
    const { repository } = inputRef.current.ports;
    const outcome = await executeRetentionCommand(command, repository, {
      isCurrent: () => retentionStillCurrent(account, operationIsCurrent, capturedOwner),
      publish: (snapshot) => {
        if (!retentionStillCurrent(account, operationIsCurrent, capturedOwner)
          || snapshot.account.accountId !== account.accountId
          || snapshot.account.cacheNamespace !== account.cacheNamespace) {
          return false;
        }
        applyRetentionSnapshot(snapshot);
        return true;
      }
    });
    // Allow a queued unmount/context replacement to commit before wrappers publish terminal effects.
    await Promise.resolve();
    return retentionStillCurrent(account, operationIsCurrent, capturedOwner)
      ? outcome
      : { kind: "superseded" as const };
  }, [applyRetentionSnapshot, retentionStillCurrent]);

  const refreshCacheSummary = useCallback(async () => {
    const current = inputRef.current;
    if (!current.cacheNamespace) {
      setCacheSummary({ itemCount: 0, totalBytes: 0, limitBytes: current.ports.defaultCacheLimitBytes });
      setRetentionSnapshot(undefined);
      return;
    }
    if (!current.activeAccount) {
      return;
    }
    const account = current.ports.toRetentionAccount(current.activeAccount);
    const capturedOwner = committedOwnerRef.current;
    const outcome = await executeSnapshotCommand({
      kind: "readSnapshot",
      account
    }, () => true, capturedOwner);
    if (!retentionStillCurrent(account, () => true, capturedOwner)) {
      return;
    }
    if (outcome.kind === "failed") {
      throw new Error(outcome.message);
    }
  }, [executeSnapshotCommand, retentionStillCurrent]);

  useEffect(() => {
    void refreshCacheSummary().catch(() => undefined);
  }, [input.cacheNamespace, refreshCacheSummary]);

  const configureNormalCacheLimit = useCallback(async (limitBytes: number) => {
    const current = inputRef.current;
    if (!current.cacheNamespace || !current.activeAccount) {
      return;
    }
    const account = current.ports.toRetentionAccount(current.activeAccount);
    const capturedOwner = committedOwnerRef.current;
    const outcome = await executeSnapshotCommand({
      kind: "configureNormalCacheLimit",
      account,
      limitBytes
    }, () => true, capturedOwner);
    if (!retentionStillCurrent(account, () => true, capturedOwner)) {
      return;
    }
    if (outcome.kind === "failed") {
      throw new Error(outcome.message);
    }
    if (outcome.kind === "superseded") {
      return;
    }
    current.ports.ui.setStatus(current.ports.presentation.formatCacheLimitStatus(limitBytes, current.accountName));
  }, [executeSnapshotCommand, retentionStillCurrent]);

  const removeOfflineCopy = useCallback(async (root: Pick<RetainedRootSummary, "rootId" | "rootPath" | "rootName" | "kind">) => {
    const current = inputRef.current;
    if (!current.cacheNamespace || !current.activeAccount) {
      return;
    }
    const account = current.ports.toRetentionAccount(current.activeAccount);
    const capturedOwner = committedOwnerRef.current;
    const result = await executeSnapshotCommand({ kind: "removeRoot", account, rootId: root.rootId }, () => true, capturedOwner);
    if (!retentionStillCurrent(account, () => true, capturedOwner)) {
      return;
    }
    if (result.kind === "failed") {
      throw new Error(result.message);
    }
    if (result.kind === "superseded") {
      return;
    }
    if (root.kind === "folder") {
      current.ports.ui.clearFolderCacheForPath(account.cacheNamespace, root.rootPath);
    } else if (root.kind === "batch") {
      current.ports.ui.clearFolderAndSearchCache(account.cacheNamespace);
    }
    current.ports.ui.setStatus(current.ports.presentation.formatRemoveOfflineCopyStatus(root.rootName));
  }, [executeSnapshotCommand, retentionStillCurrent]);

  const clearNormalCache = useCallback(async () => {
    const current = inputRef.current;
    if (!current.cacheNamespace || !current.activeAccount) {
      return;
    }
    const account = current.ports.toRetentionAccount(current.activeAccount);
    const capturedOwner = committedOwnerRef.current;
    const result = await executeSnapshotCommand({ kind: "clearNormalCache", account }, () => true, capturedOwner);
    if (!retentionStillCurrent(account, () => true, capturedOwner)) {
      return;
    }
    if (result.kind === "failed") {
      throw new Error(result.message);
    }
    if (result.kind === "superseded" || !result.snapshot) {
      return;
    }
    current.ports.ui.clearFolderAndSearchCache(account.cacheNamespace, {
      preserveFolderPaths: [...selectRequiredOfflineAncestors(result.snapshot)]
    });
    current.ports.ui.clearSelectionChrome();
    current.ports.ui.setStatus(current.ports.presentation.formatClearCacheStatus(current.accountName));
  }, [executeSnapshotCommand, retentionStillCurrent]);

  return {
    retentionSnapshot,
    cacheSummary,
    retentionStillCurrent,
    refreshCacheSummary,
    publishCacheSummary,
    executeSnapshotCommand,
    configureNormalCacheLimit,
    removeOfflineCopy,
    clearNormalCache
  } as const;
}
