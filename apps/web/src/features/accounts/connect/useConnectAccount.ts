import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type SetStateAction } from "react";

import {
  buildReconnectForm,
  createEmptyAccountForm,
  type AccountFormState,
  type AccountReconnectSource
} from "./model";
import { executeConnectAccount } from "./controller";
import { shouldEnsureSessionAfterConnect } from "./model";
import type { ConnectAccountPorts } from "./ports";
import type { ConnectAccountDialogStageProps } from "./ConnectAccountDialogStage";
import type { ConnectAccountStageProps } from "./ConnectAccountStage";

export interface ConnectAccountOpenerPorts {
  pushAccountSurface(): void;
  closeSettings(): void;
}

export interface UseConnectAccountInput {
  readonly healthRootPath: string;
  readonly unlockRequired: boolean;
  readonly activeRecord?: AccountReconnectSource;
  readonly ports: ConnectAccountPorts;
  readonly openerPorts: ConnectAccountOpenerPorts;
  readonly onStatusChange: (message: string) => void;
}

export function useConnectAccount(input: UseConnectAccountInput) {
  const [form, setFormState] = useState<AccountFormState>(() => createEmptyAccountForm("add"));
  const [formError, setFormErrorState] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [showDialog, setShowDialogState] = useState(false);
  const [showZeroStateForm, setShowZeroStateForm] = useState(false);

  const inputRef = useRef(input);
  const formRef = useRef(form);
  inputRef.current = input;
  formRef.current = form;

  const accountId = input.activeRecord?.account.id;
  const generationRef = useRef({ ownerAccountId: accountId, value: 0 });
  const replacementRef = useRef(false);
  if (accountId && generationRef.current.ownerAccountId && generationRef.current.ownerAccountId !== accountId) {
    generationRef.current = { ownerAccountId: accountId, value: generationRef.current.value + 1 };
    replacementRef.current = true;
  } else if (accountId) {
    generationRef.current = { ...generationRef.current, ownerAccountId: accountId };
  }
  const mountedRef = useRef(true);
  const nextAttemptIdRef = useRef(1);
  const activeAttemptRef = useRef<number>();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current = { ...generationRef.current, value: generationRef.current.value + 1 };
      activeAttemptRef.current = undefined;
    };
  }, []);

  useLayoutEffect(() => {
    if (!replacementRef.current) {
      return;
    }
    replacementRef.current = false;
    activeAttemptRef.current = undefined;
    setBusy(false);
  }, [accountId]);

  const invalidateAttempt = useCallback(() => {
    activeAttemptRef.current = undefined;
  }, []);

  const setForm = useCallback((next: SetStateAction<AccountFormState>) => {
    invalidateAttempt();
    setFormState(next);
  }, [invalidateAttempt]);
  const setFormError = useCallback((next: SetStateAction<string | undefined>) => {
    invalidateAttempt();
    setFormErrorState(next);
  }, [invalidateAttempt]);
  const setShowDialog = useCallback((next: SetStateAction<boolean>) => {
    invalidateAttempt();
    setShowDialogState(next);
  }, [invalidateAttempt]);

  const beginAttempt = useCallback(() => {
    const attempt = nextAttemptIdRef.current++;
    activeAttemptRef.current = attempt;
    return { attempt, generation: generationRef.current.value };
  }, []);

  const submitAccountForm = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const owned = beginAttempt();
    const current = inputRef.current;
    setBusy(true);
    setFormErrorState(undefined);
    const isCurrent = () => mountedRef.current
      && generationRef.current.value === owned.generation
      && activeAttemptRef.current === owned.attempt;
    try {
      const outcome = await executeConnectAccount(current.ports, {
        form: formRef.current
      });
      const ownsSuccessfulActivation = outcome.kind === "success"
        && inputRef.current.activeRecord?.account.id === outcome.account.id;
      const isCurrentOutcome = () => isCurrent()
        || (ownsSuccessfulActivation
          && inputRef.current.activeRecord?.account.id === outcome.account.id);
      if (!isCurrentOutcome()) {
        return;
      }
      if (outcome.kind === "validation-error") {
        setFormErrorState(outcome.message);
        return;
      }
      if ((outcome.kind === "partial" || outcome.kind === "failure") && outcome.clearCredential) {
        setFormState((currentForm) => ({ ...currentForm, appPassword: "" }));
      }
      if (outcome.kind === "partial") {
        setFormErrorState(outcome.message);
        return;
      }
      if (outcome.kind === "failure") {
        setFormErrorState(outcome.message);
        return;
      }
      setFormState(createEmptyAccountForm("add", current.healthRootPath));
      setShowDialogState(false);
      setShowZeroStateForm(false);
      if (!isCurrentOutcome()) {
        return;
      }
      current.onStatusChange(outcome.statusMessage);
      if (!isCurrentOutcome()) {
        return;
      }
      if (shouldEnsureSessionAfterConnect(current.unlockRequired)) {
        await current.ports.ensureSessionForAccount(outcome.account.id);
      }
    } finally {
      if (isCurrent()) {
        setBusy(false);
        activeAttemptRef.current = undefined;
      }
    }
  }, [beginAttempt]);

  const openAddAccountDialog = useCallback(() => {
    invalidateAttempt();
    const current = inputRef.current;
    setFormState(createEmptyAccountForm("add", current.healthRootPath));
    setFormErrorState(undefined);
    current.openerPorts.pushAccountSurface();
    setShowDialogState(true);
  }, [invalidateAttempt]);

  const openReconnectDialog = useCallback((record: AccountReconnectSource) => {
    invalidateAttempt();
    setFormState(buildReconnectForm(record));
    setFormErrorState(undefined);
    inputRef.current.openerPorts.pushAccountSurface();
    setShowDialogState(true);
  }, [invalidateAttempt]);

  const openAddAccountFromSettings = useCallback(() => {
    inputRef.current.openerPorts.closeSettings();
    openAddAccountDialog();
  }, [openAddAccountDialog]);

  const openReconnectFromSettings = useCallback(() => {
    const current = inputRef.current;
    if (!current.activeRecord) {
      return;
    }
    current.openerPorts.closeSettings();
    openReconnectDialog(current.activeRecord);
  }, [openReconnectDialog]);

  const revealZeroStateForm = useCallback(() => {
    invalidateAttempt();
    setFormErrorState(undefined);
    setFormState(createEmptyAccountForm("add"));
    setShowZeroStateForm(true);
  }, [invalidateAttempt]);

  const reconnectRequired = input.activeRecord?.account.connectionState === "reconnect_required";
  const bootstrap: ConnectAccountStageProps = {
    accountName: input.activeRecord?.account.displayName,
    busy,
    error: formError,
    form: reconnectRequired && form.mode !== "reconnect" && input.activeRecord
      ? buildReconnectForm(input.activeRecord)
      : form,
    onChange: setForm,
    onRevealForm: revealZeroStateForm,
    onSubmit: (event) => void submitAccountForm(event),
    showForm: showZeroStateForm,
    variant: input.activeRecord ? (reconnectRequired ? "reconnect" : "connect") : "zero"
  };
  const dialog: ConnectAccountDialogStageProps = {
    busy,
    error: formError,
    form,
    onCancel: () => setShowDialog(false),
    onChange: setForm,
    onSubmit: (event) => void submitAccountForm(event),
    open: showDialog,
    variant: form.mode
  };

  return {
    bootstrap,
    dialog,
    form,
    setForm,
    formError,
    setFormError,
    busy,
    showDialog,
    setShowDialog,
    showZeroStateForm,
    submitAccountForm,
    openAddAccountDialog,
    openReconnectDialog,
    openAddAccountFromSettings,
    openReconnectFromSettings,
    revealZeroStateForm
  } as const;
}
