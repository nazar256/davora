import { useCallback, useEffect, useRef, useState } from "react";
import { assertNever, type ConnectedAccount } from "@davora/shared";

import { applyAccountSessionMutation, executeEnsureSession, executeHealthLoad } from "./controller";
import {
  initialSessionLifecycle,
  projectAutoRestorePausedForAccountId,
  projectBootstrapError,
  projectHealthLoading,
  projectHealthReady,
  projectHealthRootPath,
  projectSessionBusy,
  projectUnlockRequired,
  projectWorkerUnavailable,
  shouldAttemptAutoRestore,
  shouldSkipHealthLoad,
  transitionActiveAccountChange,
  transitionClearBootstrapError,
  transitionEnsureSessionFailure,
  transitionEnsureSessionStart,
  transitionEnsureSessionSuccess,
  transitionHealthLoadFailure,
  transitionHealthLoadStart,
  transitionHealthLoadSuccess,
  transitionSetWorkerUnavailable,
  type SessionLifecycleState
} from "./model";
import type { AccountSessionPorts } from "./ports";

export interface UseAccountSessionInput {
  readonly explicitOfflineMode: boolean;
  readonly activeAccount?: ConnectedAccount;
  readonly token?: string;
  readonly offline: boolean;
  readonly ports: AccountSessionPorts;
  readonly onStatusChange: (message: string) => void;
}

export interface AccountSessionController {
  readonly lifecycle: SessionLifecycleState;
  readonly healthLoading: boolean;
  readonly unlockRequired: boolean;
  readonly healthRootPath: string;
  readonly workerUnavailable: boolean;
  readonly bootstrapError?: string;
  readonly sessionBusy: boolean;
  readonly autoRestorePausedForAccountId?: string;
  readonly setBootstrapError: (message?: string) => void;
  readonly setWorkerUnavailable: (unavailable: boolean) => void;
  readonly ensureSessionForAccount: (
    accountId: string,
    candidateUnlockCode?: string,
    source?: "auto" | "manual"
  ) => Promise<import("@davora/shared").AppSession | undefined>;
}

interface EnsureInFlightRecord {
  readonly generation: number;
  readonly accountId: string;
  readonly promise: Promise<import("@davora/shared").AppSession | undefined>;
}

export function useAccountSession(input: UseAccountSessionInput): AccountSessionController {
  const [lifecycle, setLifecycle] = useState<SessionLifecycleState>(() => initialSessionLifecycle(input.explicitOfflineMode));
  const inputRef = useRef(input);
  inputRef.current = input;
  const generationRef = useRef({
    accountId: input.activeAccount?.id,
    explicitOfflineMode: input.explicitOfflineMode,
    value: 0
  });
  if (generationRef.current.accountId !== input.activeAccount?.id
    || generationRef.current.explicitOfflineMode !== input.explicitOfflineMode) {
    generationRef.current = {
      accountId: input.activeAccount?.id,
      explicitOfflineMode: input.explicitOfflineMode,
      value: generationRef.current.value + 1
    };
  }
  const ensureInFlightRef = useRef<EnsureInFlightRecord | undefined>();
  const restoredWithoutTokenRef = useRef<string | undefined>();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current = {
        ...generationRef.current,
        value: generationRef.current.value + 1
      };
    };
  }, []);

  useEffect(() => {
    if (input.token) {
      restoredWithoutTokenRef.current = undefined;
    }
  }, [input.token]);

  useEffect(() => {
    restoredWithoutTokenRef.current = undefined;
    setLifecycle((current) => transitionActiveAccountChange(current));
  }, [input.activeAccount?.id]);

  useEffect(() => {
    if (shouldSkipHealthLoad(input.explicitOfflineMode)) {
      setLifecycle({ kind: "skipped" });
      return;
    }

    let cancelled = false;
    void (async () => {
      setLifecycle((current) => transitionHealthLoadStart(current, input.explicitOfflineMode));
      const outcome = await executeHealthLoad(input.ports, { isCancelled: () => cancelled });
      if (cancelled || outcome.kind === "cancelled") {
        return;
      }
      if (outcome.kind === "success") {
        setLifecycle((current) => transitionHealthLoadSuccess(current, outcome.projection));
      } else {
        setLifecycle((current) => transitionHealthLoadFailure(current, outcome.projection));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [input.explicitOfflineMode, input.ports]);

  const setBootstrapError = useCallback((message?: string) => {
    if (message === undefined) {
      setLifecycle((current) => transitionClearBootstrapError(current));
      return;
    }

    setLifecycle((current) => {
      const context = readMutableBootstrapContext(current);
      if (!context) {
        return current;
      }
      return { ...context, bootstrapError: message };
    });
  }, []);

  const setWorkerUnavailable = useCallback((unavailable: boolean) => {
    setLifecycle((current) => transitionSetWorkerUnavailable(current, unavailable));
  }, []);

  const ensureSessionForAccount = useCallback(async (
    accountId: string,
    candidateUnlockCode?: string,
    source: "auto" | "manual" = "manual"
  ) => {
    const capturedGeneration = generationRef.current.value;
    const existing = ensureInFlightRef.current;
    if (existing?.generation === capturedGeneration && existing.accountId === accountId) {
      return existing.promise;
    }

    const isCurrent = () => generationRef.current.value === capturedGeneration
      && mountedRef.current
      && inputRef.current.activeAccount?.id === accountId
      && !inputRef.current.explicitOfflineMode;
    const runRef: { current?: Promise<import("@davora/shared").AppSession | undefined> } = {};
    const run = (async () => {
      if (!isCurrent()) {
        return undefined;
      }
      setLifecycle((current) => isCurrent() ? transitionEnsureSessionStart(current, accountId) : current);
      try {
        const outcome = await executeEnsureSession(inputRef.current.ports, {
          accountId,
          unlockCode: candidateUnlockCode,
          source
        }, { isCurrent });
        if (outcome.kind === "cancelled" || !isCurrent()) {
          return undefined;
        }
        if (outcome.kind === "success") {
          if (!isCurrent()) {
            return undefined;
          }
          restoredWithoutTokenRef.current = accountId;
          setLifecycle((current) => isCurrent() ? transitionEnsureSessionSuccess(current) : current);
          if (!isCurrent()) {
            return undefined;
          }
          inputRef.current.onStatusChange(outcome.statusMessage);
          return outcome.session;
        }

        applyAccountSessionMutation(inputRef.current.ports, outcome.mutation);
        if (!isCurrent()) {
          return undefined;
        }
        setLifecycle((current) => isCurrent() ? transitionEnsureSessionFailure(current, outcome, accountId) : current);
        if (!isCurrent()) {
          return undefined;
        }
        inputRef.current.onStatusChange(outcome.statusMessage);
        return undefined;
      } finally {
        if (ensureInFlightRef.current?.promise === runRef.current) {
          ensureInFlightRef.current = undefined;
        }
      }
    })();

    runRef.current = run;
    ensureInFlightRef.current = { generation: capturedGeneration, accountId, promise: run };
    return run;
  }, []);

  const healthLoading = projectHealthLoading(lifecycle);
  const healthReady = projectHealthReady(lifecycle);
  const unlockRequired = projectUnlockRequired(lifecycle);
  const sessionBusy = projectSessionBusy(lifecycle);
  const autoRestorePausedForAccountId = projectAutoRestorePausedForAccountId(lifecycle);

  useEffect(() => {
    const current = inputRef.current;
    if (restoredWithoutTokenRef.current === current.activeAccount?.id) {
      return;
    }
    if (!shouldAttemptAutoRestore({
      activeAccount: current.activeAccount,
      token: current.token,
      unlockRequired,
      healthLoading,
      healthReady,
      sessionBusy,
      offline: current.offline,
      explicitOfflineMode: current.explicitOfflineMode,
      autoRestorePausedForAccountId
    })) {
      return;
    }

    void ensureSessionForAccount(current.activeAccount!.id, undefined, "auto");
  }, [
    autoRestorePausedForAccountId,
    ensureSessionForAccount,
    healthLoading,
    healthReady,
    input.activeAccount,
    input.explicitOfflineMode,
    input.offline,
    input.token,
    sessionBusy,
    unlockRequired
  ]);

  return {
    lifecycle,
    healthLoading,
    unlockRequired,
    healthRootPath: projectHealthRootPath(lifecycle),
    workerUnavailable: projectWorkerUnavailable(lifecycle),
    bootstrapError: projectBootstrapError(lifecycle),
    sessionBusy,
    autoRestorePausedForAccountId,
    setBootstrapError,
    setWorkerUnavailable,
    ensureSessionForAccount
  };
}

function readMutableBootstrapContext(
  lifecycle: SessionLifecycleState
): SessionLifecycleState | undefined {
  switch (lifecycle.kind) {
    case "healthReady":
    case "awaitingRestore":
      return lifecycle;
    case "skipped":
    case "checking":
    case "healthFailed":
    case "restoring":
      return undefined;
    default:
      return assertNever(lifecycle, "session lifecycle mutable bootstrap context");
  }
}
