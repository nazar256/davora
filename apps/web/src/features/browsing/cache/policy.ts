import type { FileEntry, SearchResult } from "@davora/shared";
import { basename, fileEntrySchema, parseNormalizedPath, searchResultSchema } from "@davora/shared";

export const FOLDER_CACHE_PREFIX = "davora-cache:v2:folder:";
export const SEARCH_CACHE_PREFIX = "davora-cache:v2:search:";
export const V1_FOLDER_CACHE_PREFIX = "davora-cache:folder:";
export const V1_SEARCH_CACHE_PREFIX = "davora-cache:search:";
export const V1_PURGE_MARKER_KEY = "davora-cache:v2:last-v1-purge-complete";

export const encodePart = (value: string): string => `${value.length}:${value}`;

export const folderCacheKey = (cacheNamespace: string, path: string): string =>
  `${FOLDER_CACHE_PREFIX}${encodePart(cacheNamespace)}${encodePart(path)}`;

export const searchCacheKey = (cacheNamespace: string, path: string, query: string): string =>
  `${SEARCH_CACHE_PREFIX}${encodePart(cacheNamespace)}${encodePart(path)}${encodePart(query.toLowerCase())}`;

const isCanonicalPath = (path: unknown): path is string => {
  if (typeof path !== "string") return false;
  try {
    return parseNormalizedPath(path) === path;
  } catch {
    return false;
  }
};

const isValidNamespace = (cacheNamespace: unknown): cacheNamespace is string =>
  typeof cacheNamespace === "string" && cacheNamespace.length > 0;

type DecodedPart = { readonly value: string; readonly next: number };

const decodePart = (key: string, offset: number): DecodedPart | undefined => {
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
};

export type DecodedV2CacheKey =
  | { readonly kind: "folder"; readonly cacheNamespace: string; readonly path: string }
  | { readonly kind: "search"; readonly cacheNamespace: string; readonly path: string; readonly query: string };

/** Strict parser used by cleanup. Malformed keys are deliberately left untouched. */
export const decodeV2CacheKey = (key: string): DecodedV2CacheKey | undefined => {
  if (typeof key !== "string") return undefined;
  const isFolder = key.startsWith(FOLDER_CACHE_PREFIX);
  const isSearch = key.startsWith(SEARCH_CACHE_PREFIX);
  if (!isFolder && !isSearch) return undefined;
  let offset = isFolder ? FOLDER_CACHE_PREFIX.length : SEARCH_CACHE_PREFIX.length;
  const namespace = decodePart(key, offset);
  if (!namespace) return undefined;
  offset = namespace.next;
  const path = decodePart(key, offset);
  if (!path || !isValidNamespace(namespace.value) || !isCanonicalPath(path.value)) return undefined;
  offset = path.next;
  if (isFolder) {
    return offset === key.length
      ? { kind: "folder", cacheNamespace: namespace.value, path: path.value }
      : undefined;
  }
  const query = decodePart(key, offset);
  if (!query || query.next !== key.length || query.value !== query.value.toLowerCase()) return undefined;
  return { kind: "search", cacheNamespace: namespace.value, path: path.value, query: query.value };
};

const isSearchInScope = (scope: string, path: string): boolean =>
  scope === "" ? path !== "" : path === scope || path.startsWith(`${scope}/`);

const isFolderDescendant = (folderPath: string, path: string): boolean =>
  folderPath === "" ? path !== "" : path.startsWith(`${folderPath}/`);

const isSameOrDescendant = (scope: string, path: string): boolean =>
  scope === "" || path === scope || path.startsWith(`${scope}/`);

const parseEnvelope = (raw: string): { readonly cachedAt: string; readonly value: unknown; readonly completeness?: unknown } | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  if (!("cachedAt" in parsed)
    || typeof parsed.cachedAt !== "string"
    || !Number.isFinite(Date.parse(parsed.cachedAt))
    || !("value" in parsed)) return undefined;
  return { cachedAt: parsed.cachedAt, value: parsed.value, ...("completeness" in parsed ? { completeness: parsed.completeness } : {}) };
};

export const parseFolderCacheEnvelope = (
  raw: string,
  requestedPath: string
): { readonly cachedAt: string; readonly completeness: "complete" | "partial" | "unknown"; readonly items: FileEntry[] } | undefined => {
  if (!isCanonicalPath(requestedPath)) return undefined;
  const envelope = parseEnvelope(raw);
  if (!envelope || !Array.isArray(envelope.value)) return undefined;
  const completeness = !("completeness" in envelope)
    ? "unknown" as const
    : envelope.completeness;
  if (completeness !== "complete" && completeness !== "partial" && completeness !== "unknown") return undefined;
  const items: FileEntry[] = [];
  for (const value of envelope.value) {
    const parsed = fileEntrySchema.safeParse(value);
    if (!parsed.success
      || basename(parsed.data.path) !== parsed.data.name
      || !isFolderDescendant(requestedPath, parsed.data.path)) return undefined;
    items.push(parsed.data);
  }
  return { cachedAt: envelope.cachedAt, completeness, items };
};

export const parseSearchCacheEnvelope = (
  raw: string,
  requestedPath: string
): { readonly items: SearchResult[] } | undefined => {
  if (!isCanonicalPath(requestedPath)) return undefined;
  const envelope = parseEnvelope(raw);
  if (!envelope || !Array.isArray(envelope.value)) return undefined;
  const items: SearchResult[] = [];
  for (const value of envelope.value) {
    const parsed = searchResultSchema.safeParse(value);
    if (!parsed.success
      || !Number.isFinite(parsed.data.score)
      || basename(parsed.data.path) !== parsed.data.name
      || !isSearchInScope(requestedPath, parsed.data.path)) return undefined;
    items.push(parsed.data);
  }
  return { items };
};

export const isValidCacheNamespace = isValidNamespace;
export const isValidCachePath = isCanonicalPath;
export const isFolderPathInScope = isSameOrDescendant;

export const planNamespaceCacheClear = (
  keys: readonly string[],
  cacheNamespace: string,
  preserveFolderPaths: readonly string[] = []
): string[] => keys.filter((key) => {
  const decoded = decodeV2CacheKey(key);
  if (!decoded || decoded.cacheNamespace !== cacheNamespace) return false;
  if (decoded.kind === "search") return true;
  return !preserveFolderPaths.some((path) => isSameOrDescendant(path, decoded.path));
});

export const planFolderPathCacheClear = (
  keys: readonly string[],
  cacheNamespace: string,
  path: string
): string[] => keys.filter((key) => {
  const decoded = decodeV2CacheKey(key);
  return decoded?.kind === "folder"
    && decoded.cacheNamespace === cacheNamespace
    && isSameOrDescendant(path, decoded.path);
});
