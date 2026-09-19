/**
 * Bounded per-session diagnostic recorder.
 *
 * The recorder keeps the current session's event list in memory (capped),
 * persists it through the injected store, and never lets a logging failure
 * escape into application code: every public method is total and swallows
 * internal failures into an explicit `degraded` flag.
 */

import {
  DIAGNOSTICS_BUFFER_FLUSH_EVENT_COUNT,
  DIAGNOSTICS_MAX_EVENTS_PER_SESSION,
  DIAGNOSTICS_MAX_SESSION_BYTES,
  DIAGNOSTICS_SCHEMA_VERSION,
  type DiagnosticActionName,
  type DiagnosticEvent,
  type DiagnosticsEnvironment,
  type DiagnosticsSessionContext,
  type DiagnosticsSessionRecord
} from "./model";
import type {
  DiagnosticEventInput,
  DiagnosticsClock,
  DiagnosticsIdGenerator,
  DiagnosticsStore
} from "./ports";
import { createDiagnosticsRedactor, type DiagnosticsRedactor } from "./redaction";

export interface DiagnosticsRecorderInput {
  readonly store: DiagnosticsStore;
  readonly clock: DiagnosticsClock;
  readonly ids: DiagnosticsIdGenerator;
  readonly environment?: DiagnosticsEnvironment;
  readonly context?: DiagnosticsSessionContext;
  /** Called when the buffer crosses the flush threshold; platform schedules a flush. */
  readonly requestFlush?: (flush: () => void) => void;
}

export interface DiagnosticsRecorder {
  readonly sessionId: string;
  readonly sessionStartedAt: string;
  readonly bufferedEventCount: () => number;
  readonly redactor: DiagnosticsRedactor;
  /** True after a store failure; the recorder keeps working in memory only. */
  readonly degraded: () => boolean;
  readonly isActive: () => boolean;
  readonly record: (event: DiagnosticEventInput) => void;
  readonly recordAction: (
    action: DiagnosticActionName,
    detail?: Record<string, string | number | boolean>
  ) => void;
  readonly recordActionResult: (
    action: DiagnosticActionName,
    outcome: "success" | "failure" | "cancelled" | "partial",
    durationMs?: number,
    errorKind?: string
  ) => void;
  readonly setEnvironment: (environment: DiagnosticsEnvironment) => void;
  readonly setContext: (context: DiagnosticsSessionContext) => void;
  readonly flush: () => Promise<void>;
  /** End the session; further `record` calls become no-ops. */
  readonly end: (reason: "pagehide" | "disabled" | "replaced") => Promise<void>;
}

export const createDiagnosticsRecorder = (input: DiagnosticsRecorderInput): DiagnosticsRecorder => {
  const sessionId = input.ids.next();
  const startedAt = input.clock.nowIso();
  const startedMs = input.clock.nowMs();
  const redactor = createDiagnosticsRedactor();

  let events: DiagnosticEvent[] = [];
  let environment = input.environment;
  let context = input.context;
  let ended = false;
  let endReason: "pagehide" | "disabled" | "replaced" | undefined;
  let endedAt: string | undefined;
  let degraded = false;
  let flushing: Promise<void> | undefined;
  let flushRequested = false;
  let droppedEventCount = 0;
  let approxBytes = 0;

  const toRecord = (): DiagnosticsSessionRecord => ({
    version: DIAGNOSTICS_SCHEMA_VERSION,
    meta: { id: sessionId, startedAt, endedAt, endReason },
    environment,
    context,
    events
  });

  const record = (event: DiagnosticEventInput): void => {
    if (ended) {
      return;
    }
    try {
      const stamped = { ...event, at: input.clock.nowIso() } as DiagnosticEvent;
      if (events.length >= DIAGNOSTICS_MAX_EVENTS_PER_SESSION
        || approxBytes >= DIAGNOSTICS_MAX_SESSION_BYTES) {
        droppedEventCount += 1;
        return;
      }
      approxBytes += JSON.stringify(stamped).length;
      events.push(stamped);
      if (!flushRequested && events.length >= DIAGNOSTICS_BUFFER_FLUSH_EVENT_COUNT) {
        flushRequested = true;
        input.requestFlush?.(() => {
          flushRequested = false;
          void recorder.flush();
        });
      }
    } catch {
      degraded = true;
    }
  };

  const flush = async (): Promise<void> => {
    if (flushing) {
      return flushing;
    }
    flushing = (async () => {
      try {
        const result = await input.store.writeSession(toRecord());
        if (!result.ok) {
          degraded = true;
          return;
        }
        const prune = await input.store.prune();
        if (!prune.ok) {
          degraded = true;
        }
      } catch {
        degraded = true;
      }
    })().finally(() => {
      flushing = undefined;
    });
    return flushing;
  };

  const recorder: DiagnosticsRecorder = {
    sessionId,
    sessionStartedAt: startedAt,
    bufferedEventCount: () => events.length,
    redactor,
    degraded: () => degraded,
    isActive: () => !ended,
    record,
    recordAction(action, detail) {
      record({ kind: "action.invoked", action, detail });
    },
    recordActionResult(action, outcome, durationMs, errorKind) {
      record({ kind: "action.result", action, outcome, durationMs, errorKind });
    },
    setEnvironment(next) {
      environment = next;
    },
    setContext(next) {
      context = next;
    },
    flush,
    async end(reason) {
      if (ended) {
        return;
      }
      ended = true;
      endReason = reason;
      endedAt = input.clock.nowIso();
      try {
        events.push({
          kind: "session.ended",
          at: endedAt,
          reason,
          durationMs: Math.max(0, input.clock.nowMs() - startedMs)
        });
        if (droppedEventCount > 0) {
          events.push({
            kind: "perf.marker",
            at: endedAt,
            name: "diagnostics.dropped-events",
            durationMs: 0,
            detail: `${droppedEventCount} event(s) dropped at the per-session cap`
          });
        }
      } catch {
        degraded = true;
      }
      await flush();
    }
  };

  return recorder;
};
