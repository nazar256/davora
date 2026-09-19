import { describe, expect, it } from "vitest";

import { createTransferLedger, reduceTransferLedger, type TransferEvent } from "../../transfers/model";
import { formatWakeLockReasonLabel, mergeWakeLockReasons } from "./model";

function ledger(...events: readonly TransferEvent[]) {
  return events.reduce(reduceTransferLedger, createTransferLedger());
}

describe("wakeLock model", () => {
  it("adds mediaPlayback only while preview or folder audio is playing", () => {
    expect(mergeWakeLockReasons({
      previewMediaPlaying: false,
      folderAudioPlaying: false,
      transferTasks: []
    })).toEqual([]);

    expect(mergeWakeLockReasons({
      previewMediaPlaying: true,
      folderAudioPlaying: false,
      transferTasks: []
    })).toEqual(["mediaPlayback"]);

    expect(mergeWakeLockReasons({
      previewMediaPlaying: false,
      folderAudioPlaying: true,
      transferTasks: []
    })).toEqual(["mediaPlayback"]);
  });

  it("derives transfer wake-lock reasons only through selectTransferWakeLockReasons", () => {
    const tasks = ledger(
      {
        type: "enqueued",
        at: "2026-07-17T10:00:00Z",
        task: { id: "1", accountId: "account-a", kind: "download", label: "Download" }
      },
      {
        type: "enqueued",
        at: "2026-07-17T10:00:01Z",
        task: { id: "2", accountId: "account-a", kind: "upload", label: "Upload" }
      },
      {
        type: "enqueued",
        at: "2026-07-17T10:00:02Z",
        task: { id: "3", accountId: "account-a", kind: "sync", label: "Sync", dedupeKey: "root:A", syncRootEntries: [] }
      }
    ).tasks;

    expect(mergeWakeLockReasons({
      previewMediaPlaying: false,
      folderAudioPlaying: false,
      transferTasks: tasks
    })).toEqual(["download", "transferQueue", "offlineSync"]);
  });

  it("formats AppBar wake-lock reason labels with stable copy", () => {
    expect(formatWakeLockReasonLabel(["mediaPlayback"])).toBe("media playback");
    expect(formatWakeLockReasonLabel(["download"])).toBe("downloads");
    expect(formatWakeLockReasonLabel(["offlineSync"])).toBe("offline sync");
    expect(formatWakeLockReasonLabel(["transferQueue"])).toBe("transfers");
    expect(formatWakeLockReasonLabel(["mediaPlayback", "download", "offlineSync", "transferQueue"]))
      .toBe("media playback, downloads, offline sync, transfers");
  });
});
