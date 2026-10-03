import type { FileEntry } from "@davora/shared";
import { basename, fileEntrySchema, parseNormalizedPath } from "@davora/shared";

import { ApiRequestError, listFiles as requestFolder } from "../../lib/api";
type FolderCompleteness = "complete" | "partial" | "unknown";

type FolderDiagnosticValueType = "undefined" | "null" | "boolean" | "number" | "string" | "array" | "object";
type FolderNameDifferenceCategory = "end" | "control" | "whitespace" | "letter" | "number" | "mark" | "punctuation" | "symbol" | "other";
interface FolderBasenameComparisonDiagnostic {
  readonly basenameLength: number;
  readonly equalAfterTrim: boolean;
  readonly equalAfterNfc: boolean;
  readonly equalIgnoringCase: boolean;
  readonly firstDifferenceIndex: number;
  readonly basenameDifferenceCategory: FolderNameDifferenceCategory;
  readonly nameDifferenceCategory: FolderNameDifferenceCategory;
}
interface FolderResponseIssueDiagnostic {
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly expectedType?: string;
  readonly actualType: FolderDiagnosticValueType;
}
interface FolderItemShapeDiagnostic {
  readonly presentKeys: readonly string[];
  readonly fieldTypes: Readonly<Record<string, FolderDiagnosticValueType>>;
  readonly isFolder?: boolean;
  readonly pathDepth?: number;
  readonly nameLength?: number;
  readonly basenameComparison?: FolderBasenameComparisonDiagnostic;
  readonly flags: {
    readonly hasControl: boolean;
    readonly hasEdgeWhitespace: boolean;
    readonly nonNfc: boolean;
    readonly hasEncodedSeparator?: boolean;
    readonly hasDotSegment?: boolean;
  };
}
interface FolderResponseRejectionDiagnostic {
  readonly phase: "json-decode" | "envelope-schema" | "response-path-mismatch" | "items-not-array" | "item-schema" | "noncanonical-item-path" | "basename-mismatch" | "item-outside-folder";
  readonly status?: number;
  readonly contentType?: "json" | "html" | "text" | "binary" | "other" | "missing";
  readonly payloadBytes?: number;
  readonly workerBuild?: string;
  readonly apiContract?: string;
  readonly itemIndex?: number;
  readonly issues?: readonly FolderResponseIssueDiagnostic[];
  readonly truncatedIssueCount?: number;
  readonly itemShape?: FolderItemShapeDiagnostic;
  readonly rejectedCount?: number;
  readonly truncatedCount?: number;
}

interface FolderCache {
  readFolder(cacheNamespace: string, path: string):
    | { readonly kind: "hit"; readonly cachedAt: string; readonly completeness: FolderCompleteness; readonly items: FileEntry[] }
    | { readonly kind: "miss" };
  writeFolder(cacheNamespace: string, path: string, items: readonly FileEntry[], completeness: Exclude<FolderCompleteness, "unknown">): unknown;
}

interface FolderApi {
  listFiles(path: string, token: string, signal: AbortSignal): Promise<{ path: string; completeness: "complete" | "partial"; items: unknown }>;
}

const canonicalPath = (path: string): string | undefined => {
  try {
    const normalized = parseNormalizedPath(path);
    return normalized === path ? normalized : undefined;
  } catch {
    return undefined;
  }
};

const diagnosticType = (value: unknown): FolderDiagnosticValueType => {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const kind = typeof value;
  if (kind === "boolean" || kind === "number" || kind === "string") return kind;
  return "object";
};

const PROTOCOL_KEYS = new Set([
  "etag", "isFolder", "lastModified", "mimeType", "name", "ownerDisplayName",
  "path", "permissions", "size"
]);

const CONTROL_CHARACTER = /\p{Cc}/u;

const differenceCategory = (value: string | undefined): FolderNameDifferenceCategory => {
  if (value === undefined) return "end";
  if (CONTROL_CHARACTER.test(value)) return "control";
  if (/^\s$/u.test(value)) return "whitespace";
  if (/^\p{L}$/u.test(value)) return "letter";
  if (/^\p{N}$/u.test(value)) return "number";
  if (/^\p{M}$/u.test(value)) return "mark";
  if (/^\p{P}$/u.test(value)) return "punctuation";
  if (/^\p{S}$/u.test(value)) return "symbol";
  return "other";
};

const basenameComparison = (path: string, name: string): FolderBasenameComparisonDiagnostic | undefined => {
  let pathBasename: string;
  try {
    pathBasename = basename(path);
  } catch {
    return undefined;
  }
  if (pathBasename === name) return undefined;
  const basenameCodePoints = [...pathBasename];
  const nameCodePoints = [...name];
  const comparisonLength = Math.max(basenameCodePoints.length, nameCodePoints.length);
  let firstDifferenceIndex = 0;
  while (firstDifferenceIndex < comparisonLength
    && basenameCodePoints[firstDifferenceIndex] === nameCodePoints[firstDifferenceIndex]) {
    firstDifferenceIndex += 1;
  }
  return {
    basenameLength: basenameCodePoints.length,
    equalAfterTrim: pathBasename.trim() === name.trim(),
    equalAfterNfc: pathBasename.normalize("NFC") === name.normalize("NFC"),
    equalIgnoringCase: pathBasename.toLowerCase() === name.toLowerCase(),
    firstDifferenceIndex,
    basenameDifferenceCategory: differenceCategory(basenameCodePoints[firstDifferenceIndex]),
    nameDifferenceCategory: differenceCategory(nameCodePoints[firstDifferenceIndex])
  };
};

const safeIssuePath = (path: readonly PropertyKey[]): readonly (string | number)[] => {
  const result: Array<string | number> = [];
  for (const segment of path.slice(0, 8)) {
    if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0) result.push(segment);
    if (typeof segment === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(segment)) result.push(segment);
  }
  return result;
};

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const candidateValueAtPath = (candidate: unknown, path: readonly (string | number)[]): unknown => {
  let value = candidate;
  for (const segment of path) {
    if (typeof segment === "number" && Array.isArray(value)) {
      value = value[segment];
    } else if (typeof segment === "string" && isUnknownRecord(value)) {
      value = value[segment];
    } else {
      return undefined;
    }
  }
  return value;
};

const summarizeItemIssues = (issues: readonly { readonly path: readonly PropertyKey[]; readonly code: string; readonly expected?: unknown }[], candidate: unknown) => {
  const summarized: FolderResponseIssueDiagnostic[] = issues.slice(0, 10).map((issue) => {
    const path = safeIssuePath(issue.path);
    const expectedType = typeof issue.expected === "string" && /^[a-z0-9_-]{1,40}$/i.test(issue.expected)
      ? issue.expected
      : undefined;
    return {
      path,
      code: /^[a-z0-9_-]{1,40}$/i.test(issue.code) ? issue.code : "invalid",
      expectedType,
      actualType: diagnosticType(candidateValueAtPath(candidate, path))
    };
  });
  return {
    issues: summarized,
    ...(issues.length > summarized.length ? { truncatedIssueCount: issues.length - summarized.length } : {})
  };
};

const itemShape = (candidate: unknown): FolderItemShapeDiagnostic | undefined => {
  if (!isUnknownRecord(candidate)) return undefined;
  const record = candidate;
  const presentKeys = Object.keys(record).filter((key) => PROTOCOL_KEYS.has(key)).sort();
  const fieldTypes: Record<string, FolderDiagnosticValueType> = {};
  for (const key of presentKeys) fieldTypes[key] = diagnosticType(record[key]);
  const path = typeof record.path === "string" ? record.path : undefined;
  const name = typeof record.name === "string" ? record.name : undefined;
  const comparison = path !== undefined && name !== undefined
    ? basenameComparison(path, name)
    : undefined;
  return {
    presentKeys,
    fieldTypes,
    ...(typeof record.isFolder === "boolean" ? { isFolder: record.isFolder } : {}),
    ...(path !== undefined ? { pathDepth: path.split("/").filter(Boolean).length } : {}),
    ...(name !== undefined ? { nameLength: [...name].length } : {}),
    ...(comparison ? { basenameComparison: comparison } : {}),
    flags: {
      hasControl: [path, name].some((value) => value !== undefined && CONTROL_CHARACTER.test(value)),
      hasEdgeWhitespace: [path, name].some((value) => value !== undefined && value.trim() !== value),
      nonNfc: [path, name].some((value) => value !== undefined && value.normalize("NFC") !== value),
      hasEncodedSeparator: path !== undefined && /%2f|%5c/i.test(path),
      hasDotSegment: path !== undefined && path.split("/").some((segment) => segment === "." || segment === "..")
    }
  };
};

type ParsedFolderItems =
  | { readonly ok: true; readonly items: FileEntry[] }
  | { readonly ok: false; readonly diagnostic: FolderResponseRejectionDiagnostic };

const rejectItem = (
  phase: FolderResponseRejectionDiagnostic["phase"],
  candidate: unknown,
  itemIndex: number,
  extra: Partial<FolderResponseRejectionDiagnostic> = {}
): ParsedFolderItems => ({
  ok: false,
  diagnostic: {
    phase,
    itemIndex,
    itemShape: itemShape(candidate),
    rejectedCount: 1,
    ...extra
  }
});

const parseFolderItems = (value: unknown, folderPath: string): ParsedFolderItems => {
  if (!Array.isArray(value)) {
    return { ok: false, diagnostic: { phase: "items-not-array" } };
  }
  if (canonicalPath(folderPath) === undefined) {
    return { ok: false, diagnostic: { phase: "response-path-mismatch" } };
  }
  const items: FileEntry[] = [];
  for (const [itemIndex, candidate] of value.entries()) {
    const candidatePath = isUnknownRecord(candidate)
      ? candidate.path
      : undefined;
    if (typeof candidatePath === "string" && canonicalPath(candidatePath) === undefined) {
      return rejectItem("noncanonical-item-path", candidate, itemIndex);
    }
    const parsed = fileEntrySchema.safeParse(candidate);
    if (!parsed.success) {
      return rejectItem("item-schema", candidate, itemIndex, summarizeItemIssues(parsed.error.issues, candidate));
    }
    if (basename(parsed.data.path) !== parsed.data.name) {
      return rejectItem("basename-mismatch", candidate, itemIndex);
    }
    const belongsToFolder = folderPath === ""
      ? parsed.data.path !== ""
      : parsed.data.path.startsWith(`${folderPath}/`);
    if (!belongsToFolder) {
      return rejectItem("item-outside-folder", candidate, itemIndex);
    }
    items.push(parsed.data);
  }
  return { ok: true, items };
};

const isTransient = (error: unknown): boolean => {
  if (error instanceof ApiRequestError) {
    return error.status >= 500 && error.code !== "config_error";
  }
  return error instanceof TypeError
    || (error instanceof Error && /fetch|network|proxy|socket|connection/i.test(error.message));
};

const classifyFolderError = (error: unknown) => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { kind: "cancelled" } as const;
  }
  const normalized = error instanceof Error ? error : new Error("Unable to load folder.");
  if (normalized instanceof ApiRequestError && normalized.status === 401) {
    return { kind: "unauthorized", error: normalized } as const;
  }
  if (normalized instanceof ApiRequestError && normalized.code === "account_reconnect_required") {
    return { kind: "reconnect-required", error: normalized } as const;
  }
  const diagnostic = normalized instanceof ApiRequestError ? normalized.responseDiagnostic : undefined;
  return isTransient(normalized)
    ? { kind: "transient", error: normalized, ...(diagnostic ? { diagnostic } : {}) } as const
    : { kind: "failure", error: normalized, ...(diagnostic ? { diagnostic } : {}) } as const;
};

export const createBrowserFolderPorts = (
  cache: FolderCache,
  api: FolderApi = { listFiles: requestFolder }
) => ({
  createAbortHandle: () => new AbortController(),
  async loadFolder(input: { path: string; token: string; signal: AbortSignal }) {
    try {
      const response = await api.listFiles(input.path, input.token, input.signal);
      if (response.path !== input.path) {
        return {
          kind: "failure",
          error: new Error("The server returned invalid folder entries."),
          diagnostic: { phase: "response-path-mismatch" }
        } as const;
      }
      const parsed = parseFolderItems(response.items, input.path);
      if (!parsed.ok) {
        return {
          kind: "failure",
          error: new Error("The server returned invalid folder entries."),
          diagnostic: parsed.diagnostic
        } as const;
      }
      if (response.completeness !== "complete" && response.completeness !== "partial") {
        return { kind: "failure", error: new Error("The server returned invalid folder completeness.") } as const;
      }
      return { kind: "success", items: parsed.items, completeness: response.completeness } as const;
    } catch (error) {
      return classifyFolderError(error);
    }
  },
  readCachedFolder(cacheNamespace: string, path: string) {
    const result = cache.readFolder(cacheNamespace, path);
    return result.kind === "hit" ? { items: result.items, cachedAt: result.cachedAt, completeness: result.completeness } : undefined;
  },
  writeCachedFolder(cacheNamespace: string, path: string, items: FileEntry[], completeness: "complete" | "partial"): void {
    cache.writeFolder(cacheNamespace, path, items, completeness);
  }
});
