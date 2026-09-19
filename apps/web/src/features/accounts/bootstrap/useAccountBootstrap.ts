import { useCallback, useEffect, useRef, useState } from "react";

import {
  canAttemptAutoRestore,
  type AccountSessionController,
  resolveSessionState,
  useAccountSession
} from "../session";
import type { UnlockPanelStageProps } from "../unlock";
import type { RestoreSessionStageProps } from "../restore";

import {
  projectAccountBootstrapGate,
  projectBootstrapErrorFromSession,
  resolveBootstrapAppBarSupportText,
  resolveCachedShellStatus,
  shouldMountBootstrapNavDrawer,
  type AccountBootstrapGate,
  type CachedShellMode
} from "./model";
import type { AccountBootstrapInput } from "./ports";

export interface AccountBootstrapController extends AccountSessionController {
  readonly sessionState: ReturnType<typeof resolveSessionState>;
  readonly gate: AccountBootstrapGate;
  readonly gateError?: string;
  readonly appBarSupportText: string;
  readonly mountNavDrawer: boolean;
  readonly cacheOnlyMode: boolean;
  readonly allowOfflineCachedShell: boolean;
  readonly unlockCode: string;
  readonly setUnlockCode: (value: string) => void;
  readonly submitUnlockCode: () => Promise<void>;
  readonly restoreStage: RestoreSessionStageProps;
  readonly unlockStage: UnlockPanelStageProps;
}

export function useAccountBootstrap(input: AccountBootstrapInput): AccountBootstrapController {
  const session = useAccountSession({
    explicitOfflineMode: input.explicitOfflineMode,
    activeAccount: input.activeAccount,
    token: input.token,
    offline: input.offline,
    ports: input.ports.session,
    onStatusChange: input.ports.onStatusChange
  });
  const [unlockDraft, setUnlockDraft] = useState<{ readonly accountId?: string; readonly value: string }>({ value: "" });
  const inputRef = useRef(input);
  inputRef.current = input;
  const cachedShellAnnouncementRef = useRef<string>();
  const cachedShellContextRef = useRef<{ readonly key: string; readonly mode: CachedShellMode }>();
  const mountedRef = useRef(false);
  const accountId = input.activeAccount?.id;
  const unlockCode = unlockDraft.accountId === accountId ? unlockDraft.value : "";
  const unlockCodeRef = useRef(unlockCode);
  unlockCodeRef.current = unlockCode;

  useEffect(() => {
    setUnlockDraft({ accountId, value: "" });
  }, [accountId]);

  useEffect(() => {
    if (input.token) {
      setUnlockDraft({ accountId, value: "" });
    }
  }, [accountId, input.token]);

  const setUnlockCode = useCallback((value: string) => {
    setUnlockDraft({ accountId: inputRef.current.activeAccount?.id, value });
  }, []);

  const cacheOnlyMode = input.offline || session.workerUnavailable || input.explicitOfflineMode;
  const allowOfflineCachedShell = Boolean(
    cacheOnlyMode
      && input.activeAccount
      && input.cacheNamespace
      && canAttemptAutoRestore(input.activeAccount)
  );
  const sessionState = resolveSessionState({
    lifecycle: session.lifecycle,
    accountCount: input.accountCount,
    activeAccount: input.activeAccount,
    token: input.token,
    allowOfflineCachedShell
  });
  const gate: AccountBootstrapGate = input.registryUnavailable
    ? { kind: "unavailable" }
    : projectAccountBootstrapGate(sessionState);
  const gateError = projectBootstrapErrorFromSession(sessionState) ?? session.bootstrapError;
  const appBarSupportText = resolveBootstrapAppBarSupportText(gate, input.activeAccount?.displayName ?? "current account");
  const { ensureSessionForAccount, setBootstrapError } = session;
  const cachedShellMode: CachedShellMode = input.explicitOfflineMode
    ? "explicit-offline"
    : input.offline
      ? "offline"
      : "worker-unavailable";
  const cachedShellEligible = Boolean(allowOfflineCachedShell && !input.token && input.activeAccount);
  const cachedShellKey = cachedShellEligible ? `${accountId}:${cachedShellMode}` : "";
  cachedShellContextRef.current = { key: cachedShellKey, mode: cachedShellMode };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!cachedShellEligible || !accountId) {
      cachedShellAnnouncementRef.current = undefined;
      return;
    }

    const mode = cachedShellMode;
    const announcementKey = cachedShellKey;
    if (cachedShellAnnouncementRef.current === announcementKey) {
      return;
    }
    cachedShellAnnouncementRef.current = announcementKey;
    queueMicrotask(() => {
      const current = inputRef.current;
      const context = cachedShellContextRef.current;
      if (!mountedRef.current || !context || !cachedShellEligible || context.key !== announcementKey || context.mode !== mode
        || current.activeAccount?.id !== accountId || current.token || !current.activeAccount) {
        return;
      }
      setBootstrapError(undefined);
      current.ports.onStatusChange(resolveCachedShellStatus(mode, current.activeAccount.displayName));
    });
  }, [
    cachedShellEligible,
    cachedShellKey,
    cachedShellMode,
    accountId,
    input.explicitOfflineMode,
    input.offline,
    input.ports,
    input.token,
    setBootstrapError
  ]);

  const submitUnlockCode = useCallback(async () => {
    const current = inputRef.current;
    const account = current.activeAccount;
    if (!account) {
      return;
    }
    const candidate = unlockCodeRef.current.trim();
    if (!candidate) {
      setBootstrapError("Enter the deployment unlock code to create a session.");
      return;
    }
    const established = await ensureSessionForAccount(account.id, candidate, "manual");
    if (established && inputRef.current.activeAccount?.id === account.id) {
      setUnlockDraft({ accountId: account.id, value: "" });
    }
  }, [ensureSessionForAccount, setBootstrapError]);

  const restoreStage: RestoreSessionStageProps = {
    accountName: input.activeAccount?.displayName ?? "current account",
    busy: session.sessionBusy,
    canRetryRestore: Boolean(input.activeAccount),
    error: session.bootstrapError,
    onRetryRestore: () => {
      const account = inputRef.current.activeAccount;
      if (account) {
        void ensureSessionForAccount(account.id);
      }
    }
  };
  const unlockStage: UnlockPanelStageProps = {
    accountHost: input.accountHost ?? "",
    accountName: input.activeAccount?.displayName ?? "current account",
    busy: session.sessionBusy,
    error: session.bootstrapError,
    onChange: setUnlockCode,
    onSubmit: () => void submitUnlockCode(),
    unlockCode
  };

  return {
    ...session,
    sessionState,
    gate,
    gateError,
    appBarSupportText,
    mountNavDrawer: shouldMountBootstrapNavDrawer(gate),
    cacheOnlyMode,
    allowOfflineCachedShell,
    unlockCode,
    setUnlockCode,
    submitUnlockCode,
    restoreStage,
    unlockStage
  };
}
