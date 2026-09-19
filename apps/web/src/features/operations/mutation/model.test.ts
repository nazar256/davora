import type { FileEntry, MutationResult } from "@davora/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  buildDefaultMutationSuccessStatus,
  buildOfflineMutationBlockedMessage,
  buildServerUnavailableMutationBlockedMessage,
  evaluateMutationPreconditions,
  isMutationOperationStillCurrent,
  MUTATION_NO_SESSION_MESSAGE,
  planSelectionSyncWithMutation,
  shouldNavigateAfterMutation,
  mutationWorkflowReducer,
  initialMutationWorkflowState,
  type MutationWorkflowDraft,
  type MutationWorkflowEvent,
  type MutationWorkflowState
} from "./model";
import { createOperationContextToken } from "../policy";
import { acceptDeleteProgress, createBatchDeleteWorkflow, type BatchDeleteWorkflow } from "../delete";
import { buildMovePickerInitialState } from "../copyMove";
import { issueMutationAttemptToken } from "./attempt";

function attempt(context: ReturnType<typeof createOperationContextToken>, workflowIdentity: number, domainIdentity = "test") {
  return issueMutationAttemptToken({
    workflowIdentity, context, path: "", pathGeneration: 0, ownershipGeneration: 0,
    mountGeneration: 1, domainIdentity, intent: { kind: "createFolder" }
  });
}

function entry(path: string, name = path.split("/").pop() ?? path): FileEntry {
  return { path, name, isFolder: false };
}

function mutationResult(overrides: Partial<MutationResult> & Pick<MutationResult, "action" | "path">): MutationResult {
  return {
    parentPath: "",
    ...overrides
  };
}

describe("mutation model", () => {
  it("models one exhaustive mutation surface lifecycle and replaces the previous operation", () => {
    const firstContext = createOperationContextToken();
    const secondContext = createOperationContextToken();
    const createDraft: MutationWorkflowDraft = {
      kind: "action",
      dialog: { kind: "createFolder", value: "New folder", context: firstContext }
    };
    const deleteDraft: MutationWorkflowDraft = {
      kind: "action",
      dialog: {
        kind: "delete",
        context: secondContext,
        workflow: createBatchDeleteWorkflow(1, [{ path: "old.txt", confirmName: "old.txt" }])
      }
    };

    const first = mutationWorkflowReducer(initialMutationWorkflowState, {
      kind: "open",
      identity: 1,
      draft: createDraft
    });
    expect(first).toMatchObject({ kind: "collectingInput", identity: 1, draft: createDraft });

    const replacement = mutationWorkflowReducer(first, {
      kind: "open",
      identity: 2,
      draft: deleteDraft
    });
    expect(replacement).toMatchObject({ kind: "collectingInput", identity: 2, draft: deleteDraft });
  });

  it("carries one attempt through legal validation, running, failure, and completion", () => {
    const context = createOperationContextToken();
    const draft: MutationWorkflowDraft = {
      kind: "action",
      dialog: { kind: "createFolder", value: "Projects", context }
    };
    const opened = mutationWorkflowReducer(initialMutationWorkflowState, { kind: "open", identity: 7, draft });
    const owner = attempt(context, 7);
    const validating = mutationWorkflowReducer(opened, {
      kind: "validate",
      identity: 7,
      context,
      intent: { kind: "createFolder" },
      attempt: owner
    });
    expect(validating.kind).toBe("validating");
    const running = mutationWorkflowReducer(validating, { kind: "run", identity: 7, context, attempt: owner });
    expect(running.kind).toBe("running");
    const failed = mutationWorkflowReducer(running, {
      kind: "fail",
      identity: 7,
      context,
      error: "Unable to create folder.",
      attempt: owner
    });
    expect(failed).toMatchObject({ kind: "failed", error: "Unable to create folder." });
    expect(mutationWorkflowReducer(failed, {
      kind: "set-error",
      identity: 7,
      context,
      error: undefined
    })).toMatchObject({ kind: "collectingInput", draft });
    const completed = mutationWorkflowReducer(running, {
      kind: "complete",
      identity: 7,
      context,
      result: { kind: "accepted" },
      attempt: owner
    });
    expect(completed).toMatchObject({ kind: "completed", result: { kind: "accepted" } });
    expect(mutationWorkflowReducer(completed, { kind: "accept-effects", identity: 7, context, attempt: owner }))
      .toEqual(initialMutationWorkflowState);
  });

  it("ignores stale identity and context events and resets only for the owning context", () => {
    const context = createOperationContextToken();
    const staleContext = createOperationContextToken();
    const draft: MutationWorkflowDraft = {
      kind: "action",
      dialog: { kind: "createFolder", value: "Projects", context }
    };
    const opened = mutationWorkflowReducer(initialMutationWorkflowState, { kind: "open", identity: 3, draft });
    const owner = attempt(context, 3);

    expect(mutationWorkflowReducer(opened, {
      kind: "validate",
      identity: 2,
      context,
      intent: { kind: "createFolder" }, attempt: owner
    })).toBe(opened);
    expect(mutationWorkflowReducer(opened, {
      kind: "validate",
      identity: 3,
      context: staleContext,
      intent: { kind: "createFolder" }, attempt: owner
    })).toBe(opened);
    expect(mutationWorkflowReducer(opened, { kind: "reset-context", context: staleContext })).toBe(opened);
    expect(mutationWorkflowReducer(opened, { kind: "reset-context", context }))
      .toEqual(initialMutationWorkflowState);
  });

  it("property: no foreign positive workflow identity can advance the owned lifecycle", () => {
    const context = createOperationContextToken();
    const draft: MutationWorkflowDraft = {
      kind: "action",
      dialog: { kind: "createFolder", value: "Projects", context }
    };
    const opened = mutationWorkflowReducer(initialMutationWorkflowState, { kind: "open", identity: 17, draft });
    const owner = attempt(context, 17);

    fc.assert(fc.property(
      fc.integer({ min: 1, max: 10_000 }).filter((identity) => identity !== 17),
      (identity) => {
        expect(mutationWorkflowReducer(opened, {
          kind: "validate",
          identity,
          context,
          intent: { kind: "createFolder" }, attempt: owner
        })).toBe(opened);
      }
    ));
  });

  it("property: invalid intent kinds cannot advance an action draft, and submitted drafts cannot be edited", () => {
    const context = createOperationContextToken();
    const draft: MutationWorkflowDraft = {
      kind: "action",
      dialog: { kind: "createFolder", value: "Projects", context }
    };
    const opened = mutationWorkflowReducer(initialMutationWorkflowState, { kind: "open", identity: 23, draft });
    const owner = attempt(context, 23);
    fc.assert(fc.property(fc.constantFrom(
      { kind: "delete" as const, count: 1 },
      { kind: "copy" as const, count: 1 },
      { kind: "move" as const, count: 1 },
      { kind: "upload" as const, requiresFolderCreation: false }
    ), (intent) => {
      expect(mutationWorkflowReducer(opened, {
        kind: "validate", identity: 23, context, intent, attempt: owner
      })).toBe(opened);
    }));

    const validating = mutationWorkflowReducer(opened, {
      kind: "validate", identity: 23, context, intent: { kind: "createFolder" }, attempt: owner
    });
    const running = mutationWorkflowReducer(validating, { kind: "run", identity: 23, context, attempt: owner });
    expect(mutationWorkflowReducer(running, {
      kind: "update-draft", identity: 23, context,
      draft: { kind: "action", dialog: { kind: "createFolder", value: "Changed", context } }
    })).toBe(running);
  });

  it("rejects every foreign-attempt transition across submitted states", () => {
    const context = createOperationContextToken();
    const actionDraft: MutationWorkflowDraft = {
      kind: "action", dialog: { kind: "createFolder", value: "Projects", context }
    };
    const opened = mutationWorkflowReducer(initialMutationWorkflowState, { kind: "open", identity: 31, draft: actionDraft });
    const owner = attempt(context, 31, "owner");
    const foreign = attempt(context, 31, "foreign");
    const validating = mutationWorkflowReducer(opened, {
      kind: "validate", identity: 31, context, intent: { kind: "createFolder" }, attempt: owner
    });
    expect(mutationWorkflowReducer(validating, { kind: "run", identity: 31, context, attempt: foreign })).toBe(validating);
    const running = mutationWorkflowReducer(validating, { kind: "run", identity: 31, context, attempt: owner });
    expect(mutationWorkflowReducer(running, {
      kind: "fail", identity: 31, context, attempt: foreign, error: "foreign"
    })).toBe(running);
    expect(mutationWorkflowReducer(running, {
      kind: "complete", identity: 31, context, attempt: foreign, result: {}
    })).toBe(running);
    const completed = mutationWorkflowReducer(running, {
      kind: "complete", identity: 31, context, attempt: owner, result: {}
    });
    expect(mutationWorkflowReducer(completed, {
      kind: "accept-effects", identity: 31, context, attempt: foreign
    })).toBe(completed);

    const deleteWorkflow = createBatchDeleteWorkflow(32, [
      { path: "a.txt", confirmName: "a.txt" }, { path: "b.txt", confirmName: "b.txt" }
    ]);
    const deleteOpened = mutationWorkflowReducer(initialMutationWorkflowState, {
      kind: "open", identity: 32,
      draft: { kind: "action", dialog: { kind: "delete", context, workflow: deleteWorkflow } }
    });
    const deleteOwner = attempt(context, 32);
    const deleteRunning = mutationWorkflowReducer(mutationWorkflowReducer(deleteOpened, {
      kind: "validate", identity: 32, context, intent: { kind: "delete", count: 2 }, attempt: deleteOwner
    }), { kind: "run", identity: 32, context, attempt: deleteOwner });
    const progressed = acceptDeleteProgress(deleteWorkflow, deleteWorkflow.submittedTargets[0]);
    expect(mutationWorkflowReducer(deleteRunning, {
      kind: "delete-progress", identity: 32, context, attempt: foreign, workflow: progressed
    })).toBe(deleteRunning);
    const skipped = acceptDeleteProgress(progressed, deleteWorkflow.submittedTargets[1]);
    expect(mutationWorkflowReducer(deleteRunning, {
      kind: "delete-progress", identity: 32, context, attempt: deleteOwner, workflow: skipped
    })).toBe(deleteRunning);
    expect(mutationWorkflowReducer(deleteRunning, {
      kind: "delete-partial", identity: 32, context, attempt: foreign, workflow: deleteWorkflow,
      failedTarget: deleteWorkflow.submittedTargets[0], completedCount: 1, totalCount: 2, error: "foreign"
    })).toBe(deleteRunning);

    const source = entry("notes.txt");
    const destinationOpened = mutationWorkflowReducer(initialMutationWorkflowState, {
      kind: "open", identity: 33, draft: { kind: "destination", picker: buildMovePickerInitialState(context, source) }
    });
    const destinationOwner = attempt(context, 33);
    const destinationRunning = mutationWorkflowReducer(mutationWorkflowReducer(destinationOpened, {
      kind: "validate", identity: 33, context, intent: { kind: "move", count: 1 }, attempt: destinationOwner
    }), { kind: "run", identity: 33, context, attempt: destinationOwner });
    expect(mutationWorkflowReducer(destinationRunning, {
      kind: "partial", identity: 33, context, attempt: foreign, error: "foreign", failedEntries: [source]
    })).toBe(destinationRunning);
  });

  it("accepts effects only from completed, never from another submitted state", () => {
    const context = createOperationContextToken();
    const owner = attempt(context, 41);
    const opened = mutationWorkflowReducer(initialMutationWorkflowState, {
      kind: "open", identity: 41,
      draft: { kind: "action", dialog: { kind: "createFolder", value: "Projects", context } }
    });
    const validating = mutationWorkflowReducer(opened, {
      kind: "validate", identity: 41, context, intent: { kind: "createFolder" }, attempt: owner
    });
    const running = mutationWorkflowReducer(validating, { kind: "run", identity: 41, context, attempt: owner });
    const failed = mutationWorkflowReducer(running, {
      kind: "fail", identity: 41, context, attempt: owner, error: "failed"
    });
    const completed = mutationWorkflowReducer(running, {
      kind: "complete", identity: 41, context, attempt: owner, result: {}
    });
    const accept = { kind: "accept-effects" as const, identity: 41, context, attempt: owner };
    expect(mutationWorkflowReducer(validating, accept)).toBe(validating);
    expect(mutationWorkflowReducer(running, accept)).toBe(running);
    expect(mutationWorkflowReducer(failed, accept)).toBe(failed);

    const source = entry("notes.txt");
    const destinationOwner = attempt(context, 42);
    const destinationOpened = mutationWorkflowReducer(initialMutationWorkflowState, {
      kind: "open", identity: 42, draft: { kind: "destination", picker: buildMovePickerInitialState(context, source) }
    });
    const destinationRunning = mutationWorkflowReducer(mutationWorkflowReducer(destinationOpened, {
      kind: "validate", identity: 42, context, intent: { kind: "move", count: 1 }, attempt: destinationOwner
    }), { kind: "run", identity: 42, context, attempt: destinationOwner });
    const partial = mutationWorkflowReducer(destinationRunning, {
      kind: "partial", identity: 42, context, attempt: destinationOwner, error: "partial", failedEntries: [source]
    });
    expect(mutationWorkflowReducer(partial, {
      kind: "accept-effects", identity: 42, context, attempt: destinationOwner
    })).toBe(partial);
    expect(mutationWorkflowReducer(completed, accept)).toEqual(initialMutationWorkflowState);
  });

  it("accepts exactly one ordered delete removal and rejects duplicate, reordered, substituted, and skipped progress", () => {
    const context = createOperationContextToken();
    const workflow = createBatchDeleteWorkflow(43, [
      { path: "a.txt", confirmName: "a.txt" },
      { path: "b.txt", confirmName: "b.txt" },
      { path: "c.txt", confirmName: "c.txt" }
    ]);
    const owner = attempt(context, 43);
    const opened = mutationWorkflowReducer(initialMutationWorkflowState, {
      kind: "open", identity: 43,
      draft: { kind: "action", dialog: { kind: "delete", context, workflow } }
    });
    const running = mutationWorkflowReducer(mutationWorkflowReducer(opened, {
      kind: "validate", identity: 43, context, intent: { kind: "delete", count: 3 }, attempt: owner
    }), { kind: "run", identity: 43, context, attempt: owner });
    const progress = (next: BatchDeleteWorkflow) => mutationWorkflowReducer(running, {
      kind: "delete-progress", identity: 43, context, attempt: owner, workflow: next
    });
    const validMiddle: BatchDeleteWorkflow = {
      ...workflow, unresolvedTargets: [workflow.submittedTargets[0], workflow.submittedTargets[2]]
    };
    expect(progress(validMiddle)).toMatchObject({
      kind: "running", draft: { kind: "action", dialog: { workflow: validMiddle } }
    });

    const invalid: readonly BatchDeleteWorkflow[] = [
      { ...workflow, unresolvedTargets: [workflow.submittedTargets[0], workflow.submittedTargets[0]] },
      { ...workflow, unresolvedTargets: [workflow.submittedTargets[2], workflow.submittedTargets[0]] },
      { ...workflow, unresolvedTargets: [workflow.submittedTargets[0], { ...workflow.submittedTargets[2], confirmName: "wrong" }] },
      { ...workflow, unresolvedTargets: [workflow.submittedTargets[2]] }
    ];
    for (const candidate of invalid) expect(progress(candidate)).toBe(running);

    const progressed = progress(validMiddle);
    expect(mutationWorkflowReducer(progressed, {
      kind: "delete-partial", identity: 43, context, attempt: owner, workflow: validMiddle,
      failedTarget: { ...workflow.submittedTargets[0], confirmName: "wrong" },
      completedCount: 1, totalCount: 3, error: "failed"
    })).toBe(progressed);
    expect(mutationWorkflowReducer(progressed, {
      kind: "delete-partial", identity: 43, context, attempt: owner, workflow: validMiddle,
      failedTarget: workflow.submittedTargets[0], completedCount: 1, totalCount: 3, error: "failed"
    })).toMatchObject({ kind: "partial", partial: { kind: "delete", failedTarget: workflow.submittedTargets[0] } });
  });

  it("table: OWNER events advance only legal phases when every payload matches the current domain", () => {
    type OwnedState = Exclude<MutationWorkflowState, { readonly kind: "idle" }>;
    interface Row<Name extends string> {
      readonly label: string;
      readonly state: OwnedState;
      readonly owner: ReturnType<typeof attempt>;
      readonly legal: ReadonlySet<Name>;
    }
    const row = <Name extends string>(label: string, state: MutationWorkflowState, owner: ReturnType<typeof attempt>, legal: readonly Name[]): Row<Name> => {
      if (state.kind === "idle") throw new Error(`${label} must be an owned state.`);
      return { label, state, owner, legal: new Set(legal) };
    };
    const assertCell = <Name extends string>(current: Row<Name>, name: Name, event: MutationWorkflowEvent, expected?: object) => {
      const next = mutationWorkflowReducer(current.state, event);
      if (!current.legal.has(name)) {
        expect(next, `${current.label} + ${name}`).toBe(current.state);
      } else if (expected) {
        expect(next, `${current.label} + ${name}`).toMatchObject(expected);
      } else {
        expect(next, `${current.label} + ${name}`).toEqual(initialMutationWorkflowState);
      }
    };

    const context = createOperationContextToken();
    const submitted = createBatchDeleteWorkflow(51, [
      { path: "a.txt", confirmName: "a.txt" }, { path: "b.txt", confirmName: "b.txt" },
      { path: "c.txt", confirmName: "c.txt" }
    ]);
    const currentDelete = acceptDeleteProgress(submitted, submitted.submittedTargets[0]);
    const nextDelete = acceptDeleteProgress(currentDelete, currentDelete.unresolvedTargets[0]);
    const deleteOwner = attempt(context, 51);
    const deleteOpened = mutationWorkflowReducer(initialMutationWorkflowState, {
      kind: "open", identity: 51, draft: { kind: "action", dialog: { kind: "delete", context, workflow: currentDelete } }
    });
    const deleteValidating = mutationWorkflowReducer(deleteOpened, {
      kind: "validate", identity: 51, context, intent: { kind: "delete", count: 2 }, attempt: deleteOwner
    });
    const deleteRunning = mutationWorkflowReducer(deleteValidating, { kind: "run", identity: 51, context, attempt: deleteOwner });
    const deletePartial = mutationWorkflowReducer(deleteRunning, {
      kind: "delete-partial", identity: 51, context, attempt: deleteOwner, workflow: currentDelete,
      failedTarget: currentDelete.unresolvedTargets[0], completedCount: 1, totalCount: 3, error: "delete partial"
    });
    const deleteFailed = mutationWorkflowReducer(deleteRunning, {
      kind: "fail", identity: 51, context, attempt: deleteOwner, error: "failed"
    });
    const deleteCompleted = mutationWorkflowReducer(deleteRunning, {
      kind: "complete", identity: 51, context, attempt: deleteOwner, result: { accepted: true }
    });
    type DeleteEvent = "run" | "delete-partial" | "delete-progress" | "fail" | "complete" | "accept-effects";
    const deleteRows: readonly Row<DeleteEvent>[] = [
      row("delete/validating", deleteValidating, deleteOwner, ["run"]),
      row("delete/running", deleteRunning, deleteOwner, ["delete-partial", "delete-progress", "fail", "complete"]),
      row("delete/partial", deletePartial, deleteOwner, []),
      row("delete/failed", deleteFailed, deleteOwner, []),
      row("delete/completed", deleteCompleted, deleteOwner, ["accept-effects"])
    ];
    const deleteEvents: readonly DeleteEvent[] = ["run", "delete-partial", "delete-progress", "fail", "complete", "accept-effects"];
    for (const current of deleteRows) {
      const owned = { identity: current.state.identity, context, attempt: current.owner };
      for (const name of deleteEvents) {
        const event: MutationWorkflowEvent = name === "run" ? { kind: "run", ...owned }
          : name === "delete-partial" ? { kind: "delete-partial", ...owned, workflow: currentDelete,
              failedTarget: currentDelete.unresolvedTargets[0], completedCount: 1, totalCount: 3, error: "delete partial" }
            : name === "delete-progress" ? { kind: "delete-progress", ...owned, workflow: nextDelete }
              : name === "fail" ? { kind: "fail", ...owned, error: "failed" }
                : name === "complete" ? { kind: "complete", ...owned, result: { accepted: true } }
                  : { kind: "accept-effects", ...owned };
        const expected = name === "run" ? { kind: "running", attempt: current.owner }
          : name === "delete-partial" ? { kind: "partial", partial: { kind: "delete", completedCount: 1, totalCount: 3 } }
            : name === "delete-progress" ? { kind: "running", draft: { kind: "action", dialog: { workflow: nextDelete } } }
              : name === "fail" ? { kind: "failed", error: "failed" }
                : name === "complete" ? { kind: "completed", result: { accepted: true } }
                  : undefined;
        assertCell(current, name, event, expected);
      }
    }

    const source = entry("notes.txt");
    const destinationOwner = attempt(context, 52);
    const destinationOpened = mutationWorkflowReducer(initialMutationWorkflowState, {
      kind: "open", identity: 52, draft: { kind: "destination", picker: buildMovePickerInitialState(context, source) }
    });
    const destinationValidating = mutationWorkflowReducer(destinationOpened, {
      kind: "validate", identity: 52, context, intent: { kind: "move", count: 1 }, attempt: destinationOwner
    });
    const destinationRunning = mutationWorkflowReducer(destinationValidating, { kind: "run", identity: 52, context, attempt: destinationOwner });
    const destinationPartial = mutationWorkflowReducer(destinationRunning, {
      kind: "partial", identity: 52, context, attempt: destinationOwner, error: "destination partial", failedEntries: [source]
    });
    const destinationFailed = mutationWorkflowReducer(destinationRunning, {
      kind: "fail", identity: 52, context, attempt: destinationOwner, error: "failed"
    });
    const destinationCompleted = mutationWorkflowReducer(destinationRunning, {
      kind: "complete", identity: 52, context, attempt: destinationOwner, result: { accepted: true }
    });
    type DestinationEvent = "run" | "destination-partial" | "fail" | "complete" | "accept-effects";
    const destinationRows: readonly Row<DestinationEvent>[] = [
      row("destination/validating", destinationValidating, destinationOwner, ["run"]),
      row("destination/running", destinationRunning, destinationOwner, ["destination-partial", "fail", "complete"]),
      row("destination/partial", destinationPartial, destinationOwner, []),
      row("destination/failed", destinationFailed, destinationOwner, []),
      row("destination/completed", destinationCompleted, destinationOwner, ["accept-effects"])
    ];
    const destinationEvents: readonly DestinationEvent[] = ["run", "destination-partial", "fail", "complete", "accept-effects"];
    for (const current of destinationRows) {
      const owned = { identity: current.state.identity, context, attempt: current.owner };
      for (const name of destinationEvents) {
        const event: MutationWorkflowEvent = name === "run" ? { kind: "run", ...owned }
          : name === "destination-partial" ? { kind: "partial", ...owned, error: "destination partial", failedEntries: [source] }
            : name === "fail" ? { kind: "fail", ...owned, error: "failed" }
              : name === "complete" ? { kind: "complete", ...owned, result: { accepted: true } }
                : { kind: "accept-effects", ...owned };
        const expected = name === "run" ? { kind: "running", attempt: current.owner }
          : name === "destination-partial" ? { kind: "partial", partial: { kind: "destination", failedSourcePaths: [source.path] } }
            : name === "fail" ? { kind: "failed", error: "failed" }
              : name === "complete" ? { kind: "completed", result: { accepted: true } }
                : undefined;
        assertCell(current, name, event, expected);
      }
    }
  });
  it("uses exact offline and server-unavailable cache-only messages", () => {
    expect(buildOfflineMutationBlockedMessage()).toBe("Offline mutations are disabled. Reconnect to modify files.");
    expect(buildServerUnavailableMutationBlockedMessage()).toBe(
      "Mutations are disabled while the local server is unavailable. Restore the server and retry."
    );
  });

  it("evaluates mutation preconditions", () => {
    expect(evaluateMutationPreconditions({ hasSession: false, cacheOnlyMode: false, isOffline: false }))
      .toEqual({ kind: "denied", message: MUTATION_NO_SESSION_MESSAGE });
    expect(evaluateMutationPreconditions({ hasSession: true, cacheOnlyMode: true, isOffline: true }))
      .toEqual({ kind: "denied", message: buildOfflineMutationBlockedMessage() });
    expect(evaluateMutationPreconditions({ hasSession: true, cacheOnlyMode: true, isOffline: false }))
      .toEqual({ kind: "denied", message: buildServerUnavailableMutationBlockedMessage() });
    expect(evaluateMutationPreconditions({ hasSession: true, cacheOnlyMode: false, isOffline: false }))
      .toEqual({ kind: "allowed" });
  });

  it("treats missing context or intent as still current", () => {
    expect(isMutationOperationStillCurrent({
      isContextAllowed: () => false
    })).toBe(true);
    expect(isMutationOperationStillCurrent({
      context: createOperationContextToken(),
      isContextAllowed: () => false
    })).toBe(true);
  });

  it("builds the default success status", () => {
    expect(buildDefaultMutationSuccessStatus(
      mutationResult({ action: "delete", path: "notes.txt" }),
      "Workspace",
      (path) => `/${path}`
    )).toBe("delete completed for /notes.txt in Workspace");
  });

  it("plans delete selection sync", () => {
    expect(planSelectionSyncWithMutation(
      mutationResult({ action: "delete", path: "notes.txt" }),
      entry("notes.txt"),
      undefined
    )).toEqual({ kind: "delete", path: "notes.txt" });
  });

  it("plans focus-item sync for uploads without a destination path", () => {
    const item = entry("new.txt");
    expect(planSelectionSyncWithMutation(
      mutationResult({ action: "upload", path: "new.txt", item }),
      undefined,
      undefined
    )).toEqual({ kind: "focus-item", item, rebindFromPath: "new.txt" });
  });

  it("plans move-copy sync when the selected entry matches", () => {
    const selected = entry("Projects/notes.txt", "notes.txt");
    expect(planSelectionSyncWithMutation(
      mutationResult({
        action: "move",
        path: "Projects/notes.txt",
        destinationPath: "Archive/notes.txt",
        parentPath: "Archive"
      }),
      selected,
      { path: "Projects/notes.txt" }
    )).toEqual({
      kind: "move-copy-selected",
      sourcePath: "Projects/notes.txt",
      destinationPath: "Archive/notes.txt",
      nextEntry: {
        ...selected,
        path: "Archive/notes.txt",
        name: "notes.txt"
      },
      updatePreview: true,
      previewName: "notes.txt"
    });
  });

  it("navigates when the mutation parent path differs", () => {
    expect(shouldNavigateAfterMutation(
      mutationResult({ action: "copy", path: "a.txt", parentPath: "Archive" }),
      ""
    )).toBe(true);
    expect(shouldNavigateAfterMutation(
      mutationResult({ action: "copy", path: "a.txt", parentPath: "" }),
      ""
    )).toBe(false);
  });
});
