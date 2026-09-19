import { describe, expect, it } from "vitest";

import {
  buildOfflineSyncAlreadyRunningStatus,
  buildOfflineSyncCompletedStatus,
  buildOfflineSyncPartialStatus,
  deriveOfflineSyncRootLabels
} from "./presentation";

describe("offline sync presentation", () => {
  it("derives batch root labels and dedupe key", () => {
    expect(deriveOfflineSyncRootLabels([
      { path: "Archive/a.txt", name: "a.txt", isFolder: false },
      { path: "Archive/b.txt", name: "b.txt", isFolder: false }
    ])).toMatchObject({
      rootKind: "batch",
      rootName: "2 items offline batch"
    });
    expect(deriveOfflineSyncRootLabels([
      { path: "roadmap.txt", name: "roadmap.txt", isFolder: false }
    ]).dedupeKey).toBe("sync:roadmap.txt");
  });

  it("builds status copy for running, completed, and partial sync", () => {
    expect(buildOfflineSyncAlreadyRunningStatus("roadmap.txt")).toBe("Offline sync is already running for roadmap.txt.");
    expect(buildOfflineSyncCompletedStatus("roadmap.txt", "Alpha")).toBe("Kept roadmap.txt offline on this device for Alpha.");
    expect(buildOfflineSyncPartialStatus(1, 2, "Alpha")).toBe("Synced 1 of 2 files for offline use in Alpha.");
  });
});
