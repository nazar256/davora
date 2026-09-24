/**
 * Diagnostic event schema for the opt-in local diagnostics feature.
 *
 * Everything in this module is pure: no React, no browser globals, no clocks.
 * Persisted records are untrusted input and must pass the guards here before
 * entering application state.
 */

export const DIAGNOSTICS_SCHEMA_VERSION = 2;
export const DIAGNOSTICS_SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const;

/** Keep the live session plus this many ended sessions. */
export const DIAGNOSTICS_MAX_KEPT_SESSIONS = 4;
/** Hard cap for a single session's stored event list. */
export const DIAGNOSTICS_MAX_EVENTS_PER_SESSION = 2_000;
/** Approximate cap for one session record in bytes. */
export const DIAGNOSTICS_MAX_SESSION_BYTES = 512 * 1024;
/** Approximate cap for all retained diagnostics data in bytes. */
export const DIAGNOSTICS_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
/** In-memory buffer cap before an automatic flush is requested. */
export const DIAGNOSTICS_BUFFER_FLUSH_EVENT_COUNT = 100;

/** A redacted path reference: stable per-report alias plus debugging shape. */
export interface RedactedPathRef {
  readonly alias: string;
  readonly depth: number;
  readonly extension?: string;
  readonly kind?: "file" | "folder";
}

export interface DiagnosticsEnvironment {
  readonly appBuild: string;
  readonly userAgent: string;
  readonly platform?: string;
  readonly language?: string;
  readonly languages?: readonly string[];
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly colorScheme?: "light" | "dark";
  readonly displayMode?: "browser" | "standalone" | "installed";
  readonly connectionEffectiveType?: string;
  readonly onLine?: boolean;
  readonly serviceWorkerControlled?: boolean;
  readonly storageEstimate?: { readonly usage?: number; readonly quota?: number };
  readonly deviceClass?: "narrow" | "wide";
}

export interface DiagnosticsSessionContext {
  readonly accountAlias?: string;
  readonly backendKind?: string;
  readonly themeMode?: string;
  readonly explicitOffline?: boolean;
}

export type DiagnosticValueType = "undefined" | "null" | "boolean" | "number" | "string" | "array" | "object";
export type FolderNameDifferenceCategory = "end" | "control" | "whitespace" | "letter" | "number" | "mark" | "punctuation" | "symbol" | "other";

export interface FolderBasenameComparisonEvidence {
  readonly basenameLength: number;
  readonly equalAfterTrim: boolean;
  readonly equalAfterNfc: boolean;
  readonly equalIgnoringCase: boolean;
  readonly firstDifferenceIndex: number;
  readonly basenameDifferenceCategory: FolderNameDifferenceCategory;
  readonly nameDifferenceCategory: FolderNameDifferenceCategory;
}

export interface FolderResponseIssueEvidence {
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly expectedType?: string;
  readonly actualType: DiagnosticValueType;
}

export interface FolderItemShapeEvidence {
  readonly presentKeys: readonly string[];
  readonly fieldTypes: Readonly<Record<string, DiagnosticValueType>>;
  readonly isFolder?: boolean;
  readonly pathDepth?: number;
  readonly nameLength?: number;
  readonly basenameComparison?: FolderBasenameComparisonEvidence;
  readonly flags: {
    readonly hasControl: boolean;
    readonly hasEdgeWhitespace: boolean;
    readonly nonNfc: boolean;
    readonly hasEncodedSeparator?: boolean;
    readonly hasDotSegment?: boolean;
  };
}

export interface FolderResponseRejectionEvidence {
  readonly phase:
    | "json-decode"
    | "envelope-schema"
    | "response-path-mismatch"
    | "items-not-array"
    | "item-schema"
    | "noncanonical-item-path"
    | "basename-mismatch"
    | "item-outside-folder";
  readonly status?: number;
  readonly contentType?: "json" | "html" | "text" | "binary" | "other" | "missing";
  readonly payloadBytes?: number;
  readonly workerBuild?: string;
  readonly apiContract?: string;
  readonly itemIndex?: number;
  readonly issues?: readonly FolderResponseIssueEvidence[];
  readonly truncatedIssueCount?: number;
  readonly itemShape?: FolderItemShapeEvidence;
  readonly rejectedCount?: number;
  readonly truncatedCount?: number;
}

export type DiagnosticActionName =
  | "create-folder"
  | "upload"
  | "upload-folder"
  | "download"
  | "batch-download"
  | "copy-move"
  | "delete"
  | "keep-offline"
  | "preview-open"
  | "folder-load"
  | "search"
  | "sort-change"
  | "settings-change"
  | "report-bug"
  | "export-report"
  | "clear-cache"
  | "clear-diagnostics";

export type DiagnosticEvent =
  | {
      readonly kind: "session.started";
      readonly at: string;
      readonly environment: DiagnosticsEnvironment;
      readonly context: DiagnosticsSessionContext;
    }
  | {
      readonly kind: "session.ended";
      readonly at: string;
      readonly reason: "pagehide" | "disabled" | "replaced";
      readonly durationMs: number;
    }
  | { readonly kind: "app.visibility"; readonly at: string; readonly state: "visible" | "hidden" }
  | {
      readonly kind: "app.connectivity";
      readonly at: string;
      readonly state: "online" | "offline";
      readonly effectiveType?: string;
    }
  | { readonly kind: "app.explicitOffline"; readonly at: string; readonly enabled: boolean }
  | { readonly kind: "app.workerUnavailable"; readonly at: string; readonly unavailable: boolean }
  | {
      readonly kind: "account.context";
      readonly at: string;
      readonly accountAlias?: string;
      readonly backendKind?: string;
      readonly sessionState?: string;
    }
  | { readonly kind: "navigation.folder"; readonly at: string; readonly path: RedactedPathRef }
  | {
      readonly kind: "navigation.search";
      readonly at: string;
      readonly active: boolean;
      readonly resultCount?: number;
    }
  | {
      readonly kind: "navigation.surface";
      readonly at: string;
      readonly surface: string;
      readonly state: "opened" | "closed";
    }
  | {
      readonly kind: "folder.load";
      readonly at: string;
      readonly outcome: "live" | "failed" | "offline" | "cancelled";
      readonly errorKind?: string;
      readonly durationMs?: number;
      readonly itemCount?: number;
    }
  | {
      readonly kind: "folder.response.rejected";
      readonly at: string;
      readonly path: RedactedPathRef;
      readonly rejection: FolderResponseRejectionEvidence;
    }
  | {
      readonly kind: "action.invoked";
      readonly at: string;
      readonly action: DiagnosticActionName;
      readonly detail?: Record<string, string | number | boolean>;
    }
  | {
      readonly kind: "action.result";
      readonly at: string;
      readonly action: DiagnosticActionName;
      readonly outcome: "success" | "failure" | "cancelled" | "partial";
      readonly durationMs?: number;
      readonly errorKind?: string;
    }
  | {
      readonly kind: "transfer.finished";
      readonly at: string;
      readonly transferKind: "upload" | "download" | "sync" | "copy" | "move";
      readonly phase: "done" | "partial" | "error" | "canceled";
      readonly itemCount?: number;
      readonly bytes?: number;
    }
  | {
      readonly kind: "network.request";
      readonly at: string;
      readonly category: "auth" | "files" | "preview" | "download" | "health" | "mutation" | "other";
      readonly method: string;
      readonly route: string;
      readonly durationMs: number;
      readonly result: "2xx" | "4xx" | "5xx" | "network-error" | "aborted" | "blocked";
    }
  | {
      readonly kind: "cache.event";
      readonly at: string;
      readonly op: "cleared" | "keep-offline-added" | "keep-offline-removed" | "evicted";
      readonly items?: number;
      readonly bytes?: number;
    }
  | {
      readonly kind: "error.uncaught";
      readonly at: string;
      readonly message: string;
      readonly stack?: string;
      readonly context?: string;
    }
  | { readonly kind: "error.rejection"; readonly at: string; readonly reasonKind: string; readonly message: string }
  | {
      readonly kind: "error.reported";
      readonly at: string;
      readonly area: "list" | "mutation" | "bootstrap" | "preview" | "session" | "diagnostics";
      readonly errorKind: string;
    }
  | {
      readonly kind: "perf.marker";
      readonly at: string;
      readonly name: string;
      readonly durationMs: number;
      readonly detail?: string;
    };

export interface DiagnosticsSessionMeta {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly endReason?: "pagehide" | "disabled" | "replaced";
}

export interface DiagnosticsSessionRecord {
  readonly version: number;
  readonly meta: DiagnosticsSessionMeta;
  readonly environment?: DiagnosticsEnvironment;
  readonly context?: DiagnosticsSessionContext;
  readonly events: readonly DiagnosticEvent[];
}

export interface DiagnosticsSessionSummary {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly eventCount: number;
  readonly byteSize: number;
  /** Distinct event kind strings; the feature maps them to display categories. */
  readonly eventKinds: readonly string[];
}

const EVENT_KIND_CATEGORY: Readonly<Record<string, string>> = {
  "session.started": "Session lifecycle",
  "session.ended": "Session lifecycle",
  "app.visibility": "Session lifecycle",
  "app.connectivity": "App and environment",
  "app.explicitOffline": "App and environment",
  "app.workerUnavailable": "App and environment",
  "account.context": "Session lifecycle",
  "navigation.folder": "User actions and navigation",
  "navigation.search": "User actions and navigation",
  "navigation.surface": "User actions and navigation",
  "folder.load": "User actions and navigation",
  "folder.response.rejected": "Errors and performance",
  "action.invoked": "User actions and navigation",
  "action.result": "User actions and navigation",
  "transfer.finished": "Cache, storage, and sync",
  "network.request": "Network operations",
  "cache.event": "Cache, storage, and sync",
  "error.uncaught": "Errors and performance",
  "error.rejection": "Errors and performance",
  "error.reported": "Errors and performance",
  "perf.marker": "Errors and performance"
};

export const eventCategory = (kind: string): string =>
  EVENT_KIND_CATEGORY[kind] ?? "Other";

export const eventCategories = (kinds: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  for (const kind of kinds) {
    seen.add(eventCategory(kind));
  }
  return [...seen].sort();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";

const isOptionalFiniteNumber = (value: unknown): value is number | undefined =>
  value === undefined || isFiniteNumber(value);

const isOptionalBoolean = (value: unknown): value is boolean | undefined =>
  value === undefined || typeof value === "boolean";

const DIAGNOSTIC_VALUE_TYPES = new Set(["undefined", "null", "boolean", "number", "string", "array", "object"]);
const REJECTION_PHASES = new Set([
  "json-decode", "envelope-schema", "response-path-mismatch", "items-not-array",
  "item-schema", "noncanonical-item-path", "basename-mismatch", "item-outside-folder"
]);
const CONTENT_TYPE_CLASSES = new Set(["json", "html", "text", "binary", "other", "missing"]);
const NAME_DIFFERENCE_CATEGORIES = new Set([
  "end", "control", "whitespace", "letter", "number", "mark", "punctuation", "symbol", "other"
]);
const PROTOCOL_KEYS = new Set([
  "etag", "isFolder", "lastModified", "mimeType", "name", "ownerDisplayName",
  "path", "permissions", "size"
]);
const RESPONSE_ISSUE_KEYS = new Set(["path", "code", "expectedType", "actualType"]);
const BASENAME_COMPARISON_KEYS = new Set([
  "basenameLength", "equalAfterTrim", "equalAfterNfc", "equalIgnoringCase",
  "firstDifferenceIndex", "basenameDifferenceCategory", "nameDifferenceCategory"
]);
const ITEM_SHAPE_KEYS = new Set([
  "presentKeys", "fieldTypes", "isFolder", "pathDepth", "nameLength", "basenameComparison", "flags"
]);
const ITEM_SHAPE_FLAG_KEYS = new Set([
  "hasControl", "hasEdgeWhitespace", "nonNfc", "hasEncodedSeparator", "hasDotSegment"
]);
const REJECTION_KEYS = new Set([
  "phase", "status", "contentType", "payloadBytes", "workerBuild", "apiContract", "itemIndex",
  "issues", "truncatedIssueCount", "itemShape", "rejectedCount", "truncatedCount"
]);
const REDACTED_PATH_KEYS = new Set(["alias", "depth", "extension", "kind"]);
const FOLDER_REJECTION_EVENT_KEYS = new Set(["kind", "at", "path", "rejection"]);

const hasOnlyKeys = (value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean =>
  Object.keys(value).every((key) => allowedKeys.has(key));

const isDiagnosticValueType = (value: unknown): value is DiagnosticValueType =>
  typeof value === "string" && DIAGNOSTIC_VALUE_TYPES.has(value);

const isIssuePath = (value: unknown): value is readonly (string | number)[] =>
  Array.isArray(value)
    && value.length <= 8
    && value.every((segment) => (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0)
      || (typeof segment === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(segment)));

const isResponseIssueEvidence = (value: unknown): value is FolderResponseIssueEvidence =>
  isRecord(value)
    && hasOnlyKeys(value, RESPONSE_ISSUE_KEYS)
    && isIssuePath(value.path)
    && typeof value.code === "string"
    && value.code.length <= 40
    && isOptionalString(value.expectedType)
    && isDiagnosticValueType(value.actualType);

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isNameDifferenceCategory = (value: unknown): value is FolderNameDifferenceCategory =>
  typeof value === "string" && NAME_DIFFERENCE_CATEGORIES.has(value);

const isBasenameComparisonEvidence = (value: unknown): value is FolderBasenameComparisonEvidence =>
  isRecord(value)
    && hasOnlyKeys(value, BASENAME_COMPARISON_KEYS)
    && isNonNegativeSafeInteger(value.basenameLength)
    && typeof value.equalAfterTrim === "boolean"
    && typeof value.equalAfterNfc === "boolean"
    && typeof value.equalIgnoringCase === "boolean"
    && isNonNegativeSafeInteger(value.firstDifferenceIndex)
    && isNameDifferenceCategory(value.basenameDifferenceCategory)
    && isNameDifferenceCategory(value.nameDifferenceCategory);

const isItemShapeEvidence = (value: unknown): value is FolderItemShapeEvidence => {
  if (!isRecord(value) || !Array.isArray(value.presentKeys) || value.presentKeys.length > 16
    || !hasOnlyKeys(value, ITEM_SHAPE_KEYS)
    || !value.presentKeys.every((key) => typeof key === "string" && PROTOCOL_KEYS.has(key))
    || !isRecord(value.fieldTypes)
    || Object.keys(value.fieldTypes).length > PROTOCOL_KEYS.size
    || !Object.keys(value.fieldTypes).every((key) => PROTOCOL_KEYS.has(key))
    || !Object.values(value.fieldTypes).every(isDiagnosticValueType)
    || !isRecord(value.flags)
    || !hasOnlyKeys(value.flags, ITEM_SHAPE_FLAG_KEYS)) {
    return false;
  }
  return isOptionalBoolean(value.isFolder)
    && (value.pathDepth === undefined || isNonNegativeSafeInteger(value.pathDepth))
    && (value.nameLength === undefined || isNonNegativeSafeInteger(value.nameLength))
    && (value.basenameComparison === undefined || isBasenameComparisonEvidence(value.basenameComparison))
    && typeof value.flags.hasControl === "boolean"
    && typeof value.flags.hasEdgeWhitespace === "boolean"
    && typeof value.flags.nonNfc === "boolean"
    && isOptionalBoolean(value.flags.hasEncodedSeparator)
    && isOptionalBoolean(value.flags.hasDotSegment);
};

const isFolderResponseRejectionEvidence = (value: unknown): value is FolderResponseRejectionEvidence => {
  if (!isRecord(value) || !hasOnlyKeys(value, REJECTION_KEYS)
    || typeof value.phase !== "string" || !REJECTION_PHASES.has(value.phase)) return false;
  if (!isOptionalFiniteNumber(value.status)
    || (value.contentType !== undefined && (typeof value.contentType !== "string" || !CONTENT_TYPE_CLASSES.has(value.contentType)))
    || !isOptionalFiniteNumber(value.payloadBytes)
    || !isOptionalString(value.workerBuild)
    || !isOptionalString(value.apiContract)
    || !isOptionalFiniteNumber(value.itemIndex)
    || !isOptionalFiniteNumber(value.truncatedIssueCount)
    || !isOptionalFiniteNumber(value.rejectedCount)
    || !isOptionalFiniteNumber(value.truncatedCount)) {
    return false;
  }
  return (value.issues === undefined
      || (Array.isArray(value.issues) && value.issues.length <= 10 && value.issues.every(isResponseIssueEvidence)))
    && (value.itemShape === undefined || isItemShapeEvidence(value.itemShape));
};

const isRedactedPathRef = (value: unknown): value is RedactedPathRef => {
  if (!isRecord(value) || !hasOnlyKeys(value, REDACTED_PATH_KEYS)) {
    return false;
  }
  return typeof value.alias === "string"
    && isFiniteNumber(value.depth)
    && isOptionalString(value.extension)
    && (value.kind === undefined || value.kind === "file" || value.kind === "folder");
};

const isEnvironment = (value: unknown): value is DiagnosticsEnvironment =>
  isRecord(value) && typeof value.appBuild === "string" && typeof value.userAgent === "string";

const isSessionContext = (value: unknown): value is DiagnosticsSessionContext =>
  isRecord(value)
    && isOptionalString(value.accountAlias)
    && isOptionalString(value.backendKind)
    && isOptionalString(value.themeMode)
    && (value.explicitOffline === undefined || typeof value.explicitOffline === "boolean");

const hasBase = (value: Record<string, unknown>): boolean =>
  typeof value.kind === "string" && typeof value.at === "string";

/** Structural validation for events read back from storage. */
export const isDiagnosticEvent = (value: unknown): value is DiagnosticEvent => {
  if (!isRecord(value) || !hasBase(value)) {
    return false;
  }
  switch (value.kind) {
    case "session.started":
      return isEnvironment(value.environment) && isSessionContext(value.context);
    case "session.ended":
      return (value.reason === "pagehide" || value.reason === "disabled" || value.reason === "replaced")
        && isFiniteNumber(value.durationMs);
    case "app.visibility":
      return value.state === "visible" || value.state === "hidden";
    case "app.connectivity":
      return (value.state === "online" || value.state === "offline") && isOptionalString(value.effectiveType);
    case "app.explicitOffline":
      return typeof value.enabled === "boolean";
    case "app.workerUnavailable":
      return typeof value.unavailable === "boolean";
    case "account.context":
      return isOptionalString(value.accountAlias)
        && isOptionalString(value.backendKind)
        && isOptionalString(value.sessionState);
    case "navigation.folder":
      return isRedactedPathRef(value.path);
    case "navigation.search":
      return typeof value.active === "boolean" && isOptionalFiniteNumber(value.resultCount);
    case "navigation.surface":
      return typeof value.surface === "string"
        && (value.state === "opened" || value.state === "closed");
    case "folder.load":
      return (value.outcome === "live" || value.outcome === "failed"
          || value.outcome === "offline" || value.outcome === "cancelled")
        && isOptionalString(value.errorKind)
        && isOptionalFiniteNumber(value.durationMs)
        && isOptionalFiniteNumber(value.itemCount);
    case "folder.response.rejected":
      return hasOnlyKeys(value, FOLDER_REJECTION_EVENT_KEYS)
        && isRedactedPathRef(value.path)
        && isFolderResponseRejectionEvidence(value.rejection);
    case "action.invoked":
      return typeof value.action === "string" && (value.detail === undefined || isRecord(value.detail));
    case "action.result":
      return typeof value.action === "string"
        && (value.outcome === "success" || value.outcome === "failure"
          || value.outcome === "cancelled" || value.outcome === "partial")
        && isOptionalFiniteNumber(value.durationMs)
        && isOptionalString(value.errorKind);
    case "transfer.finished":
      return (value.transferKind === "upload" || value.transferKind === "download" || value.transferKind === "sync" || value.transferKind === "copy" || value.transferKind === "move")
        && (value.phase === "done" || value.phase === "partial" || value.phase === "error" || value.phase === "canceled")
        && isOptionalFiniteNumber(value.itemCount)
        && isOptionalFiniteNumber(value.bytes);
    case "network.request":
      return (value.category === "auth" || value.category === "files" || value.category === "preview"
          || value.category === "download" || value.category === "health"
          || value.category === "mutation" || value.category === "other")
        && typeof value.method === "string"
        && typeof value.route === "string"
        && isFiniteNumber(value.durationMs)
        && (value.result === "2xx" || value.result === "4xx" || value.result === "5xx"
          || value.result === "network-error" || value.result === "aborted" || value.result === "blocked");
    case "cache.event":
      return (value.op === "cleared" || value.op === "keep-offline-added"
          || value.op === "keep-offline-removed" || value.op === "evicted")
        && isOptionalFiniteNumber(value.items)
        && isOptionalFiniteNumber(value.bytes);
    case "error.uncaught":
      return typeof value.message === "string"
        && isOptionalString(value.stack)
        && isOptionalString(value.context);
    case "error.rejection":
      return typeof value.reasonKind === "string" && typeof value.message === "string";
    case "error.reported":
      return (value.area === "list" || value.area === "mutation" || value.area === "bootstrap"
          || value.area === "preview" || value.area === "session" || value.area === "diagnostics")
        && typeof value.errorKind === "string";
    case "perf.marker":
      return typeof value.name === "string"
        && isFiniteNumber(value.durationMs)
        && isOptionalString(value.detail);
    default:
      return false;
  }
};

const isSessionMeta = (value: unknown): value is DiagnosticsSessionMeta => {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.id === "string"
    && typeof value.startedAt === "string"
    && isOptionalString(value.endedAt)
    && (value.endReason === undefined || value.endReason === "pagehide"
      || value.endReason === "disabled" || value.endReason === "replaced");
};

/**
 * Runtime-validate a persisted session record. Invalid or wrongly typed
 * payloads are rejected as a whole rather than partially repaired: a corrupt
 * log must never surface as trusted application state.
 */
export const isDiagnosticsSessionRecord = (value: unknown): value is DiagnosticsSessionRecord => {
  if (!isRecord(value) || (value.version !== 1 && value.version !== DIAGNOSTICS_SCHEMA_VERSION)) {
    return false;
  }
  if (!isSessionMeta(value.meta) || !Array.isArray(value.events)) {
    return false;
  }
  if (value.environment !== undefined && !isEnvironment(value.environment)) {
    return false;
  }
  if (value.context !== undefined && !isSessionContext(value.context)) {
    return false;
  }
  return value.events.every((event) => isDiagnosticEvent(event)
    && (value.version !== 1 || event.kind !== "folder.response.rejected"));
};

export const summarizeSessionRecord = (
  record: DiagnosticsSessionRecord,
  byteSize: number
): DiagnosticsSessionSummary => ({
  id: record.meta.id,
  startedAt: record.meta.startedAt,
  endedAt: record.meta.endedAt,
  eventCount: record.events.length,
  byteSize,
  eventKinds: [...new Set(record.events.map((event) => event.kind))]
});

/** Map raw event kinds to the display categories used in report previews. */
export const summaryCategories = (summaries: readonly DiagnosticsSessionSummary[]): readonly string[] =>
  eventCategories(summaries.flatMap((summary) => summary.eventKinds));
