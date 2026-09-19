import { describe, expect, it } from "vitest";

import { createTransferLedger, reduceTransferLedger, type TransferEvent } from "../model";
import {
  buildTransferTraySummary,
  formatTransferPercent,
  transferKindLabel,
  transferPhaseLabel
} from "./presentation";

describe("transfer tray presentation", () => {
  it("formats percent, kind labels, and phase copy unchanged", () => {
    expect(formatTransferPercent(25, 100)).toBe("25%");
    expect(formatTransferPercent(25, 0)).toBeUndefined();
    expect(transferKindLabel("upload")).toBe("Upload");
    expect(transferKindLabel("download")).toBe("Download");
    expect(transferKindLabel("sync")).toBe("Offline sync");
    expect(transferPhaseLabel("preparing", "upload")).toBe("Preparing");
    expect(transferPhaseLabel("transferring", "sync")).toBe("Offline sync");
    expect(transferPhaseLabel("partial", "download")).toBe("Partial");
  });

  it("builds active count and primary summary from account-filtered tasks", () => {
    const events: TransferEvent[] = [
      { type: "enqueued", at: "2026-07-17T10:00:00Z", task: { id: "upload", accountId: "account-a", kind: "upload", label: "photo.jpg", totalBytes: 100 } },
      { type: "progressReported", id: "upload", stage: "preparing", loadedBytes: 25, totalBytes: 100 },
      { type: "enqueued", at: "2026-07-17T10:00:01Z", task: { id: "done", accountId: "account-a", kind: "download", label: "archive.zip" } },
      { type: "completed", id: "done", at: "2026-07-17T10:01:00Z" }
    ];
    const state = events.reduce(reduceTransferLedger, createTransferLedger());

    expect(buildTransferTraySummary(state.tasks)).toEqual({
      activeCount: 1,
      summary: "Upload: photo.jpg (25%)",
      percent: "25%"
    });
  });
});
