import { del, delMany, get, keys, set, setMany } from "idb-keyval";

import type { FilePreview } from "@davora/shared";

const CACHE_PREFIX = "davora-opened-file:";
const V2_INDEX_PREFIX = "davora-opened-file:v2:index:";
const V2_BLOB_PREFIX = "davora-opened-file:v2:blob:";
const V2_DERIVATIVE_PREFIX = "davora-opened-file:v2:derived:";
const LEGACY_INDEX_PREFIX = "davora-opened-file:index:";
const VERSION = 2;
const envLimit = Number.parseInt(text(isRecord(import.meta.env) ? import.meta.env.VITE_OPENED_FILE_CACHE_LIMIT_BYTES : undefined) ?? "", 10);
export const MIN_OPENED_FILE_CACHE_LIMIT = 1024 * 1024;
export const MAX_OPENED_FILE_CACHE_LIMIT = 8 * 1024 * 1024 * 1024;
export const DEFAULT_OPENED_FILE_CACHE_LIMIT = Number.isFinite(envLimit) && envLimit > 0 ? envLimit : 24 * 1024 * 1024;

type RootKind = "file" | "folder" | "batch";
type RootStatus = "incomplete" | "complete";
type NormalCacheOwnership = "none" | "owned";

export interface RetentionAccountShape {
  readonly accountId: string;
  readonly cacheNamespace: string;
}

export interface RetainedRootInputShape {
  readonly rootPath: string;
  readonly rootName: string;
  readonly kind: RootKind;
  readonly folderRoots: readonly string[];
}

export interface RetainedFileShape {
  readonly path: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly preview?: FilePreview;
  readonly blobSize: number;
  readonly readable: boolean;
  readonly normalCacheOwnership: NormalCacheOwnership;
  readonly cachedAt?: string;
  readonly lastAccessedAt?: string;
}

export interface RetentionSnapshotShape {
  readonly account: RetentionAccountShape;
  readonly normalCache: { readonly itemCount: number; readonly totalBytes: number; readonly limitBytes: number };
  readonly roots: readonly (RetainedRootInputShape & { readonly id: string; readonly status: RootStatus; readonly addedAt: string })[];
  readonly files: readonly RetainedFileShape[];
  readonly memberships: readonly { readonly rootId: string; readonly filePath: string }[];
}

export type RetentionResultShape<T> =
  | { readonly kind: "success"; readonly value: T }
  | { readonly kind: "failure"; readonly message: string };

interface StoredFile {
  path: string;
  name: string;
  mimeType: string;
  size: number;
  preview?: FilePreview;
  blobSize: number;
  normalCacheOwnership: NormalCacheOwnership;
  cachedAt?: string;
  lastAccessedAt?: string;
  sourceRevision?: string;
  derivative?: StoredDerivative;
}

interface StoredDerivative {
  sourceRevision: string;
  mimeType: string;
  filename: string;
  blobSize: number;
  cachedAt: string;
  lastAccessedAt: string;
}

interface StoredRoot {
  id: string;
  rootPath: string;
  rootName: string;
  kind: RootKind;
  folderRoots: string[];
  status: RootStatus;
  addedAt: string;
}

interface StoredIndex {
  readonly version: typeof VERSION;
  limitBytes: number;
  files: Record<string, StoredFile>;
  roots: Record<string, StoredRoot>;
  memberships: Record<string, string[]>;
}

interface LegacyEntry {
  readonly path: string;
  readonly preview: FilePreview;
  readonly mimeType: string;
  readonly filename: string;
  readonly blobSize: number;
  readonly cachedAt: string;
  readonly lastAccessedAt: string;
  readonly keepOffline?: boolean;
  readonly keepOfflineRoot?: string;
  readonly keepOfflineRootName?: string;
  readonly keepOfflineRootKind?: RootKind;
  readonly keepOfflineFolderRoots?: string[];
  readonly keepOfflineRootComplete?: boolean;
  readonly keepOfflineAddedAt?: string;
}

export interface OpenedFilePreviewWrite {
  readonly file: RetainedFileShape;
  readonly blob?: Blob;
  /**
   * Original-bytes variant stored instead of `file`/`blob` when the record
   * still belongs to a retained root, so a preview refresh can never replace
   * a kept-offline file's true bytes with derived preview material.
   */
  readonly retainedOriginal?: {
    readonly file: RetainedFileShape;
    readonly blob: Blob;
  };
}

export interface OpenedFileRepository {
  readonly defaultCacheLimitBytes?: number;
  readSnapshot(account: RetentionAccountShape): Promise<RetentionResultShape<RetentionSnapshotShape>>;
  readPreview(account: RetentionAccountShape, path: string): Promise<RetentionResultShape<{
    readonly file: RetainedFileShape;
    readonly blob?: Blob;
    readonly sourceRevision?: string;
    readonly derivative?: { readonly blob: Blob; readonly mimeType: string; readonly filename: string };
  } | undefined>>;
  writePreview(account: RetentionAccountShape, input: OpenedFilePreviewWrite): Promise<RetentionResultShape<RetentionSnapshotShape>>;
  writePreviewDerivative(account: RetentionAccountShape, input: {
    readonly path: string;
    readonly expectedSourceRevision: string;
    readonly blob: Blob;
    readonly mimeType: string;
    readonly filename: string;
  }): Promise<RetentionResultShape<RetentionSnapshotShape>>;
  beginRoot(account: RetentionAccountShape, root: RetainedRootInputShape): Promise<RetentionResultShape<RetentionSnapshotShape>>;
  persistRetainedFile(account: RetentionAccountShape, input: { readonly rootId: string; readonly file: RetainedFileShape; readonly blob?: Blob }): Promise<RetentionResultShape<RetentionSnapshotShape>>;
  completeRoot(account: RetentionAccountShape, rootId: string): Promise<RetentionResultShape<RetentionSnapshotShape>>;
  removeRoot(account: RetentionAccountShape, rootId: string): Promise<RetentionResultShape<RetentionSnapshotShape>>;
  clearNormalCache(account: RetentionAccountShape): Promise<RetentionResultShape<RetentionSnapshotShape>>;
  purgeAccountNamespace(account: RetentionAccountShape, knownAccounts?: readonly RetentionAccountShape[]): Promise<RetentionResultShape<RetentionSnapshotShape>>;
  configureNormalCacheLimit(account: RetentionAccountShape, limitBytes: number): Promise<RetentionResultShape<RetentionSnapshotShape>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function iso(value: unknown): string | undefined {
  const candidate = text(value);
  return candidate !== undefined && Number.isFinite(Date.parse(candidate)) ? candidate : undefined;
}

function normalizedPath(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function validPath(value: unknown): string | undefined {
  const candidate = text(value);
  const normalized = candidate === undefined ? undefined : normalizedPath(candidate);
  return normalized ? normalized : undefined;
}

function optionalText(value: unknown): string | undefined {
  return value === undefined ? undefined : text(value);
}

function optionalNonnegativeNumber(value: unknown): number | undefined {
  return value === undefined ? undefined : finiteNumber(value);
}

function validViewer(value: unknown): FilePreview["viewer"] | undefined {
  return value === "text" || value === "markdown" || value === "image" || value === "audio" || value === "video" || value === "pdf" || value === "unsupported" ? value : undefined;
}

function validPreview(value: unknown, expectedPath?: string): FilePreview | undefined {
  if (!isRecord(value)) return undefined;
  const path = validPath(value.path);
  const name = text(value.name);
  const isFolder = typeof value.isFolder === "boolean" ? value.isFolder : undefined;
  const viewer = validViewer(value.viewer);
  const content = text(value.content);
  const encoding = value.encoding;
  const truncated = typeof value.truncated === "boolean" ? value.truncated : undefined;
  const bytesRead = finiteNumber(value.bytesRead);
  const size = optionalNonnegativeNumber(value.size);
  const mimeType = optionalText(value.mimeType);
  const lastModified = optionalText(value.lastModified);
  const etag = optionalText(value.etag);
  const permissions = optionalText(value.permissions);
  const ownerDisplayName = optionalText(value.ownerDisplayName);
  const unsupportedReason = optionalText(value.unsupportedReason);
  const requiresOriginalBlob = value.requiresOriginalBlob === undefined ? undefined : typeof value.requiresOriginalBlob === "boolean" ? value.requiresOriginalBlob : undefined;
  if (!path || (expectedPath !== undefined && path !== expectedPath) || !name || isFolder === undefined || !viewer || content === undefined || (encoding !== "utf8" && encoding !== "none") || truncated === undefined || bytesRead === undefined || bytesRead < 0 || (value.size !== undefined && (size === undefined || size < 0)) || (value.mimeType !== undefined && mimeType === undefined) || (value.lastModified !== undefined && lastModified === undefined) || (value.etag !== undefined && etag === undefined) || (value.permissions !== undefined && permissions === undefined) || (value.ownerDisplayName !== undefined && ownerDisplayName === undefined) || (value.unsupportedReason !== undefined && unsupportedReason === undefined) || (value.requiresOriginalBlob !== undefined && requiresOriginalBlob === undefined)) return undefined;
  return {
    path,
    name,
    isFolder,
    ...(size === undefined ? {} : { size }),
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(lastModified === undefined ? {} : { lastModified }),
    ...(etag === undefined ? {} : { etag }),
    ...(permissions === undefined ? {} : { permissions }),
    ...(ownerDisplayName === undefined ? {} : { ownerDisplayName }),
    viewer,
    content,
    encoding,
    truncated,
    bytesRead,
    ...(unsupportedReason === undefined ? {} : { unsupportedReason }),
    ...(requiresOriginalBlob === undefined ? {} : { requiresOriginalBlob })
  };
}

function validOwnership(value: unknown): NormalCacheOwnership | undefined {
  return value === "none" || value === "owned" ? value : undefined;
}

function validRootKind(value: unknown): RootKind | undefined {
  return value === "file" || value === "folder" || value === "batch" ? value : undefined;
}

function validRootStatus(value: unknown): RootStatus | undefined {
  return value === "incomplete" || value === "complete" ? value : undefined;
}

function validPaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const paths = value.map(validPath);
  return paths.every((path): path is string => path !== undefined) ? [...new Set(paths)] : undefined;
}

function blobSize(value: unknown): number | undefined {
  return isRecord(value) ? finiteNumber(value.size) : undefined;
}

function clampLimit(limitBytes: number): number {
  if (!Number.isFinite(limitBytes)) return MIN_OPENED_FILE_CACHE_LIMIT;
  return Math.min(MAX_OPENED_FILE_CACHE_LIMIT, Math.max(MIN_OPENED_FILE_CACHE_LIMIT, Math.round(limitBytes)));
}

function encodePart(value: string): string {
  return `${value.length}:${value}`;
}

export type DecodedOpenedFileKey =
  | { readonly kind: "index"; readonly cacheNamespace: string }
  | { readonly kind: "blob"; readonly cacheNamespace: string; readonly path: string }
  | { readonly kind: "derived"; readonly cacheNamespace: string; readonly path: string };

type DecodedPart = { readonly value: string; readonly next: number };

function decodePart(key: string, offset: number): DecodedPart | undefined {
  const separator = key.indexOf(":", offset);
  if (separator < offset) return undefined;
  const lengthText = key.slice(offset, separator);
  if (!/^(?:0|[1-9]\d*)$/.test(lengthText)) return undefined;
  let length = 0;
  for (const character of lengthText) {
    const digit = character.charCodeAt(0) - 48;
    if (length > Math.floor((Number.MAX_SAFE_INTEGER - digit) / 10)) return undefined;
    length = length * 10 + digit;
  }
  const valueStart = separator + 1;
  const valueEnd = valueStart + length;
  if (valueEnd < valueStart || valueEnd > key.length) return undefined;
  return { value: key.slice(valueStart, valueEnd), next: valueEnd };
}

export function openedFileIndexKey(namespace: string): string {
  return `${V2_INDEX_PREFIX}${encodePart(namespace)}`;
}

export function openedFileBlobKey(namespace: string, path: string): string {
  return `${V2_BLOB_PREFIX}${encodePart(namespace)}${encodePart(normalizedPath(path))}`;
}

export function openedFileDerivativeKey(namespace: string, path: string): string {
  return `${V2_DERIVATIVE_PREFIX}${encodePart(namespace)}${encodePart(normalizedPath(path))}`;
}

/** Strict parser used by account cleanup. Malformed V2 keys are never trusted. */
export function decodeOpenedFileKey(key: string): DecodedOpenedFileKey | undefined {
  if (typeof key !== "string") return undefined;
  const isIndex = key.startsWith(V2_INDEX_PREFIX);
  const isBlob = key.startsWith(V2_BLOB_PREFIX);
  const isDerived = key.startsWith(V2_DERIVATIVE_PREFIX);
  if (!isIndex && !isBlob && !isDerived) return undefined;
  let offset = isIndex ? V2_INDEX_PREFIX.length : isBlob ? V2_BLOB_PREFIX.length : V2_DERIVATIVE_PREFIX.length;
  const namespace = decodePart(key, offset);
  if (!namespace || namespace.value.length === 0) return undefined;
  offset = namespace.next;
  if (isIndex) return offset === key.length ? { kind: "index", cacheNamespace: namespace.value } : undefined;
  const path = decodePart(key, offset);
  if (!path || path.next !== key.length || !validPath(path.value)) return undefined;
  return { kind: isDerived ? "derived" : "blob", cacheNamespace: namespace.value, path: validPath(path.value)! };
}

function legacyIndexKey(namespace: string): string {
  return `${LEGACY_INDEX_PREFIX}${namespace}`;
}

function legacyBlobKey(namespace: string, path: string): string {
  return `${CACHE_PREFIX}${namespace}:${normalizedPath(path)}:blob`;
}

function indexKey(namespace: string): string {
  return openedFileIndexKey(namespace);
}

function blobKey(namespace: string, path: string): string {
  return openedFileBlobKey(namespace, path);
}

function derivativeKey(namespace: string, path: string): string {
  return openedFileDerivativeKey(namespace, path);
}

function emptyIndex(limitBytes = DEFAULT_OPENED_FILE_CACHE_LIMIT): StoredIndex {
  return { version: VERSION, limitBytes: clampLimit(limitBytes), files: {}, roots: {}, memberships: {} };
}

let nextSourceRevision = 1;

function newSourceRevision(): string {
  return `source:${Date.now().toString(36)}:${(nextSourceRevision++).toString(36)}`;
}

function parseDerivative(value: unknown): StoredDerivative | undefined {
  if (!isRecord(value)) return undefined;
  const sourceRevision = text(value.sourceRevision);
  const mimeType = text(value.mimeType);
  const filename = text(value.filename);
  const blobSize = finiteNumber(value.blobSize);
  const cachedAt = iso(value.cachedAt);
  const lastAccessedAt = iso(value.lastAccessedAt);
  if (!sourceRevision || !mimeType || !filename || blobSize === undefined || blobSize < 0 || !cachedAt || !lastAccessedAt) return undefined;
  return { sourceRevision, mimeType, filename, blobSize, cachedAt, lastAccessedAt };
}

function parseFile(value: unknown): StoredFile | undefined {
  if (!isRecord(value)) return undefined;
  const path = validPath(value.path);
  const name = text(value.name);
  const mimeType = text(value.mimeType);
  const size = finiteNumber(value.size);
  const blobSize = finiteNumber(value.blobSize);
  const ownership = validOwnership(value.normalCacheOwnership);
  const preview = value.preview === undefined ? undefined : validPreview(value.preview, path);
  const cachedAt = value.cachedAt === undefined ? undefined : iso(value.cachedAt);
  const lastAccessedAt = value.lastAccessedAt === undefined ? undefined : iso(value.lastAccessedAt);
  const sourceRevision = value.sourceRevision === undefined ? undefined : text(value.sourceRevision);
  const derivative = value.derivative === undefined ? undefined : parseDerivative(value.derivative);
  if (!path || !name || !mimeType || size === undefined || size < 0 || blobSize === undefined || blobSize < 0 || !ownership || (value.preview !== undefined && !preview) || (value.cachedAt !== undefined && !cachedAt) || (value.lastAccessedAt !== undefined && !lastAccessedAt) || (value.sourceRevision !== undefined && !sourceRevision)) return undefined;
  return { path, name, mimeType, size, blobSize, normalCacheOwnership: ownership, ...(preview ? { preview } : {}), ...(cachedAt ? { cachedAt } : {}), ...(lastAccessedAt ? { lastAccessedAt } : {}), ...(sourceRevision ? { sourceRevision } : {}), ...(derivative ? { derivative } : {}) };
}

function parseRoot(value: unknown): StoredRoot | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value.id);
  const rootPath = validPath(value.rootPath);
  const rootName = text(value.rootName);
  const kind = validRootKind(value.kind);
  const folderRoots = validPaths(value.folderRoots);
  const status = validRootStatus(value.status);
  const addedAt = iso(value.addedAt);
  if (!id || !rootPath || !rootName || !kind || !folderRoots || !status || !addedAt || id !== retainedRootId(kind, rootPath)) return undefined;
  return { id, rootPath, rootName, kind, folderRoots, status, addedAt };
}

function parseV2(value: unknown): StoredIndex | undefined {
  if (!isRecord(value) || value.version !== VERSION || !isRecord(value.files) || !isRecord(value.roots) || !isRecord(value.memberships)) return undefined;
  const limitBytes = finiteNumber(value.limitBytes);
  if (limitBytes === undefined) return undefined;
  const files = Object.fromEntries(Object.values(value.files).map(parseFile).filter((file): file is StoredFile => file !== undefined).map((file) => [file.path, file]));
  const roots = Object.fromEntries(Object.values(value.roots).map(parseRoot).filter((root): root is StoredRoot => root !== undefined).map((root) => [root.id, root]));
  const memberships: Record<string, string[]> = {};
  for (const [rawPath, rawRootIds] of Object.entries(value.memberships)) {
    const path = validPath(rawPath);
    if (!path || !files[path] || !Array.isArray(rawRootIds)) continue;
    const ids = [...new Set(rawRootIds.filter((id): id is string => typeof id === "string" && Boolean(roots[id])))];
    if (ids.length > 0) memberships[path] = ids.sort();
  }
  return { version: VERSION, limitBytes: clampLimit(limitBytes), files, roots, memberships };
}

function parseLegacyEntry(value: unknown): LegacyEntry | undefined {
  if (!isRecord(value)) return undefined;
  const path = validPath(value.path);
  const preview = validPreview(value.preview, path);
  const mimeType = text(value.mimeType);
  const filename = text(value.filename);
  const blobSize = finiteNumber(value.blobSize);
  const cachedAt = iso(value.cachedAt);
  const lastAccessedAt = iso(value.lastAccessedAt);
  if (!path || !preview || !mimeType || !filename || blobSize === undefined || blobSize < 0 || !cachedAt || !lastAccessedAt) return undefined;
  const keepOffline = value.keepOffline === true;
  const rootPath = keepOffline ? validPath(value.keepOfflineRoot ?? path) : undefined;
  const rootName = keepOffline ? text(value.keepOfflineRootName ?? rootPath) : undefined;
  const rootKind = keepOffline ? validRootKind(value.keepOfflineRootKind ?? "file") : undefined;
  const folderRoots = keepOffline ? validPaths(value.keepOfflineFolderRoots ?? []) : undefined;
  if (keepOffline && (!rootPath || !rootName || !rootKind || !folderRoots)) return undefined;
  return { path, preview, mimeType, filename, blobSize, cachedAt, lastAccessedAt, ...(keepOffline ? { keepOffline, keepOfflineRoot: rootPath, keepOfflineRootName: rootName, keepOfflineRootKind: rootKind, keepOfflineFolderRoots: folderRoots, keepOfflineRootComplete: value.keepOfflineRootComplete === true, keepOfflineAddedAt: iso(value.keepOfflineAddedAt) ?? cachedAt } : {}) };
}

type LegacyReference = { readonly namespace: string; readonly path: string; readonly key: string };
type LegacyScan = {
  readonly validNamespaces: ReadonlySet<string>;
  readonly indexes: ReadonlyMap<string, StoredIndex>;
  readonly referencesByBlobKey: ReadonlyMap<string, readonly LegacyReference[]>;
  readonly legacyIndexKeys: ReadonlySet<string>;
};

function parseLegacyIndex(value: unknown): StoredIndex | undefined {
  return parseV2(value) ?? migrateLegacy(value);
}

async function scanLegacyNamespaces(allKeys: readonly unknown[], namespaces: readonly string[]): Promise<LegacyScan> {
  const validNamespaces = new Set<string>();
  const indexes = new Map<string, StoredIndex>();
  const references = new Map<string, LegacyReference[]>();
  const legacyIndexKeys = new Set<string>();
  const availableKeys = new Set(allKeys.filter((key): key is string => typeof key === "string"));
  for (const namespace of [...new Set(namespaces)].filter((value) => value.length > 0)) {
    const rawKey = legacyIndexKey(namespace);
    if (!availableKeys.has(rawKey)) continue;
    const raw = await get<unknown>(rawKey);
    const index = parseLegacyIndex(raw);
    if (!index) continue;
    validNamespaces.add(namespace);
    legacyIndexKeys.add(rawKey);
    indexes.set(namespace, index);
    for (const file of Object.values(index.files)) {
      const key = legacyBlobKey(namespace, file.path);
      const list = references.get(key) ?? [];
      if (!list.some((reference) => reference.namespace === namespace && reference.path === file.path)) {
        list.push({ namespace, path: file.path, key });
      }
      references.set(key, list);
    }
  }
  return { validNamespaces, indexes, referencesByBlobKey: references, legacyIndexKeys };
}

function isLegacyCacheKey(key: string): boolean {
  return key.startsWith(CACHE_PREFIX) && !key.startsWith(V2_INDEX_PREFIX) && !key.startsWith(V2_BLOB_PREFIX);
}

async function migrateLegacyNamespaces(allKeys: readonly unknown[], namespaces: readonly string[], removeLegacy: boolean): Promise<void> {
  const scan = await scanLegacyNamespaces(allKeys, namespaces);
  if (scan.validNamespaces.size === 0) {
    if (removeLegacy) {
      const legacyKeys = allKeys.filter((key): key is string => typeof key === "string" && isLegacyCacheKey(key));
      if (legacyKeys.length > 0) await delMany(legacyKeys);
    }
    return;
  }

  for (const [key, references] of scan.referencesByBlobKey) {
    const blob = await get<unknown>(key);
    if (!(blob instanceof Blob)) continue;
    for (const reference of references) {
      if (scan.indexes.has(reference.namespace)) await set(blobKey(reference.namespace, reference.path), blob);
    }
  }
  for (const [namespace, index] of scan.indexes) await set(indexKey(namespace), index);

  if (removeLegacy) {
    const legacyKeys = allKeys.filter((key): key is string => typeof key === "string" && isLegacyCacheKey(key));
    if (legacyKeys.length > 0) await delMany(legacyKeys);
  }
}

function retainedRootId(kind: RootKind, rootPath: string): string {
  return `retained-root:${encodeURIComponent(kind)}:${encodeURIComponent(normalizedPath(rootPath))}`;
}

function migrateLegacy(value: unknown): StoredIndex | undefined {
  if (!isRecord(value) || !isRecord(value.entries)) return undefined;
  const limitBytes = finiteNumber(value.limitBytes);
  if (limitBytes === undefined) return undefined;
  const index = emptyIndex(limitBytes);
  for (const rawEntry of Object.values(value.entries)) {
    const entry = parseLegacyEntry(rawEntry);
    if (!entry) continue;
    index.files[entry.path] = { path: entry.path, name: entry.filename, mimeType: entry.mimeType, size: entry.blobSize, preview: entry.preview, blobSize: entry.blobSize, normalCacheOwnership: entry.keepOffline ? "none" : "owned", cachedAt: entry.cachedAt, lastAccessedAt: entry.lastAccessedAt };
    if (!entry.keepOffline || !entry.keepOfflineRoot || !entry.keepOfflineRootName || !entry.keepOfflineRootKind || !entry.keepOfflineFolderRoots) continue;
    const id = retainedRootId(entry.keepOfflineRootKind, entry.keepOfflineRoot);
    index.roots[id] ??= { id, rootPath: entry.keepOfflineRoot, rootName: entry.keepOfflineRootName, kind: entry.keepOfflineRootKind, folderRoots: entry.keepOfflineFolderRoots, status: entry.keepOfflineRootComplete ? "complete" : "incomplete", addedAt: entry.keepOfflineAddedAt ?? entry.cachedAt };
    index.memberships[entry.path] = [id];
  }
  return index;
}

function membershipCount(index: StoredIndex, path: string): number {
  return index.memberships[path]?.length ?? 0;
}

async function deleteCanonicalBlob(namespace: string, path: string): Promise<void> {
  await del(blobKey(namespace, path));
}

async function deleteIfUnowned(namespace: string, index: StoredIndex, path: string): Promise<void> {
  const file = index.files[path];
  if (!file || file.normalCacheOwnership === "owned" || membershipCount(index, path) > 0) return;
  await deleteCanonicalBlob(namespace, path);
  delete index.files[path];
}

function evictableFiles(index: StoredIndex): StoredFile[] {
  return Object.values(index.files).filter((file) => file.normalCacheOwnership === "owned" && membershipCount(index, file.path) === 0);
}

type NormalCacheEntry =
  | { readonly kind: "file"; readonly file: StoredFile; readonly blobSize: number; readonly lastAccessedAt: string | undefined }
  | { readonly kind: "derivative"; readonly file: StoredFile; readonly blobSize: number; readonly lastAccessedAt: string };

function normalCacheEntries(index: StoredIndex): NormalCacheEntry[] {
  return [
    ...evictableFiles(index).map((file) => ({ kind: "file" as const, file, blobSize: file.blobSize, lastAccessedAt: file.lastAccessedAt })),
    ...Object.values(index.files).flatMap((file) => file.derivative === undefined ? [] : [{
      kind: "derivative" as const,
      file,
      blobSize: file.derivative.blobSize,
      lastAccessedAt: file.derivative.lastAccessedAt
    }])
  ];
}

async function enforceLimit(namespace: string, index: StoredIndex): Promise<void> {
  const evictable = normalCacheEntries(index).sort((left, right) => (Date.parse(left.lastAccessedAt ?? "") || 0) - (Date.parse(right.lastAccessedAt ?? "") || 0) || left.file.path.localeCompare(right.file.path));
  const total = () => normalCacheEntries(index).reduce((sum, entry) => sum + entry.blobSize, 0);
  while (total() > index.limitBytes && evictable.length > 0) {
    const oldest = evictable.shift();
    if (!oldest) break;
    if (oldest.kind === "derivative") {
      delete oldest.file.derivative;
      await del(derivativeKey(namespace, oldest.file.path));
    } else {
      oldest.file.normalCacheOwnership = "none";
      await deleteIfUnowned(namespace, index, oldest.file.path);
    }
  }
}

function immutable<T>(value: T): T {
  return structuredClone(value);
}

async function snapshot(account: RetentionAccountShape, index: StoredIndex): Promise<RetentionSnapshotShape> {
  const files = await Promise.all(Object.values(index.files).map(async (file) => {
    const blob = await get<unknown>(blobKey(account.cacheNamespace, file.path));
    return { ...file, readable: blob instanceof Blob };
  }));
  const evictable = normalCacheEntries(index);
  return immutable({
    account: { accountId: account.accountId, cacheNamespace: account.cacheNamespace },
    normalCache: { itemCount: evictable.length, totalBytes: evictable.reduce((total, entry) => total + entry.blobSize, 0), limitBytes: index.limitBytes },
    roots: Object.values(index.roots),
    files,
    memberships: Object.entries(index.memberships).flatMap(([filePath, rootIds]) => rootIds.map((rootId) => ({ rootId, filePath })))
  });
}

function failure(error: unknown): RetentionResultShape<never> {
  return { kind: "failure", message: error instanceof Error ? error.message : "Opened-file persistence failed." };
}

export function createOpenedFileRepository(): OpenedFileRepository {
  async function load(namespace: string): Promise<StoredIndex> {
    const raw = await get<unknown>(indexKey(namespace));
    const legacy = await get<unknown>(legacyIndexKey(namespace));
    if (legacy !== undefined) await migrateLegacyNamespaces(await keys(), [namespace], false);
    if (raw !== undefined) {
      const v2 = parseV2(raw) ?? emptyIndex();
      await set(indexKey(namespace), v2);
      return v2;
    }
    const migrated = parseLegacyIndex(legacy);
    const index = migrated ?? emptyIndex();
    if (migrated) await set(indexKey(namespace), index);
    return index;
  }

  async function save(account: RetentionAccountShape, index: StoredIndex): Promise<RetentionSnapshotShape> {
    await enforceLimit(account.cacheNamespace, index);
    await set(indexKey(account.cacheNamespace), index);
    return snapshot(account, index);
  }

  return {
    defaultCacheLimitBytes: DEFAULT_OPENED_FILE_CACHE_LIMIT,
    async readSnapshot(account) {
      try { return { kind: "success", value: await snapshot(account, await load(account.cacheNamespace)) }; } catch (error) { return failure(error); }
    },
    async readPreview(account, rawPath) {
      try {
        const path = validPath(rawPath);
        if (!path) return { kind: "success", value: undefined };
        const index = await load(account.cacheNamespace);
        const file = index.files[path];
        if (!file) return { kind: "success", value: undefined };
        const now = new Date().toISOString();
        file.lastAccessedAt = now;
        file.sourceRevision ??= newSourceRevision();
        const storedDerivative = file.derivative;
        const derivativeBlob = storedDerivative?.sourceRevision === file.sourceRevision
          ? await get<unknown>(derivativeKey(account.cacheNamespace, path))
          : undefined;
        if (storedDerivative !== undefined && !(derivativeBlob instanceof Blob)) {
          delete file.derivative;
          await del(derivativeKey(account.cacheNamespace, path));
        } else if (storedDerivative !== undefined) {
          storedDerivative.lastAccessedAt = now;
        }
        await set(indexKey(account.cacheNamespace), index);
        const blob = await get<unknown>(blobKey(account.cacheNamespace, path));
        return { kind: "success", value: {
          file: immutable({ ...file, readable: blob instanceof Blob }),
          ...(blob instanceof Blob ? { blob } : {}),
          sourceRevision: file.sourceRevision,
          ...(storedDerivative !== undefined && derivativeBlob instanceof Blob ? {
            derivative: { blob: derivativeBlob, mimeType: storedDerivative.mimeType, filename: storedDerivative.filename }
          } : {})
        } };
      } catch (error) { return failure(error); }
    },
    async writePreview(account, input) {
      try {
        const index = await load(account.cacheNamespace);
        const path = validPath(input.file.path);
        const original = input.retainedOriginal;
        const selected = original !== undefined && path !== undefined && validPath(original.file.path) === path && membershipCount(index, path) > 0
          ? { file: original.file, blob: original.blob as Blob | undefined }
          : { file: input.file, blob: input.blob };
        const file = writeFile(index, selected.file, selected.blob, "owned");
        if (selected.blob !== undefined) await del(derivativeKey(account.cacheNamespace, file.path));
        if (selected.blob === undefined && membershipCount(index, file.path) === 0) {
          file.blobSize = 0;
          await deleteCanonicalBlob(account.cacheNamespace, file.path);
        } else {
          await writeBlob(account.cacheNamespace, file.path, selected.blob);
        }
        if (original !== undefined && selected.file === original.file && input.blob !== undefined && path !== undefined) {
          const now = new Date().toISOString();
          file.normalCacheOwnership = "none";
          file.derivative = {
            sourceRevision: file.sourceRevision ?? (file.sourceRevision = newSourceRevision()),
            mimeType: input.file.mimeType,
            filename: input.file.name,
            blobSize: input.blob.size,
            cachedAt: now,
            lastAccessedAt: now
          };
          await setMany([
            [blobKey(account.cacheNamespace, file.path), original.blob],
            [derivativeKey(account.cacheNamespace, file.path), input.blob],
            [indexKey(account.cacheNamespace), index]
          ]);
        }
        return { kind: "success", value: await save(account, index) };
      } catch (error) { return failure(error); }
    },
    async writePreviewDerivative(account, input) {
      try {
        const path = validPath(input.path);
        const mimeType = text(input.mimeType);
        const filename = text(input.filename);
        if (!path || !mimeType || !filename || !(input.blob instanceof Blob)) throw new Error("Invalid preview derivative.");
        const index = await load(account.cacheNamespace);
        const file = index.files[path];
        if (!file || membershipCount(index, path) === 0) throw new Error("Retained source is unavailable.");
        file.sourceRevision ??= newSourceRevision();
        if (file.sourceRevision !== input.expectedSourceRevision) throw new Error("Retained source changed before its preview derivative was stored.");
        const now = new Date().toISOString();
        file.normalCacheOwnership = "none";
        file.derivative = {
          sourceRevision: file.sourceRevision,
          mimeType,
          filename,
          blobSize: input.blob.size,
          cachedAt: now,
          lastAccessedAt: now
        };
        await setMany([
          [derivativeKey(account.cacheNamespace, path), input.blob],
          [indexKey(account.cacheNamespace), index]
        ]);
        return { kind: "success", value: await save(account, index) };
      } catch (error) { return failure(error); }
    },
    async beginRoot(account, rawRoot) {
      try {
        const root = createRoot(rawRoot);
        if (!root) throw new Error("Invalid retained root.");
        const index = await load(account.cacheNamespace);
        index.roots[root.id] = root;
        return { kind: "success", value: await save(account, index) };
      } catch (error) { return failure(error); }
    },
    async persistRetainedFile(account, input) {
      try {
        const index = await load(account.cacheNamespace);
        if (!index.roots[input.rootId]) throw new Error("Unknown retained root.");
        const file = writeFile(index, input.file, input.blob, index.files[validPath(input.file.path) ?? ""]?.normalCacheOwnership ?? "none");
        if (input.blob !== undefined) await del(derivativeKey(account.cacheNamespace, file.path));
        await writeBlob(account.cacheNamespace, file.path, input.blob);
        index.memberships[file.path] = [...new Set([...(index.memberships[file.path] ?? []), input.rootId])].sort();
        return { kind: "success", value: await save(account, index) };
      } catch (error) { return failure(error); }
    },
    async completeRoot(account, rootId) {
      try {
        const index = await load(account.cacheNamespace);
        const root = index.roots[rootId];
        if (!root) throw new Error("Unknown retained root.");
        root.status = "complete";
        return { kind: "success", value: await save(account, index) };
      } catch (error) { return failure(error); }
    },
    async removeRoot(account, rootId) {
      try {
        const index = await load(account.cacheNamespace);
        if (!index.roots[rootId]) return { kind: "success", value: await snapshot(account, index) };
        delete index.roots[rootId];
        for (const [path, ids] of Object.entries(index.memberships)) {
          const remaining = ids.filter((id) => id !== rootId);
          if (remaining.length > 0) index.memberships[path] = remaining;
          else {
            delete index.memberships[path];
            const file = index.files[path];
            const derivative = file?.derivative;
            const derivativeBlob = derivative === undefined ? undefined : await get<unknown>(derivativeKey(account.cacheNamespace, path));
            if (file && derivative && derivative.sourceRevision === file.sourceRevision && derivativeBlob instanceof Blob) {
              file.name = derivative.filename;
              file.mimeType = derivative.mimeType;
              file.size = derivative.blobSize;
              file.blobSize = derivative.blobSize;
              file.normalCacheOwnership = "owned";
              file.cachedAt = derivative.cachedAt;
              file.lastAccessedAt = derivative.lastAccessedAt;
              file.sourceRevision = newSourceRevision();
              delete file.derivative;
              await set(blobKey(account.cacheNamespace, path), derivativeBlob);
              await del(derivativeKey(account.cacheNamespace, path));
            } else {
              await deleteIfUnowned(account.cacheNamespace, index, path);
            }
          }
        }
        return { kind: "success", value: await save(account, index) };
      } catch (error) { return failure(error); }
    },
    async clearNormalCache(account) {
      try {
        const index = await load(account.cacheNamespace);
        for (const file of Object.values(index.files)) {
          file.normalCacheOwnership = "none";
          if (file.derivative !== undefined) {
            delete file.derivative;
            await del(derivativeKey(account.cacheNamespace, file.path));
          }
          await deleteIfUnowned(account.cacheNamespace, index, file.path);
        }
        return { kind: "success", value: await save(account, index) };
      } catch (error) { return failure(error); }
    },
    async purgeAccountNamespace(account, knownAccounts = []) {
      try {
        const namespace = account.cacheNamespace;
        const allKeys = await keys();
        const knownNamespaces = [namespace, ...knownAccounts.map((known) => known.cacheNamespace)];
        await migrateLegacyNamespaces(allKeys, knownNamespaces, true);
        const postMigrationKeys = await keys();
        const matchingKeys = postMigrationKeys.filter((key): key is string => {
          if (typeof key !== "string") return false;
          const decoded = decodeOpenedFileKey(key);
          return decoded?.cacheNamespace === namespace;
        });
        if (matchingKeys.length > 0) await delMany(matchingKeys);
        return { kind: "success", value: await snapshot(account, emptyIndex()) };
      } catch (error) { return failure(error); }
    },
    async configureNormalCacheLimit(account, limitBytes) {
      try {
        const index = await load(account.cacheNamespace);
        index.limitBytes = clampLimit(limitBytes);
        return { kind: "success", value: await save(account, index) };
      } catch (error) { return failure(error); }
    }
  };
}

function createRoot(input: RetainedRootInputShape): StoredRoot | undefined {
  const rootPath = validPath(input.rootPath);
  const rootName = text(input.rootName);
  const kind = validRootKind(input.kind);
  const folderRoots = validPaths(input.folderRoots);
  if (!rootPath || !rootName || !kind || !folderRoots) return undefined;
  return { id: retainedRootId(kind, rootPath), rootPath, rootName, kind, folderRoots, status: "incomplete", addedAt: new Date().toISOString() };
}

function writeFile(index: StoredIndex, input: RetainedFileShape, blob: Blob | undefined, ownership: NormalCacheOwnership): StoredFile {
  const path = validPath(input.path);
  const name = text(input.name);
  const mimeType = text(input.mimeType);
  const size = finiteNumber(input.size);
  const preview = input.preview === undefined ? undefined : validPreview(input.preview, path);
  if (!path || !name || !mimeType || size === undefined || size < 0 || (input.preview !== undefined && !preview)) throw new Error("Invalid cached file.");
  const existing = index.files[path];
  const now = new Date().toISOString();
  const inputBlobSize = blobSize(blob);
  const sourceRevision = blob === undefined ? existing?.sourceRevision ?? newSourceRevision() : newSourceRevision();
  const record: StoredFile = {
    path,
    name,
    mimeType,
    size,
    blobSize: inputBlobSize ?? existing?.blobSize ?? input.blobSize,
    normalCacheOwnership: ownership,
    ...(preview ?? existing?.preview ? { preview: preview ?? existing?.preview } : {}),
    cachedAt: existing?.cachedAt ?? now,
    lastAccessedAt: now,
    sourceRevision,
    ...(blob === undefined && existing?.derivative?.sourceRevision === sourceRevision ? { derivative: existing.derivative } : {})
  };
  index.files[path] = record;
  return record;
}

async function writeBlob(namespace: string, path: string, blob: Blob | undefined): Promise<void> {
  if (blob !== undefined) await set(blobKey(namespace, path), blob);
}
