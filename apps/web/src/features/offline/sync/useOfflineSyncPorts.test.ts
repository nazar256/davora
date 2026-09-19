import { describe, expect, it, vi } from "vitest";

import type { OfflineSyncRetentionDeps } from "./retentionAdapters";
import { createTransferLedger, reduceTransferLedger } from "../../transfers";
import { buildOfflineSyncSupersededError } from "./orchestration";
import {
  OFFLINE_SYNC_NO_SESSION_MESSAGE,
  OFFLINE_SYNC_RECONNECT_REQUIRED_MESSAGE,
  OFFLINE_SYNC_SESSION_EXPIRED_MESSAGE
} from "./presentation";
import { createOfflineSyncPorts, type CreateOfflineSyncPortsInput } from "./useOfflineSyncPorts";

type ExecuteSnapshotCommand = OfflineSyncRetentionDeps["executeSnapshotCommand"];
type FetchDownloadBlob = CreateOfflineSyncPortsInput["fetchDownloadBlob"];

const archiveInput = {
  roots: [{
    entry: { path: "Projects", name: "Projects", isFolder: true },
    archiveRoot: "Projects"
  }],
  archiveLabel: "projects"
} as const;

function createInput(overrides: Partial<CreateOfflineSyncPortsInput> = {}): CreateOfflineSyncPortsInput {
  return {
    createAbortHandle: () => new AbortController(),
    getToken: () => "token-alpha",
    getCacheNamespace: () => "ns-alpha",
    listFiles: vi.fn(async () => ({
      items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false }]
    })),
    fetchDownloadBlob: vi.fn<FetchDownloadBlob>(async () => ({
      blob: new Blob(["offline"], { type: "text/plain" }),
      filename: "roadmap.txt"
    })),
    retention: {
      getActiveAccount: () => ({ id: "alpha", cacheNamespace: "ns-alpha" }),
      toRetentionAccount: (account) => ({ accountId: account.id, cacheNamespace: account.cacheNamespace }),
      executeSnapshotCommand: vi.fn<ExecuteSnapshotCommand>(async () => ({ kind: "completed" })),
      readBlobText: async (blob) => blob.text()
    },
    registry: {
      acquire: vi.fn(() => ({
        signal: new AbortController().signal,
        isRegistered: () => true,
        isOwned: () => true,
        release: vi.fn()
      }))
    },
    transfers: {
      createId: vi.fn(() => "transfer-1"),
      enqueue: vi.fn(),
      beginPreparation: vi.fn(),
      beginTransfer: vi.fn(),
      reportProgress: vi.fn(),
      reportFailure: vi.fn(),
      complete: vi.fn(),
      completePartial: vi.fn(),
      fail: vi.fn()
    },
    transferTasks: [],
    openTransferTray: vi.fn(),
    presentation: {
      setStatus: vi.fn(),
      reportListError: vi.fn(),
      closeMobileDetails: vi.fn(),
      showMobileActions: vi.fn(),
      setDialog: vi.fn(),
      updateDialog: vi.fn(),
      setBusy: vi.fn()
    },
    context: {
      isCurrentOperationContext: vi.fn(() => true),
      isOperationAllowed: vi.fn(() => true),
      getCurrentCapabilities: vi.fn(),
      capabilitiesMatch: vi.fn(() => true)
    },
    session: {
      resetActiveSession: vi.fn()
    },
    selection: {
      removeCaptured: vi.fn()
    },
    errors: {
      isUnauthorized: (error: unknown) => error instanceof Error && error.name === "Unauthorized",
      isReconnectRequired: (error: unknown) => error instanceof Error && error.name === "ReconnectRequired",
      toErrorMessage: (_error, fallback) => fallback
    },
    ...overrides
  };
}

describe("createOfflineSyncPorts", () => {
  describe("resolvePlan", () => {
    it("returns a successful plan when listing succeeds", async () => {
      const ports = createOfflineSyncPorts(createInput());
      const signal = new AbortController().signal;

      await expect(ports.confirm.plan.resolvePlan(archiveInput, signal, () => true)).resolves.toEqual({
        kind: "success",
        value: {
          files: [{ sourcePath: "Projects/roadmap.txt" }],
          totalBytes: undefined
        }
      });
    });

    it("classifies unauthorized, reconnect-required, and superseded plan failures", async () => {
      const unauthorized = Object.assign(new Error("expired"), { name: "Unauthorized" });
      const reconnectRequired = Object.assign(new Error("reconnect"), { name: "ReconnectRequired" });
      const signal = new AbortController().signal;

      const unauthorizedPorts = createOfflineSyncPorts(createInput({
        listFiles: vi.fn(async () => {
          throw unauthorized;
        })
      }));
      await expect(unauthorizedPorts.confirm.plan.resolvePlan(archiveInput, signal, () => true)).resolves.toEqual({
        kind: "sessionTerminal",
        reason: "unauthorized",
        message: OFFLINE_SYNC_SESSION_EXPIRED_MESSAGE
      });

      const reconnectPorts = createOfflineSyncPorts(createInput({
        listFiles: vi.fn(async () => {
          throw reconnectRequired;
        })
      }));
      await expect(reconnectPorts.confirm.plan.resolvePlan(archiveInput, signal, () => true)).resolves.toEqual({
        kind: "sessionTerminal",
        reason: "reconnectRequired",
        message: OFFLINE_SYNC_RECONNECT_REQUIRED_MESSAGE
      });

      let owned = true;
      const supersededPorts = createOfflineSyncPorts(createInput({
        listFiles: vi.fn(async () => {
          owned = false;
          throw buildOfflineSyncSupersededError();
        })
      }));
      await expect(supersededPorts.confirm.plan.resolvePlan(archiveInput, signal, () => owned)).resolves.toEqual({
        kind: "cancelled",
        reason: "superseded"
      });
    });
  });

  describe("download", () => {
    it("rejects downloads when no session token is available", async () => {
      const ports = createOfflineSyncPorts(createInput({ getToken: () => undefined }));
      const signal = new AbortController().signal;

      await expect(ports.confirm.download.fetchDownloadBlob("Projects/roadmap.txt", {
        onProgress: vi.fn(),
        signal
      })).rejects.toThrow(OFFLINE_SYNC_NO_SESSION_MESSAGE);
    });

    it("passes the session token through to the download adapter", async () => {
      const fetchDownloadBlob = vi.fn<FetchDownloadBlob>(async () => ({
        blob: new Blob(["offline"], { type: "text/plain" }),
        filename: "roadmap.txt"
      }));
      const ports = createOfflineSyncPorts(createInput({ fetchDownloadBlob }));
      const signal = new AbortController().signal;

      await ports.confirm.download.fetchDownloadBlob("Projects/roadmap.txt", {
        onProgress: vi.fn(),
        signal
      });

      expect(fetchDownloadBlob).toHaveBeenCalledTimes(1);
      const call = fetchDownloadBlob.mock.calls[0];
      expect(call?.[0]).toBe("Projects/roadmap.txt");
      expect(call?.[1]).toBe("token-alpha");
      expect(call?.[2]).toMatchObject({ signal });
      expect(typeof call?.[2]?.onProgress).toBe("function");
    });
  });

  describe("retention", () => {
    it("composes retention deps and error classifiers into the confirm port", async () => {
      const executeSnapshotCommand = vi.fn<ExecuteSnapshotCommand>()
        .mockResolvedValueOnce({ kind: "completed" })
        .mockRejectedValueOnce(Object.assign(new Error("expired"), { name: "Unauthorized" }));
      const ports = createOfflineSyncPorts(createInput({ retention: {
        getActiveAccount: () => ({ id: "alpha", cacheNamespace: "ns-alpha" }),
        toRetentionAccount: (account) => ({ accountId: account.id, cacheNamespace: account.cacheNamespace }),
        executeSnapshotCommand,
        readBlobText: async () => "offline",
      } }));
      const job = {
        id: "job-1",
        accountId: "alpha",
        cacheNamespace: "ns-alpha",
        root: { path: "Projects/roadmap.txt", name: "roadmap.txt", kind: "file" as const, folderRoots: [] },
        selectedEntries: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false }],
        planSource: { kind: "acceptedPlan" as const, plan: { files: [{ sourcePath: "Projects/roadmap.txt", size: 4 }] } }
      };
      const signal = new AbortController().signal;

      await expect(ports.confirm.retention.beginRoot(job, () => true)).resolves.toEqual({ kind: "success" });
      expect(executeSnapshotCommand).toHaveBeenCalledWith(expect.objectContaining({
        kind: "beginRoot",
        account: { accountId: "alpha", cacheNamespace: "ns-alpha" }
      }), expect.any(Function));

      await expect(ports.confirm.retention.persistRetainedFile(
        job,
        { sourcePath: "Projects/roadmap.txt", size: 4 },
        { blob: new Blob(["offline"], { type: "application/octet-stream" }), filename: "roadmap.txt" },
        signal,
        () => true
      )).resolves.toEqual({
        kind: "sessionTerminal",
        reason: "unauthorized",
        message: OFFLINE_SYNC_SESSION_EXPIRED_MESSAGE
      });
    });
  });

  describe("findActiveSyncByDedupeKey", () => {
    it("returns the active sync transfer id for the same account and dedupe key", () => {
      const transferTasks = reduceTransferLedger(createTransferLedger(), {
        type: "enqueued",
        at: "2026-07-21T10:00:00.000Z",
        task: {
          id: "sync-a",
          accountId: "alpha",
          kind: "sync",
          label: "roadmap.txt",
          dedupeKey: "sync:Projects/roadmap.txt",
          syncRootEntries: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false }]
        }
      }).tasks;
      const ports = createOfflineSyncPorts(createInput({ transferTasks }));

      expect(ports.confirm.transfers.findActiveSyncByDedupeKey("alpha", "sync:Projects/roadmap.txt"))
        .toEqual({ id: "sync-a" });
      expect(ports.confirm.transfers.findActiveSyncByDedupeKey("beta", "sync:Projects/roadmap.txt"))
        .toBeUndefined();
    });
  });
});
