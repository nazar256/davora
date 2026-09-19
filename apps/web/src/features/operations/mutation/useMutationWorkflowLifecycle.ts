import { useCallback, useLayoutEffect, useReducer, useRef } from "react";

import type { FileEntry } from "@davora/shared";

import type { ActionDialogSnapshot, BatchDeleteWorkflow, DeleteWorkflowId } from "../delete";
import type { DestinationPickerState } from "../destination";
import type { OperationContextToken, OperationIntent } from "../policy";
import {
  issueMutationAttemptToken,
  readMutationAttemptFacts,
  type MutationAttemptToken
} from "./attempt";
import {
  initialMutationWorkflowState,
  mutationWorkflowReducer,
  type MutationWorkflowDraft,
  type MutationWorkflowState
} from "./model";

type StateUpdater<T extends object> = T | undefined | ((previous: T | undefined) => T | undefined);

function selectActionDialog(state: MutationWorkflowState): ActionDialogSnapshot | undefined {
  if (state.kind === "idle" || state.kind === "completed" || state.draft.kind !== "action") return undefined;
  return state.draft.dialog;
}

function selectDestinationPicker(state: MutationWorkflowState): DestinationPickerState | undefined {
  if (state.kind === "idle" || state.kind === "completed" || state.draft.kind !== "destination") return undefined;
  return state.draft.picker;
}

function resolveUpdater<T extends object>(updater: StateUpdater<T>, previous: T | undefined): T | undefined {
  return typeof updater === "function" ? updater(previous) : updater;
}

function domainIdentity(draft: MutationWorkflowDraft): string {
  if (draft.kind === "action") {
    return draft.dialog.kind === "createFolder"
      ? "create-folder"
      : `delete:${draft.dialog.workflow.id}`;
  }
  return `destination:${draft.picker.kind}`;
}

export interface UseMutationWorkflowLifecycleInput {
  readonly operationContextToken: OperationContextToken;
  readonly currentPath: string;
}

export function useMutationWorkflowLifecycle(input: UseMutationWorkflowLifecycleInput) {
  const [state, dispatch] = useReducer(mutationWorkflowReducer, initialMutationWorkflowState);
  const stateRef = useRef(state);
  const inputRef = useRef(input);
  const sequenceRef = useRef(0);
  const pathGenerationRef = useRef(0);
  const ownershipGenerationRef = useRef(0);
  const mountGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const priorPathRef = useRef(input.currentPath);
  const priorContextRef = useRef(input.operationContextToken);
  stateRef.current = state;
  inputRef.current = input;

  const send = useCallback((event: Parameters<typeof mutationWorkflowReducer>[1]) => {
    stateRef.current = mutationWorkflowReducer(stateRef.current, event);
    dispatch(event);
  }, []);

  useLayoutEffect(() => {
    mountedRef.current = true;
    mountGenerationRef.current += 1;
    return () => {
      mountedRef.current = false;
      mountGenerationRef.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    const contextChanged = !priorContextRef.current.isSame(input.operationContextToken);
    const pathChanged = priorPathRef.current !== input.currentPath;
    if (!contextChanged && !pathChanged) return;
    if (pathChanged) pathGenerationRef.current += 1;
    ownershipGenerationRef.current += 1;
    const current = stateRef.current;
    if (current.kind !== "idle") send({ kind: "dismiss", identity: current.identity, context: current.context });
    priorContextRef.current = input.operationContextToken;
    priorPathRef.current = input.currentPath;
  }, [input.currentPath, input.operationContextToken, send]);

  const publishDraft = useCallback((draft: MutationWorkflowDraft, replaceExisting = false) => {
    const current = stateRef.current;
    const context = draft.kind === "action" ? draft.dialog.context : draft.picker.context;
    if (!replaceExisting) {
      if ((current.kind === "collectingInput" || current.kind === "choosingDestination")
        && current.context.isSame(context)) {
        send({ kind: "update-draft", identity: current.identity, context: current.context, draft });
      }
      return;
    }
    ownershipGenerationRef.current += 1;
    send({ kind: "open", identity: ++sequenceRef.current, draft });
  }, [send]);

  const dismissCurrent = useCallback(() => {
    const current = stateRef.current;
    if (current.kind === "idle") return;
    ownershipGenerationRef.current += 1;
    send({ kind: "dismiss", identity: current.identity, context: current.context });
  }, [send]);

  const hasSurface = useCallback(() => {
    const current = stateRef.current;
    return current.kind !== "idle" && current.kind !== "completed";
  }, []);

  const setActionDialog = useCallback((updater: StateUpdater<ActionDialogSnapshot>) => {
    const previous = selectActionDialog(stateRef.current);
    const next = resolveUpdater(updater, previous);
    if (!next) {
      if (previous) dismissCurrent();
      return;
    }
    publishDraft({ kind: "action", dialog: next }, typeof updater !== "function");
  }, [dismissCurrent, publishDraft]);

  const setDestinationPicker = useCallback((updater: StateUpdater<DestinationPickerState>) => {
    const previous = selectDestinationPicker(stateRef.current);
    const next = resolveUpdater(updater, previous);
    if (!next) {
      if (previous) dismissCurrent();
      return;
    }
    publishDraft({ kind: "destination", picker: next }, typeof updater !== "function");
  }, [dismissCurrent, publishDraft]);

  const setPresentationError = useCallback((error: string | undefined) => {
    const current = stateRef.current;
    if (current.kind === "collectingInput" || current.kind === "choosingDestination"
      || current.kind === "failed" || current.kind === "partial") {
      send({ kind: "set-error", identity: current.identity, context: current.context, error });
    }
  }, [send]);

  const isAttemptCurrent = useCallback((attempt: MutationAttemptToken): boolean => {
    const facts = readMutationAttemptFacts(attempt);
    const current = stateRef.current;
    const currentInput = inputRef.current;
    return mountedRef.current
      && facts.mountGeneration === mountGenerationRef.current
      && facts.pathGeneration === pathGenerationRef.current
      && facts.ownershipGeneration === ownershipGenerationRef.current
      && facts.path === currentInput.currentPath
      && facts.context.isSame(currentInput.operationContextToken)
      && current.kind !== "idle"
      && current.kind !== "completed"
      && current.identity === facts.workflowIdentity
      && current.context.isSame(facts.context)
      && facts.domainIdentity === domainIdentity(current.draft)
      && (current.kind === "validating" || current.kind === "running" || current.kind === "partial" || current.kind === "failed")
      && current.attempt === attempt;
  }, []);

  const beginAttempt = useCallback((intent: OperationIntent): MutationAttemptToken | undefined => {
    const current = stateRef.current;
    if (current.kind !== "collectingInput" && current.kind !== "choosingDestination") return undefined;
    const attempt = issueMutationAttemptToken({
      workflowIdentity: current.identity,
      context: current.context,
      path: inputRef.current.currentPath,
      pathGeneration: pathGenerationRef.current,
      ownershipGeneration: ownershipGenerationRef.current,
      mountGeneration: mountGenerationRef.current,
      domainIdentity: domainIdentity(current.draft),
      intent
    });
    send({ kind: "validate", identity: current.identity, context: current.context, intent, attempt });
    const validated = stateRef.current;
    if (validated.kind !== "validating" || validated.attempt !== attempt) return undefined;
    send({ kind: "run", identity: current.identity, context: current.context, attempt });
    const running = stateRef.current;
    return running.kind === "running" && running.attempt === attempt ? attempt : undefined;
  }, [send]);

  const failAttempt = useCallback((attempt: MutationAttemptToken, error: string) => {
    if (!isAttemptCurrent(attempt)) return;
    const facts = readMutationAttemptFacts(attempt);
    send({ kind: "fail", identity: facts.workflowIdentity, context: facts.context, attempt, error });
  }, [isAttemptCurrent, send]);

  const reportPartial = useCallback((attempt: MutationAttemptToken, error: string, failedEntries: readonly FileEntry[]) => {
    if (!isAttemptCurrent(attempt)) return;
    const facts = readMutationAttemptFacts(attempt);
    send({
      kind: "partial", identity: facts.workflowIdentity, context: facts.context, attempt, error, failedEntries
    });
  }, [isAttemptCurrent, send]);

  const reportDeletePartial = useCallback((attempt: MutationAttemptToken, input: {
    readonly workflow: BatchDeleteWorkflow;
    readonly failedTarget: BatchDeleteWorkflow["submittedTargets"][number];
    readonly completedCount: number;
    readonly totalCount: number;
    readonly error: string;
  }) => {
    if (!isAttemptCurrent(attempt)) return;
    const facts = readMutationAttemptFacts(attempt);
    send({ kind: "delete-partial", identity: facts.workflowIdentity, context: facts.context, attempt, ...input });
  }, [isAttemptCurrent, send]);

  const completeAttempt = useCallback((attempt: MutationAttemptToken, result: Readonly<Record<string, unknown>>) => {
    if (!isAttemptCurrent(attempt)) return false;
    const facts = readMutationAttemptFacts(attempt);
    send({ kind: "complete", identity: facts.workflowIdentity, context: facts.context, attempt, result });
    send({ kind: "accept-effects", identity: facts.workflowIdentity, context: facts.context, attempt });
    return true;
  }, [isAttemptCurrent, send]);

  const completeActionDialog = useCallback((attempt: MutationAttemptToken, dialog: ActionDialogSnapshot) => {
    if (!isAttemptCurrent(attempt)) return false;
    const current = stateRef.current;
    if (current.kind !== "running" || current.draft.kind !== "action") return false;
    const owned = current.draft.dialog;
    const matches = dialog.kind === "delete"
      ? owned.kind === "delete" && owned.workflow.id === dialog.workflow.id && owned.context.isSame(dialog.context)
      : owned === dialog;
    return matches && completeAttempt(attempt, { kind: "mutation-completed" });
  }, [completeAttempt, isAttemptCurrent]);

  const completeDestination = useCallback((attempt: MutationAttemptToken, context: OperationContextToken) => {
    const current = stateRef.current;
    return isAttemptCurrent(attempt) && current.kind === "running" && current.draft.kind === "destination"
      && current.context.isSame(context) && completeAttempt(attempt, { kind: "mutation-completed" });
  }, [completeAttempt, isAttemptCurrent]);

  const getActiveDeleteWorkflowId = useCallback((): DeleteWorkflowId | undefined => {
    const current = stateRef.current;
    return current.kind !== "idle" && current.kind !== "completed" && current.draft.kind === "action"
      && current.draft.dialog.kind === "delete" ? current.draft.dialog.workflow.id : undefined;
  }, []);

  const updateDeleteWorkflow = useCallback((attempt: MutationAttemptToken, workflow: BatchDeleteWorkflow) => {
    if (!isAttemptCurrent(attempt)) return false;
    const facts = readMutationAttemptFacts(attempt);
    const before = stateRef.current;
    send({ kind: "delete-progress", identity: facts.workflowIdentity, context: facts.context, attempt, workflow });
    return stateRef.current !== before;
  }, [isAttemptCurrent, send]);

  const currentState = state.kind === "idle" || (state.context.isSame(input.operationContextToken)
    && priorPathRef.current === input.currentPath) ? state : initialMutationWorkflowState;

  return {
    state: currentState,
    currentActionDialog: selectActionDialog(currentState),
    currentDestinationPicker: selectDestinationPicker(currentState),
    setActionDialog,
    setDestinationPicker,
    setPresentationError,
    hasSurface,
    dismissCurrent,
    beginAttempt,
    isAttemptCurrent,
    failAttempt,
    reportPartial,
    reportDeletePartial,
    completeActionDialog,
    completeDestination,
    getActiveDeleteWorkflowId,
    updateDeleteWorkflow
  };
}

export type MutationWorkflowLifecycle = ReturnType<typeof useMutationWorkflowLifecycle>;
export type { MutationAttemptToken } from "./attempt";
