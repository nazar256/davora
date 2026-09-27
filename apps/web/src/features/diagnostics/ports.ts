import type {
  DiagnosticEvent,
  DiagnosticsEnvironment,
  DiagnosticsSessionRecord,
  DiagnosticsSessionSummary
} from "./model";
import type { DiagnosticReportReceipt } from "@davora/shared";

/** Millisecond-resolution clock for durations. */
export interface DiagnosticsClock {
  nowMs(): number;
  nowIso(): string;
}

/** Opaque identifier generator; the platform adapter uses secure entropy. */
export interface DiagnosticsIdGenerator {
  next(): string;
}

export type DiagnosticsStoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

/**
 * Persistent log store. Implementations live in `platform/` and are
 * structurally typed at the composition root. All operations resolve with an
 * explicit failure instead of throwing so diagnostics can never crash the app.
 */
export interface DiagnosticsStore {
  /** Persist a full session record (create or replace). */
  writeSession(record: DiagnosticsSessionRecord): Promise<DiagnosticsStoreResult<void>>;
  /**
   * Load one stored session payload for export. The payload is untrusted;
   * callers must validate it with `isDiagnosticsSessionRecord` before use.
   */
  readSession(id: string): Promise<DiagnosticsStoreResult<unknown>>;
  /** List retained sessions, newest first. */
  listSessions(): Promise<DiagnosticsStoreResult<readonly DiagnosticsSessionSummary[]>>;
  /** Enforce retention caps; returns nothing meaningful on success. */
  prune(): Promise<DiagnosticsStoreResult<void>>;
  /** Delete every retained session and the index. */
  clear(): Promise<DiagnosticsStoreResult<void>>;
}

export interface DiagnosticsEnvironmentPort {
  /** Snapshot browser/device facts; must not request permissions. */
  capture(): DiagnosticsEnvironment | Promise<DiagnosticsEnvironment>;
}

export interface CapturedDiagnosticError {
  readonly source: "error" | "unhandledrejection";
  readonly message: string;
  readonly stack?: string;
}

export interface DiagnosticsErrorCapturePort {
  /** Install global error listeners; returns an unsubscribe function. */
  subscribe(onError: (error: CapturedDiagnosticError) => void): () => void;
}

export interface DiagnosticsLifecyclePort {
  /** Subscribe to visibility changes; returns an unsubscribe function. */
  onVisibilityChange(callback: (state: "visible" | "hidden") => void): () => void;
  /** Subscribe to page teardown; returns an unsubscribe function. */
  onPageHide(callback: () => void): () => void;
  /** Schedule a deferred flush; returns a cancel function. */
  scheduleFlush(callback: () => void, delayMs: number): () => void;
  /** Current startup timing in milliseconds since navigation start, if known. */
  startupDurationMs?(): number | undefined;
}

export interface DiagnosticsExportPort {
  /** Save a bundle to the device via the platform download mechanism. */
  saveFile(blob: Blob, filename: string): void;
  /** Whether the platform share sheet can accept a generated file. */
  sharingSupported(): boolean;
  /**
   * Share the bundle through the platform share sheet; resolves false when
   * unavailable or cancelled, throws on unexpected failure.
   */
  share(blob: Blob, filename: string, title: string): Promise<boolean>;
}

export interface DiagnosticsReportUploadInput {
  readonly reportId: string;
  readonly blob: Blob;
  readonly generatedAt: string;
  readonly diagnosticsSchema: number;
  readonly appBuild: string;
  readonly token: string;
}

export interface DiagnosticsReportUploadPort {
  /** Create the stable idempotency key for one user-visible send attempt. */
  createReportId(): string;
  /** Upload is invoked only by an explicit user action; implementations must not retry automatically. */
  upload(input: DiagnosticsReportUploadInput): Promise<DiagnosticReportReceipt>;
}

export interface DiagnosticsNetworkObservationPort {
  /** Install or remove the backend request observer (null disables). */
  setObserver(observer: ((observation: DiagnosticsNetworkObservation) => void) | null): void;
}

export interface DiagnosticsNetworkObservation {
  readonly method: string;
  readonly url: string;
  readonly durationMs: number;
  readonly result: "status" | "network-error" | "aborted" | "blocked";
  readonly status?: number;
}

export interface DiagnosticsRuntimePorts {
  readonly store: DiagnosticsStore;
  readonly environment: DiagnosticsEnvironmentPort;
  readonly errorCapture: DiagnosticsErrorCapturePort;
  readonly lifecycle: DiagnosticsLifecyclePort;
  readonly exportPort: DiagnosticsExportPort;
  readonly uploadPort: DiagnosticsReportUploadPort;
  readonly network: DiagnosticsNetworkObservationPort;
  readonly clock: DiagnosticsClock;
  readonly ids: DiagnosticsIdGenerator;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** Event payload without the timestamp; the recorder stamps `at` itself. */
export type DiagnosticEventInput = DistributiveOmit<DiagnosticEvent, "at">;
