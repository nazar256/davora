import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { buildAccount } from "../../../test/accounts";
import { createRetainedSnapshot, retainedRootId, type RetainedFile, type RetainedSnapshot } from "./model";
import type { RetentionRepository, UseRetentionPorts } from "./ports";
import { useRetention } from "./useRetention";

const account = buildAccount("alpha", { displayName: "Alpha workspace", cacheNamespace: "ns-alpha" });
const retentionAccount = { accountId: account.id, cacheNamespace: account.cacheNamespace };
const root = { rootPath: "Projects", rootName: "Projects", kind: "folder" as const, folderRoots: ["Projects"] };
const rootId = retainedRootId(root);
const batchRoot = { rootPath: '["Archive","Projects"]', rootName: "Archive", kind: "batch" as const, folderRoots: ["Archive", "Projects"] };
const batchRootId = retainedRootId(batchRoot);

const retainedFile = (path: string, overrides: Partial<RetainedFile> = {}): RetainedFile => ({
  path,
  name: path.split("/").pop() ?? path,
  mimeType: "text/plain",
  size: 12,
  blobSize: 12,
  readable: true,
  normalCacheOwnership: "none",
  ...overrides
});

const snapshot = (overrides: {
  normalCache?: RetainedSnapshot["normalCache"];
  roots?: RetainedSnapshot["roots"];
  files?: RetainedSnapshot["files"];
  memberships?: RetainedSnapshot["memberships"];
} = {}): RetainedSnapshot => createRetainedSnapshot({
  account: retentionAccount,
  normalCache: overrides.normalCache ?? { itemCount: 1, totalBytes: 11, limitBytes: 24 * 1024 * 1024 },
  roots: overrides.roots ?? [{ ...root, status: "complete", addedAt: "2026-07-18T10:00:00.000Z" }],
  files: overrides.files ?? [retainedFile("Projects/roadmap.txt")],
  memberships: overrides.memberships ?? [{ rootId, filePath: "Projects/roadmap.txt" }]
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function createRepository(overrides: Partial<RetentionRepository> = {}): RetentionRepository {
  const success = vi.fn(async () => ({ kind: "success" as const, value: snapshot() }));
  return {
    readSnapshot: success,
    readPreview: async () => ({ kind: "success" as const, value: undefined }),
    writePreview: success,
    beginRoot: success,
    persistRetainedFile: success,
    completeRoot: success,
    removeRoot: success,
    clearNormalCache: success,
    purgeAccountNamespace: success,
    configureNormalCacheLimit: success,
    ...overrides
  };
}

function createPorts(overrides: Partial<UseRetentionPorts> = {}): UseRetentionPorts {
  return {
    repository: createRepository(),
    ui: {
      clearFolderCacheForPath: vi.fn(),
      clearFolderAndSearchCache: vi.fn(),
      clearSelectionChrome: vi.fn(),
      setStatus: vi.fn()
    },
    presentation: {
      formatCacheLimitStatus: (limitBytes, accountName) => `limit:${limitBytes}:${accountName}`,
      formatRemoveOfflineCopyStatus: (rootName) => `removed:${rootName}`,
      formatClearCacheStatus: (accountName) => `cleared:${accountName}`
    },
    toRetentionAccount: (connected) => ({ accountId: connected.id, cacheNamespace: connected.cacheNamespace }),
    defaultCacheLimitBytes: 24 * 1024 * 1024,
    ...overrides
  };
}

function renderRetention(ports: UseRetentionPorts, overrides: { activeAccount?: typeof account; cacheNamespace?: string; accountName?: string } = {}) {
  return renderHook(
    (props) => useRetention(props),
    {
      initialProps: {
        activeAccount: overrides.activeAccount ?? account,
        cacheNamespace: overrides.cacheNamespace ?? account.cacheNamespace,
        accountName: overrides.accountName ?? account.displayName,
        ports
      }
    }
  );
}

describe("useRetention", () => {
  it("refreshes the active snapshot on mount and publishes cache summary", async () => {
    const ports = createPorts();
    const { result } = renderRetention(ports);

    await waitFor(() => expect(ports.repository.readSnapshot).toHaveBeenCalledWith(retentionAccount));
    await waitFor(() => expect(result.current.cacheSummary).toEqual(snapshot().normalCache));
    expect(result.current.retentionSnapshot?.account).toEqual(retentionAccount);
  });

  it("drops publication when account ownership no longer matches", async () => {
    const pending = deferred<{ readonly kind: "success"; readonly value: RetainedSnapshot }>();
    const ports = createPorts({
      repository: createRepository({
        configureNormalCacheLimit: vi.fn(() => pending.promise)
      })
    });
    const { result, rerender } = renderRetention(ports);
    await waitFor(() => expect(ports.repository.readSnapshot).toHaveBeenCalled());

    const configure = result.current.configureNormalCacheLimit(512 * 1024 * 1024);
    rerender({
      activeAccount: buildAccount("beta", { displayName: "Beta workspace", cacheNamespace: "ns-beta" }),
      cacheNamespace: "ns-beta",
      accountName: "Beta workspace",
      ports
    });

    pending.resolve({
      kind: "success" as const,
      value: createRetainedSnapshot({
        account: retentionAccount,
        normalCache: { itemCount: 9, totalBytes: 999, limitBytes: 512 * 1024 * 1024 },
        roots: [],
        files: [],
        memberships: []
      })
    });
    await act(async () => { await configure; });

    expect(ports.ui.setStatus).not.toHaveBeenCalled();
    expect(result.current.cacheSummary.totalBytes).toBe(11);
  });

  it("rejects mismatched snapshot accounts during publication", async () => {
    const ports = createPorts({
      repository: createRepository({
        readSnapshot: vi.fn(async () => ({
          kind: "success" as const,
          value: createRetainedSnapshot({
            account: { accountId: "other", cacheNamespace: "ns-other" },
            normalCache: { itemCount: 5, totalBytes: 55, limitBytes: 1024 },
            roots: [],
            files: [],
            memberships: []
          })
        }))
      })
    });
    const { result } = renderRetention(ports);

    await waitFor(() => expect(ports.repository.readSnapshot).toHaveBeenCalled());
    expect(result.current.retentionSnapshot).toBeUndefined();
    expect(result.current.cacheSummary).toEqual({ itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 });
  });

  it("clears folder cache for folder removals and reports status without server delete", async () => {
    const ports = createPorts();
    const { result } = renderRetention(ports);
    await waitFor(() => expect(ports.repository.readSnapshot).toHaveBeenCalled());

    await act(async () => {
      await result.current.removeOfflineCopy({ rootId, rootPath: root.rootPath, rootName: root.rootName, kind: "folder" });
    });

    expect(ports.repository.removeRoot).toHaveBeenCalledWith(retentionAccount, rootId);
    expect(ports.ui.clearFolderCacheForPath).toHaveBeenCalledWith("ns-alpha", "Projects");
    expect(ports.ui.clearFolderAndSearchCache).not.toHaveBeenCalled();
    expect(ports.ui.setStatus).toHaveBeenCalledWith("removed:Projects");
  });

  it("clears folder and search cache for batch removals", async () => {
    const ports = createPorts();
    const { result } = renderRetention(ports);
    await waitFor(() => expect(ports.repository.readSnapshot).toHaveBeenCalled());

    await act(async () => {
      await result.current.removeOfflineCopy({
        rootId: batchRootId,
        rootPath: batchRoot.rootPath,
        rootName: batchRoot.rootName,
        kind: "batch"
      });
    });

    expect(ports.repository.removeRoot).toHaveBeenCalledWith(retentionAccount, batchRootId);
    expect(ports.ui.clearFolderAndSearchCache).toHaveBeenCalledWith("ns-alpha");
    expect(ports.ui.clearFolderCacheForPath).not.toHaveBeenCalled();
  });

  it("preserves required offline ancestors and clears selection chrome when clearing normal cache", async () => {
    const clearedSnapshot = snapshot({
      normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 },
      files: [retainedFile("Projects/roadmap.txt")],
      memberships: [{ rootId, filePath: "Projects/roadmap.txt" }]
    });
    const ports = createPorts({
      repository: createRepository({
        clearNormalCache: vi.fn(async () => ({ kind: "success" as const, value: clearedSnapshot }))
      })
    });
    const { result } = renderRetention(ports);
    await waitFor(() => expect(ports.repository.readSnapshot).toHaveBeenCalled());

    await act(async () => {
      await result.current.clearNormalCache();
    });

    expect(ports.repository.clearNormalCache).toHaveBeenCalledWith(retentionAccount);
    expect(ports.ui.clearFolderAndSearchCache).toHaveBeenCalledWith("ns-alpha", { preserveFolderPaths: ["Projects"] });
    expect(ports.ui.clearSelectionChrome).toHaveBeenCalledTimes(1);
    expect(ports.ui.setStatus).toHaveBeenCalledWith("cleared:Alpha workspace");
  });

  it("throws when an explicit refresh fails", async () => {
    const ports = createPorts({
      repository: createRepository({
        readSnapshot: vi.fn(async () => ({ kind: "failure" as const, message: "storage unavailable" }))
      })
    });
    const { result } = renderRetention(ports);
    await waitFor(() => expect(ports.repository.readSnapshot).toHaveBeenCalled());

    await expect(result.current.refreshCacheSummary()).rejects.toThrow("storage unavailable");
  });

  it("no-ops superseded cache-limit changes without status", async () => {
    const pending = deferred<{ readonly kind: "success"; readonly value: RetainedSnapshot }>();
    const ports = createPorts({
      repository: createRepository({
        configureNormalCacheLimit: vi.fn(() => pending.promise)
      })
    });
    const { result, rerender } = renderRetention(ports);
    await waitFor(() => expect(ports.repository.readSnapshot).toHaveBeenCalled());

    const configure = result.current.configureNormalCacheLimit(512 * 1024 * 1024);
    rerender({
      activeAccount: buildAccount("beta", { displayName: "Beta workspace", cacheNamespace: "ns-beta" }),
      cacheNamespace: "ns-beta",
      accountName: "Beta workspace",
      ports
    });
    pending.resolve({ kind: "success" as const, value: snapshot({ normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 512 * 1024 * 1024 }, roots: [], files: [], memberships: [] }) });
    await act(async () => { await configure; });

    expect(ports.ui.setStatus).not.toHaveBeenCalled();
  });

  it("keeps the first Alpha read inert after returning through Beta", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace", cacheNamespace: "ns-alpha" });
    const beta = buildAccount("beta", { displayName: "Beta workspace", cacheNamespace: "ns-beta" });
    const first = deferred<{ readonly kind: "success"; readonly value: RetainedSnapshot }>();
    const currentAlpha = snapshot({
      normalCache: { itemCount: 7, totalBytes: 77, limitBytes: 1024 },
      files: [retainedFile("current-alpha.txt")], roots: [], memberships: []
    });
    let reads = 0;
    const ports = createPorts({
      repository: createRepository({
        readSnapshot: vi.fn(() => {
          reads += 1;
          return reads === 1 ? first.promise : Promise.resolve({ kind: "success" as const, value: currentAlpha });
        })
      })
    });
    const { result, rerender } = renderRetention(ports);
    await waitFor(() => expect(ports.repository.readSnapshot).toHaveBeenCalled());
    rerender({ activeAccount: beta, cacheNamespace: beta.cacheNamespace, accountName: "Beta workspace", ports });
    rerender({ activeAccount: alpha, cacheNamespace: alpha.cacheNamespace, accountName: "Alpha workspace", ports });
    first.resolve({ kind: "success", value: snapshot() });
    await act(async () => { await first.promise; });

    expect(result.current.retentionSnapshot?.files.map((entry) => entry.path)).toEqual(["current-alpha.txt"]);
    expect(result.current.cacheSummary.totalBytes).toBe(77);
  });

  it("makes a successful direct command inert after unmount and keeps StrictMode current work valid", async () => {
    const pending = deferred<{ readonly kind: "success"; readonly value: RetainedSnapshot }>();
    const ports = createPorts({ repository: createRepository({ configureNormalCacheLimit: vi.fn(() => pending.promise) }) });
    const rendered = renderRetention(ports);
    await waitFor(() => expect(ports.repository.readSnapshot).toHaveBeenCalled());
    const command = rendered.result.current.configureNormalCacheLimit(512 * 1024 * 1024);
    rendered.unmount();
    pending.resolve({ kind: "success", value: snapshot({ normalCache: { itemCount: 1, totalBytes: 11, limitBytes: 512 * 1024 * 1024 } }) });
    await expect(command).resolves.toBeUndefined();
    expect(ports.ui.setStatus).not.toHaveBeenCalled();

    const strictPorts = createPorts();
    const strict = renderHook((props) => useRetention(props), {
      initialProps: { activeAccount: account, cacheNamespace: account.cacheNamespace, accountName: account.displayName, ports: strictPorts },
      wrapper: StrictMode
    });
    await waitFor(() => expect(strictPorts.repository.readSnapshot).toHaveBeenCalled());
    await act(async () => { await strict.result.current.configureNormalCacheLimit(512 * 1024 * 1024); });
    expect(strictPorts.ui.setStatus).toHaveBeenCalledWith(`limit:${512 * 1024 * 1024}:Alpha workspace`);

    for (const commandKind of ["remove", "clear"] as const) {
      const delayed = deferred<{ readonly kind: "failure"; readonly message: string }>();
      const commandPorts = createPorts({ repository: createRepository({
        ...(commandKind === "remove"
          ? { removeRoot: vi.fn(() => delayed.promise) }
          : { clearNormalCache: vi.fn(() => delayed.promise) })
      }) });
      const commandHook = renderRetention(commandPorts);
      await waitFor(() => expect(commandPorts.repository.readSnapshot).toHaveBeenCalled());
      const pendingCommand = commandKind === "remove"
        ? commandHook.result.current.removeOfflineCopy({ rootId, rootPath: root.rootPath, rootName: root.rootName, kind: root.kind })
        : commandHook.result.current.clearNormalCache();
      commandHook.unmount();
      delayed.resolve({ kind: "failure", message: "raw-retention-error-sentinel" });
      await expect(pendingCommand).resolves.toBeUndefined();
      expect(commandPorts.ui.setStatus).not.toHaveBeenCalled();
    }
  });

  it("guards wrapper effects when ownership changes between controller outcome and continuation", async () => {
    for (const commandKind of ["configure", "remove", "clear"] as const) {
      const pending = deferred<
        | { readonly kind: "success"; readonly value: RetainedSnapshot }
        | { readonly kind: "failure"; readonly message: string }
      >();
      const ports = createPorts({ repository: createRepository({
        ...(commandKind === "configure"
          ? { configureNormalCacheLimit: vi.fn(() => pending.promise) }
          : commandKind === "remove"
            ? { removeRoot: vi.fn(() => pending.promise) }
            : { clearNormalCache: vi.fn(() => pending.promise) })
      }) });
      const hook = renderRetention(ports);
      await waitFor(() => expect(ports.repository.readSnapshot).toHaveBeenCalled());
      const command = commandKind === "configure"
        ? hook.result.current.configureNormalCacheLimit(512)
        : commandKind === "remove"
          ? hook.result.current.removeOfflineCopy({ rootId, rootPath: root.rootPath, rootName: root.rootName, kind: root.kind })
          : hook.result.current.clearNormalCache();
      const resolvedSnapshot = snapshot();
      const lateSnapshot = { ...resolvedSnapshot };
      Object.defineProperty(lateSnapshot, "account", {
        enumerable: true,
        get: () => {
          queueMicrotask(() => hook.unmount());
          return resolvedSnapshot.account;
        }
      });
      const lateFailure = {
        kind: "failure" as const,
        get message() {
          queueMicrotask(() => hook.unmount());
          return "late-retention-failure";
        }
      };
      pending.resolve(commandKind === "configure"
        ? { kind: "success", value: lateSnapshot }
        : lateFailure);
      await expect(command).resolves.toBeUndefined();
      expect(ports.ui.setStatus).not.toHaveBeenCalled();
      expect(ports.ui.clearFolderCacheForPath).not.toHaveBeenCalled();
      expect(ports.ui.clearFolderAndSearchCache).not.toHaveBeenCalled();
      expect(ports.ui.clearSelectionChrome).not.toHaveBeenCalled();
    }
  });

  it("returns a superseded outcome to public helpers after a queued lifetime replacement", async () => {
    for (const outcomeKind of ["success", "failure"] as const) {
      const pending = deferred<
        | { readonly kind: "success"; readonly value: RetainedSnapshot }
        | { readonly kind: "failure"; readonly message: string }
      >();
      const ports = createPorts({ repository: createRepository({
        configureNormalCacheLimit: vi.fn(() => pending.promise)
      }) });
      const hook = renderRetention(ports);
      await waitFor(() => expect(ports.repository.readSnapshot).toHaveBeenCalled());
      const command = hook.result.current.executeSnapshotCommand({
        kind: "configureNormalCacheLimit",
        account: retentionAccount,
        limitBytes: 512
      });
      if (outcomeKind === "success") {
        const value = { ...snapshot() };
        Object.defineProperty(value, "account", {
          enumerable: true,
          get: () => {
            queueMicrotask(() => hook.unmount());
            return retentionAccount;
          }
        });
        pending.resolve({ kind: "success", value });
      } else {
        const failure = {
          kind: "failure" as const,
          get message() {
            queueMicrotask(() => hook.unmount());
            return "public-helper-late-failure";
          }
        };
        pending.resolve(failure);
      }
      await expect(command).resolves.toEqual({ kind: "superseded" });
    }
  });

  it("keeps first StrictMode lifetime reads and unmounted reads inert", async () => {
    const first = deferred<{ readonly kind: "success"; readonly value: RetainedSnapshot }>();
    let reads = 0;
    const current = snapshot({ files: [retainedFile("current.txt")], memberships: [] });
    const ports = createPorts({ repository: createRepository({
      readSnapshot: vi.fn(() => {
        reads += 1;
        return reads === 1 ? first.promise : Promise.resolve({ kind: "success" as const, value: current });
      })
    }) });
    const strict = renderHook((props) => useRetention(props), {
      initialProps: { activeAccount: account, cacheNamespace: account.cacheNamespace, accountName: account.displayName, ports },
      wrapper: StrictMode
    });
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
    first.resolve({ kind: "success", value: snapshot() });
    await act(async () => { await first.promise; });
    expect(strict.result.current.retentionSnapshot?.files.map((entry) => entry.path)).toEqual(["current.txt"]);

    const delayed = deferred<{ readonly kind: "success"; readonly value: RetainedSnapshot }>();
    const readPorts = createPorts({ repository: createRepository({ readSnapshot: vi.fn(() => delayed.promise) }) });
    const unmounted = renderRetention(readPorts);
    await waitFor(() => expect(readPorts.repository.readSnapshot).toHaveBeenCalled());
    unmounted.unmount();
    delayed.resolve({ kind: "success", value: snapshot() });
    await act(async () => { await delayed.promise; });
    expect(unmounted.result.current.retentionSnapshot).toBeUndefined();
    expect(readPorts.ui.setStatus).not.toHaveBeenCalled();
  });

  it("reports cache-limit status when the command completes for the active account", async () => {
    const ports = createPorts();
    const { result } = renderRetention(ports);
    await waitFor(() => expect(ports.repository.readSnapshot).toHaveBeenCalled());

    await act(async () => {
      await result.current.configureNormalCacheLimit(512 * 1024 * 1024);
    });

    expect(ports.repository.configureNormalCacheLimit).toHaveBeenCalledWith(retentionAccount, 512 * 1024 * 1024);
    expect(ports.ui.setStatus).toHaveBeenCalledWith(`limit:${512 * 1024 * 1024}:Alpha workspace`);
  });

  it("preserves caller operation-currentness and no-account no-op behavior", async () => {
    const ports = createPorts({
      repository: createRepository({ configureNormalCacheLimit: vi.fn() })
    });
    const { result } = renderHook((props) => useRetention(props), {
      initialProps: { activeAccount: undefined, cacheNamespace: undefined, accountName: "No account", ports }
    });
    await act(async () => {
      await result.current.configureNormalCacheLimit(512);
      await result.current.removeOfflineCopy({ rootId, rootPath: root.rootPath, rootName: root.rootName, kind: root.kind });
      await result.current.clearNormalCache();
    });
    expect(ports.repository.readSnapshot).not.toHaveBeenCalled();
    expect(ports.repository.configureNormalCacheLimit).not.toHaveBeenCalled();
    expect(ports.ui.setStatus).not.toHaveBeenCalled();

    const active = renderRetention(ports);
    await waitFor(() => expect(ports.repository.readSnapshot).toHaveBeenCalled());
    const outcome = await active.result.current.executeSnapshotCommand({ kind: "readSnapshot", account: retentionAccount }, () => false);
    expect(outcome.kind).toBe("superseded");
  });

  it("exposes retentionStillCurrent for account and namespace gating", async () => {
    const ports = createPorts();
    const { result } = renderRetention(ports);
    await waitFor(() => expect(ports.repository.readSnapshot).toHaveBeenCalled());

    expect(result.current.retentionStillCurrent(retentionAccount)).toBe(true);
    expect(result.current.retentionStillCurrent({ accountId: "beta", cacheNamespace: "ns-beta" })).toBe(false);
    expect(result.current.retentionStillCurrent(retentionAccount, () => false)).toBe(false);
  });
});
