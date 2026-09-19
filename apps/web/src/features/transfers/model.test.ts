import { describe, expect, it } from "vitest";

import {
  createTransferLedger,
  isValidTransferTaskDraft,
  reduceTransferLedger,
  type TransferEvent,
  type TransferLedger
} from "./model";

const enqueueDownload = (id: string, accountId = "account-a"): TransferEvent => ({
  type: "enqueued",
  at: `2026-07-17T10:00:${id.padStart(2, "0")}Z`,
  task: { id, accountId, kind: "download", label: `Download ${id}` }
});

function apply(ledger: TransferLedger, ...events: readonly TransferEvent[]): TransferLedger {
  return events.reduce(reduceTransferLedger, ledger);
}

describe("transfer ledger", () => {
  it("enqueues newest first without mutating prior state and ignores duplicate identifiers", () => {
    const initial = createTransferLedger();
    const first = apply(initial, enqueueDownload("1"));
    const second = apply(first, enqueueDownload("2"), enqueueDownload("1"));

    expect(initial.tasks).toEqual([]);
    expect(first.tasks.map((task) => task.id)).toEqual(["1"]);
    expect(second.tasks.map((task) => task.id)).toEqual(["2", "1"]);
    expect(second.tasks[1]).toBe(first.tasks[0]);
  });

  it("expresses preparation, transfer, progress, and the archive preparation step explicitly", () => {
    const ledger = apply(
      createTransferLedger(),
      enqueueDownload("1"),
      { type: "preparationStarted", id: "1", totalBytes: 20 },
      { type: "progressReported", id: "1", stage: "preparing", loadedBytes: 4, totalBytes: 20 },
      { type: "transferStarted", id: "1", label: "Archive.zip", totalBytes: 10 },
      { type: "progressReported", id: "1", stage: "transferring", loadedBytes: 5, totalBytes: 10 },
      { type: "preparationStarted", id: "1", loadedBytes: 10, totalBytes: 10 }
    );

    expect(ledger.tasks[0]).toMatchObject({
      phase: "preparing",
      label: "Archive.zip",
      loadedBytes: 10,
      totalBytes: 10
    });
  });

  it("accumulates nonterminal failures and requires them for partial completion", () => {
    const active = apply(
      createTransferLedger(),
      enqueueDownload("1"),
      { type: "nonterminalFailureReported", id: "1", failure: { sourcePath: "A.txt", error: "Denied" } }
    );
    const invalidPartial = apply(active, {
      type: "partiallyCompleted",
      id: "1",
      at: "2026-07-17T10:01:00Z",
      failures: [],
      message: "Some files failed"
    });
    const partial = apply(invalidPartial, {
      type: "partiallyCompleted",
      id: "1",
      at: "2026-07-17T10:01:00Z",
      failures: [{ sourcePath: "A.txt", error: "Denied" }],
      message: "1 file failed"
    });

    expect(active.tasks[0]).toMatchObject({
      phase: "queued",
      errorMessage: "A.txt: Denied",
      failedFiles: [{ sourcePath: "A.txt", error: "Denied" }]
    });
    expect(invalidPartial).toBe(active);
    expect(partial.tasks[0]).toMatchObject({ phase: "partial", finishedAt: "2026-07-17T10:01:00Z", errorMessage: "1 file failed" });
  });

  it("makes terminal tasks and unknown identifiers inert", () => {
    const done = apply(
      createTransferLedger(),
      enqueueDownload("1"),
      { type: "completed", id: "1", at: "2026-07-17T10:01:00Z" }
    );
    const unchanged = apply(
      done,
      { type: "transferStarted", id: "1" },
      { type: "failed", id: "1", at: "2026-07-17T10:02:00Z", message: "Late failure" },
      { type: "failed", id: "missing", at: "2026-07-17T10:02:00Z", message: "Missing" }
    );

    expect(done.tasks[0]).toMatchObject({ phase: "done", finishedAt: "2026-07-17T10:01:00Z" });
    expect(unchanged).toBe(done);
  });

  it("accepts sync identity only when both roots and a dedupe key are present", () => {
    expect(isValidTransferTaskDraft({ id: "sync-invalid", accountId: "account-a", kind: "sync", label: "Sync", syncRootEntries: [] })).toBe(false);
    expect(isValidTransferTaskDraft({ id: "download-invalid", accountId: "account-a", kind: "download", label: "Download", dedupeKey: "wrong" })).toBe(false);
    const valid = apply(createTransferLedger(), {
      type: "enqueued",
      at: "2026-07-17T10:00:00Z",
      task: {
        id: "sync-valid",
        accountId: "account-a",
        kind: "sync",
        label: "Sync",
        dedupeKey: "root:A",
        syncRootEntries: [{ path: "A", name: "A", isFolder: true }]
      }
    });

    expect(valid.tasks[0]).toMatchObject({ kind: "sync", dedupeKey: "root:A" });
  });

  it("retains every active task and only the newest terminal history", () => {
    let ledger = createTransferLedger({ maxTerminal: 2 });
    ledger = apply(ledger, enqueueDownload("1"), enqueueDownload("2"), enqueueDownload("3"), enqueueDownload("4"));
    ledger = apply(
      ledger,
      { type: "completed", id: "1", at: "2026-07-17T10:01:01Z" },
      { type: "completed", id: "2", at: "2026-07-17T10:01:02Z" },
      { type: "completed", id: "3", at: "2026-07-17T10:01:03Z" }
    );

    expect(ledger.tasks.map((task) => task.id)).toEqual(["4", "3", "2"]);
  });

  it("clears all terminal history for one account, including partial results", () => {
    let ledger = apply(createTransferLedger(), enqueueDownload("active"), enqueueDownload("done"), enqueueDownload("partial"), enqueueDownload("other", "account-b"));
    ledger = apply(
      ledger,
      { type: "completed", id: "done", at: "2026-07-17T10:01:00Z" },
      { type: "partiallyCompleted", id: "partial", at: "2026-07-17T10:01:00Z", failures: [{ sourcePath: "A", error: "Denied" }], message: "Partial" },
      { type: "completed", id: "other", at: "2026-07-17T10:01:00Z" },
      { type: "accountHistoryCleared", accountId: "account-a" }
    );

    expect(ledger.tasks.map((task) => task.id)).toEqual(["other", "active"]);
  });

  it("fails active account tasks without rewriting existing terminal results", () => {
    let ledger = apply(createTransferLedger(), enqueueDownload("active"), enqueueDownload("partial"));
    ledger = apply(ledger, {
      type: "partiallyCompleted",
      id: "partial",
      at: "2026-07-17T10:01:00Z",
      failures: [{ sourcePath: "A", error: "Denied" }],
      message: "Partial"
    });
    ledger = apply(ledger, {
      type: "activeAccountFailed",
      accountId: "account-a",
      at: "2026-07-17T10:02:00Z",
      message: "Session changed"
    });

    expect(ledger.tasks.find((task) => task.id === "active")).toMatchObject({ phase: "error", errorMessage: "Session changed" });
    expect(ledger.tasks.find((task) => task.id === "partial")).toMatchObject({ phase: "partial", errorMessage: "Partial" });
  });

  it("snapshots caller-owned sync roots and failure facts", () => {
    const roots = [{ path: "A", name: "A", isFolder: true }];
    const failure = { sourcePath: "A/private.txt", error: "Denied" };
    const ledger = apply(
      createTransferLedger(),
      {
        type: "enqueued",
        at: "2026-07-17T10:00:00Z",
        task: { id: "sync", accountId: "account-a", kind: "sync", label: "A", dedupeKey: "root:A", syncRootEntries: roots }
      },
      { type: "nonterminalFailureReported", id: "sync", failure }
    );

    const firstRoot = roots[0];
    if (!firstRoot) {
      throw new Error("Expected the test root.");
    }
    firstRoot.path = "mutated";
    roots.push({ path: "B", name: "B", isFolder: true });
    failure.error = "mutated";

    expect(ledger.tasks[0]).toMatchObject({
      syncRootEntries: [{ path: "A", name: "A", isFolder: true }],
      failedFiles: [{ sourcePath: "A/private.txt", error: "Denied" }]
    });
  });
});
