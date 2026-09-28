import { describe, expect, it, vi } from "vitest";
import { executeOfflineSync } from "./controller";
import {
  createOfflineSyncJob,
  type OfflineSyncJob,
  type OfflineSyncPlan,
  type OfflineSyncPlannedFile
} from "./model";
import type { OfflineSyncExecutionPorts } from "./ports";

type Downloaded = { readonly body: string };
type Summary = { readonly itemCount: number };
type ProgressPublisher = (loadedBytes: number, totalBytes?: number) => boolean;

const plan: OfflineSyncPlan = {
  files: [
    { sourcePath: "Projects/a.txt", size: 4 },
    { sourcePath: "Projects/b.txt", size: 6 }
  ],
  totalBytes: 10
};

function job(planSource: OfflineSyncJob["planSource"] = { kind: "acceptedPlan", plan }): OfflineSyncJob {
  return createOfflineSyncJob({
    id: "job-1",
    accountId: "alpha",
    cacheNamespace: "ns-alpha",
    root: { path: "Projects", name: "Projects", kind: "folder", folderRoots: ["Projects"] },
    selectedEntries: [{ path: "Projects", name: "Projects", isFolder: true }],
    planSource
  });
}

function ports(overrides: Partial<OfflineSyncExecutionPorts<Downloaded, Summary>> = {}) {
  const order: string[] = [];
  const controller = new AbortController();
  const value: OfflineSyncExecutionPorts<Downloaded, Summary> = {
    signal: controller.signal,
    checkOwnership: vi.fn(() => ({ kind: "current" } as const)),
    resolvePlan: vi.fn(async () => ({ kind: "success", value: plan } as const)),
    download: vi.fn(async (file: OfflineSyncPlannedFile, onProgress: ProgressPublisher) => {
      order.push(`download:${file.sourcePath}`);
      onProgress(file.size ?? 0, file.size);
      return { kind: "success", value: { value: { body: file.sourcePath }, byteSize: file.size ?? 0 } } as const;
    }),
    persistOffline: vi.fn(async (_job: OfflineSyncJob, file: OfflineSyncPlannedFile) => {
      order.push(`persist:${file.sourcePath}`);
      return { kind: "success" } as const;
    }),
    readRetainedMembers: vi.fn(async () => {
      order.push("members");
      return { kind: "success", value: new Map() } as const;
    }),
    markRootComplete: vi.fn(async () => {
      order.push("mark");
      return { kind: "success" } as const;
    }),
    readSummary: vi.fn(async () => {
      order.push("summary");
      return { kind: "success", value: { itemCount: 2 } } as const;
    }),
    publish: vi.fn(() => true),
    ...overrides
  };
  return { value, order, controller };
}

describe("executeOfflineSync", () => {
  it("uses an accepted plan and executes download then persistence sequentially", async () => {
    const fixture = ports();

    const outcome = await executeOfflineSync(job(), fixture.value);

    expect(fixture.value.resolvePlan).not.toHaveBeenCalled();
    expect(fixture.order).toEqual([
      "members",
      "download:Projects/a.txt",
      "persist:Projects/a.txt",
      "download:Projects/b.txt",
      "persist:Projects/b.txt",
      "mark",
      "summary"
    ]);
    expect(outcome).toMatchObject({
      kind: "completed",
      persistedBytes: 10,
      completedFiles: plan.files,
      failures: [],
      summary: { kind: "success", value: { itemCount: 2 } }
    });
  });

  it("resolves an unresolved plan exactly once", async () => {
    const fixture = ports();
    const archiveInput = {
      roots: [{ entry: { path: "Projects", name: "Projects", isFolder: true }, archiveRoot: "Projects" }],
      archiveLabel: "projects"
    } as const;

    await executeOfflineSync(job({ kind: "resolvePlan", archiveInput }), fixture.value);

    expect(fixture.value.resolvePlan).toHaveBeenCalledOnce();
    expect(fixture.value.resolvePlan).toHaveBeenCalledWith(archiveInput, fixture.value.signal);
  });

  it("skips download and persistence for files already retained under the root", async () => {
    const fixture = ports();
    fixture.value.readRetainedMembers = vi.fn(async () => {
      fixture.order.push("members");
      return {
        kind: "success",
        value: new Map([["Projects/a.txt", { blobSize: 4, readable: true }]])
      } as const;
    });

    const outcome = await executeOfflineSync(job(), fixture.value);

    expect(fixture.order).toEqual([
      "members",
      "download:Projects/b.txt",
      "persist:Projects/b.txt",
      "mark",
      "summary"
    ]);
    expect(outcome).toMatchObject({
      kind: "completed",
      persistedBytes: 10,
      completedFiles: plan.files,
      failures: []
    });
    expect(fixture.value.markRootComplete).toHaveBeenCalledOnce();
  });

  it("re-downloads retained members whose stored size no longer matches or that are not readable", async () => {
    const fixture = ports();
    fixture.value.readRetainedMembers = vi.fn(async () => {
      fixture.order.push("members");
      return {
        kind: "success",
        value: new Map<string, { blobSize: number; readable: boolean }>([
          ["Projects/a.txt", { blobSize: 99, readable: true }],
          ["Projects/b.txt", { blobSize: 6, readable: false }]
        ])
      } as const;
    });

    const outcome = await executeOfflineSync(job(), fixture.value);

    expect(fixture.order).toEqual([
      "members",
      "download:Projects/a.txt",
      "persist:Projects/a.txt",
      "download:Projects/b.txt",
      "persist:Projects/b.txt",
      "mark",
      "summary"
    ]);
    expect(outcome).toMatchObject({ kind: "completed", persistedBytes: 10 });
  });

  it("downloads everything when the retained-member read fails", async () => {
    const fixture = ports();
    fixture.value.readRetainedMembers = vi.fn(async () => {
      fixture.order.push("members");
      return { kind: "ordinaryFailure", message: "index unavailable" } as const;
    });

    const outcome = await executeOfflineSync(job(), fixture.value);

    expect(fixture.order).toEqual([
      "members",
      "download:Projects/a.txt",
      "persist:Projects/a.txt",
      "download:Projects/b.txt",
      "persist:Projects/b.txt",
      "mark",
      "summary"
    ]);
    expect(outcome).toMatchObject({ kind: "completed", persistedBytes: 10 });
  });

  it("terminates on a session-terminal or cancelled member read", async () => {
    const terminal = ports({
      readRetainedMembers: vi.fn(async () => ({
        kind: "sessionTerminal",
        reason: "reconnectRequired",
        message: "reconnect"
      } as const))
    });
    await expect(executeOfflineSync(job(), terminal.value)).resolves.toMatchObject({
      kind: "sessionTerminated",
      message: "reconnect"
    });
    expect(terminal.value.download).not.toHaveBeenCalled();

    const cancelled = ports({
      readRetainedMembers: vi.fn(async () => ({ kind: "cancelled", reason: "superseded" } as const))
    });
    await expect(executeOfflineSync(job(), cancelled.value)).resolves.toMatchObject({
      kind: "cancelled",
      reason: "superseded"
    });
    expect(cancelled.value.download).not.toHaveBeenCalled();
  });

  it("records ordinary download and persistence failures once, continues, and never marks a partial root complete", async () => {
    const fixture = ports({
      download: vi.fn(async (file: OfflineSyncPlannedFile) => file.sourcePath.endsWith("a.txt")
        ? { kind: "ordinaryFailure", message: "download failed" } as const
        : { kind: "success", value: { value: { body: "b" }, byteSize: 6 } } as const),
      persistOffline: vi.fn(async () => ({ kind: "ordinaryFailure", message: "cache failed" } as const))
    });

    const outcome = await executeOfflineSync(job(), fixture.value);

    expect(outcome).toMatchObject({
      kind: "partial",
      persistedBytes: 0,
      completedFiles: [],
      failures: [
        { sourcePath: "Projects/a.txt", stage: "download", error: "download failed" },
        { sourcePath: "Projects/b.txt", stage: "persistence", error: "cache failed" }
      ]
    });
    expect(fixture.value.markRootComplete).not.toHaveBeenCalled();
    expect(fixture.value.readSummary).toHaveBeenCalledOnce();
  });

  it("keeps progress monotonic and counts bytes only after persistence", async () => {
    const fixture = ports({
      download: vi.fn(async (file: OfflineSyncPlannedFile, onProgress: ProgressPublisher) => {
        onProgress(3, file.size);
        onProgress(2, file.size);
        return { kind: "success", value: { value: { body: file.sourcePath }, byteSize: file.size ?? 0 } } as const;
      })
    });

    await executeOfflineSync(job(), fixture.value);

    const progress = vi.mocked(fixture.value.publish).mock.calls
      .map(([event]) => event)
      .filter((event) => event.kind === "progress");
    expect(progress.map((event) => event.displayBytes)).toEqual([3, 3, 4, 7, 7, 10]);
    expect(progress.map((event) => event.persistedBytes)).toEqual([0, 0, 4, 4, 4, 10]);
  });

  it("makes late download completion inert after supersession", async () => {
    let current = true;
    let resolveDownload!: (value: { kind: "success"; value: { value: Downloaded; byteSize: number } }) => void;
    const download = new Promise<{ kind: "success"; value: { value: Downloaded; byteSize: number } }>((resolve) => {
      resolveDownload = resolve;
    });
    const fixture = ports({
      checkOwnership: vi.fn(() => current ? { kind: "current" } as const : { kind: "cancelled", reason: "superseded" } as const),
      download: vi.fn(async () => download)
    });

    const execution = executeOfflineSync(job(), fixture.value);
    await vi.waitFor(() => expect(fixture.value.download).toHaveBeenCalledOnce());
    current = false;
    resolveDownload({ kind: "success", value: { value: { body: "late" }, byteSize: 4 } });

    await expect(execution).resolves.toMatchObject({ kind: "cancelled", reason: "superseded" });
    expect(fixture.value.persistOffline).not.toHaveBeenCalled();
    expect(fixture.value.markRootComplete).not.toHaveBeenCalled();
    expect(fixture.value.readSummary).not.toHaveBeenCalled();
  });

  it("returns typed planning and root-completion failures with accepted facts", async () => {
    const planning = ports({ resolvePlan: vi.fn(async () => ({ kind: "ordinaryFailure", message: "plan failed" } as const)) });
    await expect(executeOfflineSync(job({
      kind: "resolvePlan",
      archiveInput: { roots: [], archiveLabel: "empty" }
    }), planning.value)).resolves.toMatchObject({ kind: "failed", phase: "planning", message: "plan failed", completedFiles: [] });

    const completion = ports({ markRootComplete: vi.fn(async () => ({ kind: "ordinaryFailure", message: "mark failed" } as const)) });
    await expect(executeOfflineSync(job(), completion.value)).resolves.toMatchObject({
      kind: "failed",
      phase: "rootCompletion",
      message: "mark failed",
      persistedBytes: 10,
      summary: { kind: "success" }
    });
  });

  it("attaches summary failure without rewriting completed or partial terminal truth", async () => {
    const fixture = ports({ readSummary: vi.fn(async () => ({ kind: "ordinaryFailure", message: "summary failed" } as const)) });

    await expect(executeOfflineSync(job(), fixture.value)).resolves.toMatchObject({
      kind: "completed",
      summary: { kind: "failed", error: "summary failed" }
    });
  });

  it("stops immediately on a session-terminal file result", async () => {
    const fixture = ports({ download: vi.fn(async () => ({
      kind: "sessionTerminal",
      reason: "reconnectRequired",
      message: "reconnect"
    } as const)) });

    await expect(executeOfflineSync(job(), fixture.value)).resolves.toMatchObject({
      kind: "sessionTerminated",
      message: "reconnect"
    });
    expect(fixture.value.download).toHaveBeenCalledOnce();
    expect(fixture.value.persistOffline).not.toHaveBeenCalled();
    expect(fixture.value.readSummary).not.toHaveBeenCalled();
  });
});
