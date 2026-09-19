import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type SetStateAction } from "react";
import type { ConnectedAccount } from "@davora/shared";

import { executeRemoveAccount } from "./controller";
import type { RemoveAccountPorts } from "./ports";

export interface RemoveAccountOpenerPorts {
  pushRemoveAccountSurface(): void;
  closeSettings(): void;
}

export interface UseRemoveAccountInput {
  readonly activeAccount?: ConnectedAccount;
  readonly ports: RemoveAccountPorts;
  readonly openerPorts: RemoveAccountOpenerPorts;
  readonly onStatusChange: (message: string) => void;
}

export function useRemoveAccount(input: UseRemoveAccountInput) {
  const [target, setTargetState] = useState<ConnectedAccount | undefined>();
  const [confirmation, setConfirmationState] = useState("");
  const [error, setErrorState] = useState<string | undefined>();
  const [retryToken, setRetryTokenState] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const inputRef = useRef(input);
  const targetRef = useRef(target);
  const confirmationRef = useRef(confirmation);
  inputRef.current = input;
  targetRef.current = target;
  confirmationRef.current = confirmation;

  const accountId = input.activeAccount?.id;
  const generationRef = useRef({ ownerAccountId: accountId, value: 0 });
  const replacementRef = useRef(false);
  if (accountId && generationRef.current.ownerAccountId && generationRef.current.ownerAccountId !== accountId) {
    generationRef.current = { ownerAccountId: accountId, value: generationRef.current.value + 1 };
    replacementRef.current = true;
  } else if (accountId) {
    generationRef.current = { ...generationRef.current, ownerAccountId: accountId };
  }
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const nextAttemptIdRef = useRef(1);
  const activeAttemptRef = useRef<number>();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current = { ...generationRef.current, value: generationRef.current.value + 1 };
      activeAttemptRef.current = undefined;
      busyRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (!replacementRef.current) {
      return;
    }
    replacementRef.current = false;
    activeAttemptRef.current = undefined;
    busyRef.current = false;
    setBusy(false);
  }, [accountId]);

  const invalidateAttempt = useCallback(() => {
    activeAttemptRef.current = undefined;
    if (busyRef.current) {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
  const setTarget = useCallback((next: SetStateAction<ConnectedAccount | undefined>) => {
    invalidateAttempt();
    setTargetState(next);
  }, [invalidateAttempt]);
  const setConfirmation = useCallback((next: SetStateAction<string>) => {
    invalidateAttempt();
    setConfirmationState(next);
  }, [invalidateAttempt]);
  const beginAttempt = useCallback(() => {
    const attempt = nextAttemptIdRef.current++;
    activeAttemptRef.current = attempt;
    return { attempt, generation: generationRef.current.value };
  }, []);

  const confirmRemoveAccount = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current) {
      return;
    }
    const owned = beginAttempt();
    const current = inputRef.current;
    busyRef.current = true;
    setBusy(true);
    setErrorState(undefined);
    const isCurrent = () => mountedRef.current
      && generationRef.current.value === owned.generation
      && activeAttemptRef.current === owned.attempt;
    try {
      const outcome = await executeRemoveAccount(current.ports, {
        target: targetRef.current,
        confirmation: confirmationRef.current,
        retryToken
      });
      const ownsSuccessfulRemoval = outcome.kind === "success"
        && targetRef.current !== undefined
        && !outcome.snapshot.accounts.some((record) => record.account.id === targetRef.current?.id)
        && mountedRef.current
        && (activeAttemptRef.current === owned.attempt || generationRef.current.value !== owned.generation);
      if (!isCurrent() && !ownsSuccessfulRemoval) {
        return;
      }
      if (outcome.kind === "validation-error" || outcome.kind === "failure") {
        setErrorState(outcome.message);
        return;
      }
      current.onStatusChange(outcome.statusMessage);
      if (outcome.kind === "degraded-success") {
        setErrorState(outcome.error);
        if (outcome.retryToken) {
          setRetryTokenState(outcome.retryToken);
          return;
        }
      }
      setTargetState(undefined);
      setConfirmationState("");
      setRetryTokenState(undefined);
    } finally {
      if (isCurrent()) {
        busyRef.current = false;
        setBusy(false);
        activeAttemptRef.current = undefined;
      }
    }
  }, [beginAttempt, retryToken]);

  const openRemoveFromSettings = useCallback(() => {
    invalidateAttempt();
    const current = inputRef.current;
    if (!current.activeAccount) {
      return;
    }
    current.openerPorts.closeSettings();
    current.openerPorts.pushRemoveAccountSurface();
    setTargetState(current.activeAccount);
    setConfirmationState("");
    setErrorState(undefined);
    setRetryTokenState(undefined);
  }, [invalidateAttempt]);

  return {
    target,
    setTarget,
    confirmation,
    setConfirmation,
    error,
    busy,
    retryToken,
    confirmRemoveAccount,
    openRemoveFromSettings
  } as const;
}
