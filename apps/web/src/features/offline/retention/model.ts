import type { FileEntry, FilePreview, SearchResult } from "@davora/shared";
import { basename, parseNormalizedPath } from "@davora/shared";

export type RetainedRootKind = "file" | "folder" | "batch";
export type RetainedRootStatus = "incomplete" | "complete";
export type NormalCacheOwnership = "none" | "owned";

export interface RetentionAccount {
  readonly accountId: string;
  readonly cacheNamespace: string;
}

export interface RetainedRootInput {
  readonly rootPath: string;
  readonly rootName: string;
  readonly kind: RetainedRootKind;
  readonly folderRoots: readonly string[];
}

export interface RetainedRoot extends RetainedRootInput {
  readonly id: string;
  readonly status: RetainedRootStatus;
  readonly addedAt: string;
}

export interface RetainedFile {
  readonly path: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly preview?: FilePreview;
  /** Physical stored bytes, independently of whether a current blob is readable. */
  readonly blobSize: number;
  readonly readable: boolean;
  readonly normalCacheOwnership: NormalCacheOwnership;
  readonly cachedAt?: string;
  readonly lastAccessedAt?: string;
}

export interface NormalCacheSummary {
  readonly itemCount: number;
  readonly totalBytes: number;
  readonly limitBytes: number;
}

export interface RetainedMembership {
  readonly rootId: string;
  readonly filePath: string;
}

export interface RetainedSnapshot {
  readonly account: RetentionAccount;
  readonly normalCache: NormalCacheSummary;
  readonly roots: readonly RetainedRoot[];
  readonly files: readonly RetainedFile[];
  readonly memberships: readonly RetainedMembership[];
}

export interface RetainedSnapshotInput {
  readonly account: RetentionAccount;
  readonly normalCache: NormalCacheSummary;
  readonly roots: readonly (RetainedRootInput & { readonly status: RetainedRootStatus; readonly addedAt: string })[];
  readonly files: readonly RetainedFile[];
  readonly memberships: readonly RetainedMembership[];
}

export interface RetainedRootSummary {
  readonly rootId: string;
  readonly rootPath: string;
  readonly rootName: string;
  readonly kind: RetainedRootKind;
  readonly status: RetainedRootStatus;
  readonly fileCount: number;
  readonly readableFileCount: number;
  readonly totalBytes: number;
  readonly available: boolean;
  readonly addedAt: string;
}

function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

function freezeArray<T>(items: readonly T[]): readonly T[] {
  return Object.freeze([...items]);
}

function snapshotRoot(input: RetainedRootInput & { readonly status: RetainedRootStatus; readonly addedAt: string }): RetainedRoot {
  const rootPath = normalizePath(input.rootPath);
  const kind = input.kind;
  return Object.freeze({
    id: retainedRootId({ ...input, rootPath }),
    rootPath,
    rootName: input.rootName,
    kind,
    folderRoots: freezeArray(input.folderRoots.map(normalizePath).filter(Boolean)),
    status: input.status,
    addedAt: input.addedAt
  });
}

function snapshotFile(input: RetainedFile): RetainedFile {
  return Object.freeze({
    path: normalizePath(input.path),
    name: input.name,
    mimeType: input.mimeType,
    size: input.size,
    ...(input.preview === undefined ? {} : { preview: Object.freeze({ ...input.preview }) }),
    blobSize: input.blobSize,
    readable: input.readable,
    normalCacheOwnership: input.normalCacheOwnership,
    ...(input.cachedAt === undefined ? {} : { cachedAt: input.cachedAt }),
    ...(input.lastAccessedAt === undefined ? {} : { lastAccessedAt: input.lastAccessedAt })
  });
}

/** Opaque, stable identity; callers never use a root path as ownership identity. */
export function retainedRootId(input: Pick<RetainedRootInput, "kind" | "rootPath">): string {
  return `retained-root:${encodeURIComponent(input.kind)}:${encodeURIComponent(normalizePath(input.rootPath))}`;
}

/**
 * Canonical synthetic path for a batch root. JSON array encoding keeps each
 * normalized member unambiguous, unlike delimiter-joined path strings.
 */
export function retainedBatchRootPath(paths: readonly string[]): string {
  return JSON.stringify([...new Set(paths.map(normalizePath).filter(Boolean))].sort());
}

export function createRetainedSnapshot(input: RetainedSnapshotInput): RetainedSnapshot {
  const roots = [...new Map(input.roots.map((root) => {
    const snapshot = snapshotRoot(root);
    return [snapshot.id, snapshot] as const;
  })).values()].sort((left, right) => left.id.localeCompare(right.id));
  const rootIds = new Set(roots.map((root) => root.id));
  const files = input.files.map(snapshotFile).sort((left, right) => left.path.localeCompare(right.path));
  const filePaths = new Set(files.map((file) => file.path));
  const memberships = [...new Map(input.memberships
    .map((membership) => ({ rootId: membership.rootId, filePath: normalizePath(membership.filePath) }))
    .filter((membership) => rootIds.has(membership.rootId) && filePaths.has(membership.filePath))
    .map((membership) => [`${membership.rootId}\u0000${membership.filePath}`, Object.freeze(membership)] as const)).values()]
    .sort((left, right) => left.rootId.localeCompare(right.rootId) || left.filePath.localeCompare(right.filePath));

  return Object.freeze({
    account: Object.freeze({ accountId: input.account.accountId, cacheNamespace: input.account.cacheNamespace }),
    normalCache: Object.freeze({
      itemCount: input.normalCache.itemCount,
      totalBytes: input.normalCache.totalBytes,
      limitBytes: input.normalCache.limitBytes
    }),
    roots: freezeArray(roots),
    files: freezeArray(files),
    memberships: freezeArray(memberships)
  });
}

function readableFilesByPath(snapshot: RetainedSnapshot): Map<string, RetainedFile> {
  const memberPaths = new Set(snapshot.memberships.map((membership) => membership.filePath));
  return new Map(snapshot.files
    .filter((file) => memberPaths.has(file.path) && file.readable)
    .map((file) => [file.path, file]));
}

export function selectReadableRetainedFiles(snapshot: RetainedSnapshot): readonly RetainedFile[] {
  return freezeArray([...readableFilesByPath(snapshot).values()].sort((left, right) => left.path.localeCompare(right.path)));
}

export function selectRequiredOfflineAncestors(snapshot: RetainedSnapshot): readonly string[] {
  const ancestors = new Set<string>();
  for (const file of selectReadableRetainedFiles(snapshot)) {
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      ancestors.add(parts.slice(0, index).join("/"));
    }
  }
  return freezeArray([...ancestors].sort((left, right) => left.localeCompare(right)));
}

function memberPathsForRoot(snapshot: RetainedSnapshot, rootId: string): readonly string[] {
  return freezeArray(snapshot.memberships
    .filter((membership) => membership.rootId === rootId)
    .map((membership) => membership.filePath)
    .sort((left, right) => left.localeCompare(right)));
}

function rootAvailable(snapshot: RetainedSnapshot, root: RetainedRoot): boolean {
  const paths = memberPathsForRoot(snapshot, root.id);
  const readable = readableFilesByPath(snapshot);
  return root.status === "complete" && paths.length > 0 && paths.every((path) => readable.has(path));
}

export function selectRetainedRootSummaries(snapshot: RetainedSnapshot): readonly RetainedRootSummary[] {
  const readable = readableFilesByPath(snapshot);
  return freezeArray(snapshot.roots
    .map((root) => {
      const memberPaths = memberPathsForRoot(snapshot, root.id);
      return Object.freeze({
        rootId: root.id,
        rootPath: root.rootPath,
        rootName: root.rootName,
        kind: root.kind,
        status: root.status,
        fileCount: memberPaths.length,
        readableFileCount: memberPaths.filter((path) => readable.has(path)).length,
        totalBytes: memberPaths.reduce((total, path) => total + (snapshot.files.find((file) => file.path === path)?.blobSize ?? 0), 0),
        available: rootAvailable(snapshot, root),
        addedAt: root.addedAt
      });
    })
    .sort((left, right) => Date.parse(right.addedAt) - Date.parse(left.addedAt) || left.rootId.localeCompare(right.rootId)));
}

export function selectFolderOfflineAvailability(snapshot: RetainedSnapshot, folderPath: string): boolean {
  const normalizedFolderPath = normalizePath(folderPath);
  return snapshot.roots.some((root) => root.kind === "folder" && root.rootPath === normalizedFolderPath && rootAvailable(snapshot, root));
}

export type RetainedReadiness = "available" | "incomplete" | "missing" | "empty";
export type RetainedRecovery =
  | { readonly kind: "recoverable"; readonly account: RetentionAccount; readonly rootId: string; readonly entries: readonly FileEntry[] }
  | { readonly kind: "unavailable"; readonly reason: "missing-root" | "invalid-selection" };

export function selectRetainedReadiness(snapshot: RetainedSnapshot): readonly (RetainedRootSummary & { readonly readiness: RetainedReadiness })[] {
  return selectRetainedRootSummaries(snapshot).map((root) => ({
    ...root,
    readiness: root.available ? "available" : root.status === "incomplete" ? "incomplete" : root.fileCount === 0 ? "empty" : "missing"
  }));
}

export function selectRetainedStorageBytes(snapshot: RetainedSnapshot): number {
  const memberPaths = new Set(snapshot.memberships.map((member) => member.filePath));
  const files = new Map(snapshot.files.map((file) => [file.path, file]));
  return [...memberPaths].reduce((total, path) => total + (files.get(path)?.blobSize ?? 0), 0);
}

export function selectRetainedRecovery(snapshot: RetainedSnapshot, rootId: string): RetainedRecovery {
  const root = snapshot.roots.find((item) => item.id === rootId);
  if (!root) return { kind: "unavailable", reason: "missing-root" };
  try {
    let paths: string[];
    if (root.kind === "batch") {
      const decoded: unknown = JSON.parse(root.rootPath);
      if (!Array.isArray(decoded) || decoded.length < 2 || !decoded.every((path): path is string => typeof path === "string" && path.length > 0 && parseNormalizedPath(path) === path)) {
        return { kind: "unavailable", reason: "invalid-selection" };
      }
      paths = decoded;
      if (retainedBatchRootPath(paths) !== root.rootPath || root.folderRoots.some((path) => !paths.includes(path))) {
        return { kind: "unavailable", reason: "invalid-selection" };
      }
    } else {
      if (parseNormalizedPath(root.rootPath) !== root.rootPath || (!root.rootPath && root.kind === "file")) {
        return { kind: "unavailable", reason: "invalid-selection" };
      }
      paths = [root.rootPath];
    }
    return {
      kind: "recoverable", account: snapshot.account, rootId,
      entries: paths.map((path) => ({ path, name: basename(path) || root.rootName, isFolder: root.kind === "folder" || (root.kind === "batch" && root.folderRoots.includes(path)) }))
    };
  } catch {
    return { kind: "unavailable", reason: "invalid-selection" };
  }
}

function toOfflineFileEntry(entry: RetainedFile): FileEntry {
  return {
    path: entry.path,
    name: entry.preview?.name || entry.name,
    isFolder: false,
    size: entry.preview?.size ?? entry.size,
    mimeType: entry.preview?.mimeType ?? entry.mimeType,
    lastModified: entry.preview?.lastModified,
    etag: entry.preview?.etag
  };
}

function addFolderAndAncestors(folders: Map<string, FileEntry>, filePath: string): void {
  const segments = normalizePath(filePath).split("/").filter(Boolean);
  for (let index = 0; index < segments.length - 1; index += 1) {
    const path = segments.slice(0, index + 1).join("/");
    folders.set(path, { path, name: segments[index], isFolder: true });
  }
}

function buildOfflineTree(entries: readonly RetainedFile[]): { files: FileEntry[]; folders: FileEntry[] } {
  const folders = new Map<string, FileEntry>();
  const files = entries.map((entry) => {
    addFolderAndAncestors(folders, entry.path);
    return toOfflineFileEntry(entry);
  });
  return { files, folders: [...folders.values()] };
}

function isDirectChild(path: string, parentPath: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedParent = normalizePath(parentPath);
  const relative = normalizedParent ? normalizedPath.slice(normalizedParent.length + 1) : normalizedPath;
  return normalizedPath !== normalizedParent
    && (!normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`))
    && relative.length > 0
    && !relative.includes("/");
}

/** Projects readable retained files into the virtual folder tree exposed in explicit offline mode. */
export function buildOfflineFolderItems(entries: readonly RetainedFile[], path: string): FileEntry[] {
  const tree = buildOfflineTree(entries.filter((entry) => entry.readable));
  return [...tree.folders, ...tree.files]
    .filter((entry) => isDirectChild(entry.path, path))
    .sort((left, right) => Number(right.isFolder) - Number(left.isFolder) || left.name.localeCompare(right.name));
}

/** Projects readable retained files into the virtual search tree exposed in explicit offline mode. */
export function buildOfflineSearchResults(entries: readonly RetainedFile[], path: string, query: string): SearchResult[] {
  const normalizedPath = normalizePath(path);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return [];
  }
  const tree = buildOfflineTree(entries.filter((entry) => entry.readable));
  return [...tree.folders, ...tree.files]
    .filter((entry) => {
      const entryPath = normalizePath(entry.path);
      const inScope = !normalizedPath || entryPath === normalizedPath || entryPath.startsWith(`${normalizedPath}/`);
      return inScope && entry.name.toLocaleLowerCase().includes(normalizedQuery);
    })
    .map((entry) => ({ ...entry, score: entry.name.toLocaleLowerCase() === normalizedQuery ? 2 : 1 }))
    .sort((left, right) => right.score - left.score || Number(right.isFolder) - Number(left.isFolder) || left.path.localeCompare(right.path));
}
