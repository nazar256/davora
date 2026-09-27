import { Blob as NodeBlob } from "node:buffer";

import { del, get, set } from "idb-keyval";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const storageFaults = vi.hoisted(() => ({ failSet: false, failDelMany: false }));
vi.mock("idb-keyval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb-keyval")>();
  return {
    ...actual,
    set: async (...args: Parameters<typeof actual.set>) => {
      if (storageFaults.failSet) throw new Error("injected migration failure");
      return actual.set(...args);
    },
    delMany: async (...args: Parameters<typeof actual.delMany>) => {
      if (storageFaults.failDelMany) throw new Error("injected delete failure");
      return actual.delMany(...args);
    }
  };
});

import {
  DEFAULT_OPENED_FILE_CACHE_LIMIT,
  createOpenedFileRepository,
  decodeOpenedFileKey,
  openedFileBlobKey,
  openedFileDerivativeKey,
  openedFileIndexKey,
  type RetentionResultShape,
  type RetentionSnapshotShape
} from "./openedFileRepository";

const account = { accountId: "alpha", cacheNamespace: "alpha" };
const otherAccount = { accountId: "beta", cacheNamespace: "beta" };
const indexKey = openedFileIndexKey;
const blobKey = openedFileBlobKey;
const derivativeKey = openedFileDerivativeKey;
const legacyIndexKey = (namespace: string) => `davora-opened-file:index:${namespace}`;
const legacyBlobKey = (namespace: string, path: string) => `davora-opened-file:${namespace}:${path}:blob`;
const repository = createOpenedFileRepository();

const file = (path: string, blob?: Blob) => ({ path, name: path.split("/").at(-1)!, mimeType: "text/plain", size: blob?.size ?? 0, preview: { path, name: path.split("/").at(-1)!, isFolder: false, mimeType: "text/plain", viewer: "text" as const, content: "", encoding: "utf8" as const, truncated: false, bytesRead: 0 }, blobSize: blob?.size ?? 0, readable: false, normalCacheOwnership: "none" as const });
const root = (rootPath: string, kind: "file" | "folder" | "batch" = "folder") => ({ rootPath, rootName: rootPath, kind, folderRoots: [] });

async function success<T>(result: RetentionResultShape<T>): Promise<T> {
  if (result.kind === "failure") throw new Error(result.message);
  return result.value;
}

function requiredRootId(snapshot: RetentionSnapshotShape, rootPath?: string): string {
  const root = rootPath === undefined ? snapshot.roots[0] : snapshot.roots.find((entry) => entry.rootPath === rootPath);
  if (!root) throw new Error(`Expected retained root${rootPath === undefined ? "" : ` ${rootPath}`}.`);
  return root.id;
}

beforeAll(() => {
  vi.stubGlobal("Blob", NodeBlob);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  storageFaults.failSet = false;
  storageFaults.failDelMany = false;
  await Promise.all([
    del(indexKey("alpha")), del(indexKey("beta")), del(indexKey("fresh")), del(indexKey("alpha:beta")), del(indexKey("alpha-extra")),
    del(legacyIndexKey("alpha")), del(legacyIndexKey("beta")), del(legacyIndexKey("fresh")), del(legacyIndexKey("alpha:beta")), del(legacyIndexKey("alpha-extra"))
  ]);
  await Promise.all([
    del(blobKey("alpha", "one.txt")), del(blobKey("alpha", "shared.txt")), del(blobKey("alpha", "preview.txt")), del(blobKey("alpha", "secret.txt")), del(blobKey("alpha", "malformed.txt")), del(blobKey("beta", "one.txt")),
    del(blobKey("alpha:beta", "foo.txt")), del(blobKey("alpha-extra", "colon:path.txt")),
    del(derivativeKey("alpha", "photo.heic")), del(derivativeKey("beta", "photo.heic")), del(derivativeKey("alpha", "one.heic")), del(derivativeKey("alpha", "two.heic")),
    del(legacyBlobKey("alpha", "one.txt")), del(legacyBlobKey("alpha", "shared.txt")), del(legacyBlobKey("alpha", "preview.txt")), del(legacyBlobKey("alpha", "secret.txt")), del(legacyBlobKey("alpha", "malformed.txt")), del(legacyBlobKey("beta", "one.txt")), del(legacyBlobKey("alpha", "beta:foo.txt"))
  ]);
});

describe("opened-file repository", () => {
  it("migrates valid legacy facts once and isolates malformed siblings", async () => {
    await set(legacyIndexKey("alpha"), { limitBytes: 1024 * 1024, entries: {
      valid: { path: "one.txt", preview: file("one.txt").preview, mimeType: "text/plain", filename: "one.txt", blobSize: 3, cachedAt: "2026-01-01T00:00:00.000Z", lastAccessedAt: "2026-01-01T00:00:00.000Z", keepOffline: true, keepOfflineRoot: "folder", keepOfflineRootName: "folder", keepOfflineRootKind: "folder", keepOfflineFolderRoots: [], keepOfflineRootComplete: true, keepOfflineAddedAt: "2026-01-01T00:00:00.000Z" },
      malformed: { path: 3 }
    } });
    await set(legacyBlobKey("alpha", "one.txt"), new Blob(["one"]));

    const snapshot = await success(await repository.readSnapshot(account));
    expect(snapshot.roots).toHaveLength(1);
    expect(snapshot.files.map((entry) => entry.path)).toEqual(["one.txt"]);
    expect(snapshot.memberships).toHaveLength(1);
    expect(await get(indexKey("alpha"))).toMatchObject({ version: 2 });
  });

  it("migrates the prior colon-key V2 index with retained memberships and blobs", async () => {
    const started = await success(await repository.beginRoot(account, root("kept")));
    const rootId = requiredRootId(started);
    const blob = new Blob(["retained"]);
    const current = await get<{ readonly limitBytes: number }>(indexKey(account.cacheNamespace));
    if (!current) throw new Error("expected current V2 index");
    await del(indexKey(account.cacheNamespace));
    await set(legacyIndexKey(account.cacheNamespace), {
      version: 2,
      limitBytes: current.limitBytes,
      files: { "kept.txt": { ...file("kept.txt", blob), normalCacheOwnership: "none", blobSize: blob.size } },
      roots: { [rootId]: { id: rootId, rootPath: "kept", rootName: "kept", kind: "folder", folderRoots: [], status: "complete", addedAt: "2026-01-01T00:00:00.000Z" } },
      memberships: { "kept.txt": [rootId] }
    });
    await set(legacyBlobKey(account.cacheNamespace, "kept.txt"), blob);

    const snapshot = await success(await repository.readSnapshot(account));

    expect(snapshot.files).toContainEqual(expect.objectContaining({ path: "kept.txt", readable: true, normalCacheOwnership: "none" }));
    expect(snapshot.memberships).toEqual([{ rootId, filePath: "kept.txt" }]);
    expect(await get(indexKey(account.cacheNamespace))).toMatchObject({ version: 2 });
    expect(await get(blobKey(account.cacheNamespace, "kept.txt"))).toEqual(blob);
  });

  it("replaces corrupt top-level indexes with an empty V2 index", async () => {
    await set(indexKey("alpha"), { version: 2, files: "bad" });
    expect((await success(await repository.readSnapshot(account))).files).toEqual([]);
    expect(await get(indexKey("alpha"))).toMatchObject({ version: 2, files: {} });
  });

  it("drops malformed preview records while preserving valid V2 siblings", async () => {
    const valid = file("one.txt");
    const malformed = { ...file("preview.txt"), preview: { path: "preview.txt" } };
    await set(indexKey("alpha"), { version: 2, limitBytes: 1024 * 1024, files: { valid, malformed }, roots: {}, memberships: {} });

    const snapshot = await success(await repository.readSnapshot(account));
    expect(snapshot.files.map((entry) => entry.path)).toEqual(["one.txt"]);
    expect((await get<{ files: Record<string, unknown> }>(indexKey("alpha")))?.files).toHaveProperty("one.txt");
    expect((await get<{ files: Record<string, unknown> }>(indexKey("alpha")))?.files).not.toHaveProperty("preview.txt");
  });

  it("ignores a malformed derivative descriptor without dropping its source record", async () => {
    const valid = { ...file("one.txt"), sourceRevision: "source-1", derivative: { sourceRevision: 3 } };
    await set(indexKey("alpha"), { version: 2, limitBytes: 1024 * 1024, files: { valid }, roots: {}, memberships: {} });

    const snapshot = await success(await repository.readSnapshot(account));

    expect(snapshot.files.map((entry) => entry.path)).toEqual(["one.txt"]);
    expect((await get<{ files: Record<string, { derivative?: unknown }> }>(indexKey("alpha")))?.files["one.txt"]?.derivative).toBeUndefined();
  });

  it("uses the injective encoded root identity while migrating legacy facts", async () => {
    await set(legacyIndexKey("alpha"), { limitBytes: 1024 * 1024, entries: {
      valid: { path: "one.txt", preview: file("one.txt").preview, mimeType: "text/plain", filename: "one.txt", blobSize: 0, cachedAt: "2026-01-01T00:00:00.000Z", lastAccessedAt: "2026-01-01T00:00:00.000Z", keepOffline: true, keepOfflineRoot: "folder/a:b", keepOfflineRootName: "a:b", keepOfflineRootKind: "folder", keepOfflineFolderRoots: [] }
    } });

    const snapshot = await success(await repository.readSnapshot(account));
    expect(snapshot.roots[0]?.id).toBe("retained-root:folder:folder%2Fa%3Ab");
  });

  it("drops V2 roots whose stored identity does not canonically identify their kind and path", async () => {
    await set(indexKey("alpha"), {
      version: 2,
      limitBytes: 1024 * 1024,
      files: { "secret.txt": { ...file("secret.txt"), blobSize: 6 } },
      roots: {
        forged: {
          id: "forged",
          rootPath: "folder/a:b",
          rootName: "a:b",
          kind: "folder",
          folderRoots: [],
          status: "complete",
          addedAt: "2026-01-01T00:00:00.000Z"
        }
      },
      memberships: { "secret.txt": ["forged"] }
    });
    await set(blobKey("alpha", "secret.txt"), new Blob(["secret"]));

    const snapshot = await success(await repository.readSnapshot(account));

    expect(snapshot.roots).toEqual([]);
    expect(snapshot.memberships).toEqual([]);
    expect(snapshot.normalCache).toMatchObject({ itemCount: 0, totalBytes: 0 });
    expect((await get<{ roots: Record<string, unknown>; memberships: Record<string, unknown> }>(indexKey("alpha")))?.roots).toEqual({});
    expect((await get<{ roots: Record<string, unknown>; memberships: Record<string, unknown> }>(indexKey("alpha")))?.memberships).toEqual({});
    await success(await repository.clearNormalCache(account));
    expect(await get(blobKey("alpha", "secret.txt"))).toBeUndefined();
  });

  it("uses only canonical keys when deleting an unowned file", async () => {
    const rootId = "retained-root:file:root";
    await set(indexKey("alpha"), { version: 2, limitBytes: 1024 * 1024, files: { "secret.txt": { path: "secret.txt", name: "secret.txt", mimeType: "text/plain", size: 6, blobSize: 6, normalCacheOwnership: "none" } }, roots: { [rootId]: { id: rootId, rootPath: "root", rootName: "root", kind: "file", folderRoots: [], status: "incomplete", addedAt: "2026-01-01T00:00:00.000Z" } }, memberships: { "secret.txt": [rootId] } });
    await set("untrusted-blob-key", new Blob(["keep"]));
    await set(blobKey("alpha", "secret.txt"), new Blob(["delete"]));
    await success(await repository.removeRoot(account, rootId));
    expect(await get("untrusted-blob-key")).toBeDefined();
    expect(await get(blobKey("alpha", "secret.txt"))).toBeUndefined();
  });

  it("preserves an overlapping blob until its final root membership is removed", async () => {
    const first = await success(await repository.beginRoot(account, root("A")));
    const second = await success(await repository.beginRoot(account, root("B")));
    const firstRoot = requiredRootId(first);
    const secondRoot = requiredRootId(second, "B");
    const blob = new Blob(["shared"]);
    await success(await repository.persistRetainedFile(account, { rootId: firstRoot, file: file("shared.txt", blob), blob }));
    await success(await repository.persistRetainedFile(account, { rootId: secondRoot, file: file("shared.txt", blob), blob }));
    const overlapping = await success(await repository.readSnapshot(account));
    expect(overlapping.memberships).toHaveLength(2);
    expect(overlapping.files[0]?.blobSize).toBe(blob.size);
    await success(await repository.removeRoot(account, firstRoot));
    expect((await success(await repository.readSnapshot(account))).files.map((entry) => entry.path)).toEqual(["shared.txt"]);
    await success(await repository.removeRoot(account, secondRoot));
    expect((await success(await repository.readSnapshot(account))).files).toEqual([]);
    expect(await get(blobKey("alpha", "shared.txt"))).toBeUndefined();
  });

  it("keeps dual preview and retention ownership after root removal, then clears it normally", async () => {
    const started = await success(await repository.beginRoot(account, root("A")));
    const rootId = requiredRootId(started);
    const blob = new Blob(["preview"]);
    await success(await repository.writePreview(account, { file: file("preview.txt", blob), blob }));
    await success(await repository.persistRetainedFile(account, { rootId, file: file("preview.txt", blob), blob }));
    await success(await repository.removeRoot(account, rootId));
    expect((await success(await repository.readPreview(account, "preview.txt")))?.file.readable).toBe(true);
    await success(await repository.clearNormalCache(account));
    expect(await success(await repository.readPreview(account, "preview.txt"))).toBeUndefined();
  });

  it("replaces an ordinary preview blob with metadata-only preview state", async () => {
    const blob = new Blob(["old preview"]);
    await success(await repository.writePreview(account, { file: file("preview.txt", blob), blob }));

    const snapshot = await success(await repository.writePreview(account, { file: file("preview.txt") }));

    expect(await get(blobKey("alpha", "preview.txt"))).toBeUndefined();
    expect(snapshot.files).toContainEqual(expect.objectContaining({ path: "preview.txt", blobSize: 0, readable: false }));
    expect((await success(await repository.readPreview(account, "preview.txt")))?.blob).toBeUndefined();
  });

  it("keeps metadata-only normal previews addressable through replacement and normal cache clearing", async () => {
    const freshAccount = { accountId: "fresh", cacheNamespace: "fresh" };
    const markdownFile = (content: string) => ({
      ...file("notes.md"),
      mimeType: "text/markdown",
      preview: { ...file("notes.md").preview, mimeType: "text/markdown", viewer: "markdown" as const, content }
    });

    const initial = await success(await repository.writePreview(freshAccount, { file: markdownFile("first metadata") }));
    expect(initial.files).toContainEqual(expect.objectContaining({ path: "notes.md", blobSize: 0, readable: false, normalCacheOwnership: "owned" }));
    expect(initial.normalCache).toMatchObject({ itemCount: 1, totalBytes: 0 });
    const metadataOnlyPreview = await success(await repository.readPreview(freshAccount, "notes.md"));
    expect(metadataOnlyPreview?.file.preview?.content).toBe("first metadata");
    expect(metadataOnlyPreview?.blob).toBeUndefined();

    const binary = new Blob(["binary markdown"]);
    await success(await repository.writePreview(freshAccount, { file: markdownFile("binary metadata"), blob: binary }));
    const replaced = await success(await repository.writePreview(freshAccount, { file: markdownFile("replacement metadata") }));
    expect(await get(blobKey("fresh", "notes.md"))).toBeUndefined();
    const replacedFile = replaced.files.find((entry) => entry.path === "notes.md");
    expect(replacedFile).toMatchObject({ path: "notes.md", blobSize: 0, readable: false });
    expect(replacedFile?.preview?.content).toBe("replacement metadata");
    const replacementPreview = await success(await repository.readPreview(freshAccount, "notes.md"));
    expect(replacementPreview?.file.preview?.content).toBe("replacement metadata");
    expect(replacementPreview?.blob).toBeUndefined();

    await success(await repository.clearNormalCache(freshAccount));
    expect(await success(await repository.readPreview(freshAccount, "notes.md"))).toBeUndefined();
  });

  it("preserves a retained blob when a preview update has no binary payload", async () => {
    const started = await success(await repository.beginRoot(account, root("A")));
    const rootId = requiredRootId(started);
    const blob = new Blob(["retained"]);
    await success(await repository.persistRetainedFile(account, { rootId, file: file("preview.txt", blob), blob }));

    const metadataUpdate = { ...file("preview.txt"), preview: { ...file("preview.txt").preview, content: "retained metadata update" } };
    const snapshot = await success(await repository.writePreview(account, { file: metadataUpdate }));

    expect(await get(blobKey("alpha", "preview.txt"))).toBeInstanceOf(Blob);
    const updatedFile = snapshot.files.find((entry) => entry.path === "preview.txt");
    expect(updatedFile).toMatchObject({ path: "preview.txt", blobSize: blob.size, readable: true, normalCacheOwnership: "owned" });
    expect(updatedFile?.preview?.content).toBe("retained metadata update");
    const preview = await success(await repository.readPreview(account, "preview.txt"));
    expect(preview?.file.preview?.content).toBe("retained metadata update");
    expect(preview?.blob).toBeInstanceOf(Blob);
  });

  it("stores the retained-original variant for a member file and the payload variant for plain cache", async () => {
    const heicPreview = { path: "photo.heic", name: "photo.heic", isFolder: false as const, mimeType: "image/heic", viewer: "image" as const, content: "", encoding: "none" as const, truncated: false, bytesRead: 0, size: 4, requiresOriginalBlob: true };
    const retainedBlob = new Blob(["heic"], { type: "image/heic" });
    const derivedBlob = new Blob(["jpeg"], { type: "image/jpeg" });
    const freshBlob = new Blob(["heic2"], { type: "image/heic" });
    const started = await success(await repository.beginRoot(account, root("photo.heic", "file")));
    await success(await repository.persistRetainedFile(account, { rootId: requiredRootId(started), file: { ...file("photo.heic", retainedBlob), mimeType: "image/heic", preview: heicPreview }, blob: retainedBlob }));
    await success(await repository.writePreview(otherAccount, { file: { ...file("photo.heic", retainedBlob), mimeType: "image/heic", preview: heicPreview }, blob: retainedBlob }));

    const write = {
      file: { path: "photo.heic", name: "photo.heic.jpg", mimeType: "image/jpeg", size: 4, preview: { ...heicPreview, etag: "v2" }, blobSize: derivedBlob.size, readable: true, normalCacheOwnership: "owned" as const },
      blob: derivedBlob,
      retainedOriginal: {
        file: { path: "photo.heic", name: "photo.heic", mimeType: "image/heic", size: freshBlob.size, preview: { ...heicPreview, etag: "v2" }, blobSize: freshBlob.size, readable: true, normalCacheOwnership: "owned" as const },
        blob: freshBlob
      }
    };

    const retained = await success(await repository.writePreview(account, write));
    const retainedFile = retained.files.find((entry) => entry.path === "photo.heic");
    expect(retainedFile).toMatchObject({ name: "photo.heic", mimeType: "image/heic", size: freshBlob.size, blobSize: freshBlob.size, readable: true });
    expect(retainedFile?.preview?.etag).toBe("v2");
    expect(await get(blobKey("alpha", "photo.heic"))).toEqual(freshBlob);
    expect(retained.memberships).toHaveLength(1);

    const cached = await success(await repository.writePreview(otherAccount, write));
    const cachedFile = cached.files.find((entry) => entry.path === "photo.heic");
    expect(cachedFile).toMatchObject({ name: "photo.heic.jpg", mimeType: "image/jpeg", blobSize: derivedBlob.size });
    expect(await get(blobKey("beta", "photo.heic"))).toEqual(derivedBlob);
  });

  it("persists a retained HEIC derivative across repository instances and counts it in normal cache", async () => {
    const heicPreview = { path: "photo.heic", name: "photo.heic", isFolder: false as const, mimeType: "image/heic", viewer: "image" as const, content: "", encoding: "none" as const, truncated: false, bytesRead: 0, size: 4, requiresOriginalBlob: true };
    const original = new Blob(["heic"], { type: "image/heic" });
    const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
    const started = await success(await repository.beginRoot(account, root("photo.heic", "file")));
    await success(await repository.persistRetainedFile(account, {
      rootId: requiredRootId(started),
      file: { ...file("photo.heic", original), mimeType: "image/heic", preview: heicPreview },
      blob: original
    }));
    const initial = await success(await repository.readPreview(account, "photo.heic"));
    if (!initial?.sourceRevision) throw new Error("Expected retained HEIC revision.");

    const written = await success(await repository.writePreviewDerivative(account, {
      path: "photo.heic",
      expectedSourceRevision: initial.sourceRevision,
      blob: jpeg,
      mimeType: "image/jpeg",
      filename: "photo.heic.jpg"
    }));

    expect(written.normalCache).toMatchObject({ itemCount: 1, totalBytes: jpeg.size });
    expect(await get(derivativeKey("alpha", "photo.heic"))).toEqual(jpeg);
    const reopened = await success(await createOpenedFileRepository().readPreview(account, "photo.heic"));
    expect(reopened?.blob).toEqual(original);
    expect(reopened?.derivative).toMatchObject({ blob: jpeg, mimeType: "image/jpeg", filename: "photo.heic.jpg" });

    const cleared = await success(await repository.clearNormalCache(account));
    expect(cleared.normalCache).toMatchObject({ itemCount: 0, totalBytes: 0 });
    expect(await get(derivativeKey("alpha", "photo.heic"))).toBeUndefined();
    expect((await success(await repository.readPreview(account, "photo.heic")))?.blob).toEqual(original);
  });

  it("rejects a stale derivative and promotes a current derivative when the final retained root is removed", async () => {
    const original = new Blob(["heic"], { type: "image/heic" });
    const refreshed = new Blob(["heic2"], { type: "image/heic" });
    const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
    const started = await success(await repository.beginRoot(account, root("photo.heic", "file")));
    const rootId = requiredRootId(started);
    await success(await repository.persistRetainedFile(account, { rootId, file: { ...file("photo.heic", original), mimeType: "image/heic" }, blob: original }));
    const first = await success(await repository.readPreview(account, "photo.heic"));
    if (!first?.sourceRevision) throw new Error("Expected retained HEIC revision.");
    await success(await repository.persistRetainedFile(account, { rootId, file: { ...file("photo.heic", refreshed), mimeType: "image/heic" }, blob: refreshed }));

    const stale = await repository.writePreviewDerivative(account, {
      path: "photo.heic",
      expectedSourceRevision: first.sourceRevision,
      blob: jpeg,
      mimeType: "image/jpeg",
      filename: "photo.heic.jpg"
    });
    expect(stale).toMatchObject({ kind: "failure" });

    const current = await success(await repository.readPreview(account, "photo.heic"));
    if (!current?.sourceRevision) throw new Error("Expected refreshed HEIC revision.");
    await success(await repository.writePreviewDerivative(account, {
      path: "photo.heic",
      expectedSourceRevision: current.sourceRevision,
      blob: jpeg,
      mimeType: "image/jpeg",
      filename: "photo.heic.jpg"
    }));
    const removed = await success(await repository.removeRoot(account, rootId));
    expect(removed.memberships).toEqual([]);
    expect(removed.files).toContainEqual(expect.objectContaining({ path: "photo.heic", name: "photo.heic.jpg", mimeType: "image/jpeg", normalCacheOwnership: "owned" }));
    expect((await success(await repository.readPreview(account, "photo.heic")))?.blob).toEqual(jpeg);
    expect(await get(derivativeKey("alpha", "photo.heic"))).toBeUndefined();
  });

  it("evicts retained derivatives by the normal cache quota without evicting their originals", async () => {
    const payload = new Blob([new Uint8Array(Math.floor(1024 * 1024 * 0.6))], { type: "image/jpeg" });
    const originals = ["one.heic", "two.heic"] as const;
    for (const path of originals) {
      const original = new Blob([path], { type: "image/heic" });
      const started = await success(await repository.beginRoot(account, root(path, "file")));
      await success(await repository.persistRetainedFile(account, { rootId: requiredRootId(started, path), file: { ...file(path, original), mimeType: "image/heic" }, blob: original }));
      const stored = await success(await repository.readPreview(account, path));
      if (!stored?.sourceRevision) throw new Error("Expected retained source revision.");
      await success(await repository.writePreviewDerivative(account, { path, expectedSourceRevision: stored.sourceRevision, blob: payload, mimeType: "image/jpeg", filename: `${path}.jpg` }));
    }

    const limited = await success(await repository.configureNormalCacheLimit(account, 1024 * 1024));

    expect(limited.normalCache).toEqual({ itemCount: 1, totalBytes: payload.size, limitBytes: 1024 * 1024 });
    for (const path of originals) expect((await success(await repository.readPreview(account, path)))?.blob).toBeInstanceOf(Blob);
    const derivativeCount = (await Promise.all(originals.map((path) => get(derivativeKey("alpha", path))))).filter((value) => value instanceof Blob).length;
    expect(derivativeCount).toBe(1);
  });

  it("ignores a retained-original variant whose path does not match the payload", async () => {
    const blob = new Blob(["image"], { type: "image/png" });
    const started = await success(await repository.beginRoot(account, root("other.png", "file")));
    await success(await repository.persistRetainedFile(account, { rootId: requiredRootId(started), file: file("other.png", blob), blob }));

    await success(await repository.writePreview(account, {
      file: { ...file("other.png"), mimeType: "image/jpeg", name: "other.png.jpg" },
      blob: new Blob(["jpeg"], { type: "image/jpeg" }),
      retainedOriginal: { file: file("unrelated.png", blob), blob }
    }));

    const stored = await success(await repository.readPreview(account, "other.png"));
    expect(stored?.file).toMatchObject({ name: "other.png.jpg", mimeType: "image/jpeg" });
    expect(stored?.blob).toEqual(new Blob(["jpeg"], { type: "image/jpeg" }));
    expect(await success(await repository.readPreview(account, "unrelated.png"))).toBeUndefined();
  });

  it("never treats a non-Blob persisted payload as readable or returns it as binary", async () => {
    await set(indexKey("alpha"), { version: 2, limitBytes: 1024 * 1024, files: { "malformed.txt": { ...file("malformed.txt"), blobSize: 7 } }, roots: {}, memberships: {} });
    await set(blobKey("alpha", "malformed.txt"), { size: 7 });

    const snapshot = await success(await repository.readSnapshot(account));
    const preview = await success(await repository.readPreview(account, "malformed.txt"));

    expect(snapshot.files).toContainEqual(expect.objectContaining({ path: "malformed.txt", readable: false }));
    expect(preview?.file.readable).toBe(false);
    expect(preview?.blob).toBeUndefined();
  });

  it("uses the exported configured default cache limit for a new namespace", async () => {
    const snapshot = await success(await repository.readSnapshot({ accountId: "fresh", cacheNamespace: "fresh" }));
    expect(snapshot.normalCache.limitBytes).toBe(Math.min(8 * 1024 * 1024 * 1024, Math.max(1024 * 1024, Math.round(DEFAULT_OPENED_FILE_CACHE_LIMIT))));
  });

  it("reports missing blobs as metadata-only and keeps same-root writes idempotent", async () => {
    const started = await success(await repository.beginRoot(account, root("A")));
    const rootId = requiredRootId(started);
    await success(await repository.persistRetainedFile(account, { rootId, file: file("one.txt") }));
    await success(await repository.persistRetainedFile(account, { rootId, file: file("one.txt") }));
    const snapshot = await success(await repository.completeRoot(account, rootId));
    expect(snapshot.memberships).toHaveLength(1);
    expect(snapshot.files[0]?.readable).toBe(false);
  });

  it("keeps retained files through normal cache clear and isolates namespaces", async () => {
    const started = await success(await repository.beginRoot(account, root("A")));
    const retainedBlob = new Blob(["one"]);
    const previewBlob = new Blob(["other"]);
    await success(await repository.persistRetainedFile(account, { rootId: requiredRootId(started), file: file("one.txt", retainedBlob), blob: retainedBlob }));
    await success(await repository.writePreview(otherAccount, { file: file("one.txt", previewBlob), blob: previewBlob }));
    await success(await repository.clearNormalCache(account));
    expect((await success(await repository.readSnapshot(account))).files).toHaveLength(1);
    expect((await success(await repository.readPreview(otherAccount, "one.txt")))?.file.readable).toBe(true);
  });

  it("enforces LRU only for normal-owned, non-retained blobs", async () => {
    const payload = new Blob([new Uint8Array(Math.floor(1024 * 1024 * 0.6))]);
    const started = await success(await repository.beginRoot(account, root("A")));
    await success(await repository.persistRetainedFile(account, { rootId: requiredRootId(started), file: file("shared.txt", payload), blob: payload }));
    await success(await repository.writePreview(account, { file: file("one.txt", payload), blob: payload }));
    await success(await repository.writePreview(account, { file: file("preview.txt", payload), blob: payload }));
    await success(await repository.configureNormalCacheLimit(account, 1024 * 1024));

    const index = await get<{ files: Record<string, unknown>; memberships: Record<string, string[]> }>(indexKey("alpha"));
    expect(index?.files["shared.txt"]).toBeDefined();
    expect(index?.memberships["shared.txt"]).toHaveLength(1);
    expect(Object.keys(index?.files ?? {})).toHaveLength(2);
    const snapshot = await success(await repository.readSnapshot(account));
    expect(snapshot.normalCache).toEqual({ itemCount: 1, totalBytes: payload.size, limitBytes: 1024 * 1024 });
  });

  it("uses an injective V2 codec for namespaces and colon-bearing paths", async () => {
    const alphaColonPath = "beta:foo.txt";
    const alphaBeta = { accountId: "alpha-beta", cacheNamespace: "alpha:beta" };
    const alphaExtra = { accountId: "alpha-extra", cacheNamespace: "alpha-extra" };
    const alphaBlob = new Blob(["alpha"]);
    const betaBlob = new Blob(["beta"]);
    const extraBlob = new Blob(["extra"]);

    await success(await repository.writePreview(account, { file: file(alphaColonPath, alphaBlob), blob: alphaBlob }));
    await success(await repository.writePreview(alphaBeta, { file: file("foo.txt", betaBlob), blob: betaBlob }));
    await success(await repository.writePreview(alphaExtra, { file: file("colon:path.txt", extraBlob), blob: extraBlob }));

    expect(openedFileBlobKey("alpha", alphaColonPath)).not.toBe(openedFileBlobKey("alpha:beta", "foo.txt"));
    expect(openedFileDerivativeKey("alpha", alphaColonPath)).not.toBe(openedFileDerivativeKey("alpha:beta", "foo.txt"));
    expect(decodeOpenedFileKey(openedFileDerivativeKey("alpha", alphaColonPath))).toEqual({ kind: "derived", cacheNamespace: "alpha", path: alphaColonPath });
    expect(await success(await repository.readPreview(account, alphaColonPath))).toMatchObject({ blob: alphaBlob });
    expect(await success(await repository.readPreview(alphaBeta, "foo.txt"))).toMatchObject({ blob: betaBlob });
    expect(await success(await repository.readPreview(alphaExtra, "colon:path.txt"))).toMatchObject({ blob: extraBlob });

    await success(await repository.purgeAccountNamespace(account));
    expect(await get(openedFileIndexKey("alpha"))).toBeUndefined();
    expect(await get(openedFileBlobKey("alpha", alphaColonPath))).toBeUndefined();
    expect(await get(openedFileIndexKey("alpha:beta"))).toBeDefined();
    expect(await get(openedFileBlobKey("alpha:beta", "foo.txt"))).toEqual(betaBlob);
    expect(await get(openedFileIndexKey("alpha-extra"))).toBeDefined();
    expect(await get(openedFileBlobKey("alpha-extra", "colon:path.txt"))).toEqual(extraBlob);
  });

  it("fails closed for malformed V2 keys and never deletes them during purge", async () => {
    const malformed = "davora-opened-file:v2:blob:5:alpha4:one";
    const value = new Blob(["must remain"]);
    await set(malformed, value);

    expect(decodeOpenedFileKey(malformed)).toBeUndefined();
    await success(await repository.purgeAccountNamespace(account));
    expect(await get(malformed)).toEqual(value);
  });

  it("copies an ambiguous legacy blob for every valid namespace without removing legacy data on load", async () => {
    const alphaPath = "beta:foo.txt";
    const betaAccount = { accountId: "alpha-beta", cacheNamespace: "alpha:beta" };
    const legacyEntry = (path: string) => ({
      path,
      preview: file(path).preview,
      mimeType: "text/plain",
      filename: path.split("/").at(-1),
      blobSize: 5,
      cachedAt: "2026-01-01T00:00:00.000Z",
      lastAccessedAt: "2026-01-01T00:00:00.000Z"
    });
    const sharedLegacyBlob = new Blob(["shared"]);
    await set(legacyIndexKey(account.cacheNamespace), { limitBytes: 1024 * 1024, entries: { alpha: legacyEntry(alphaPath) } });
    await set(legacyIndexKey(betaAccount.cacheNamespace), { limitBytes: 1024 * 1024, entries: { beta: legacyEntry("foo.txt") } });
    await set(legacyBlobKey(account.cacheNamespace, alphaPath), sharedLegacyBlob);

    await success(await repository.readSnapshot(account));
    await success(await repository.readSnapshot(betaAccount));

    expect(await get(openedFileBlobKey(account.cacheNamespace, alphaPath))).toEqual(sharedLegacyBlob);
    expect(await get(openedFileBlobKey(betaAccount.cacheNamespace, "foo.txt"))).toEqual(sharedLegacyBlob);
    expect(await get(legacyBlobKey(account.cacheNamespace, alphaPath))).toEqual(sharedLegacyBlob);
    expect(await get(legacyIndexKey(account.cacheNamespace))).toBeDefined();
    expect(await get(legacyIndexKey(betaAccount.cacheNamespace))).toBeDefined();
  });

  it("reports migration persistence failure without deleting legacy data", async () => {
    await set(legacyIndexKey(account.cacheNamespace), { limitBytes: 1024 * 1024, entries: {
      valid: { path: "one.txt", preview: file("one.txt").preview, mimeType: "text/plain", filename: "one.txt", blobSize: 3, cachedAt: "2026-01-01T00:00:00.000Z", lastAccessedAt: "2026-01-01T00:00:00.000Z" }
    } });
    await set(legacyBlobKey(account.cacheNamespace, "one.txt"), new Blob(["one"]));
    storageFaults.failSet = true;

    const result = await repository.readSnapshot(account);

    storageFaults.failSet = false;
    expect(result).toMatchObject({ kind: "failure" });
    expect(await get(legacyIndexKey(account.cacheNamespace))).toBeDefined();
    expect(await get(legacyBlobKey(account.cacheNamespace, "one.txt"))).toBeDefined();
    expect(await get(openedFileBlobKey(account.cacheNamespace, "one.txt"))).toBeUndefined();
  });

  it("reports V2 deletion failure without claiming namespace purge", async () => {
    const blob = new Blob(["private"]);
    await success(await repository.writePreview(account, { file: file("one.txt", blob), blob }));
    storageFaults.failDelMany = true;

    const result = await repository.purgeAccountNamespace(account);

    storageFaults.failDelMany = false;
    expect(result).toMatchObject({ kind: "failure" });
    expect(await get(openedFileIndexKey(account.cacheNamespace))).toBeDefined();
    expect(await get(openedFileBlobKey(account.cacheNamespace, "one.txt"))).toBeDefined();

    storageFaults.failDelMany = false;
    expect((await repository.purgeAccountNamespace(account)).kind).toBe("success");
    expect((await repository.purgeAccountNamespace(account)).kind).toBe("success");
  });

  it("uses supplied namespaces to migrate known B data without inferring malformed legacy ownership", async () => {
    const beta = { accountId: "alpha-beta", cacheNamespace: "alpha:beta" };
    const alphaBlob = new Blob(["alpha"]);
    const betaBlob = new Blob(["healthy-beta"]);
    await set(legacyIndexKey(account.cacheNamespace), { limitBytes: 1024 * 1024, entries: {
      alpha: { path: "beta:foo.txt", preview: file("beta:foo.txt").preview, mimeType: "text/plain", filename: "beta:foo.txt", blobSize: alphaBlob.size, cachedAt: "2026-01-01T00:00:00.000Z", lastAccessedAt: "2026-01-01T00:00:00.000Z" }
    } });
    await set(legacyBlobKey(account.cacheNamespace, "beta:foo.txt"), alphaBlob);
    await success(await repository.writePreview(beta, { file: file("foo.txt", betaBlob), blob: betaBlob }));
    await set(legacyIndexKey(beta.cacheNamespace), { corrupt: true });

    await success(await repository.purgeAccountNamespace(account, [account, beta]));

    expect(await get(indexKey(account.cacheNamespace))).toBeUndefined();
    expect(await get(blobKey(account.cacheNamespace, "beta:foo.txt"))).toBeUndefined();
    expect(await get(indexKey(beta.cacheNamespace))).toBeDefined();
    expect(await get(blobKey(beta.cacheNamespace, "foo.txt"))).toEqual(betaBlob);
    expect(await get(legacyIndexKey(beta.cacheNamespace))).toBeUndefined();
  });
});
