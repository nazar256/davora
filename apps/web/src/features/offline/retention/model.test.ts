import { describe, expect, it } from "vitest";

import {
  createRetainedSnapshot,
  retainedBatchRootPath,
  retainedRootId,
  selectReadableRetainedFiles,
  selectRequiredOfflineAncestors,
  selectRetainedRootSummaries,
  selectFolderOfflineAvailability,
  buildOfflineFolderItems,
  buildOfflineSearchResults,
  type RetainedRootInput
} from "./model";
import type { FilePreview } from "@davora/shared";

const root = (overrides: Partial<RetainedRootInput> = {}): RetainedRootInput => ({
  rootPath: "Projects",
  rootName: "Projects",
  kind: "folder",
  folderRoots: ["Projects"],
  ...overrides
});

describe("retention model", () => {
  const readableFile = (path: string) => {
    const name = path.split("/").pop() ?? path;
    return {
      path,
      name,
      mimeType: "text/plain",
      size: name.length,
      blobSize: name.length,
      readable: true,
      normalCacheOwnership: "none" as const,
      preview: { path, name, isFolder: false as const, mimeType: "text/plain", viewer: "text" as const, content: name, encoding: "utf8" as const, truncated: false, bytesRead: name.length, size: name.length }
    };
  };

  it("projects only readable files and required folder ancestors", () => {
    const entries = [readableFile("Documents/trips/2026/photo.jpg"), readableFile("Documents/notes.txt"), readableFile("Music/song.m4a"), { ...readableFile("Online-only.txt"), readable: false }];

    expect(buildOfflineFolderItems(entries, "")).toEqual([
      expect.objectContaining({ path: "Documents", name: "Documents", isFolder: true }),
      expect.objectContaining({ path: "Music", name: "Music", isFolder: true })
    ]);
    expect(buildOfflineFolderItems(entries, "Documents")).toEqual([
      expect.objectContaining({ path: "Documents/trips", name: "trips", isFolder: true }),
      expect.objectContaining({ path: "Documents/notes.txt", name: "notes.txt", isFolder: false })
    ]);
    expect(buildOfflineSearchResults(entries, "Documents", "trips")).toEqual([
      expect.objectContaining({ path: "Documents/trips", isFolder: true })
    ]);
    expect(buildOfflineSearchResults(entries, "", "online")).toEqual([]);
  });

  it("derives injective batch root paths independently of order and duplicates", () => {
    const first = retainedBatchRootPath(["Archive", "/Projects/", "Archive"]);
    const reordered = retainedBatchRootPath(["Projects", "Archive"]);
    const delimiterCollisionLeft = retainedBatchRootPath(["folder|file", "other"]);
    const delimiterCollisionRight = retainedBatchRootPath(["folder", "file|other"]);

    expect(first).toBe(reordered);
    expect(delimiterCollisionLeft).not.toBe(delimiterCollisionRight);
  });

  it("derives injective deterministic identities for file, folder, and batch roots", () => {
    const file = retainedRootId(root({ kind: "file", rootPath: "/notes.txt/", rootName: "notes.txt", folderRoots: [] }));
    const folder = retainedRootId(root());
    const batch = retainedRootId(root({ kind: "batch", rootPath: "batch:Projects|Archive", rootName: "Selected files", folderRoots: ["Projects", "Archive"] }));

    expect(file).toBe(retainedRootId(root({ kind: "file", rootPath: "notes.txt", rootName: "renamed", folderRoots: [] })));
    expect(new Set([file, folder, batch])).toHaveLength(3);
    expect(folder).toBe("retained-root:folder:Projects");
    expect(retainedRootId(root({ kind: "file", rootPath: "a:b", folderRoots: [] }))).not.toBe(
      retainedRootId(root({ kind: "batch", rootPath: "a/b", folderRoots: [] }))
    );
  });

  it("models overlapping memberships, partial roots, readable files, required ancestors, and complete folder availability", () => {
    const projects = root();
    const archive = root({ rootPath: "Archive", rootName: "Archive", folderRoots: ["Archive"] });
    const snapshot = createRetainedSnapshot({
      account: { accountId: "alpha", cacheNamespace: "cache-alpha" },
      normalCache: { itemCount: 1, totalBytes: 8, limitBytes: 24 },
      roots: [
        { ...projects, status: "complete", addedAt: "2026-07-18T10:00:00.000Z" },
        { ...archive, status: "incomplete", addedAt: "2026-07-18T10:01:00.000Z" }
      ],
      files: [
        { path: "Projects/a.txt", name: "a.txt", mimeType: "text/plain", size: 4, blobSize: 4, readable: true, normalCacheOwnership: "none" },
        { path: "Archive/missing.txt", name: "missing.txt", mimeType: "text/plain", size: 8, blobSize: 8, readable: false, normalCacheOwnership: "owned" }
      ],
      memberships: [
        { rootId: retainedRootId(projects), filePath: "Projects/a.txt" },
        { rootId: retainedRootId(archive), filePath: "Projects/a.txt" },
        { rootId: retainedRootId(archive), filePath: "Archive/missing.txt" }
      ]
    });

    expect(selectRetainedRootSummaries(snapshot)).toEqual([
      expect.objectContaining({ rootId: retainedRootId(archive), status: "incomplete", fileCount: 2, readableFileCount: 1, totalBytes: 12, available: false }),
      expect.objectContaining({ rootId: retainedRootId(projects), status: "complete", fileCount: 1, readableFileCount: 1, totalBytes: 4, available: true })
    ]);
    expect(selectReadableRetainedFiles(snapshot).map((file) => file.path)).toEqual(["Projects/a.txt"]);
    expect(selectRequiredOfflineAncestors(snapshot)).toEqual(["Projects"]);
    expect(selectFolderOfflineAvailability(snapshot, "Projects")).toBe(true);
    expect(selectFolderOfflineAvailability(snapshot, "Archive")).toBe(false);
  });

  it("deeply snapshots inputs and removes duplicate memberships deterministically", () => {
    const mutableRoot: { rootPath: string; rootName: string; kind: RetainedRootInput["kind"]; folderRoots: string[] } = {
      rootPath: "Projects",
      rootName: "Projects",
      kind: "folder",
      folderRoots: ["Projects"]
    };
    const source = {
      account: { accountId: "alpha", cacheNamespace: "cache-alpha" },
      normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 },
      roots: [{ ...mutableRoot, status: "incomplete", addedAt: "2026-07-18T10:00:00.000Z" }],
      files: [{ path: "Projects/a.txt", name: "a.txt", mimeType: "text/plain", size: 4, blobSize: 0, readable: false, normalCacheOwnership: "none" }],
      memberships: [{ rootId: retainedRootId(root()), filePath: "Projects/a.txt" }, { rootId: retainedRootId(root()), filePath: "Projects/a.txt" }]
    } satisfies Parameters<typeof createRetainedSnapshot>[0];
    const snapshot = createRetainedSnapshot(source);
    mutableRoot.folderRoots.push("late");
    source.files[0].name = "changed";

    expect(snapshot.roots[0]).toMatchObject({ folderRoots: ["Projects"] });
    expect(snapshot.files[0]).toMatchObject({ name: "a.txt" });
    expect(snapshot.memberships).toHaveLength(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.roots)).toBe(true);
    expect(Object.isFrozen(snapshot.roots[0].folderRoots)).toBe(true);
    expect(Object.isFrozen(snapshot.files[0])).toBe(true);
    expect(Object.isFrozen(snapshot.normalCache)).toBe(true);
  });

  it("makes repeated begin facts for the same normalized root idempotent", () => {
    const snapshot = createRetainedSnapshot({
      account: { accountId: "alpha", cacheNamespace: "cache-alpha" },
      normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 },
      roots: [
        { ...root(), status: "incomplete", addedAt: "2026-07-18T10:00:00.000Z" },
        { ...root({ rootPath: "/Projects/" }), status: "complete", addedAt: "2026-07-18T10:01:00.000Z" }
      ],
      files: [],
      memberships: []
    });

    expect(snapshot.roots).toEqual([expect.objectContaining({ id: retainedRootId(root()), status: "complete" })]);
  });

  it("preserves typed preview facts and immutable normal-cache accounting", () => {
    const preview: FilePreview = {
      path: "Projects/a.txt", name: "a.txt", isFolder: false, viewer: "text", content: "hello", encoding: "utf8",
      truncated: false, bytesRead: 5
    };
    const snapshot = createRetainedSnapshot({
      account: { accountId: "alpha", cacheNamespace: "cache-alpha" },
      normalCache: { itemCount: 2, totalBytes: 9, limitBytes: 24 },
      roots: [],
      files: [{ path: "Projects/a.txt", name: "a.txt", mimeType: "text/plain", size: 5, blobSize: 5, readable: true, preview, normalCacheOwnership: "owned" }],
      memberships: []
    });
    preview.content = "changed";

    expect(snapshot.normalCache).toEqual({ itemCount: 2, totalBytes: 9, limitBytes: 24 });
    expect(snapshot.files[0].preview).toMatchObject({ viewer: "text", content: "hello" });
    expect(Object.isFrozen(snapshot.normalCache)).toBe(true);
  });
});
