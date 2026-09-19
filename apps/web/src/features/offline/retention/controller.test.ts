import { describe, expect, it, vi } from "vitest";

import { executeRetentionCommand } from "./controller";
import { createRetainedSnapshot, retainedRootId, type RetainedFile, type RetainedSnapshot } from "./model";
import type { RetentionRepository } from "./ports";

const account = { accountId: "alpha", cacheNamespace: "cache-alpha" };
const root = { rootPath: "Projects", rootName: "Projects", kind: "folder" as const, folderRoots: ["Projects"] };
const snapshot = (): RetainedSnapshot => createRetainedSnapshot({
  account,
  normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 },
  roots: [{ ...root, status: "incomplete", addedAt: "2026-07-18T10:00:00.000Z" }],
  files: [],
  memberships: []
});

function repository(overrides: Partial<RetentionRepository> = {}): RetentionRepository {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

describe("executeRetentionCommand", () => {
  it("starts roots and publishes the immutable resulting snapshot", async () => {
    const adapter = repository();
    const published: RetainedSnapshot[] = [];

    const result = await executeRetentionCommand({ kind: "beginRoot", account, root }, adapter, {
      isCurrent: () => true,
      publish: (next) => { published.push(next); return true; }
    });

    expect(result).toEqual({ kind: "completed", snapshot: snapshot() });
    expect(adapter.beginRoot).toHaveBeenCalledWith(account, root);
    expect(published).toHaveLength(1);
    expect(Object.isFrozen(published[0])).toBe(true);
  });

  it("routes remove and normal-clear commands through typed ports", async () => {
    const adapter = repository();
    const callbacks = { isCurrent: () => true, publish: () => true };

    await executeRetentionCommand({ kind: "removeRoot", account, rootId: retainedRootId(root) }, adapter, callbacks);
    await executeRetentionCommand({ kind: "clearNormalCache", account }, adapter, callbacks);

    expect(adapter.removeRoot).toHaveBeenCalledWith(account, retainedRootId(root));
    expect(adapter.clearNormalCache).toHaveBeenCalledWith(account);
  });

  it("returns command failures without publication", async () => {
    const adapter = repository({ removeRoot: vi.fn(async () => ({ kind: "failure" as const, message: "storage unavailable" })) });
    const publish = vi.fn(() => true);

    const result = await executeRetentionCommand({ kind: "removeRoot", account, rootId: retainedRootId(root) }, adapter, { isCurrent: () => true, publish });

    expect(result).toEqual({ kind: "failed", message: "storage unavailable" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("is inert when superseded before a command", async () => {
    const adapter = repository();
    const result = await executeRetentionCommand({ kind: "readSnapshot", account }, adapter, { isCurrent: () => false, publish: () => true });

    expect(result).toEqual({ kind: "superseded" });
    expect(adapter.readSnapshot).not.toHaveBeenCalled();
  });

  it("makes an awaited command result inert after supersession", async () => {
    let current = true;
    const pending = deferred<{ readonly kind: "success"; readonly value: RetainedSnapshot }>();
    const adapter = repository({ readSnapshot: vi.fn(() => pending.promise) });
    const publish = vi.fn(() => true);
    const execution = executeRetentionCommand({ kind: "readSnapshot", account }, adapter, { isCurrent: () => current, publish });
    current = false;
    pending.resolve({ kind: "success", value: snapshot() });

    expect(await execution).toEqual({ kind: "superseded" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("treats rejected publication as supersession", async () => {
    const adapter = repository();
    const result = await executeRetentionCommand({ kind: "readSnapshot", account }, adapter, { isCurrent: () => true, publish: () => false });

    expect(result).toEqual({ kind: "superseded" });
  });

  it("returns superseded when ownership changes during publication", async () => {
    let current = true;
    const result = await executeRetentionCommand({ kind: "readSnapshot", account }, repository(), {
      isCurrent: () => current,
      publish: () => {
        current = false;
        return true;
      }
    });

    expect(result).toEqual({ kind: "superseded" });
  });

  it("returns the typed preview and binary payload from the repository boundary", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const file: RetainedFile = {
      path: "Projects/a.txt", name: "a.txt", mimeType: "text/plain", size: 5, blobSize: 5, readable: true, normalCacheOwnership: "owned",
      preview: { path: "Projects/a.txt", name: "a.txt", isFolder: false, viewer: "text" as const, content: "hello", encoding: "utf8" as const, truncated: false, bytesRead: 5 }
    };
    const adapter = repository({ readPreview: vi.fn(async () => ({ kind: "success" as const, value: { file, blob } })) });

    const result = await executeRetentionCommand({ kind: "readPreview", account, path: file.path }, adapter, { isCurrent: () => true, publish: () => true });

    expect(result).toEqual({ kind: "completed", preview: { file, blob } });
  });
});
