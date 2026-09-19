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

  const accountEffectRanRef = useRef(false);
  const resetActiveSessionRef = useRef<(message: string, reconnectRequired?: boolean) => void>(() => undefined);

  useEffect(() => {
    const current = inputRef.current;
    const isFirstAccountEffect = !accountEffectRanRef.current;
    accountEffectRanRef.current = true;
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
