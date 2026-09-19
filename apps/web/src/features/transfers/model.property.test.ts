import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  createTransferLedger,
  isActiveTransferTask,
  reduceTransferLedger,
  type TransferEvent,
  type TransferFailure,
  type TransferLedger,
  type TransferTask,
  type TransferTaskDraft
} from "./model";
import {
  selectAccountTransfers,
  selectActiveSyncByDedupeKey,
  selectActiveTransfers,
  selectRecentTransfers,
  selectTransferWakeLockReasons
} from "./selectors";

const PROPERTY_OPTIONS = { numRuns: 250, seed: 20260825 } as const;

const accountArb = fc.constantFrom("account-a", "account-b", "account-c");
const idArb = fc.integer({ min: 0, max: 12 }).map((value) => `task-${value}`);
const labelArb = fc.constantFrom("Alpha", "Beta", "Gamma", "Delta");
const messageArb = fc.constantFrom("Denied", "Offline", "Timed out", "Session changed");
const pathArb = fc.constantFrom("A.txt", "B.txt", "folder/C.txt", "folder/D.txt");
const atArb = fc.integer({ min: 0, max: 59 }).map((value) => `2026-08-24T00:00:${String(value).padStart(2, "0")}Z`);
const loadedBytesArb = fc.integer({ min: 0, max: 10_000 });
const optionalTotalBytesArb = fc.constantFrom<number | null | undefined>(undefined, null, 0, 10, 100, 1_000);

const failureArb: fc.Arbitrary<TransferFailure> = fc.record({
  sourcePath: pathArb,
  error: messageArb
});

const syncRootEntryArb = fc.record({
  path: pathArb,
  name: labelArb,
  isFolder: fc.boolean()
});

const taskDraftArb: fc.Arbitrary<TransferTaskDraft> = fc.oneof(
  fc.record({
    id: idArb,
    accountId: accountArb,
    kind: fc.constantFrom<"upload" | "download">("upload", "download"),
    label: labelArb
  }),
  fc.record({
    id: idArb,
    accountId: accountArb,
    kind: fc.constant("sync" as const),
    label: labelArb,
    dedupeKey: labelArb,
    syncRootEntries: fc.array(syncRootEntryArb, { maxLength: 3 })
  })
);

const perIdEventArb: fc.Arbitrary<TransferEvent> = fc.oneof(
  fc.record({
    id: idArb,
    loadedBytes: fc.constantFrom<number | undefined>(undefined, 0, 10, 100),
    totalBytes: optionalTotalBytesArb
  }).map(({ id, loadedBytes, totalBytes }) => ({
    type: "preparationStarted" as const,
    id,
    loadedBytes,
    totalBytes
  })),
  fc.record({
    id: idArb,
    label: labelArb,
    loadedBytes: fc.constantFrom<number | undefined>(undefined, 0, 10, 100),
    totalBytes: optionalTotalBytesArb
  }).map(({ id, label, loadedBytes, totalBytes }) => ({
    type: "transferStarted" as const,
    id,
    label,
    loadedBytes,
    totalBytes
  })),
  fc.record({
    id: idArb,
    stage: fc.constantFrom<"preparing" | "transferring">("preparing", "transferring"),
    loadedBytes: loadedBytesArb,
    totalBytes: optionalTotalBytesArb
  }).map(({ id, stage, loadedBytes, totalBytes }) => ({
    type: "progressReported" as const,
    id,
    stage,
    loadedBytes,
    totalBytes
  })),
  fc.record({ id: idArb, failure: failureArb }).map(({ id, failure }) => ({
    type: "nonterminalFailureReported" as const,
    id,
    failure
  })),
  fc.record({ id: idArb, at: atArb, label: labelArb, loadedBytes: loadedBytesArb, totalBytes: fc.integer({ min: 0, max: 10_000 }) }).map((event) => ({
    type: "completed" as const,
    ...event
  })),
  fc.record({
    id: idArb,
    at: atArb,
    failures: fc.array(failureArb, { minLength: 1, maxLength: 3 }),
    message: messageArb,
    label: labelArb,
    loadedBytes: loadedBytesArb,
    totalBytes: fc.integer({ min: 0, max: 10_000 })
  }).map((event) => ({
    type: "partiallyCompleted" as const,
    ...event
  })),
  fc.record({ id: idArb, at: atArb, message: messageArb }).map((event) => ({
    type: "failed" as const,
    ...event
  }))
);

const transferEventArb: fc.Arbitrary<TransferEvent> = fc.oneof(
  fc.record({ at: atArb, task: taskDraftArb }).map(({ at, task }) => ({
    type: "enqueued" as const,
    at,
    task
  })),
  perIdEventArb,
  fc.record({
    accountId: accountArb,
    at: atArb,
    message: fc.record({ upload: messageArb, download: messageArb, sync: messageArb })
  }).map((event) => ({
    type: "activeAccountFailed" as const,
    ...event
  })),
  fc.record({
    ids: fc.array(idArb, { maxLength: 8 }),
    at: atArb,
    message: messageArb
  }).map(({ ids, at, message }) => ({
    type: "activeTasksFailed" as const,
    ids: new Set(ids),
    at,
    message
  })),
  accountArb.map((accountId) => ({
    type: "accountHistoryCleared" as const,
    accountId
  }))
);

type TerminalPhase = "done" | "partial" | "error";
type TaskPhaseSpec = { readonly draft: TransferTaskDraft; readonly phase: "active" | TerminalPhase };

const taskPhaseSpecArb: fc.Arbitrary<TaskPhaseSpec> = fc.record({
  draft: taskDraftArb,
  phase: fc.constantFrom<TaskPhaseSpec["phase"]>("active", "done", "partial", "error")
});

function applyEvents(ledger: TransferLedger, events: readonly TransferEvent[]): TransferLedger {
  return events.reduce((state, event) => reduceTransferLedger(state, event), ledger);
}

function terminalEvent(id: string, phase: TerminalPhase, at: string): TransferEvent {
  if (phase === "done") {
    return { type: "completed", id, at };
  }
  if (phase === "partial") {
    return {
      type: "partiallyCompleted",
      id,
      at,
      failures: [{ sourcePath: "partial.txt", error: "Denied" }],
      message: "Partial result"
    };
  }
  return { type: "failed", id, at, message: "Failed result" };
}

function uniqueSpecs(specs: readonly TaskPhaseSpec[]): readonly TaskPhaseSpec[] {
  const seen = new Set<string>();
  return specs.filter((spec) => {
    if (seen.has(spec.draft.id)) {
      return false;
    }
    seen.add(spec.draft.id);
    return true;
  });
}

function ledgerFromSpecs(specs: readonly TaskPhaseSpec[], maxTerminal = 100): TransferLedger {
  const unique = uniqueSpecs(specs);
  let ledger = createTransferLedger({ maxTerminal });
  for (const spec of unique) {
    ledger = reduceTransferLedger(ledger, { type: "enqueued", at: "enqueue", task: spec.draft });
  }
  for (const spec of unique) {
    if (spec.phase !== "active") {
      ledger = reduceTransferLedger(ledger, terminalEvent(spec.draft.id, spec.phase, "terminal"));
    }
  }
  return ledger;
}

function taskById(ledger: TransferLedger, id: string): TransferTask | undefined {
  return ledger.tasks.find((task) => task.id === id);
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

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

describe("transfer ledger property characterization", () => {
  it("keeps identifiers unique and rejects invalid or duplicate enqueue drafts as inert", () => {
    fc.assert(fc.property(fc.array(taskDraftArb, { maxLength: 30 }), (drafts) => {
      const initial = createTransferLedger({ maxTerminal: 5 });
      const ledger = applyEvents(initial, drafts.map((task, index) => ({ type: "enqueued", at: `enqueue-${index}`, task })));
      const ids = ledger.tasks.map((task) => task.id);

      expect(new Set(ids).size).toBe(ids.length);
      expect(initial).toEqual({ tasks: [], maxTerminal: 5 });
    }), PROPERTY_OPTIONS);

    fc.assert(fc.property(taskDraftArb, (draft) => {
      const prior = reduceTransferLedger(createTransferLedger(), {
        type: "enqueued",
        at: "existing",
        task: draft
      });
      const duplicate = cloneValue(draft);
      const priorSnapshot = cloneValue(prior);
      const duplicateSnapshot = cloneValue(duplicate);
      const frozenPrior = deepFreeze(prior);
      const frozenDuplicate = deepFreeze(duplicate);
      const after = reduceTransferLedger(frozenPrior, {
        type: "enqueued",
        at: "duplicate",
        task: frozenDuplicate
      });

      expect(after).toBe(frozenPrior);
      expect(frozenPrior).toEqual(priorSnapshot);
      expect(frozenDuplicate).toEqual(duplicateSnapshot);
    }), PROPERTY_OPTIONS);

    const invalidDraftArb = fc.constantFrom<unknown>(
      null,
      {},
      { id: "", accountId: "account-a", kind: "download", label: "Missing id" },
      { id: "invalid", accountId: "", kind: "download", label: "Missing account" },
      { id: "invalid", accountId: "account-a", kind: "download", label: "" },
      { id: "invalid", accountId: "account-a", kind: "sync", label: "Missing key", syncRootEntries: [] },
      { id: "invalid", accountId: "account-a", kind: "download", label: "Foreign sync fields", dedupeKey: "wrong" }
    );
    fc.assert(fc.property(invalidDraftArb, (draft) => {
      const ledger = deepFreeze(createTransferLedger());
      const ledgerSnapshot = cloneValue(ledger);
      // The reducer's public event type is intentionally strict; this cast models malformed
      // runtime input so the property can characterize its inert behavior at that boundary.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const event = { type: "enqueued" as const, at: "invalid", task: draft as TransferTaskDraft };
      const frozenEvent = deepFreeze(cloneValue(event));
      const eventSnapshot = cloneValue(frozenEvent);
      const after = reduceTransferLedger(ledger, frozenEvent);

      expect(after).toBe(ledger);
      expect(ledger).toEqual(ledgerSnapshot);
      expect(frozenEvent).toEqual(eventSnapshot);
    }), PROPERTY_OPTIONS);
  });

  it("absorbs every later per-ID event after terminality and ignores unknown IDs", () => {
    fc.assert(fc.property(
      fc.constantFrom<TerminalPhase>("done", "partial", "error"),
      fc.array(perIdEventArb, { maxLength: 24 }),
      (phase, laterEvents) => {
        const base = reduceTransferLedger(createTransferLedger(), {
          type: "enqueued",
          at: "enqueue",
          task: { id: "task-0", accountId: "account-a", kind: "download", label: "Stable" }
        });
        const terminal = reduceTransferLedger(base, terminalEvent("task-0", phase, "terminal"));
        const after = applyEvents(terminal, [
          ...laterEvents,
          { type: "failed", id: "unknown-id", at: "late", message: "Unknown" }
        ]);

        expect(after).toBe(terminal);
        expect(taskById(after, "task-0")).toBe(taskById(terminal, "task-0"));
      }
    ), PROPERTY_OPTIONS);
  });

  it("preserves terminal shape, active shape, and deterministic replay for arbitrary event sequences", () => {
    fc.assert(fc.property(fc.array(transferEventArb, { maxLength: 35 }), (events) => {
      const initial = createTransferLedger({ maxTerminal: 8 });
      const eventSnapshot = cloneValue(events);
      const frozenEvents = deepFreeze(cloneValue(events));
      const first = applyEvents(initial, frozenEvents);
      const second = applyEvents(createTransferLedger({ maxTerminal: 8 }), frozenEvents.map((event) => cloneValue(event)));

      expect(events).toEqual(eventSnapshot);
      expect(second).toEqual(first);
      for (const task of first.tasks) {
        if (isActiveTransferTask(task)) {
          expect(task.finishedAt).toBeUndefined();
          continue;
        }
        expect(task.finishedAt).toBeDefined();
        if (task.phase === "done") {
          expect(task.errorMessage).toBeUndefined();
          expect(task.failedFiles).toBeUndefined();
        } else {
          expect(task.errorMessage).toBeTruthy();
        }
        if (task.phase === "partial") {
          expect(task.failedFiles.length).toBeGreaterThan(0);
        }
      }
    }), PROPERTY_OPTIONS);
  });

  it("retains all active tasks and a stable newest-enqueue subsequence within terminal bounds", () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 6 }),
      fc.array(taskPhaseSpecArb, { maxLength: 22 }),
      (maxTerminal, specs) => {
        const unique = uniqueSpecs(specs);
        const ledger = ledgerFromSpecs(specs, maxTerminal);
        const expectedOrder = unique.map((spec) => spec.draft.id).reverse();
        const expectedActiveOrder = expectedOrder.filter((id) => unique.some((spec) => spec.draft.id === id && spec.phase === "active"));
        let cursor = 0;

        for (const task of ledger.tasks) {
          const position = expectedOrder.indexOf(task.id, cursor);
          expect(position).toBeGreaterThanOrEqual(cursor);
          cursor = position + 1;
        }
        expect(ledger.tasks.filter((task) => !isActiveTransferTask(task)).length).toBeLessThanOrEqual(maxTerminal);
        expect(ledger.tasks.filter(isActiveTransferTask).map((task) => task.id)).toEqual(expectedActiveOrder);
      }
    ), PROPERTY_OPTIONS);
  });

  it("clears only terminal history for the selected account and preserves retained identities", () => {
    fc.assert(fc.property(taskPhaseSpecArb, fc.array(taskPhaseSpecArb, { maxLength: 18 }), accountArb, (first, rest, accountId) => {
      const before = ledgerFromSpecs([first, ...rest]);
      const after = reduceTransferLedger(before, { type: "accountHistoryCleared", accountId });
      const expected = before.tasks.filter((task) => task.accountId !== accountId || isActiveTransferTask(task));

      expect(after.tasks).toEqual(expected);
      for (const task of expected) {
        expect(taskById(after, task.id)).toBe(task);
      }
    }), PROPERTY_OPTIONS);
  });

  it("fails only active tasks in the selected account and chooses the kind-specific message", () => {
    const messages = { upload: "upload-failure", download: "download-failure", sync: "sync-failure" } as const;
    fc.assert(fc.property(fc.array(taskPhaseSpecArb, { minLength: 1, maxLength: 18 }), accountArb, (specs, accountId) => {
      const before = ledgerFromSpecs(specs);
      const after = reduceTransferLedger(before, { type: "activeAccountFailed", accountId, at: "account-failed", message: messages });

      for (const task of before.tasks) {
        const next = taskById(after, task.id);
        if (!next) {
          throw new Error(`Missing task ${task.id}`);
        }
        if (task.accountId === accountId && isActiveTransferTask(task)) {
          expect(next).not.toBe(task);
          expect(next).toMatchObject({ phase: "error", errorMessage: messages[task.kind] });
        } else {
          expect(next).toBe(task);
        }
      }
    }), PROPERTY_OPTIONS);
  });

  it("fails only selected active IDs and never mutates the supplied ID set", () => {
    fc.assert(fc.property(fc.array(taskPhaseSpecArb, { minLength: 1, maxLength: 18 }), fc.array(idArb, { maxLength: 10 }), (specs, ids) => {
      const before = ledgerFromSpecs(specs);
      const selected = new Set(ids);
      const selectedBefore = [...selected];
      const eventIds = deepFreeze(new Set(selected));
      const after = reduceTransferLedger(before, { type: "activeTasksFailed", ids: eventIds, at: "ids-failed", message: "Explicit failure" });

      expect([...selected]).toEqual(selectedBefore);
      expect([...eventIds]).toEqual(selectedBefore);
      for (const task of before.tasks) {
        const next = taskById(after, task.id);
        if (!next) {
          throw new Error(`Missing task ${task.id}`);
        }
        if (selected.has(task.id) && isActiveTransferTask(task)) {
          expect(next).not.toBe(task);
          expect(next).toMatchObject({ phase: "error", errorMessage: "Explicit failure" });
        } else {
          expect(next).toBe(task);
        }
      }
    }), PROPERTY_OPTIONS);
  });

  it("accumulates immutable nonterminal failures and refuses silent completion", () => {
    fc.assert(fc.property(fc.array(failureArb, { minLength: 1, maxLength: 4 }), (failures) => {
      let ledger = reduceTransferLedger(createTransferLedger(), {
        type: "enqueued",
        at: "enqueue",
        task: { id: "task-0", accountId: "account-a", kind: "download", label: "Failures" }
      });
      for (const failure of failures) {
        ledger = reduceTransferLedger(ledger, { type: "nonterminalFailureReported", id: "task-0", failure });
      }
      const beforeCompletion = ledger;
      const completed = reduceTransferLedger(ledger, { type: "completed", id: "task-0", at: "complete" });
      const task = taskById(ledger, "task-0");

      expect(completed).not.toBe(beforeCompletion);
      expect(completed.tasks[0]).toBe(beforeCompletion.tasks[0]);
      expect(task).toMatchObject({ phase: "queued", failedFiles: failures });
      expect(task?.errorMessage).toBe(`${failures[failures.length - 1]?.sourcePath}: ${failures[failures.length - 1]?.error}`);
    }), PROPERTY_OPTIONS);

    const active = reduceTransferLedger(createTransferLedger(), {
      type: "enqueued",
      at: "enqueue",
      task: { id: "task-0", accountId: "account-a", kind: "download", label: "Partial" }
    });
    expect(reduceTransferLedger(active, {
      type: "partiallyCompleted",
      id: "task-0",
      at: "partial",
      failures: [],
      message: "ignored"
    })).toBe(active);
    expect(reduceTransferLedger(active, {
      type: "partiallyCompleted",
      id: "task-0",
      at: "partial",
      failures: [{ sourcePath: "A.txt", error: "Denied" }],
      message: ""
    })).toBe(active);

    fc.assert(fc.property(fc.array(failureArb, { minLength: 1, maxLength: 4 }), (failures) => {
      const expectedFailures = cloneValue(failures);
      const partialEvent = {
        type: "partiallyCompleted" as const,
        id: "task-0",
        at: "partial",
        failures,
        message: "Partial"
      };
      const after = reduceTransferLedger(active, partialEvent);
      const firstFailure = failures[0];
      if (firstFailure) {
        Object.assign(firstFailure, { sourcePath: "mutated.txt", error: "Mutated" });
      }
      failures.push({ sourcePath: "late.txt", error: "Late" });

      expect(after.tasks[0]).toMatchObject({ phase: "partial", errorMessage: "Partial" });
      expect(after.tasks[0]?.failedFiles).toEqual(expectedFailures);
      expect(after.tasks[0]?.failedFiles).not.toBe(failures);
    }), PROPERTY_OPTIONS);

    expect(reduceTransferLedger(active, {
      type: "partiallyCompleted",
      id: "task-0",
      at: "partial",
      failures: [{ sourcePath: "A.txt", error: "Denied" }],
      message: "Partial"
    }).tasks[0]).toMatchObject({ phase: "partial", errorMessage: "Partial" });
  });

  it("deeply preserves caller-owned roots, failures, prior ledgers, and event inputs", () => {
    fc.assert(fc.property(fc.array(syncRootEntryArb, { maxLength: 3 }), failureArb, (roots, failure) => {
      const expectedRoots = cloneValue(roots);
      const draft = {
        id: "task-0",
        accountId: "account-a",
        kind: "sync" as const,
        label: "Sync",
        dedupeKey: "root:A",
        syncRootEntries: roots
      } satisfies TransferTaskDraft;
      const enqueue: TransferEvent = { type: "enqueued", at: "enqueue", task: draft };
      const enqueueSnapshot = cloneValue(enqueue);
      const state = reduceTransferLedger(createTransferLedger(), enqueue);
      const frozenEnqueue = deepFreeze(cloneValue(enqueueSnapshot));
      const frozenEnqueueState = reduceTransferLedger(createTransferLedger(), frozenEnqueue);
      const expectedFailure = cloneValue(failure);
      const failureEvent: TransferEvent = { type: "nonterminalFailureReported", id: "task-0", failure };
      const failureEventSnapshot = cloneValue(failureEvent);
      const stateSnapshot = cloneValue(state);
      const frozenState = deepFreeze(state);
      const after = reduceTransferLedger(frozenState, failureEvent);

      expect(enqueue).toEqual(enqueueSnapshot);
      expect(frozenEnqueueState).toEqual(state);
      expect(failureEvent).toEqual(failureEventSnapshot);

      const firstRoot = roots[0];
      if (firstRoot) {
        Object.assign(firstRoot, { path: "mutated.txt", name: "Mutated", isFolder: !firstRoot.isFolder });
      }
      roots.push({ path: "A.txt", name: "Alpha", isFolder: false });
      Object.assign(failure, { sourcePath: "mutated.txt", error: "Mutated" });

      expect(deepFreeze(state)).toEqual(stateSnapshot);
      expect(after).not.toBe(state);
      expect(after.tasks[0]?.syncRootEntries).toEqual(expectedRoots);
      expect(after.tasks[0]?.syncRootEntries).not.toBe(roots);
      expect(after.tasks[0]?.failedFiles).toEqual([expectedFailure]);
      expect(state.tasks[0]?.failedFiles).toBeUndefined();
    }), PROPERTY_OPTIONS);
  });

  it("keeps selector projections pure and consistent with the ledger order", () => {
    const requestedAccountArb = fc.constantFrom<string | undefined>(undefined, "account-a", "account-b", "account-c");
    fc.assert(fc.property(
      fc.array(transferEventArb, { maxLength: 35 }),
      requestedAccountArb,
      labelArb,
      fc.integer({ min: 0, max: 20 }),
      (events, accountId, dedupeKey, limit) => {
        const ledger = applyEvents(createTransferLedger({ maxTerminal: 8 }), events);
        const beforeTasks = [...ledger.tasks];
        const active = ledger.tasks.filter(isActiveTransferTask);

        expect(selectActiveTransfers(ledger.tasks)).toEqual(active);
        expect(selectAccountTransfers(ledger.tasks, accountId)).toEqual(accountId
          ? ledger.tasks.filter((task) => task.accountId === accountId)
          : []);
        expect(selectRecentTransfers(ledger.tasks, limit)).toEqual(ledger.tasks.slice(0, limit));
        expect(selectTransferWakeLockReasons(ledger.tasks)).toEqual(
          (["download", "transferQueue", "offlineSync"] as const).filter((reason) => active.some((task) => (
            reason === "download" ? task.kind === "download" : reason === "offlineSync" ? task.kind === "sync" : task.kind === "upload"
          )))
        );

        const expectedSync = ledger.tasks.find((task) => task.kind === "sync"
          && task.accountId === (accountId ?? "account-a")
          && task.dedupeKey === dedupeKey
          && isActiveTransferTask(task));
        expect(selectActiveSyncByDedupeKey(ledger.tasks, accountId ?? "account-a", dedupeKey)).toBe(expectedSync);
        expect(ledger.tasks).toEqual(beforeTasks);
      }
    ), PROPERTY_OPTIONS);
  });
});
