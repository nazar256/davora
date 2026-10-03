import { describe, expect, it } from "vitest";
import { createRetainedSnapshot, retainedBatchRootPath, retainedRootId, selectRetainedReadiness, selectRetainedRecovery, selectRetainedStorageBytes, type RetainedRootInput } from "./model";

const account = { accountId: "alpha", cacheNamespace: "alpha-cache" };
const root: RetainedRootInput = { rootPath: "Docs", rootName: "Docs", kind: "folder", folderRoots: ["Docs"] };
const file = (path: string, readable = true) => ({ path, name: path, mimeType: "text/plain", size: 3, blobSize: 3, readable, normalCacheOwnership: "none" as const });
function snapshot(input: RetainedRootInput = root, status: "complete" | "incomplete" = "incomplete", readable = true) {
  return createRetainedSnapshot({ account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 100 }, roots: [{ ...input, status, addedAt: "today" }], files: [file("Docs/a.txt", readable)], memberships: [{ rootId: retainedRootId(input), filePath: "Docs/a.txt" }] });
}

describe("retained readiness and original selection", () => {
  it.each([
    ["incomplete", true, "incomplete"], ["complete", false, "missing"], ["complete", true, "available"]
  ] as const)("preserves %s state when readable=%s", (status, readable, expected) => {
    expect(selectRetainedReadiness(snapshot(root, status, readable))[0]).toMatchObject({ readiness: expected, readableFileCount: Number(readable), fileCount: 1 });
  });
  it("keeps empty complete roots neutral", () => {
    const value = snapshot(root, "complete");
    expect(selectRetainedReadiness({ ...value, files: [], memberships: [] })[0]).toMatchObject({ readiness: "empty", fileCount: 0 });
  });
  it.each([root, { rootPath: "notes.txt", rootName: "notes.txt", kind: "file" as const, folderRoots: [] }])("recovers single original $kind", (input) => {
    expect(selectRetainedRecovery(snapshot(input), retainedRootId(input))).toEqual({ kind: "recoverable", account, rootId: retainedRootId(input), entries: [{ path: input.rootPath, name: input.rootName, isFolder: input.kind === "folder" }] });
  });
  it("recovers every selected batch source even when only one child was saved", () => {
    const batch = { rootPath: retainedBatchRootPath(["Docs", "missing.txt"]), rootName: "2 items", kind: "batch" as const, folderRoots: ["Docs"] };
    expect(selectRetainedRecovery(snapshot(batch), retainedRootId(batch))).toMatchObject({ kind: "recoverable", entries: [{ path: "Docs", name: "Docs", isFolder: true }, { path: "missing.txt", name: "missing.txt", isFolder: false }] });
  });
  it.each(['old|encoding', '["a","a"]', '["b","a"]', '["/a"]', '["a/../b"]', '[]', '[1]', '["a"]'])("rejects ambiguous batch %s", (rootPath) => {
    const batch = { rootPath, rootName: "Old batch", kind: "batch" as const, folderRoots: ["Docs"] };
    expect(selectRetainedRecovery(snapshot(batch), retainedRootId(batch))).toEqual({ kind: "unavailable", reason: "invalid-selection" });
  });
  it("does not recover deleted roots", () => {
    expect(selectRetainedRecovery(snapshot(), "gone")).toEqual({ kind: "unavailable", reason: "missing-root" });
  });
  it("rejects a one-source batch rather than creating a different root identity", () => {
    const batch = { rootPath: '["Docs"]', rootName: "Old batch", kind: "batch" as const, folderRoots: ["Docs"] };
    expect(selectRetainedRecovery(snapshot(batch), retainedRootId(batch))).toEqual({ kind: "unavailable", reason: "invalid-selection" });
  });
  it("counts retained originals once across overlapping roots, excluding normal-only files", () => {
    const value = snapshot();
    expect(selectRetainedStorageBytes({ ...value, files: [...value.files, file("normal.txt")], memberships: [...value.memberships, { rootId: "overlap", filePath: "Docs/a.txt" }] })).toBe(3);
  });
});
