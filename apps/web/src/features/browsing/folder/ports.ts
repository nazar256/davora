import type { FileEntry } from "@davora/shared";

import type { FolderCompleteness } from "./model";

export interface CachedFolder {
  readonly items: FileEntry[];
  readonly completeness: FolderCompleteness;
  readonly cachedAt?: string;
}

export type FolderResponseRejectionPhase =
  | "json-decode"
  | "envelope-schema"
  | "response-path-mismatch"
  | "items-not-array"
  | "item-schema"
  | "noncanonical-item-path"
  | "basename-mismatch"
  | "item-outside-folder";

export type FolderDiagnosticValueType = "undefined" | "null" | "boolean" | "number" | "string" | "array" | "object";
export type FolderNameDifferenceCategory = "end" | "control" | "whitespace" | "letter" | "number" | "mark" | "punctuation" | "symbol" | "other";

export interface FolderBasenameComparisonDiagnostic {
  readonly basenameLength: number;
  readonly equalAfterTrim: boolean;
  readonly equalAfterNfc: boolean;
  readonly equalIgnoringCase: boolean;
  readonly firstDifferenceIndex: number;
  readonly basenameDifferenceCategory: FolderNameDifferenceCategory;
  readonly nameDifferenceCategory: FolderNameDifferenceCategory;
}

export interface FolderResponseIssueDiagnostic {
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly expectedType?: string;
  readonly actualType: FolderDiagnosticValueType;
}

export interface FolderItemShapeDiagnostic {
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

export interface FolderResponseRejectionDiagnostic {
  readonly phase: FolderResponseRejectionPhase;
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

export type FolderLoadOutcome =
  | { readonly kind: "success"; readonly items: FileEntry[]; readonly completeness: Exclude<FolderCompleteness, "unknown"> }
  | {
      readonly kind: "unauthorized" | "reconnect-required" | "transient" | "failure";
      readonly error: Error;
      readonly diagnostic?: FolderResponseRejectionDiagnostic;
    }
  | { readonly kind: "cancelled" };

export interface FolderPorts {
  createAbortHandle(): { readonly signal: AbortSignal; abort(): void };
  loadFolder(input: { path: string; token: string; signal: AbortSignal }): Promise<FolderLoadOutcome>;
  readCachedFolder(cacheNamespace: string, path: string): CachedFolder | undefined;
  writeCachedFolder(cacheNamespace: string, path: string, items: FileEntry[], completeness: "complete" | "partial"): void;
}
