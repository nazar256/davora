import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  EXPLICIT_OFFLINE_STORAGE_UNAVAILABLE_STATUS,
  EXPLICIT_OFFLINE_TRANSITION_FAILED_STATUS,
  explicitOfflineStorageFailureStatus,
  setExplicitOfflineMode
} from "./controller";
import type {
  ExplicitOfflineModePorts,
  ExplicitOfflineModeStorage,
  ExplicitOfflineModeStorageRead
} from "./ports";

const NO_ACCOUNT_SNAPSHOT = { kind: "ready" as const, enabled: false };

function readAccountSnapshot(
  accountId: string | undefined,
  storage: ExplicitOfflineModeStorage
): ExplicitOfflineModeStorageRead {
  return accountId ? storage.read(accountId) : NO_ACCOUNT_SNAPSHOT;
}

export interface UseExplicitOfflineModeInput {
  readonly activeAccount?: { readonly id: string; readonly displayName: string };
  readonly ports: ExplicitOfflineModePorts;
}

/**
 * Owns the account-keyed mode snapshot. Reading is synchronous so an account
 * switch renders its persisted mode immediately; the layout effect restores
 * the network gate before any startup/request effects run.
 */
export function useExplicitOfflineMode(input: UseExplicitOfflineModeInput) {
  const [, forceRender] = useState(0);
  const [transitionError, setTransitionError] = useState<Error | undefined>();
  const inputRef = useRef(input);
  inputRef.current = input;
  const accountId = input.activeAccount?.id;
  const attemptedRepairRef = useRef<string | undefined>();
  const failedRepairRef = useRef<string | undefined>();
  const snapshot = readAccountSnapshot(accountId, input.ports.storage);
  const repairKey = snapshot.kind === "ready" && snapshot.repair
    ? `${accountId ?? ""}:${snapshot.repair.kind}:${snapshot.repair.kind === "write" ? snapshot.repair.value : ""}`
    : undefined;
  const storageFailClosed = snapshot.kind === "failed"
    || (repairKey !== undefined && failedRepairRef.current === repairKey);
  const enabled = storageFailClosed || (snapshot.kind === "ready" && snapshot.enabled);

  useLayoutEffect(() => {
    if (snapshot.kind === "failed") {
      input.ports.network.setBlocked(true);
      input.ports.entry.setStatus(explicitOfflineStorageFailureStatus(snapshot.reason));
      return;
    }
    if (failedRepairRef.current === repairKey && repairKey !== undefined) {
      input.ports.network.setBlocked(true);
      return;
    }
    if (snapshot.repair && attemptedRepairRef.current !== repairKey) {
      attemptedRepairRef.current = repairKey;
      const repairResult = input.ports.storage.repair(snapshot.repair);
      if (repairResult.kind === "failed") {
        failedRepairRef.current = repairKey;
        setTransitionError(repairResult.error);
        input.ports.network.setBlocked(true);
        input.ports.entry.setStatus(EXPLICIT_OFFLINE_STORAGE_UNAVAILABLE_STATUS);
        return;
      }
      failedRepairRef.current = undefined;
      setTransitionError(undefined);
      forceRender((value) => value + 1);
    }
    input.ports.network.setBlocked(enabled);
  }, [accountId, enabled, forceRender, input.ports, repairKey, snapshot]);

  const setEnabled = useCallback((nextEnabled: boolean) => {
    const current = inputRef.current;
    if (!current.activeAccount) {
      return;
    }
    const outcome = setExplicitOfflineMode(current.activeAccount, nextEnabled, current.ports, () => {
      forceRender((value) => value + 1);
    });
    if (outcome.kind === "failed") {
      setTransitionError(outcome.error);
      current.ports.entry.setStatus(EXPLICIT_OFFLINE_TRANSITION_FAILED_STATUS);
      forceRender((value) => value + 1);
    } else {
      setTransitionError(undefined);
    }
    return outcome;
  }, []);

  return {
    enabled,
    storageState: storageFailClosed
      ? "fail-closed" as const
      : "ready" as const,
    storageError: snapshot.kind === "failed" ? snapshot.error : transitionError,
    transitionError,
    setEnabled
  } as const;
}
