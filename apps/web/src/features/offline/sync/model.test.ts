import { describe, expect, it } from "vitest";
import { createOfflineSyncJob } from "./model";

describe("createOfflineSyncJob", () => {
  it("deeply snapshots accepted plans, retry entries, and root facts", () => {
    const input = {
      id: "job-1",
      accountId: "alpha",
      cacheNamespace: "ns-alpha",
      root: { path: "Projects", name: "Projects", kind: "folder" as const, folderRoots: ["Projects"] },
      selectedEntries: [{ path: "Projects", name: "Projects", isFolder: true }],
      planSource: {
        kind: "acceptedPlan" as const,
        plan: { files: [{ sourcePath: "Projects/a.txt", size: 4 }], totalBytes: 4 }
      }
    };

    const job = createOfflineSyncJob(input);
    input.root.folderRoots.push("late");
    input.selectedEntries[0].name = "changed";
    input.planSource.plan.files[0].sourcePath = "changed.txt";

    expect(job).toEqual({
      id: "job-1",
      accountId: "alpha",
      cacheNamespace: "ns-alpha",
      root: { path: "Projects", name: "Projects", kind: "folder", folderRoots: ["Projects"] },
      selectedEntries: [{ path: "Projects", name: "Projects", isFolder: true }],
      planSource: {
        kind: "acceptedPlan",
        plan: { files: [{ sourcePath: "Projects/a.txt", size: 4 }], totalBytes: 4 }
      }
    });
    expect(Object.isFrozen(job)).toBe(true);
    expect(Object.isFrozen(job.root.folderRoots)).toBe(true);
    expect(Object.isFrozen(job.selectedEntries[0])).toBe(true);
    expect(Object.isFrozen(job.planSource.kind === "acceptedPlan" && job.planSource.plan.files[0])).toBe(true);
  });

  it("deeply snapshots unresolved archive inputs", () => {
    const entry = { path: "Archive", name: "Archive", isFolder: true };
    const job = createOfflineSyncJob({
      id: "job-2",
      accountId: "alpha",
      cacheNamespace: "ns-alpha",
      root: { path: "Archive", name: "Archive", kind: "folder", folderRoots: ["Archive"] },
      selectedEntries: [entry],
      planSource: {
        kind: "resolvePlan",
        archiveInput: { roots: [{ entry, archiveRoot: "Archive" }], archiveLabel: "archive" }
      }
    });
    entry.name = "changed";

    expect(job.planSource).toEqual({
      kind: "resolvePlan",
      archiveInput: {
        roots: [{ entry: { path: "Archive", name: "Archive", isFolder: true }, archiveRoot: "Archive" }],
        archiveLabel: "archive"
      }
    });
  });
});
