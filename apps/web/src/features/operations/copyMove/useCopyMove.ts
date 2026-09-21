import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useCallback, useRef } from "react";

import type { FileEntry } from "@davora/shared";

import type {
  DestinationConflictDecision,
  DestinationOperation,
  DestinationPickerState,
  ResolvedDestinationTarget
} from "../destination";
import {
  applyDecisionToAllConflicts,
  buildDestinationConflictReview,
  resolveConflictDecisions,
  withApplySizeRule,
  withConflictDecision
} from "../destination/conflicts";
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
  setDestinationPicker: Dispatch<SetStateAction<DestinationPickerState | undefined>>;
  currentFocusedSelection(): FileEntry | undefined;
  getBatchSelectionEntries(): readonly FileEntry[];
  getCurrentPath(): string;
  getAccountName(): string;
  getAccountId(): string | undefined;
  workflow: {
    hasSurface(): boolean;
    beginAttempt(intent: OperationIntent): MutationAttemptToken | undefined;
    completeDestination(attempt: MutationAttemptToken, context: OperationContextToken): boolean;
    failAttempt(attempt: MutationAttemptToken, error: string): void;
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

  const runSubmit = useCallback((
    current: UseCopyMoveInput,
    operation: DestinationOperation,
    picker: CopyMovePickerSnapshot,
    destinationPath: string,
    resolved: { readonly targets: readonly ResolvedDestinationTarget[]; readonly skipped: readonly FileEntry[] },
    applySizeRule: boolean
  ) => {
    current.ports.submit.presentation.setActionError(undefined);
    const attempt = current.workflow.beginAttempt({ kind: operation, count: picker.sourceEntries.length });
    if (!attempt) return;
    runCopyMoveSubmitOrchestration({
      operation,
      picker,
      destinationPath,
      targets: resolved.targets,
      skipped: resolved.skipped,
      applySizeRule,
      accountId: current.getAccountId(),
      accountName: current.getAccountName(),
      attempt,
      completeDestination: current.workflow.completeDestination,
      failAttempt: current.workflow.failAttempt
    }, current.ports.submit);
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
      || picker.sourceEntries.length === 0
      || picker.loading
      || picker.conflictReview) {
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

    if (destinationPlan.conflicts.length > 0) {
      current.ports.submit.presentation.setActionError(undefined);
      current.setDestinationPicker((previous) => previous
        && current.isCurrentOperationContext(previous.context)
        ? { ...previous, conflictReview: buildDestinationConflictReview(destinationPlan, operation) }
        : previous);
      return;
    }

    runSubmit(current, operation, picker, destinationPlan.destinationPath, {
      targets: destinationPlan.targets.map((target) => ({
        source: target.source,
        destinationPath: target.destinationPath,
        overwrite: false,
        merge: false
      })),
      skipped: []
    }, true);
  }, [runSubmit]);

  const updateConflictDecision = useCallback((sourcePath: string, decision: DestinationConflictDecision) => {
    const current = inputRef.current;
    current.setDestinationPicker((previous) => previous?.conflictReview
      ? { ...previous, conflictReview: withConflictDecision(previous.conflictReview, sourcePath, decision) }
      : previous);
  }, []);

  const applyConflictDecisionToAll = useCallback((decision: DestinationConflictDecision) => {
    const current = inputRef.current;
    current.setDestinationPicker((previous) => previous?.conflictReview
      ? { ...previous, conflictReview: applyDecisionToAllConflicts(previous.conflictReview, decision) }
      : previous);
  }, []);

  const updateConflictApplySizeRule = useCallback((applySizeRule: boolean) => {
    const current = inputRef.current;
    current.setDestinationPicker((previous) => previous?.conflictReview
      ? { ...previous, conflictReview: withApplySizeRule(previous.conflictReview, applySizeRule) }
      : previous);
  }, []);

  const dismissConflictReview = useCallback(() => {
    const current = inputRef.current;
    current.ports.submit.presentation.setActionError(undefined);
    current.setDestinationPicker((previous) => previous?.conflictReview
      ? { ...previous, conflictReview: undefined }
      : previous);
  }, []);

  const confirmConflictReview = useCallback(async () => {
    const current = inputRef.current;
    const picker = current.getCurrentDestinationPicker();
    const review = picker?.conflictReview;
    if (!current.isCurrentOperationHandler() || !current.hasSession() || !picker || !review
      || !current.isCurrentOperationContext(picker.context)
      || picker.sourceEntries.length === 0) {
      return;
    }
    const intent: OperationIntent = { kind: review.operation, count: picker.sourceEntries.length };
    if (!current.ports.submit.context.isContextAllowed(picker.context, intent)) {
      return;
    }
    const resolved = resolveConflictDecisions(review, picker.entries);
    current.setDestinationPicker((previous) => previous?.conflictReview
      ? { ...previous, conflictReview: undefined }
      : previous);
    runSubmit(current, review.operation, picker, review.destinationPath, resolved, review.applySizeRule);
  }, [runSubmit]);

  return {
    openMove,
    openCopyMove,
    openCopyMoveSelection,
    submitDestinationPicker,
    updateConflictDecision,
    applyConflictDecisionToAll,
    updateConflictApplySizeRule,
    dismissConflictReview,
    confirmConflictReview
  };
}
