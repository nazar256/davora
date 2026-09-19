import { describe, expect, it } from "vitest";

import { createTransferLedger, reduceTransferLedger, type TransferEvent } from "./model";
import {
  selectAccountTransfers,
  selectActiveSyncByDedupeKey,
  selectActiveTransfers,
  selectRecentTransfers,
  selectTransferWakeLockReasons
} from "./selectors";

function ledger(...events: readonly TransferEvent[]) {
  return events.reduce(reduceTransferLedger, createTransferLedger());
}

describe("transfer selectors", () => {
  const download = (id: string, accountId: string): TransferEvent => ({
    type: "enqueued",
    at: `2026-07-17T10:00:${id.padStart(2, "0")}Z`,
    task: { id, accountId, kind: "download", label: id }
  });

  it("separates account-visible tasks from globally active work and recent display", () => {
    const state = ledger(...Array.from({ length: 10 }, (_, index) => download(String(index), index === 9 ? "account-b" : "account-a")));

    expect(selectAccountTransfers(state.tasks, "account-a")).toHaveLength(9);
    expect(selectActiveTransfers(state.tasks)).toHaveLength(10);
    expect(selectRecentTransfers(state.tasks).map((task) => task.id)).toEqual(["9", "8", "7", "6", "5", "4", "3", "2"]);
  });

  it("deduplicates only active sync work for the same account and key", () => {
    let state = ledger({
      type: "enqueued",
      at: "2026-07-17T10:00:00Z",
      task: { id: "sync-a", accountId: "account-a", kind: "sync", label: "A", dedupeKey: "root:A", syncRootEntries: [] }
    });
    expect(selectActiveSyncByDedupeKey(state.tasks, "account-a", "root:A")?.id).toBe("sync-a");
    expect(selectActiveSyncByDedupeKey(state.tasks, "account-b", "root:A")).toBeUndefined();

    state = reduceTransferLedger(state, { type: "completed", id: "sync-a", at: "2026-07-17T10:01:00Z" });
    expect(selectActiveSyncByDedupeKey(state.tasks, "account-a", "root:A")).toBeUndefined();
  });

  it("derives global wake-lock reasons from active kinds", () => {
    const state = ledger(
      download("1", "account-a"),
      { type: "enqueued", at: "2026-07-17T10:00:02Z", task: { id: "2", accountId: "account-b", kind: "upload", label: "Upload" } },
      { type: "enqueued", at: "2026-07-17T10:00:03Z", task: { id: "3", accountId: "account-c", kind: "sync", label: "Sync", dedupeKey: "root:C", syncRootEntries: [] } }
    );

    expect(selectTransferWakeLockReasons(state.tasks)).toEqual(["download", "transferQueue", "offlineSync"]);
  });
});
