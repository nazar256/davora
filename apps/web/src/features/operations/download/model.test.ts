import { describe, expect, it } from "vitest";

import type { BatchDownloadPlan } from "../../../lib/batchDownload";

import {
  buildBatchDownloadListErrorMessage,
  buildBatchDownloadPartialSummary,
  buildBatchDownloadReadyMessage,
  buildBatchDownloadSuccessMessage,
  buildDownloadSelectionLabel,
  buildOfflineDownloadBlockedMessage,
  buildServerUnavailableDownloadBlockedMessage,
  DOWNLOAD_CONTEXT_CHANGED_MESSAGE,
  DOWNLOAD_NO_SESSION_MESSAGE
} from "./model";

function plan(overrides: Partial<BatchDownloadPlan> = {}): BatchDownloadPlan {
  return {
    archiveName: "davora-home-download.zip",
    selectedCount: 2,
    selectedFileCount: 1,
    selectedDirectoryCount: 1,
    directories: ["Archive"],
    files: [
      { sourcePath: "notes.txt", archivePath: "notes.txt", size: 10 },
      { sourcePath: "Archive/photo.png", archivePath: "Archive/photo.png", size: 20 }
    ],
    failedFiles: [],
    totalBytes: 30,
    ...overrides
  };
}

describe("download model messages", () => {
  it("builds selection labels with exact copy", () => {
    expect(buildDownloadSelectionLabel(1, 1)).toBe("1 file and 1 folder");
    expect(buildDownloadSelectionLabel(0, 0)).toBe("0 items");
  });

  it("builds batch ready and success messages with exact copy", () => {
    const ready = buildBatchDownloadReadyMessage(plan(), "Batch download workspace");
    expect(ready).toBe("Preparing 1 file and 1 folder as davora-home-download.zip in Batch download workspace.");

    const success = buildBatchDownloadSuccessMessage(plan(), "Batch download workspace");
    expect(success).toBe("Downloaded 1 file and 1 folder as davora-home-download.zip in Batch download workspace.");
  });

  it("builds partial summaries and list errors with exact copy", () => {
    const partialPlan = plan({
      failedFiles: [{ sourcePath: "notes.txt", error: "Temporary sync failure." }]
    });
    expect(buildBatchDownloadPartialSummary(partialPlan)).toBe("Downloaded 1 of 2 files; 1 failed");
    expect(buildBatchDownloadSuccessMessage(partialPlan, "Partial batch workspace"))
      .toBe("Downloaded 1 file and 1 folder as davora-home-download.zip in Partial batch workspace. Downloaded 1 of 2 files; 1 failed.");
    expect(buildBatchDownloadListErrorMessage(partialPlan, "Downloaded 1 of 2 files; 1 failed."))
      .toBe("Downloaded 1 of 2 files; 1 failed. Failed: notes.txt: Temporary sync failure.");
  });

  it("keeps stable guard copy", () => {
    expect(DOWNLOAD_CONTEXT_CHANGED_MESSAGE).toBe("Download stopped because its account or connection context changed.");
    expect(DOWNLOAD_NO_SESSION_MESSAGE).toBe("No session available for this action.");
    expect(buildOfflineDownloadBlockedMessage()).toBe("Offline downloads are disabled. Reconnect to download files.");
    expect(buildServerUnavailableDownloadBlockedMessage())
      .toBe("Downloads are disabled while the local server is unavailable. Restore the server and retry.");
  });
});
