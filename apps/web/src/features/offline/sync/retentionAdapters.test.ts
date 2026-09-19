import { describe, expect, it, vi } from "vitest";

import type { RetentionCommand, RetentionCommandOutcome, RetainedSnapshot } from "../retention";
import {
  createOfflineSyncRetentionPort,
  createCachedPreviewFromBlob,
  mapRetentionOutcomeToAction,
  type OfflineSyncRetentionDeps
} from "./retentionAdapters";
import type { OfflineSyncJob } from "./model";

type ExecuteSnapshotCommand = OfflineSyncRetentionDeps["executeSnapshotCommand"];

describe("mapRetentionOutcomeToAction", () => {
  it("maps retention outcomes to sync action results", () => {
    expect(mapRetentionOutcomeToAction({ kind: "completed" }, { aborted: false })).toEqual({ kind: "success" });
    expect(mapRetentionOutcomeToAction({ kind: "failed", message: "boom" }, { aborted: false }))
      .toEqual({ kind: "ordinaryFailure", message: "boom" });
    expect(mapRetentionOutcomeToAction({ kind: "superseded" }, { aborted: false }))
      .toEqual({ kind: "cancelled", reason: "superseded" });
    expect(mapRetentionOutcomeToAction({ kind: "superseded" }, { aborted: true }))
      .toEqual({ kind: "cancelled", reason: "aborted" });
  });
});

describe("createCachedPreviewFromBlob", () => {
  it("builds text and image previews from a blob", () => {
    const text = createCachedPreviewFromBlob("notes.txt", new Blob(["hello"], { type: "text/plain" }));
    expect(text).toMatchObject({
      path: "notes.txt",
      viewer: "text",
      encoding: "utf8",
      requiresOriginalBlob: false
    });

    const image = createCachedPreviewFromBlob("photo.png", new Blob([], { type: "image/png" }));
    expect(image).toMatchObject({
      path: "photo.png",
      viewer: "image",
      requiresOriginalBlob: true
    });
  });
});

describe("createOfflineSyncRetentionPort", () => {
  const account = { id: "alpha", cacheNamespace: "ns-alpha" };
  const retentionAccount = { accountId: account.id, cacheNamespace: account.cacheNamespace };
  const job: OfflineSyncJob = {
    id: "job-1",
    accountId: account.id,
    cacheNamespace: account.cacheNamespace,
    root: { path: "Projects/roadmap.txt", name: "roadmap.txt", kind: "file", folderRoots: [] },
    selectedEntries: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false }],
    planSource: { kind: "acceptedPlan", plan: { files: [{ sourcePath: "Projects/roadmap.txt", size: 4 }] } }
  };
  const file = { sourcePath: "Projects/roadmap.txt", size: 4 };

  it("gates beginRoot on an active account", async () => {
    const executeSnapshotCommand = vi.fn<ExecuteSnapshotCommand>(async () => ({ kind: "completed" }));
    const port = createOfflineSyncRetentionPort({
      getActiveAccount: () => account,
      toRetentionAccount: () => retentionAccount,
      executeSnapshotCommand,
      readBlobText: async (blob) => blob.text(),
      errors: { isUnauthorized: () => false, isReconnectRequired: () => false }
    });

    await expect(port.beginRoot(job, () => true)).resolves.toEqual({ kind: "success" });
    expect(executeSnapshotCommand).toHaveBeenCalledWith(expect.objectContaining({ kind: "beginRoot" }), expect.any(Function));
  });

  it("persists text content and maps retention failures", async () => {
    const executeSnapshotCommand = vi.fn<ExecuteSnapshotCommand>(async () => ({ kind: "completed" }));
    const port = createOfflineSyncRetentionPort({
      getActiveAccount: () => account,
      toRetentionAccount: () => retentionAccount,
      executeSnapshotCommand,
      readBlobText: async () => "offline roadmap",
      errors: { isUnauthorized: () => false, isReconnectRequired: () => false }
    });
    const signal = new AbortController().signal;

    await expect(port.persistRetainedFile(
      job,
      file,
      { blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" },
      signal,
      () => true
    )).resolves.toEqual({ kind: "success" });

    const persistCall = executeSnapshotCommand.mock.calls.find(([command]) => command.kind === "persistRetainedFile");
    expect(persistCall?.[0]).toMatchObject({
      kind: "persistRetainedFile",
      input: {
        file: {
          path: "Projects/roadmap.txt",
          normalCacheOwnership: "none",
          preview: {
            content: "offline roadmap",
            bytesRead: 15
          }
        }
      }
    });
  });

  it("cancels persist when ownership is lost or the signal is aborted", async () => {
    const executeSnapshotCommand = vi.fn<ExecuteSnapshotCommand>(async () => ({ kind: "completed" }));
    const port = createOfflineSyncRetentionPort({
      getActiveAccount: () => account,
      toRetentionAccount: () => retentionAccount,
      executeSnapshotCommand,
      readBlobText: async () => "offline roadmap",
      errors: { isUnauthorized: () => false, isReconnectRequired: () => false }
    });
    const controller = new AbortController();

    await expect(port.persistRetainedFile(
      job,
      file,
      { blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" },
      controller.signal,
      () => false
    )).resolves.toEqual({ kind: "cancelled", reason: "superseded" });

    controller.abort();
    await expect(port.persistRetainedFile(
      job,
      file,
      { blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" },
      controller.signal,
      () => true
    )).resolves.toEqual({ kind: "cancelled", reason: "aborted" });

    let owned = true;
    const readBlobText = vi.fn(async () => {
      owned = false;
      return "offline roadmap";
    });
    const gatedPort = createOfflineSyncRetentionPort({
      getActiveAccount: () => account,
      toRetentionAccount: () => retentionAccount,
      executeSnapshotCommand,
      readBlobText,
      errors: { isUnauthorized: () => false, isReconnectRequired: () => false }
    });
    await expect(gatedPort.persistRetainedFile(
      job,
      file,
      { blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" },
      new AbortController().signal,
      () => owned
    )).resolves.toEqual({ kind: "cancelled", reason: "superseded" });
    expect(executeSnapshotCommand).not.toHaveBeenCalled();
  });

  it("maps unauthorized and reconnect-required persist failures to session terminal results", async () => {
    const unauthorized = Object.assign(new Error("expired"), { name: "Unauthorized" });
    const reconnectRequired = Object.assign(new Error("reconnect"), { name: "ReconnectRequired" });
    const executeSnapshotCommand = vi.fn<ExecuteSnapshotCommand>()
      .mockRejectedValueOnce(unauthorized)
      .mockRejectedValueOnce(reconnectRequired);
    const port = createOfflineSyncRetentionPort({
      getActiveAccount: () => account,
      toRetentionAccount: () => retentionAccount,
      executeSnapshotCommand,
      readBlobText: async () => "offline roadmap",
      errors: {
        isUnauthorized: (error) => error === unauthorized,
        isReconnectRequired: (error) => error === reconnectRequired
      }
    });
    const signal = new AbortController().signal;
    const downloaded = { blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" };

    await expect(port.persistRetainedFile(job, file, downloaded, signal, () => true)).resolves.toEqual({
      kind: "sessionTerminal",
      reason: "unauthorized",
      message: "Session expired. Create a fresh session for this account."
    });
    await expect(port.persistRetainedFile(job, file, downloaded, signal, () => true)).resolves.toEqual({
      kind: "sessionTerminal",
      reason: "reconnectRequired",
      message: "This account needs to be reconnected before syncing files."
    });
  });

  it("builds text previews immutably before persisting retained files", async () => {
    const blob = new Blob(["offline roadmap"], { type: "text/plain" });
    const basePreview = createCachedPreviewFromBlob(file.sourcePath, blob, "roadmap.txt", file.size);
    const executeSnapshotCommand = vi.fn<ExecuteSnapshotCommand>(async () => ({ kind: "completed" }));
    const port = createOfflineSyncRetentionPort({
      getActiveAccount: () => account,
      toRetentionAccount: () => retentionAccount,
      executeSnapshotCommand,
      readBlobText: async () => "offline roadmap",
      errors: { isUnauthorized: () => false, isReconnectRequired: () => false }
    });
    const signal = new AbortController().signal;

    await port.persistRetainedFile(
      job,
      file,
      { blob, filename: "roadmap.txt" },
      signal,
      () => true
    );

    expect(basePreview).toMatchObject({ content: "", bytesRead: blob.size });
    const persistCall = executeSnapshotCommand.mock.calls.find(([command]) => command.kind === "persistRetainedFile");
    expect(persistCall?.[0]).toMatchObject({
      kind: "persistRetainedFile",
      input: {
        file: {
          preview: {
            content: "offline roadmap",
            bytesRead: 15
          }
        }
      }
    });
    const persistCommand = persistCall?.[0] as RetentionCommand | undefined;
    expect(persistCommand?.kind).toBe("persistRetainedFile");
    if (persistCommand?.kind === "persistRetainedFile") {
      expect(persistCommand.input.file.preview).not.toBe(basePreview);
    }
  });

  it("classifies completeRoot catch failures like persist retained files", async () => {
    const unauthorized = Object.assign(new Error("expired"), { name: "Unauthorized" });
    const reconnectRequired = Object.assign(new Error("reconnect"), { name: "ReconnectRequired" });
    const executeSnapshotCommand = vi.fn<ExecuteSnapshotCommand>()
      .mockRejectedValueOnce(unauthorized)
      .mockRejectedValueOnce(reconnectRequired);
    const port = createOfflineSyncRetentionPort({
      getActiveAccount: () => account,
      toRetentionAccount: () => retentionAccount,
      executeSnapshotCommand,
      readBlobText: async (blob) => blob.text(),
      errors: {
        isUnauthorized: (error) => error === unauthorized,
        isReconnectRequired: (error) => error === reconnectRequired
      }
    });
    const signal = new AbortController().signal;

    await expect(port.completeRoot(job, signal, () => true)).resolves.toEqual({
      kind: "sessionTerminal",
      reason: "unauthorized",
      message: "Session expired. Create a fresh session for this account."
    });
    await expect(port.completeRoot(job, signal, () => true)).resolves.toEqual({
      kind: "sessionTerminal",
      reason: "reconnectRequired",
      message: "This account needs to be reconnected before syncing files."
    });
  });

  it("refreshes summary snapshots and classifies read failures", async () => {
    const snapshot: RetainedSnapshot = {
      account: retentionAccount,
      normalCache: { itemCount: 1, totalBytes: 4, limitBytes: 1 },
      roots: [],
      files: [],
      memberships: []
    };
    const completed: RetentionCommandOutcome = { kind: "completed", snapshot };
    const failed: RetentionCommandOutcome = { kind: "failed", message: "read failed" };
    const executeSnapshotCommand = vi.fn<ExecuteSnapshotCommand>()
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce(failed);
    const port = createOfflineSyncRetentionPort({
      getActiveAccount: () => account,
      toRetentionAccount: () => retentionAccount,
      executeSnapshotCommand,
      readBlobText: async (blob) => blob.text(),
      errors: { isUnauthorized: () => false, isReconnectRequired: () => false }
    });
    const signal = new AbortController().signal;

    await expect(port.readSummary("ns-alpha", signal, () => true)).resolves.toMatchObject({
      kind: "success",
      value: { account: retentionAccount }
    });
    await expect(port.readSummary("ns-alpha", signal, () => true)).resolves.toEqual({
      kind: "ordinaryFailure",
      message: "read failed"
    });
  });
});
