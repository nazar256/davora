import type { FormEvent } from "react";
import { useCallback, useRef } from "react";

import type { FileEntry } from "@davora/shared";

import type { OperationContextToken, OperationIntent } from "../policy";
import type { MutationAttemptToken } from "../mutation/attempt";
import {
  buildCreateFolderActionDialogState,
  buildDeleteActionDialogState,
  createBatchDeleteWorkflow,
  validateCreateFolderSubmitValue,
  type ActionDialogSnapshot
} from "./model";
import { runActionDialogSubmitOrchestration } from "./orchestration";
import type { ActionDialogPorts } from "./orchestrationPorts";

export interface UseActionDialogInput {
  isCurrentOperationHandler(): boolean;
  hasSession(): boolean;
  isOperationAllowed(intent: OperationIntent): boolean;
  getOperationContextToken(): OperationContextToken;
  isCurrentOperationContext(context: OperationContextToken): boolean;
  getCurrentActionDialog(): ActionDialogSnapshot | undefined;
  currentFocusedSelection(): FileEntry | undefined;
  getBatchSelectionEntries(): readonly FileEntry[];
  getCurrentPath(): string;
  getAccountName(): string;
  workflow: {
    hasSurface(): boolean;
    beginAttempt(intent: OperationIntent): MutationAttemptToken | undefined;
    isAttemptCurrent(attempt: MutationAttemptToken): boolean;
    failAttempt(attempt: MutationAttemptToken, error: string): void;
    reportDeletePartial(attempt: MutationAttemptToken, input: {
      readonly workflow: import("./model").BatchDeleteWorkflow;
      readonly failedTarget: import("./model").DeleteTarget;
      readonly completedCount: number;
      readonly totalCount: number;
      readonly error: string;
    }): void;
    completeActionDialog(attempt: MutationAttemptToken, dialog: ActionDialogSnapshot): boolean;
  };
  ports: ActionDialogPorts;
}

export function useActionDialog(input: UseActionDialogInput) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const deleteWorkflowSequenceRef = useRef(0);

  const openCreateFolder = useCallback(() => {
    const current = inputRef.current;
    if (!current.isCurrentOperationHandler() || !current.isOperationAllowed({ kind: "createFolder" })) {
      return;
    }
    current.ports.opener.closeNavigation();
    current.ports.opener.setActionError(undefined);
    if (!current.workflow.hasSurface()) {
      current.ports.opener.pushActionSurface();
    }
    current.ports.opener.openActionDialog(buildCreateFolderActionDialogState(current.getOperationContextToken()));
  }, []);

  const openDelete = useCallback(() => {
    const current = inputRef.current;
    const selectedEntry = current.currentFocusedSelection();
    if (!current.isCurrentOperationHandler() || !selectedEntry || !current.isOperationAllowed({ kind: "delete", count: 1 })) {
      return;
    }
    current.ports.opener.closeMobileDetails();
    current.ports.opener.setActionError(undefined);
    if (!current.workflow.hasSurface()) {
      current.ports.opener.pushActionSurface();
    }
    current.ports.opener.openActionDialog(buildDeleteActionDialogState(
      current.getOperationContextToken(),
      createBatchDeleteWorkflow(++deleteWorkflowSequenceRef.current, [{ path: selectedEntry.path, confirmName: selectedEntry.name }])
    ));
  }, []);

  const openDeleteSelection = useCallback(() => {
    const current = inputRef.current;
    const batchSelectionEntries = current.getBatchSelectionEntries();
    if (!current.isCurrentOperationHandler() || !current.isOperationAllowed({ kind: "delete", count: batchSelectionEntries.length })) {
      return;
    }
    current.ports.opener.closeMobileDetails();
    current.ports.opener.showMobileActions();
    current.ports.opener.setActionError(undefined);
    if (!current.workflow.hasSurface()) {
      current.ports.opener.pushActionSurface();
    }
    current.ports.opener.openActionDialog(buildDeleteActionDialogState(
      current.getOperationContextToken(),
      createBatchDeleteWorkflow(
        ++deleteWorkflowSequenceRef.current,
        batchSelectionEntries.map((entry) => ({ path: entry.path, confirmName: entry.name }))
      )
    ));
  }, []);

  const submitActionDialog = useCallback(async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const current = inputRef.current;
    const dialog = current.getCurrentActionDialog();
    if (!current.isCurrentOperationHandler() || !current.hasSession() || !dialog
      || !current.isCurrentOperationContext(dialog.context)) {
      return;
    }

    if (dialog.kind === "createFolder") {
      const validation = validateCreateFolderSubmitValue(dialog.value);
      if (validation.kind === "invalid") {
        current.ports.submit.presentation.setActionError(validation.message);
        return;
      }
    }

    current.ports.submit.presentation.setActionError(undefined);
    const intent: OperationIntent = dialog.kind === "createFolder"
      ? { kind: "createFolder" }
      : { kind: "delete", count: dialog.workflow.unresolvedTargets.length };
    const attempt = current.workflow.beginAttempt(intent);
    if (!attempt) return;

    await runActionDialogSubmitOrchestration({
      dialog,
      currentPath: current.getCurrentPath(),
      accountName: current.getAccountName(),
      attempt,
      isAttemptCurrent: current.workflow.isAttemptCurrent,
      failAttempt: current.workflow.failAttempt,
      reportDeletePartial: current.workflow.reportDeletePartial,
      completeActionDialog: current.workflow.completeActionDialog
    }, current.ports.submit);
  }, []);

  return {
    openCreateFolder,
    openDelete,
    openDeleteSelection,
    submitActionDialog
  };
}
