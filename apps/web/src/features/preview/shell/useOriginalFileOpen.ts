import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { OriginalFileOpenPorts, OriginalFileOpenTask } from "./ports";

export interface UseOriginalFileOpenInput {
  readonly open: boolean;
  readonly accountId: string | undefined;
  readonly path: string | undefined;
  readonly token: string | undefined;
  readonly ports: OriginalFileOpenPorts;
}

interface OwnedOriginalFileOpenAttempt {
  readonly id: number;
  readonly task: OriginalFileOpenTask;
}

const ORIGINAL_FILE_OPEN_ERROR = "Unable to open the original file in a new tab.";

function safeErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : ORIGINAL_FILE_OPEN_ERROR;
}

export function useOriginalFileOpen(input: UseOriginalFileOpenInput) {
  const portsRef = useRef(input.ports);
  portsRef.current = input.ports;
  const nextAttemptIdRef = useRef(1);
  const attemptRef = useRef<OwnedOriginalFileOpenAttempt>();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const cancelOwnedAttempt = useCallback(() => {
    const attempt = attemptRef.current;
    if (!attempt) return;
    attemptRef.current = undefined;
    try {
      attempt.task.cancel();
    } catch {
      // Platform cancellation is best-effort; stale completion remains inert.
    }
  }, []);

  const cancel = useCallback(() => {
    cancelOwnedAttempt();
    setOpening(false);
  }, [cancelOwnedAttempt]);

  useLayoutEffect(() => {
    cancelOwnedAttempt();
    setOpening(false);
    setError(undefined);
    return cancelOwnedAttempt;
  }, [cancelOwnedAttempt, input.accountId, input.open, input.path, input.token]);

  const start = useCallback(() => {
    cancelOwnedAttempt();
    setOpening(false);
    setError(undefined);
    if (!input.open || !input.path || !input.token) return;

    let task: OriginalFileOpenTask;
    try {
      task = portsRef.current.startOriginalFileOpen({ path: input.path, token: input.token });
    } catch (startError) {
      setError(safeErrorMessage(startError));
      return;
    }

    const attempt = { id: nextAttemptIdRef.current++, task };
    attemptRef.current = attempt;
    setOpening(true);
    void task.completion.then(
      () => {
        if (attemptRef.current !== attempt) return;
        attemptRef.current = undefined;
        setOpening(false);
      },
      (completionError: unknown) => {
        if (attemptRef.current !== attempt) return;
        attemptRef.current = undefined;
        setOpening(false);
        setError(safeErrorMessage(completionError));
      }
    );
  }, [cancelOwnedAttempt, input.open, input.path, input.token]);

  return { opening, error, start, cancel } as const;
}
