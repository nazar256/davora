import type { FileEntry } from "@davora/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  buildBatchCopyMovePickerInitialState,
  buildMovePickerInitialState,
  buildSingleCopyMovePickerInitialState
} from "../copyMove";
import {
  acceptDeleteProgress,
  createBatchDeleteWorkflow,
  type BatchDeleteWorkflow,
  type DeleteTarget
} from "../delete";
import {
  createOperationContextToken,
  type OperationContextToken,
  type OperationIntent
} from "../policy";
import {
  initialMutationWorkflowState,
  mutationWorkflowReducer,
  type MutationWorkflowDraft,
  type MutationWorkflowEvent,
  type MutationWorkflowState
} from "./model";
import {
  issueMutationAttemptToken,
  type MutationAttemptToken
} from "./attempt";

const PROPERTY_OPTIONS = { numRuns: 250, seed: 20260831 } as const;

const NAME_VALUES = [
  "Projects",
  "Archive",
  "資料 100%.txt",
  "notes.txt",
  "folder"
] as const;
const OWNED_PHASES = [
  "collectingInput",
  "choosingDestination",
  "validating",
  "running",
  "partial",
  "failed",
  "completed"
] as const;
const nameArb = fc.constantFrom(...NAME_VALUES);
const identityArb = fc.integer({ min: 1, max: 10_000 });
const draftKindArb = fc.constantFrom<MutationDraftKind>("create", "delete", "move", "copy", "batch");
const ownedPhaseArb = fc.constantFrom<OwnedPhase>(...OWNED_PHASES);
const submittedPhaseArb = fc.constantFrom<SubmittedPhase>("validating", "running", "partial", "failed", "completed");
const traceEventKindArb = fc.constantFrom<TraceEventKind>(
  "open",
  "update-draft",
  "set-error",
  "validate",
  "run",
  "partial",
  "delete-partial",
  "delete-progress",
  "fail",
  "complete",
  "accept-effects",
  "dismiss",
  "reset-context"
);

type MutationDraftKind = "create" | "delete" | "move" | "copy" | "batch";
type OwnedPhase = Exclude<MutationWorkflowState["kind"], "idle">;
type SubmittedPhase = Extract<OwnedPhase, "validating" | "running" | "partial" | "failed" | "completed">;
type TraceEventKind = MutationWorkflowEvent["kind"];
type OwnedMutationWorkflowEvent = Exclude<
  MutationWorkflowEvent,
  { readonly kind: "open" } | { readonly kind: "reset-context" }
>;

type OwnedState = Exclude<MutationWorkflowState, { readonly kind: "idle" }>;

interface WorkflowFixture {
  readonly identity: number;
  readonly context: OperationContextToken;
  readonly draft: MutationWorkflowDraft;
  readonly intent: OperationIntent;
  readonly attempt?: MutationAttemptToken;
  readonly state: MutationWorkflowState;
}

interface TraceCommand {
  readonly kind: TraceEventKind;
  readonly foreign: boolean;
  readonly openKind: MutationDraftKind;
  readonly identity: number;
}

interface TraceScenario {
  readonly contexts: readonly [OperationContextToken, OperationContextToken];
}

function fileEntry(path: string, isFolder = false): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder };
}

function deleteTarget(index: number): DeleteTarget {
  return { path: `Projects/item-${index}.txt`, confirmName: `item-${index}.txt` };
}

function deleteWorkflow(identity: number, count = 3): BatchDeleteWorkflow {
  return createBatchDeleteWorkflow(identity, Array.from({ length: count }, (_, index) => deleteTarget(index)));
}

function contextOf(draft: MutationWorkflowDraft): OperationContextToken {
  return draft.kind === "action" ? draft.dialog.context : draft.picker.context;
}

function makeDraft(kind: MutationDraftKind, context: OperationContextToken, identity: number): MutationWorkflowDraft {
  if (kind === "create") {
    return { kind: "action", dialog: { kind: "createFolder", value: "Projects", context } };
  }
  if (kind === "delete") {
    return { kind: "action", dialog: { kind: "delete", context, workflow: deleteWorkflow(identity) } };
  }
  if (kind === "move") {
    return { kind: "destination", picker: buildMovePickerInitialState(context, fileEntry("Input/notes.txt")) };
  }
  if (kind === "copy") {
    return {
      kind: "destination",
      picker: buildSingleCopyMovePickerInitialState(context, fileEntry("Input/notes.txt"))
    };
  }
  return {
    kind: "destination",
    picker: buildBatchCopyMovePickerInitialState(context, [
      fileEntry("Input/notes.txt"),
      fileEntry("Input/second.txt")
    ], "Projects")
  };
}

function intentForDraft(draft: MutationWorkflowDraft): OperationIntent {
  if (draft.kind === "action") {
    return draft.dialog.kind === "createFolder"
      ? { kind: "createFolder" }
      : { kind: "delete", count: draft.dialog.workflow.submittedTargets.length };
  }
  return {
    kind: draft.picker.kind === "move" ? "move" : "copy",
    count: draft.picker.sourceEntries.length
  };
}

function attemptFor(
  context: OperationContextToken,
  identity: number,
  intent: OperationIntent,
  domainIdentity: string
): MutationAttemptToken {
  return issueMutationAttemptToken({
    workflowIdentity: identity,
    context,
    path: "Projects",
    pathGeneration: 1,
    ownershipGeneration: 1,
    mountGeneration: 1,
    domainIdentity,
    intent
  });
}

function requireOwnedState(state: MutationWorkflowState, operation: string): OwnedState {
  if (state.kind === "idle") {
    throw new Error(`${operation} must produce an owned mutation state.`);
  }
  return state;
}

function openDraft(identity: number, draft: MutationWorkflowDraft): OwnedState {
  return requireOwnedState(
    mutationWorkflowReducer(initialMutationWorkflowState, { kind: "open", identity, draft }),
    "Opening a draft"
  );
}

function draftWithContext(draft: MutationWorkflowDraft, context: OperationContextToken): MutationWorkflowDraft {
  if (draft.kind === "action") {
    return draft.dialog.kind === "createFolder"
      ? { kind: "action", dialog: { ...draft.dialog, context } }
      : {
          kind: "action",
          dialog: {
            ...draft.dialog,
            context,
            workflow: {
              ...draft.dialog.workflow,
              submittedTargets: draft.dialog.workflow.submittedTargets.map((target) => ({ ...target })),
              unresolvedTargets: draft.dialog.workflow.unresolvedTargets.map((target) => ({ ...target }))
            }
          }
        };
  }
  return {
    kind: "destination",
    picker: {
      ...draft.picker,
      context,
      sourceEntries: draft.picker.sourceEntries.map((entry) => ({ ...entry })),
      entries: draft.picker.entries.map((entry) => ({ ...entry }))
    }
  };
}

function stateDraft(state: MutationWorkflowState, context: OperationContextToken, identity: number): MutationWorkflowDraft {
  return state.kind !== "idle" && state.kind !== "completed"
    ? draftWithContext(state.draft, context)
    : makeDraft("create", context, identity);
}

function stateIntent(state: MutationWorkflowState): OperationIntent {
  return "intent" in state ? state.intent : { kind: "createFolder" };
}

function stateAttempt(state: MutationWorkflowState, context: OperationContextToken, identity: number): MutationAttemptToken {
  return "attempt" in state
    ? state.attempt
    : attemptFor(context, identity, stateIntent(state), "trace-fallback");
}

function buildStateAtPhase(phase: OwnedPhase, identity: number, requestedKind?: MutationDraftKind): WorkflowFixture {
  const context = createOperationContextToken();
  const draftKind = phase === "choosingDestination" || phase === "partial"
    ? requestedKind === "move" || requestedKind === "copy" || requestedKind === "batch" ? requestedKind : "copy"
    : phase === "collectingInput"
      ? requestedKind === "delete" ? "delete" : "create"
      : requestedKind ?? "create";
  const draft = makeDraft(draftKind, context, identity);
  const intent = intentForDraft(draft);
  let state: MutationWorkflowState = openDraft(identity, draft);
  if (phase === "collectingInput" || phase === "choosingDestination") {
    return { identity, context, draft, intent, state };
  }
  const attempt = attemptFor(context, identity, intent, "owner");
  state = mutationWorkflowReducer(state, { kind: "validate", identity, context, intent, attempt });
  if (phase === "validating") {
    return { identity, context, draft, intent, attempt, state };
  }
  state = mutationWorkflowReducer(state, { kind: "run", identity, context, attempt });
  if (phase === "running") {
    return { identity, context, draft, intent, attempt, state };
  }
  if (phase === "partial") {
    const failedEntries = [fileEntry("Failed/notes.txt")];
    state = mutationWorkflowReducer(state, {
      kind: "partial", identity, context, attempt, error: "partial", failedEntries
    });
    return { identity, context, draft, intent, attempt, state };
  }
  if (phase === "failed") {
    state = mutationWorkflowReducer(state, { kind: "fail", identity, context, attempt, error: "failed" });
    return { identity, context, draft, intent, attempt, state };
  }
  state = mutationWorkflowReducer(state, {
    kind: "complete", identity, context, attempt, result: { accepted: true }
  });
  return { identity, context, draft, intent, attempt, state };
}

function cloneWorkflow(workflow: BatchDeleteWorkflow): BatchDeleteWorkflow {
  return {
    ...workflow,
    submittedTargets: workflow.submittedTargets.map((target) => ({ ...target })),
    unresolvedTargets: workflow.unresolvedTargets.map((target) => ({ ...target }))
  };
}

function cloneDraft(draft: MutationWorkflowDraft): MutationWorkflowDraft {
  return draftWithContext(draft, contextOf(draft));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

function eventContext(state: MutationWorkflowState, scenario: TraceScenario, foreign: boolean): OperationContextToken {
  if (state.kind === "idle") {
    return scenario.contexts[foreign ? 1 : 0];
  }
  return foreign ? scenario.contexts[1] : state.context;
}

function eventIdentity(state: MutationWorkflowState, command: TraceCommand): number {
  if (state.kind === "idle") {
    return command.identity;
  }
  return command.foreign ? state.identity + 10_000 : state.identity;
}

function workflowForEvent(state: MutationWorkflowState, identity: number): BatchDeleteWorkflow {
  if (state.kind !== "idle" && state.kind !== "completed"
    && state.draft.kind === "action" && state.draft.dialog.kind === "delete") {
    return cloneWorkflow(state.draft.dialog.workflow);
  }
  return deleteWorkflow(identity);
}

function eventForCommand(state: MutationWorkflowState, command: TraceCommand, scenario: TraceScenario): MutationWorkflowEvent {
  const identity = eventIdentity(state, command);
  const context = eventContext(state, scenario, command.foreign);
  const attempt = stateAttempt(state, context, identity);
  const draft = stateDraft(state, context, identity);
  switch (command.kind) {
    case "open":
      return { kind: "open", identity: command.identity, draft: makeDraft(command.openKind, scenario.contexts[command.foreign ? 1 : 0], command.identity) };
    case "update-draft":
      return { kind: "update-draft", identity, context, draft };
    case "set-error":
      return { kind: "set-error", identity, context, error: command.foreign ? "foreign" : "trace" };
    case "validate":
      return { kind: "validate", identity, context, intent: intentForDraft(draft), attempt };
    case "run":
      return { kind: "run", identity, context, attempt };
    case "partial":
      return { kind: "partial", identity, context, attempt, error: "trace partial", failedEntries: [fileEntry("Failed/notes.txt")] };
    case "delete-partial": {
      const workflow = workflowForEvent(state, identity);
      const failedTarget = workflow.unresolvedTargets[0] ?? workflow.submittedTargets[0];
      return {
        kind: "delete-partial", identity, context, attempt, error: "trace partial", workflow,
        failedTarget: failedTarget ?? deleteTarget(0), completedCount: 1, totalCount: workflow.submittedTargets.length
      };
    }
    case "delete-progress": {
      const workflow = workflowForEvent(state, identity);
      const completedTarget = workflow.unresolvedTargets[0];
      return {
        kind: "delete-progress", identity, context, attempt,
        workflow: completedTarget ? acceptDeleteProgress(workflow, completedTarget) : workflow
      };
    }
    case "fail":
      return { kind: "fail", identity, context, attempt, error: "trace failure" };
    case "complete":
      return { kind: "complete", identity, context, attempt, result: { trace: true } };
    case "accept-effects":
      return { kind: "accept-effects", identity, context, attempt };
    case "dismiss":
      return { kind: "dismiss", identity, context };
    case "reset-context":
      return { kind: "reset-context", context };
    default: {
      const neverEvent: never = command.kind;
      return neverEvent;
    }
  }
}

function replaceAttempt(event: MutationWorkflowEvent, attempt: MutationAttemptToken): MutationWorkflowEvent {
  return "attempt" in event ? { ...event, attempt } : event;
}

function withEventOwnership(
  event: OwnedMutationWorkflowEvent,
  identity: number,
  context: OperationContextToken
): OwnedMutationWorkflowEvent {
  return { ...event, identity, context };
}

function cloneEvent(event: MutationWorkflowEvent): MutationWorkflowEvent {
  switch (event.kind) {
    case "open":
      return { ...event, draft: cloneDraft(event.draft) };
    case "update-draft":
      return { ...event, draft: cloneDraft(event.draft) };
    case "partial":
      return { ...event, failedEntries: event.failedEntries.map((entry) => ({ ...entry })) };
    case "delete-partial":
      return {
        ...event,
        workflow: cloneWorkflow(event.workflow),
        failedTarget: { ...event.failedTarget }
      };
    case "delete-progress":
      return { ...event, workflow: cloneWorkflow(event.workflow) };
    case "complete":
      return { ...event, result: { ...event.result } };
    case "set-error":
    case "validate":
    case "run":
    case "fail":
    case "accept-effects":
    case "dismiss":
    case "reset-context":
      return { ...event };
  }
}

function cloneEventTrace(events: readonly MutationWorkflowEvent[]): MutationWorkflowEvent[] {
  return events.map(cloneEvent);
}

function replay(events: readonly MutationWorkflowEvent[]): {
  readonly state: MutationWorkflowState;
  readonly phases: readonly MutationWorkflowState["kind"][];
} {
  let state: MutationWorkflowState = initialMutationWorkflowState;
  const phases: MutationWorkflowState["kind"][] = [state.kind];
  for (const event of events) {
    state = mutationWorkflowReducer(state, event);
    phases.push(state.kind);
  }
  return { state, phases };
}

function legalGraphNextKinds(state: MutationWorkflowState, event: MutationWorkflowEvent): ReadonlySet<MutationWorkflowState["kind"]> {
  const allowed = new Set<MutationWorkflowState["kind"]>([state.kind]);
  if (event.kind === "open") {
    allowed.add(event.draft.kind === "action" ? "collectingInput" : "choosingDestination");
  } else if (event.kind === "validate" && (state.kind === "collectingInput" || state.kind === "choosingDestination")) {
    allowed.add("validating");
  } else if (event.kind === "run" && state.kind === "validating") {
    allowed.add("running");
  } else if (event.kind === "partial" && state.kind === "running") {
    allowed.add("partial");
  } else if (event.kind === "delete-partial" && state.kind === "running") {
    allowed.add("partial");
  } else if (event.kind === "fail" && state.kind === "running") {
    allowed.add("failed");
  } else if (event.kind === "complete" && state.kind === "running") {
    allowed.add("completed");
  } else if (event.kind === "accept-effects" && state.kind === "completed") {
    allowed.add("idle");
  } else if ((event.kind === "dismiss" || event.kind === "reset-context") && state.kind !== "idle") {
    allowed.add("idle");
  } else if (event.kind === "set-error" && event.error === undefined
    && (state.kind === "failed" || state.kind === "partial")) {
    allowed.add(state.draft.kind === "action" ? "collectingInput" : "choosingDestination");
  }
  return allowed;
}

const traceCommandArb = fc.record({
  kind: traceEventKindArb,
  foreign: fc.boolean(),
  openKind: draftKindArb,
  identity: identityArb
});

describe("mutation workflow reducer property characterization", () => {
  if (process.env.DAVORA_MUTATION_WORKFLOW_FAILING_FIRST === "1") {
    it("failing-first sentinel isolates positive identity validation", () => {
      const context = createOperationContextToken();
      expect(() => mutationWorkflowReducer(initialMutationWorkflowState, {
        kind: "open", identity: 1, draft: makeDraft("create", context, 1)
      })).not.toThrow();
      expect(() => mutationWorkflowReducer(initialMutationWorkflowState, {
        kind: "open", identity: 1, draft: makeDraft("create", context, 1)
      })).not.toThrow();
      expect(1).toBe(2);
    });
  }

  it("opens positive identities, replaces prior state, and preserves the current invalid-identity throw contract", () => {
    const maximumContext = createOperationContextToken();
    expect(openDraft(
      Number.MAX_SAFE_INTEGER,
      makeDraft("create", maximumContext, Number.MAX_SAFE_INTEGER)
    )).toMatchObject({ kind: "collectingInput", identity: Number.MAX_SAFE_INTEGER });

    for (const [index, priorPhase] of OWNED_PHASES.entries()) {
      const prior = buildStateAtPhase(priorPhase, 20_001 + index).state;
      const replacementContext = createOperationContextToken();
      const replacementDraft = makeDraft(index % 2 === 0 ? "create" : "copy", replacementContext, 30_001 + index);
      expect(mutationWorkflowReducer(prior, {
        kind: "open",
        identity: 30_001 + index,
        draft: replacementDraft
      })).toMatchObject({
        kind: replacementDraft.kind === "action" ? "collectingInput" : "choosingDestination",
        identity: 30_001 + index
      });
    }

    const identityCaseArb = fc.oneof(
      identityArb.map((identity) => ({ valid: true as const, identity })),
      fc.constantFrom(0, -1, -1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1)
        .map((identity) => ({ valid: false as const, identity }))
    );
    fc.assert(fc.property(identityCaseArb, draftKindArb, ownedPhaseArb, (identityCase, kind, priorPhase) => {
      const context = createOperationContextToken();
      const draft = makeDraft(kind, context, identityCase.valid ? identityCase.identity : 1);
      if (!identityCase.valid) {
        expect(() => mutationWorkflowReducer(initialMutationWorkflowState, {
          kind: "open", identity: identityCase.identity, draft
        })).toThrow("Mutation workflow identity must be a positive safe integer.");
        return;
      }
      const first = openDraft(identityCase.identity, draft);
      expect(first.kind).toBe(draft.kind === "action" ? "collectingInput" : "choosingDestination");
      expect(first.identity).toBe(identityCase.identity);
      expect(first.context.isSame(context)).toBe(true);
      expect("draft" in first && first.draft).toBe(draft);

      const replacementContext = createOperationContextToken();
      const replacementDraft = makeDraft(kind === "create" ? "delete" : "create", replacementContext, identityCase.identity + 1);
      const prior = buildStateAtPhase(priorPhase, identityCase.identity + 20_000, kind).state;
      const replacement = requireOwnedState(mutationWorkflowReducer(prior, {
        kind: "open", identity: identityCase.identity + 1, draft: replacementDraft
      }), "Replacing a draft");
      expect(replacement.kind).toBe(replacementDraft.kind === "action" ? "collectingInput" : "choosingDestination");
      expect(replacement.identity).toBe(identityCase.identity + 1);
      expect("draft" in replacement && replacement.draft).toBe(replacementDraft);
    }), PROPERTY_OPTIONS);
  });

  it("keeps foreign identity/context events inert while accepting an equivalent context through isSame", () => {
    fc.assert(fc.property(ownedPhaseArb, draftKindArb, (phase, kind) => {
      const fixture = buildStateAtPhase(phase, 101, kind);
      const foreignContext = createOperationContextToken();
      const eventKinds: readonly Exclude<TraceEventKind, "open">[] = [
        "update-draft",
        "set-error",
        "validate",
        "run",
        "partial",
        "delete-partial",
        "delete-progress",
        "fail",
        "complete",
        "accept-effects",
        "dismiss",
        "reset-context"
      ];
      for (const eventKind of eventKinds) {
        const event = eventForCommand(fixture.state, {
          kind: eventKind, foreign: true, openKind: "create", identity: 202
        }, { contexts: [fixture.context, foreignContext] });
        if (event.kind === "reset-context") {
          expect(mutationWorkflowReducer(fixture.state, { kind: "reset-context", context: foreignContext })).toBe(fixture.state);
          continue;
        }
        if (event.kind === "open") {
          throw new Error("Ownership matrix excludes open events.");
        }
        expect(mutationWorkflowReducer(
          fixture.state,
          withEventOwnership(event, fixture.identity + 1, fixture.context)
        )).toBe(fixture.state);
        expect(mutationWorkflowReducer(
          fixture.state,
          withEventOwnership(event, fixture.identity, foreignContext)
        )).toBe(fixture.state);
      }
    }), PROPERTY_OPTIONS);

    const context = createOperationContextToken();
    const opened = openDraft(303, makeDraft("create", context, 303));
    const replacementDraft = makeDraft("create", context, 303);
    expect(context.isSame(replacementDraft.kind === "action" ? replacementDraft.dialog.context : replacementDraft.picker.context)).toBe(true);
    const updated = mutationWorkflowReducer(opened, {
      kind: "update-draft", identity: 303, context,
      draft: { kind: "action", dialog: { kind: "createFolder", value: "Archive", context } }
    });
    expect(updated).not.toBe(opened);
    expect(updated).toMatchObject({ kind: "collectingInput", draft: { kind: "action", dialog: { value: "Archive" } } });
  });

  it("rejects foreign attempt tokens across validating, running, outcome, and completion states", () => {
    fc.assert(fc.property(submittedPhaseArb, draftKindArb, (phase, kind) => {
      const fixture = buildStateAtPhase(phase, 401, kind);
      if (!fixture.attempt) {
        throw new Error("Submitted mutation fixture must have an attempt.");
      }
      const foreignAttempt = attemptFor(fixture.context, fixture.identity, fixture.intent, "foreign");
      const eventKinds: readonly TraceEventKind[] = fixture.state.kind === "validating"
        ? ["run"]
        : fixture.state.kind === "running"
          ? fixture.draft.kind === "action" && fixture.draft.dialog.kind === "delete"
            ? ["delete-progress", "delete-partial", "fail", "complete"]
            : ["partial", "fail", "complete"]
          : ["accept-effects"];
      for (const eventKind of eventKinds) {
        const event = replaceAttempt(eventForCommand(fixture.state, {
          kind: eventKind, foreign: false, openKind: "create", identity: 0
        }, { contexts: [fixture.context, createOperationContextToken()] }), foreignAttempt);
        expect(mutationWorkflowReducer(fixture.state, event)).toBe(fixture.state);
      }
    }), PROPERTY_OPTIONS);
  });

  it("keeps generated mixed traces inside the legal workflow phase graph", () => {
    fc.assert(fc.property(fc.array(traceCommandArb, { maxLength: 24 }), (commands) => {
      const scenario: TraceScenario = {
        contexts: [createOperationContextToken(), createOperationContextToken()]
      };
      let state: MutationWorkflowState = initialMutationWorkflowState;
      for (const command of commands) {
        const event = eventForCommand(state, command, scenario);
        const next = mutationWorkflowReducer(state, event);
        expect(legalGraphNextKinds(state, event).has(next.kind)).toBe(true);
        state = next;
      }
    }), PROPERTY_OPTIONS);
  });

  it("accepts only compatible drafts/intents and keeps submitted drafts immutable", () => {
    fc.assert(fc.property(fc.integer(), () => {
      const context = createOperationContextToken();
      const deleteDraft = makeDraft("delete", context, 501);
      const moveDraft = makeDraft("move", context, 502);
      const copyDraft = makeDraft("copy", context, 503);
      const batchDraft = makeDraft("batch", context, 504);
      const cases: readonly {
        readonly label: string;
        readonly identity: number;
        readonly draft: MutationWorkflowDraft;
        readonly intent: OperationIntent;
        readonly accepted: boolean;
      }[] = [
        { label: "create exact", identity: 500, draft: makeDraft("create", context, 500), intent: { kind: "createFolder" }, accepted: true },
        { label: "create crossed to delete", identity: 500, draft: makeDraft("create", context, 500), intent: { kind: "delete", count: 1 }, accepted: false },
        { label: "delete exact", identity: 501, draft: deleteDraft, intent: { kind: "delete", count: 3 }, accepted: true },
        { label: "delete wrong count", identity: 501, draft: deleteDraft, intent: { kind: "delete", count: 4 }, accepted: false },
        { label: "delete crossed to copy", identity: 501, draft: deleteDraft, intent: { kind: "copy", count: 3 }, accepted: false },
        { label: "move exact", identity: 502, draft: moveDraft, intent: { kind: "move", count: 1 }, accepted: true },
        { label: "move crossed to copy", identity: 502, draft: moveDraft, intent: { kind: "copy", count: 1 }, accepted: false },
        { label: "copy exact", identity: 503, draft: copyDraft, intent: { kind: "copy", count: 1 }, accepted: true },
        { label: "batch copy", identity: 504, draft: batchDraft, intent: { kind: "copy", count: 2 }, accepted: true },
        { label: "batch move", identity: 504, draft: batchDraft, intent: { kind: "move", count: 2 }, accepted: true },
        { label: "destination wrong count", identity: 504, draft: batchDraft, intent: { kind: "move", count: 3 }, accepted: false },
        { label: "destination upload", identity: 504, draft: batchDraft, intent: { kind: "upload", requiresFolderCreation: false }, accepted: false }
      ];
      for (const intentCase of cases) {
        const opened = openDraft(intentCase.identity, intentCase.draft);
        const attempt = attemptFor(context, intentCase.identity, intentCase.intent, intentCase.label);
        const validated = mutationWorkflowReducer(opened, {
          kind: "validate",
          identity: intentCase.identity,
          context,
          intent: intentCase.intent,
          attempt
        });
        expect(validated.kind === "validating", intentCase.label).toBe(intentCase.accepted);
        if (!intentCase.accepted) {
          expect(validated, intentCase.label).toBe(opened);
          continue;
        }
        expect(mutationWorkflowReducer(validated, {
          kind: "update-draft",
          identity: intentCase.identity,
          context,
          draft: cloneDraft(intentCase.draft)
        }), intentCase.label).toBe(validated);
      }

      const action = openDraft(505, makeDraft("create", context, 505));
      expect(mutationWorkflowReducer(action, {
        kind: "update-draft", identity: 505, context, draft: makeDraft("copy", context, 505)
      })).toBe(action);
      const destination = openDraft(506, makeDraft("copy", context, 506));
      expect(mutationWorkflowReducer(destination, {
        kind: "update-draft", identity: 506, context, draft: makeDraft("create", context, 506)
      })).toBe(destination);
    }), PROPERTY_OPTIONS);

    const identity = 507;
    const context = createOperationContextToken();
    const submittedWorkflow = deleteWorkflow(identity, 3);
    const submittedDraft: MutationWorkflowDraft = {
      kind: "action",
      dialog: { kind: "delete", context, workflow: submittedWorkflow }
    };
    const submittedIntent: OperationIntent = { kind: "delete", count: 3 };
    const submittedAttempt = attemptFor(context, identity, submittedIntent, "delete-recovery");
    const running = mutationWorkflowReducer(mutationWorkflowReducer(openDraft(identity, submittedDraft), {
      kind: "validate", identity, context, intent: submittedIntent, attempt: submittedAttempt
    }), { kind: "run", identity, context, attempt: submittedAttempt });
    const progressedWorkflow = acceptDeleteProgress(submittedWorkflow, submittedWorkflow.unresolvedTargets[0]);
    const progressed = mutationWorkflowReducer(running, {
      kind: "delete-progress", identity, context, attempt: submittedAttempt, workflow: progressedWorkflow
    });
    const partial = mutationWorkflowReducer(progressed, {
      kind: "delete-partial",
      identity,
      context,
      attempt: submittedAttempt,
      error: "remaining target failed",
      workflow: progressedWorkflow,
      failedTarget: progressedWorkflow.unresolvedTargets[0],
      completedCount: 1,
      totalCount: 3
    });
    const recovered = mutationWorkflowReducer(partial, {
      kind: "set-error", identity, context, error: undefined
    });
    expect(recovered).toMatchObject({ kind: "collectingInput" });
    const remainingIntent: OperationIntent = { kind: "delete", count: 2 };
    const remainingAttempt = attemptFor(context, identity, remainingIntent, "delete-recovery-remaining");
    expect(mutationWorkflowReducer(recovered, {
      kind: "validate", identity, context, intent: remainingIntent, attempt: remainingAttempt
    })).toMatchObject({ kind: "validating", intent: remainingIntent });
    expect(mutationWorkflowReducer(recovered, {
      kind: "validate", identity, context, intent: submittedIntent, attempt: submittedAttempt
    })).toBe(recovered);
  });

  it("preserves presentation-error domain data and clears only owned failed/partial input", () => {
    fc.assert(fc.property(ownedPhaseArb, draftKindArb, nameArb, (phase, kind, error) => {
      const fixture = buildStateAtPhase(phase, 601, kind);
      const setError = mutationWorkflowReducer(fixture.state, {
        kind: "set-error", identity: fixture.identity, context: fixture.context, error
      });
      if (fixture.state.kind === "completed") {
        expect(setError).toBe(fixture.state);
      } else {
        expect(setError.kind).toBe(fixture.state.kind);
        if (setError.kind !== "idle" && setError.kind !== "completed") {
          expect(setError.presentationError).toBe(error);
        }
      }

      const cleared = mutationWorkflowReducer(fixture.state, {
        kind: "set-error", identity: fixture.identity, context: fixture.context, error: undefined
      });
      if (fixture.state.kind === "failed" || fixture.state.kind === "partial") {
        expect(cleared.kind).toBe(fixture.draft.kind === "action" ? "collectingInput" : "choosingDestination");
        expect("draft" in cleared && cleared.draft).toBe(fixture.state.draft);
      } else if (fixture.state.kind === "completed") {
        expect(cleared).toBe(fixture.state);
      } else {
        expect(cleared.kind).toBe(fixture.state.kind);
      }
      const foreignContext = createOperationContextToken();
      expect(mutationWorkflowReducer(fixture.state, {
        kind: "set-error", identity: fixture.identity, context: foreignContext, error: undefined
      })).toBe(fixture.state);
    }), PROPERTY_OPTIONS);
  });

  it("makes fail/complete terminal outcomes and accepts effects only from completed state", () => {
    fc.assert(fc.property(submittedPhaseArb, draftKindArb, fc.constantFrom("fail", "complete", "accept-effects"), (phase, kind, eventKind) => {
      const fixture = buildStateAtPhase(phase, 701, kind);
      if (!fixture.attempt) {
        throw new Error("Terminal fixture must have an attempt.");
      }
      const event = eventForCommand(fixture.state, {
        kind: eventKind, foreign: false, openKind: "create", identity: 0
      }, { contexts: [fixture.context, createOperationContextToken()] });
      const next = mutationWorkflowReducer(fixture.state, event);
      const legal = eventKind === "accept-effects"
        ? fixture.state.kind === "completed"
        : fixture.state.kind === "running";
      if (!legal) {
        expect(next).toBe(fixture.state);
      } else if (eventKind === "fail") {
        expect(next.kind).toBe("failed");
      } else if (eventKind === "complete") {
        expect(next.kind).toBe("completed");
      } else {
        expect(next).toEqual(initialMutationWorkflowState);
      }
    }), PROPERTY_OPTIONS);

    const fixture = buildStateAtPhase("completed", 702, "create");
    if (!fixture.attempt) {
      throw new Error("Completed mutation fixture must have an attempt.");
    }
    expect(mutationWorkflowReducer(fixture.state, {
      kind: "accept-effects", identity: fixture.identity, context: fixture.context, attempt: fixture.attempt
    })).toEqual(initialMutationWorkflowState);
  });

  it("accepts exactly one ordered delete-progress removal and rejects conservation violations", () => {
    expect(() => createBatchDeleteWorkflow(800, [])).toThrow(
      "Batch delete requires a positive workflow identity and at least one target."
    );
    const oneTargetContext = createOperationContextToken();
    const oneTargetWorkflow = deleteWorkflow(810, 1);
    const oneTargetIntent: OperationIntent = { kind: "delete", count: 1 };
    const oneTargetAttempt = attemptFor(oneTargetContext, 810, oneTargetIntent, "one-target");
    const oneTargetRunning = mutationWorkflowReducer(mutationWorkflowReducer(openDraft(810, {
      kind: "action",
      dialog: { kind: "delete", context: oneTargetContext, workflow: oneTargetWorkflow }
    }), {
      kind: "validate",
      identity: 810,
      context: oneTargetContext,
      intent: oneTargetIntent,
      attempt: oneTargetAttempt
    }), { kind: "run", identity: 810, context: oneTargetContext, attempt: oneTargetAttempt });
    expect(mutationWorkflowReducer(oneTargetRunning, {
      kind: "delete-progress",
      identity: 810,
      context: oneTargetContext,
      attempt: oneTargetAttempt,
      workflow: acceptDeleteProgress(oneTargetWorkflow, oneTargetWorkflow.unresolvedTargets[0])
    })).toMatchObject({
      kind: "running",
      draft: { kind: "action", dialog: { workflow: { unresolvedTargets: [] } } }
    });
    const mutationKindArb = fc.constantFrom("valid", "zero", "two", "duplicate", "reordered", "substituted", "submitted-drift");
    fc.assert(fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 9 }), mutationKindArb, (count, index, mutationKind) => {
      const identity = 801;
      const context = createOperationContextToken();
      const workflow = deleteWorkflow(identity, count);
      const draft: MutationWorkflowDraft = { kind: "action", dialog: { kind: "delete", context, workflow } };
      const opened = openDraft(identity, draft);
      const intent: OperationIntent = { kind: "delete", count };
      const attempt = attemptFor(context, identity, intent, "delete-progress");
      const validating = mutationWorkflowReducer(opened, { kind: "validate", identity, context, intent, attempt });
      const running = mutationWorkflowReducer(validating, { kind: "run", identity, context, attempt });
      const removeIndex = index % count;
      const validWorkflow: BatchDeleteWorkflow = {
        ...workflow,
        unresolvedTargets: workflow.unresolvedTargets.filter((_, targetIndex) => targetIndex !== removeIndex)
      };
      let candidate = validWorkflow;
      if (mutationKind === "zero") candidate = workflow;
      if (mutationKind === "two" && count > 1) {
        candidate = { ...workflow, unresolvedTargets: workflow.unresolvedTargets.filter((_, targetIndex) => targetIndex > 1) };
      }
      if (mutationKind === "duplicate" && count > 1) {
        candidate = { ...workflow, unresolvedTargets: [workflow.unresolvedTargets[0], workflow.unresolvedTargets[0], ...workflow.unresolvedTargets.slice(2)] };
      }
      if (mutationKind === "reordered" && count > 1) {
        candidate = { ...workflow, unresolvedTargets: [workflow.unresolvedTargets[1], workflow.unresolvedTargets[0], ...workflow.unresolvedTargets.slice(2)] };
      }
      if (mutationKind === "substituted") {
        candidate = {
          ...validWorkflow,
          unresolvedTargets: validWorkflow.unresolvedTargets.concat({ path: "Projects/substituted.txt", confirmName: "substituted.txt" })
        };
      }
      if (mutationKind === "submitted-drift") {
        candidate = { ...validWorkflow, submittedTargets: [...workflow.submittedTargets, deleteTarget(99)] };
      }
      if (count === 1 && mutationKind !== "valid") candidate = workflow;
      const next = mutationWorkflowReducer(running, {
        kind: "delete-progress", identity, context, attempt, workflow: candidate
      });
      if (mutationKind === "valid") {
        expect(next).not.toBe(running);
        expect(next).toMatchObject({ kind: "running", draft: { kind: "action", dialog: { workflow: validWorkflow } } });
      } else {
        expect(next).toBe(running);
      }
    }), PROPERTY_OPTIONS);

    const context = createOperationContextToken();
    const workflow = deleteWorkflow(901, 3);
    const owner = attemptFor(context, 901, { kind: "delete", count: 3 }, "explicit");
    const opened = openDraft(901, { kind: "action", dialog: { kind: "delete", context, workflow } });
    const running = mutationWorkflowReducer(mutationWorkflowReducer(opened, {
      kind: "validate", identity: 901, context, intent: { kind: "delete", count: 3 }, attempt: owner
    }), { kind: "run", identity: 901, context, attempt: owner });
    expect(mutationWorkflowReducer(running, {
      kind: "delete-progress", identity: 901, context, attempt: owner,
      workflow: { ...workflow, unresolvedTargets: [workflow.unresolvedTargets[0], workflow.unresolvedTargets[2]] }
    })).toMatchObject({ kind: "running" });
    expect(mutationWorkflowReducer(running, {
      kind: "delete-progress", identity: 901, context, attempt: owner,
      workflow: {
        ...workflow,
        unresolvedTargets: [
          { ...workflow.unresolvedTargets[0], confirmName: "different-confirm-name.txt" },
          workflow.unresolvedTargets[2]
        ]
      }
    })).toBe(running);
  });

  it("preserves destination/delete partial snapshots, ordered facts, and caller-owned inputs", () => {
    fc.assert(fc.property(fc.constantFrom("destination", "delete"), fc.array(nameArb, { minLength: 1, maxLength: 4 }), (domain, names) => {
      if (domain === "destination") {
        const identity = 1001;
        const context = createOperationContextToken();
        const sources = names.map((name, index) => fileEntry(`Input/${index}/${name}`));
        const draft: MutationWorkflowDraft = {
          kind: "destination",
          picker: buildBatchCopyMovePickerInitialState(context, sources, "Projects")
        };
        const intent: OperationIntent = { kind: "copy", count: sources.length };
        const attempt = attemptFor(context, identity, intent, "destination-partial");
        const running = mutationWorkflowReducer(mutationWorkflowReducer(openDraft(identity, draft), {
          kind: "validate", identity, context, intent, attempt
        }), { kind: "run", identity, context, attempt });
        const failedEntries = names.map((name, index) => fileEntry(`Failed/${index}/${name}`));
        const event: MutationWorkflowEvent = { kind: "partial", identity, context, attempt, error: "destination failed", failedEntries };
        const snapshot = cloneEvent(event);
        const next = mutationWorkflowReducer(running, deepFreeze(event));
        expect(next).toMatchObject({
          kind: "partial",
          error: "destination failed",
          partial: { kind: "destination", failedSourcePaths: failedEntries.map((entry) => entry.path) }
        });
        if (next.kind === "partial" && next.draft.kind === "destination") {
          expect(next.draft.picker.sourceEntries).toEqual(failedEntries);
          expect(next.draft.picker.sourceEntries).not.toBe(failedEntries);
        }
        expect(event).toEqual(snapshot);
        expect(running).toMatchObject({ kind: "running" });
        return;
      }

      const identity = 1002;
      const context = createOperationContextToken();
      const count = Math.max(2, names.length);
      const submittedWorkflow = deleteWorkflow(identity, count);
      const workflow = acceptDeleteProgress(submittedWorkflow, submittedWorkflow.unresolvedTargets[0]);
      const draft: MutationWorkflowDraft = { kind: "action", dialog: { kind: "delete", context, workflow } };
      const intent: OperationIntent = { kind: "delete", count: workflow.unresolvedTargets.length };
      const attempt = attemptFor(context, identity, intent, "delete-partial");
      const running = mutationWorkflowReducer(mutationWorkflowReducer(openDraft(identity, draft), {
        kind: "validate", identity, context, intent, attempt
      }), { kind: "run", identity, context, attempt });
      const unresolvedTargets = workflow.unresolvedTargets;
      const failedTarget = unresolvedTargets[0];
      const event: MutationWorkflowEvent = {
        kind: "delete-partial", identity, context, attempt, error: "delete failed", workflow,
        failedTarget, completedCount: 1, totalCount: count
      };
      const snapshot = cloneEvent(event);
      const next = mutationWorkflowReducer(running, deepFreeze(event));
      expect(next).toMatchObject({
        kind: "partial",
        error: "delete failed",
        partial: { kind: "delete", completedCount: 1, totalCount: count, failedTarget }
      });
      if (next.kind === "partial" && next.partial.kind === "delete") {
        expect(next.partial.unresolvedTargets).toEqual(unresolvedTargets);
        expect(next.partial.unresolvedTargets).not.toBe(unresolvedTargets);
      }
      expect(mutationWorkflowReducer(running, {
        ...event,
        completedCount: 2
      })).toBe(running);
      expect(mutationWorkflowReducer(running, {
        ...event,
        failedTarget: submittedWorkflow.submittedTargets[0]
      })).toBe(running);
      expect(event).toEqual(snapshot);
      expect(running).toMatchObject({ kind: "running" });
    }), PROPERTY_OPTIONS);
  });

  it("replays cloned event traces deterministically and keeps inert foreign traces referentially unchanged", () => {
    fc.assert(fc.property(fc.array(traceCommandArb, { maxLength: 20 }), (commands) => {
      const scenario: TraceScenario = {
        contexts: [createOperationContextToken(), createOperationContextToken()]
      };
      let state: MutationWorkflowState = initialMutationWorkflowState;
      const events: MutationWorkflowEvent[] = [];
      for (const command of commands) {
        const event = eventForCommand(state, command, scenario);
        events.push(event);
        state = mutationWorkflowReducer(state, event);
      }
      const originalEvents = cloneEventTrace(events);
      const first = replay(events);
      const second = replay(cloneEventTrace(events));
      expect(second.state).toEqual(first.state);
      expect(second.phases).toEqual(first.phases);
      expect(events).toEqual(originalEvents);

      const foreignFixture = buildStateAtPhase("running", 1101, "delete");
      let foreignState = foreignFixture.state;
      const foreignScenario: TraceScenario = {
        contexts: [foreignFixture.context, createOperationContextToken()]
      };
      for (const command of commands) {
        if (command.kind === "open") continue;
        const foreignEvent = eventForCommand(foreignState, { ...command, foreign: true }, foreignScenario);
        const next = mutationWorkflowReducer(foreignState, foreignEvent);
        expect(next).toBe(foreignState);
        foreignState = next;
      }
    }), PROPERTY_OPTIONS);
  });
});
