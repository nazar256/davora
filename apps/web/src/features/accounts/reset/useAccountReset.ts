import { useEffect, useLayoutEffect, useRef, useCallback } from "react";

import { executeAccountSwitchReset, executeSessionTerminalReset } from "./controller";
import type { SemanticAccountResetPorts } from "./ports";

export interface UseAccountResetInput {
  readonly activeAccountId?: string;
  readonly activeAccountDisplayName?: string;
  readonly hasActiveAccount: boolean;
  readonly ports: SemanticAccountResetPorts;
}

export function useAccountReset(input: UseAccountResetInput) {
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const lastAccountResetRef = useRef<{ readonly seen: boolean; readonly accountId?: string }>({ seen: false });
  const resetActiveSessionRef = useRef<(message: string, reconnectRequired?: boolean) => void>(() => undefined);

  useEffect(() => {
    const current = inputRef.current;
    const previous = lastAccountResetRef.current;
    const isFirstAccountEffect = !previous.seen;
    lastAccountResetRef.current = { seen: true, accountId: current.activeAccountId };
    // React StrictMode replays the mount effect with an unchanged account id;
    // without an actual account switch there is nothing to reset.
    if (!isFirstAccountEffect && previous.accountId === current.activeAccountId) {
      return;
    }
    executeAccountSwitchReset(current.ports, {
      isFirstAccountEffect,
      locationSearch: current.ports.navigation.getLocationSearch(),
      hasActiveAccount: current.hasActiveAccount,
      accountId: current.activeAccountId,
      accountDisplayName: current.activeAccountDisplayName
    });
  }, [input.activeAccountId]);

  const resetActiveSession = useCallback((message: string, reconnectRequired = false) => {
    const current = inputRef.current;
    if (!current.activeAccountId) {
      return;
    }
    executeSessionTerminalReset(current.ports, {
      accountId: current.activeAccountId,
      message,
      reconnectRequired
    });
  }, []);

  useLayoutEffect(() => {
    resetActiveSessionRef.current = resetActiveSession;
  }, [resetActiveSession]);

  return {
    resetActiveSession,
    resetActiveSessionRef
  } as const;
}
