import type { FileEntry, MutationResult } from "@davora/shared";
import { assertNever, toDisplayPath } from "@davora/shared";

import type { OperationContextToken, OperationIntent } from "../policy";
import type { ActionDialogSnapshot, BatchDeleteWorkflow } from "../delete/model";
import type { DestinationPickerState } from "../destination/model";
import type { MutationAttemptToken } from "./attempt";

export type MutationWorkflowDraft =
  | { readonly kind: "action"; readonly dialog: ActionDialogSnapshot }
  | { readonly kind: "destination"; readonly picker: DestinationPickerState };

export type MutationPartialFacts =
  | { readonly kind: "destination"; readonly failedSourcePaths: readonly string[] }
  | {
      readonly kind: "delete";
      readonly completedCount: number;
      readonly totalCount: number;
      readonly unresolvedTargets: BatchDeleteWorkflow["unresolvedTargets"];
      readonly failedTarget: BatchDeleteWorkflow["submittedTargets"][number];
      readonly error: string;
    };

interface MutationWorkflowOwnedState {
  readonly identity: number;
  readonly context: OperationContextToken;
}

type ActionMutationDraft = Extract<MutationWorkflowDraft, { readonly kind: "action" }>;
type DestinationMutationDraft = Extract<MutationWorkflowDraft, { readonly kind: "destination" }>;

interface MutationWorkflowWithDraft extends MutationWorkflowOwnedState {
  readonly draft: MutationWorkflowDraft;
  readonly presentationError?: string;
}

export type MutationWorkflowState =
  | { readonly kind: "idle" }
  | (Omit<MutationWorkflowWithDraft, "draft"> & { readonly kind: "collectingInput"; readonly draft: ActionMutationDraft })
  | (Omit<MutationWorkflowWithDraft, "draft"> & { readonly kind: "choosingDestination"; readonly draft: DestinationMutationDraft })
  | (MutationWorkflowWithDraft & {
      readonly kind: "validating";
      readonly intent: OperationIntent;
      readonly attempt: MutationAttemptToken;
    })
  | (MutationWorkflowWithDraft & {
      readonly kind: "running";
      readonly intent: OperationIntent;
      readonly attempt: MutationAttemptToken;
    })
  | (MutationWorkflowWithDraft & {
      readonly kind: "partial";
      readonly intent: OperationIntent;
      readonly error: string;
      readonly partial: MutationPartialFacts;
      readonly attempt: MutationAttemptToken;
    })
  | (MutationWorkflowWithDraft & {
      readonly kind: "failed";
      readonly intent: OperationIntent;
      readonly error: string;
      readonly attempt: MutationAttemptToken;
    })
  | (MutationWorkflowOwnedState & {
      readonly kind: "completed";
      readonly intent: OperationIntent;
      readonly result: Readonly<Record<string, unknown>>;
      readonly attempt: MutationAttemptToken;
    });

export const initialMutationWorkflowState: MutationWorkflowState = { kind: "idle" };

export type MutationWorkflowEvent =
  | { readonly kind: "open"; readonly identity: number; readonly draft: MutationWorkflowDraft }
  | { readonly kind: "update-draft"; readonly identity: number; readonly context: OperationContextToken; readonly draft: MutationWorkflowDraft }
  | { readonly kind: "set-error"; readonly identity: number; readonly context: OperationContextToken; readonly error?: string }
  | { readonly kind: "validate"; readonly identity: number; readonly context: OperationContextToken; readonly intent: OperationIntent; readonly attempt: MutationAttemptToken }
  | { readonly kind: "run"; readonly identity: number; readonly context: OperationContextToken; readonly attempt: MutationAttemptToken }
  | { readonly kind: "partial"; readonly identity: number; readonly context: OperationContextToken; readonly attempt: MutationAttemptToken; readonly error: string; readonly failedEntries: readonly FileEntry[] }
  | { readonly kind: "delete-partial"; readonly identity: number; readonly context: OperationContextToken; readonly attempt: MutationAttemptToken; readonly error: string; readonly workflow: BatchDeleteWorkflow; readonly failedTarget: BatchDeleteWorkflow["submittedTargets"][number]; readonly completedCount: number; readonly totalCount: number }
  | { readonly kind: "delete-progress"; readonly identity: number; readonly context: OperationContextToken; readonly attempt: MutationAttemptToken; readonly workflow: BatchDeleteWorkflow }
  | { readonly kind: "fail"; readonly identity: number; readonly context: OperationContextToken; readonly attempt: MutationAttemptToken; readonly error: string }
  | { readonly kind: "complete"; readonly identity: number; readonly context: OperationContextToken; readonly attempt: MutationAttemptToken; readonly result: Readonly<Record<string, unknown>> }
  | { readonly kind: "accept-effects"; readonly identity: number; readonly context: OperationContextToken; readonly attempt: MutationAttemptToken }
  | { readonly kind: "dismiss"; readonly identity: number; readonly context: OperationContextToken }
  | { readonly kind: "reset-context"; readonly context: OperationContextToken };

function draftContext(draft: MutationWorkflowDraft): OperationContextToken {
  return draft.kind === "action" ? draft.dialog.context : draft.picker.context;
}

function ownsEvent(
  state: MutationWorkflowState,
  event: { readonly identity: number; readonly context: OperationContextToken }
): state is Exclude<MutationWorkflowState, { readonly kind: "idle" }> {
  return state.kind !== "idle"
    && state.identity === event.identity
    && state.context.isSame(event.context);
}

function stateWithDraft(state: MutationWorkflowState): MutationWorkflowWithDraft | undefined {
  return state.kind === "collectingInput"
    || state.kind === "choosingDestination"
    || state.kind === "validating"
    || state.kind === "running"
    || state.kind === "partial"
    || state.kind === "failed"
    ? state
    : undefined;
}

function intentMatchesDraft(intent: OperationIntent, draft: MutationWorkflowDraft): boolean {
  if (draft.kind === "action") {
    return draft.dialog.kind === "createFolder"
      ? intent.kind === "createFolder"
      : intent.kind === "delete" && intent.count === draft.dialog.workflow.unresolvedTargets.length;
  }
  if ((intent.kind !== "copy" && intent.kind !== "move") || intent.count !== draft.picker.sourceEntries.length) {
    return false;
  }
  return draft.picker.kind === "copyMove" || draft.picker.kind === intent.kind;
}

function ownsAttempt(state: MutationWorkflowState, event: { readonly attempt: MutationAttemptToken }): boolean {
  return (state.kind === "validating" || state.kind === "running" || state.kind === "partial"
    || state.kind === "failed" || state.kind === "completed") && state.attempt === event.attempt;
}

function targetsEqual(left: BatchDeleteWorkflow["submittedTargets"], right: BatchDeleteWorkflow["submittedTargets"]): boolean {
  return left.length === right.length && left.every((target, index) => {
    const other = right[index];
    return other?.path === target.path && other.confirmName === target.confirmName;
  });
}

function isNextDeleteProgress(previous: BatchDeleteWorkflow, next: BatchDeleteWorkflow): boolean {
  if (previous.id !== next.id || !targetsEqual(previous.submittedTargets, next.submittedTargets)
    || next.unresolvedTargets.length !== previous.unresolvedTargets.length - 1) return false;
  let nextIndex = 0;
  let removedCount = 0;
  for (const target of previous.unresolvedTargets) {
    const candidate = next.unresolvedTargets[nextIndex];
    if (candidate?.path === target.path && candidate.confirmName === target.confirmName) {
      nextIndex += 1;
    } else {
      removedCount += 1;
    }
  }
  return removedCount === 1 && nextIndex === next.unresolvedTargets.length;
}

export function mutationWorkflowReducer(
  state: MutationWorkflowState,
  event: MutationWorkflowEvent
): MutationWorkflowState {
  switch (event.kind) {
    case "open": {
      if (!Number.isSafeInteger(event.identity) || event.identity <= 0) {
        throw new Error("Mutation workflow identity must be a positive safe integer.");
      }
      const context = draftContext(event.draft);
      return event.draft.kind === "action"
        ? { kind: "collectingInput", identity: event.identity, context, draft: event.draft }
        : { kind: "choosingDestination", identity: event.identity, context, draft: event.draft };
    }
    case "update-draft": {
      if (!ownsEvent(state, event) || (state.kind !== "collectingInput" && state.kind !== "choosingDestination")) {
        return state;
      }
      if (!draftContext(event.draft).isSame(state.context)) {
        return state;
      }
      if ((state.kind === "collectingInput") !== (event.draft.kind === "action")) return state;
      if (state.kind === "collectingInput" && event.draft.kind === "action") return { ...state, draft: event.draft };
      if (state.kind === "choosingDestination" && event.draft.kind === "destination") return { ...state, draft: event.draft };
      return state;
    }
    case "set-error": {
      if (!ownsEvent(state, event) || state.kind === "completed") {
        return state;
      }
      const current = stateWithDraft(state);
      if (!current) {
        return state;
      }
      if (event.error === undefined && (state.kind === "failed" || state.kind === "partial")) {
        return current.draft.kind === "action"
          ? {
              kind: "collectingInput",
              identity: current.identity,
              context: current.context,
              draft: current.draft
            }
          : {
              kind: "choosingDestination",
              identity: current.identity,
              context: current.context,
              draft: current.draft
            };
      }
      return { ...state, presentationError: event.error };
    }
    case "validate": {
      if (!ownsEvent(state, event)) {
        return state;
      }
      const current = stateWithDraft(state);
      return current && (state.kind === "collectingInput" || state.kind === "choosingDestination")
        && intentMatchesDraft(event.intent, current.draft)
        ? {
            kind: "validating",
            identity: current.identity,
            context: current.context,
            draft: current.draft,
            intent: event.intent,
            attempt: event.attempt
          }
        : state;
    }
    case "run": {
      if (!ownsEvent(state, event) || state.kind !== "validating" || !ownsAttempt(state, event)) {
        return state;
      }
      return { ...state, kind: "running" };
    }
    case "partial": {
      if (!ownsEvent(state, event) || state.kind !== "running" || !ownsAttempt(state, event)
        || state.draft.kind !== "destination") {
        return state;
      }
      return {
        ...state,
        kind: "partial",
        error: event.error,
        presentationError: event.error,
        partial: { kind: "destination", failedSourcePaths: event.failedEntries.map((entry) => entry.path) },
        draft: event.failedEntries
          ? { kind: "destination", picker: { ...state.draft.picker, sourceEntries: [...event.failedEntries] } }
          : state.draft
      };
    }
    case "delete-partial": {
      if (!ownsEvent(state, event) || state.kind !== "running" || !ownsAttempt(state, event)
        || state.draft.kind !== "action" || state.draft.dialog.kind !== "delete"
        || state.draft.dialog.workflow.id !== event.workflow.id
        || !targetsEqual(state.draft.dialog.workflow.submittedTargets, event.workflow.submittedTargets)
        || !targetsEqual(state.draft.dialog.workflow.unresolvedTargets, event.workflow.unresolvedTargets)
        || event.completedCount <= 0 || event.totalCount !== event.workflow.submittedTargets.length
        || event.completedCount !== event.totalCount - event.workflow.unresolvedTargets.length
        || !event.workflow.unresolvedTargets.some((target) => target.path === event.failedTarget.path
          && target.confirmName === event.failedTarget.confirmName)) return state;
      return {
        ...state,
        kind: "partial",
        error: event.error,
        presentationError: event.error,
        draft: { kind: "action", dialog: { ...state.draft.dialog, workflow: event.workflow } },
        partial: {
          kind: "delete", completedCount: event.completedCount, totalCount: event.totalCount,
          unresolvedTargets: [...event.workflow.unresolvedTargets], failedTarget: event.failedTarget, error: event.error
        }
      };
    }
    case "delete-progress": {
      if (!ownsEvent(state, event) || state.kind !== "running" || !ownsAttempt(state, event)
        || state.draft.kind !== "action" || state.draft.dialog.kind !== "delete"
        || state.draft.dialog.workflow.id !== event.workflow.id
        || !isNextDeleteProgress(state.draft.dialog.workflow, event.workflow)) return state;
      return { ...state, draft: { kind: "action", dialog: { ...state.draft.dialog, workflow: event.workflow } } };
    }
    case "fail": {
      if (!ownsEvent(state, event) || state.kind !== "running" || !ownsAttempt(state, event)) {
        return state;
      }
      return {
            ...state,
            kind: "failed",
            error: event.error,
            presentationError: event.error
          };
    }
    case "complete": {
      if (!ownsEvent(state, event) || state.kind !== "running" || !ownsAttempt(state, event)) {
        return state;
      }
      return {
        kind: "completed",
        identity: state.identity,
        context: state.context,
        intent: state.intent,
        result: event.result,
        attempt: state.attempt
      };
    }
    case "accept-effects":
      return ownsEvent(state, event) && state.kind === "completed" && ownsAttempt(state, event)
        ? initialMutationWorkflowState
        : state;
    case "dismiss":
      return ownsEvent(state, event) ? initialMutationWorkflowState : state;
    case "reset-context":
      return state.kind !== "idle" && state.context.isSame(event.context)
        ? initialMutationWorkflowState
        : state;
    default:
      return assertNever(event, "mutation workflow event");
  }
}

export const MUTATION_NO_SESSION_MESSAGE = "No session available for this action.";

export function buildOfflineMutationBlockedMessage(): string {
  return "Offline mutations are disabled. Reconnect to modify files.";
}

export function buildServerUnavailableMutationBlockedMessage(): string {
  return "Mutations are disabled while the local server is unavailable. Restore the server and retry.";
}

export type MutationPreconditionResult =
  | { readonly kind: "allowed" }
  | { readonly kind: "denied"; readonly message: string };

export function evaluateMutationPreconditions(input: {
  readonly hasSession: boolean;
  readonly cacheOnlyMode: boolean;
  readonly isOffline: boolean;
}): MutationPreconditionResult {
  if (!input.hasSession) {
    return { kind: "denied", message: MUTATION_NO_SESSION_MESSAGE };
  }
  if (input.cacheOnlyMode) {
    return {
      kind: "denied",
      message: input.isOffline
        ? buildOfflineMutationBlockedMessage()
        : buildServerUnavailableMutationBlockedMessage()
    };
  }
  return { kind: "allowed" };
}

export function isMutationOperationStillCurrent(input: {
  readonly context?: OperationContextToken;
  readonly intent?: OperationIntent;
  readonly isContextAllowed: (context: OperationContextToken, intent: OperationIntent) => boolean;
}): boolean {
  if (!input.context || !input.intent) {
    return true;
  }
  return input.isContextAllowed(input.context, input.intent);
}

export function buildDefaultMutationSuccessStatus(
  result: MutationResult,
  accountName: string,
  formatPath: (path: string) => string = toDisplayPath
): string {
  return `${result.action} completed for ${formatPath(result.destinationPath ?? result.path)} in ${accountName}`;
}

export type SelectionSyncEffect =
  | { readonly kind: "delete"; readonly path: string }
  | { readonly kind: "focus-item"; readonly item: FileEntry; readonly rebindFromPath: string }
  | {
      readonly kind: "move-copy-selected";
      readonly sourcePath: string;
      readonly destinationPath: string;
      readonly nextEntry: FileEntry;
      readonly updatePreview: boolean;
      readonly previewName: string;
    }
  | { readonly kind: "none" };

export function planSelectionSyncWithMutation(
  result: MutationResult,
  selectedEntry: FileEntry | undefined,
  selectedPreview: { readonly path: string } | undefined
): SelectionSyncEffect {
  if (result.action === "delete") {
    return { kind: "delete", path: result.path };
  }

  if (!selectedEntry || !result.destinationPath) {
    if (result.item) {
      return { kind: "focus-item", item: result.item, rebindFromPath: result.path };
    }
    return { kind: "none" };
  }

  if ((result.action === "move" || result.action === "copy") && result.path === selectedEntry.path) {
    const nextName = result.destinationPath.split("/").pop() ?? selectedEntry.name;
    const nextEntry = {
      ...selectedEntry,
      path: result.destinationPath,
      name: nextName
    };
    return {
      kind: "move-copy-selected",
      sourcePath: result.path,
      destinationPath: result.destinationPath,
      nextEntry,
      updatePreview: selectedPreview?.path === result.path,
      previewName: nextName
    };
  }

  return { kind: "none" };
}

export function shouldNavigateAfterMutation(
  result: MutationResult,
  currentPath: string
): boolean {
  return result.parentPath !== currentPath;
}
