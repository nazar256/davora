import { describe, expect, it, vi } from "vitest";

import { OperationContextToken } from "../../../operations/policy";
import {
  buildOfflineSyncLifecycleKey,
  projectOfflineSyncConfirmStage,
  resolveOfflineSyncArchiveInput
} from "./model";

describe("offline sync workspace model", () => {
  it("preserves supplied archives and derives immutable browse/search identity", () => {
    const supplied = { roots: [], archiveLabel: "supplied" } as const;
    expect(resolveOfflineSyncArchiveInput({
      entries: [{ path: "Docs/a.txt", name: "a.txt", isFolder: false }],
      archive: supplied,
      context: { currentPath: "Docs", folderLabel: "Docs", searchActive: false }
    })).toBe(supplied);
    expect(resolveOfflineSyncArchiveInput({
      entries: [{ path: "Docs/a.txt", name: "a.txt", isFolder: false }],
      context: { currentPath: "Docs", folderLabel: "Docs", searchActive: false }
    })).toEqual({ roots: [{ entry: { path: "Docs/a.txt", name: "a.txt", isFolder: false }, archiveRoot: "a.txt" }], archiveLabel: "docs" });
    expect(resolveOfflineSyncArchiveInput({
      entries: [{ path: "Docs/a.txt", name: "a.txt", isFolder: false }],
      context: { currentPath: "Other", folderLabel: "Other", searchActive: true }
    })).toEqual({ roots: [{ entry: { path: "Docs/a.txt", name: "a.txt", isFolder: false }, archiveRoot: "Docs/a.txt" }], archiveLabel: "search-results" });
  });

  it("changes lifecycle identity for every invalidating context dimension", () => {
    const base = { accountId: "alpha", accountName: "Alpha", cacheNamespace: "ns-a", token: "t", sessionRevision: 1, currentPath: "Docs", folderLabel: "Docs", searchActive: false, cacheOnlyMode: false, browserOffline: false } as const;
    expect(buildOfflineSyncLifecycleKey(base)).not.toBe(buildOfflineSyncLifecycleKey({ ...base, currentPath: "Other" }));
    expect(buildOfflineSyncLifecycleKey(base)).not.toBe(buildOfflineSyncLifecycleKey({ ...base, accountId: "beta" }));
    expect(buildOfflineSyncLifecycleKey(base)).not.toBe(buildOfflineSyncLifecycleKey({ ...base, cacheNamespace: "ns-b" }));
    expect(buildOfflineSyncLifecycleKey(base)).not.toBe(buildOfflineSyncLifecycleKey({ ...base, sessionRevision: 2 }));
    expect(buildOfflineSyncLifecycleKey(base)).not.toBe(buildOfflineSyncLifecycleKey({ ...base, browserOffline: true }));
  });

  it("projects direct Stage commands and labels for every dialog phase", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const stage = projectOfflineSyncConfirmStage({
      busy: false,
      canStart: true,
      formatStorageBytes: (value) => `${value} bytes`,
      onClose,
      onConfirm,
      dialog: {
        context: OperationContextToken.create(),
        entries: [{ path: "Docs", name: "Docs", isFolder: true }],
        archiveInput: { roots: [], archiveLabel: "docs" },
        phase: "ready",
        plan: { files: [{ sourcePath: "Docs/a.txt" }], totalBytes: 12 }
      }
    });
    expect(stage).toMatchObject({ open: true, busy: false, estimating: false, includesFolders: true, filesLabel: "1", storageLabel: "12 bytes", selectionLabel: "Docs" });
    stage.onClose();
    stage.onConfirm();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
