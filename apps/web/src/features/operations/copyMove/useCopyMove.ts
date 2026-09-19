import type { FormEvent } from "react";
import { useCallback, useRef } from "react";

import type { FileEntry } from "@davora/shared";

import type { DestinationOperation } from "../destination";
import type { OperationContextToken, OperationIntent } from "../policy";
import type { MutationAttemptToken } from "../mutation/attempt";
import {
  buildBatchCopyMovePickerInitialState,
  buildDestinationPlanFromPicker,
  buildMovePickerInitialState,
  buildSingleCopyMovePickerInitialState,
  type CopyMovePickerSnapshot
} from "./model";
import { runCopyMoveSubmitOrchestration } from "./orchestration";
import type { CopyMovePorts } from "./orchestrationPorts";

export interface UseCopyMoveInput {
  isCurrentOperationHandler(): boolean;
  hasSession(): boolean;
  isOperationAllowed(intent: OperationIntent): boolean;
  getOperationContextToken(): OperationContextToken;
  isCurrentOperationContext(context: OperationContextToken): boolean;
  getCurrentDestinationPicker(): CopyMovePickerSnapshot | undefined;
  currentFocusedSelection(): FileEntry | undefined;
  getBatchSelectionEntries(): readonly FileEntry[];
  getCurrentPath(): string;
  getAccountName(): string;
  workflow: {
    hasSurface(): boolean;
    beginAttempt(intent: OperationIntent): MutationAttemptToken | undefined;
    isAttemptCurrent(attempt: MutationAttemptToken): boolean;
    failAttempt(attempt: MutationAttemptToken, error: string): void;
    reportPartial(attempt: MutationAttemptToken, error: string, failedEntries: readonly FileEntry[]): void;
    completeDestination(attempt: MutationAttemptToken, context: OperationContextToken): boolean;
  };
  ports: CopyMovePorts;
}

export function useCopyMove(input: UseCopyMoveInput) {
  const inputRef = useRef(input);
  inputRef.current = input;

  const openMove = useCallback(() => {
    const current = inputRef.current;
    const selectedEntry = current.currentFocusedSelection();
    if (!current.isCurrentOperationHandler() || !selectedEntry || !current.isOperationAllowed({ kind: "move", count: 1 })) {
      return;
    }
    current.ports.opener.closeMobileDetails();
    current.ports.opener.setActionError(undefined);
    if (!current.workflow.hasSurface()) {
      current.ports.opener.pushActionSurface();
    }
    current.ports.opener.openDestinationPicker(buildMovePickerInitialState(
      current.getOperationContextToken(),
      selectedEntry
    ));
  }, []);

  const openCopyMove = useCallback(() => {
    const current = inputRef.current;
    const selectedEntry = current.currentFocusedSelection();
    if (!current.isCurrentOperationHandler() || !selectedEntry || !current.isOperationAllowed({ kind: "copyOrMove", count: 1 })) {
      return;
    }
    current.ports.opener.closeMobileDetails();
    current.ports.opener.setActionError(undefined);
    if (!current.workflow.hasSurface()) {
      current.ports.opener.pushActionSurface();
    }
    current.ports.opener.openDestinationPicker(buildSingleCopyMovePickerInitialState(
      current.getOperationContextToken(),
      selectedEntry
    ));
  }, []);

  const openCopyMoveSelection = useCallback(() => {
    const current = inputRef.current;
    const batchSelectionEntries = current.getBatchSelectionEntries();
    if (!current.isCurrentOperationHandler() || !current.isOperationAllowed({ kind: "copyOrMove", count: batchSelectionEntries.length })) {
      return;
    }
    current.ports.opener.closeMobileDetails();
    current.ports.opener.showMobileActions();
    current.ports.opener.setActionError(undefined);
    if (!current.workflow.hasSurface()) {
      current.ports.opener.pushActionSurface();
    }
    current.ports.opener.openDestinationPicker(buildBatchCopyMovePickerInitialState(
      current.getOperationContextToken(),
      batchSelectionEntries,
      current.getCurrentPath()
    ));
  }, []);

  const submitDestinationPicker = useCallback(async (
    operation: DestinationOperation,
    event?: FormEvent<HTMLFormElement>
  ) => {
    event?.preventDefault();
    const current = inputRef.current;
    const picker = current.getCurrentDestinationPicker();
    if (!current.isCurrentOperationHandler() || !current.hasSession() || !picker
      || !current.isCurrentOperationContext(picker.context)
      || picker.sourceEntries.length === 0) {
      return;
    }
    const intent: OperationIntent = { kind: operation, count: picker.sourceEntries.length };
    const pickerStillCurrent = () => current.ports.submit.context.isContextAllowed(picker.context, intent);
    if (!pickerStillCurrent()) {
      return;
    }

    const destinationPlan = buildDestinationPlanFromPicker(picker, operation);
    if (destinationPlan.kind === "invalid") {
      current.ports.submit.presentation.setActionError(destinationPlan.message);
      return;
    }
    const { destinationPath, targets } = destinationPlan;

    current.ports.submit.presentation.setActionError(undefined);
    const attempt = current.workflow.beginAttempt(intent);
    if (!attempt) return;
    await runCopyMoveSubmitOrchestration({
      operation,
      picker,
      destinationPath,
      targets: targets ?? [],
      accountName: current.getAccountName(),
      ownerPath: current.getCurrentPath(),
      attempt,
      isAttemptCurrent: current.workflow.isAttemptCurrent,
      failAttempt: current.workflow.failAttempt,
      reportPartial: current.workflow.reportPartial,
      completeDestination: current.workflow.completeDestination
    }, current.ports.submit);
  }, []);

  return {
    openMove,
    openCopyMove,
    openCopyMoveSelection,
    submitDestinationPicker
  };
}
