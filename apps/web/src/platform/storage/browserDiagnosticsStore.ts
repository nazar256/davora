/**
 * IndexedDB-backed diagnostics log store (idb-keyval).
 *
 * Layout: one index key holding session summaries plus one record key per
 * session. All failures resolve to explicit `{ ok: false }` results so a
 * storage problem can never throw into application code.
 */

import { del, get, keys, set } from "idb-keyval";

const STORE_PREFIX = "davora-diagnostics:";
const INDEX_KEY = "davora-diagnostics:index";
const sessionKey = (sessionId: string): string => `${STORE_PREFIX}session:${sessionId}`;

/** Keep the live session plus this many ended sessions. */
const MAX_KEPT_SESSIONS = 4;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

interface SessionRecordLike {
  readonly meta: { readonly id: string; readonly startedAt: string; readonly endedAt?: string };
  readonly events: readonly { readonly kind: string }[];
}

interface SessionSummaryLike {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly eventCount: number;
  readonly byteSize: number;
  readonly eventKinds: readonly string[];
}

interface StoreIndex {
  readonly version: 1;
  readonly sessions: SessionSummaryLike[];
}

export type DiagnosticsStoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const ok = <T>(value: T): DiagnosticsStoreResult<T> => ({ ok: true, value });
const fail = <T>(error: unknown): DiagnosticsStoreResult<T> => ({
  ok: false,
  message: error instanceof Error ? error.message : "Diagnostics storage failed."
});

const isSessionSummary = (value: unknown): value is SessionSummaryLike => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return "id" in value && typeof value.id === "string"
    && "startedAt" in value && typeof value.startedAt === "string"
    && "eventCount" in value && typeof value.eventCount === "number"
    && "byteSize" in value && typeof value.byteSize === "number"
    && "eventKinds" in value && Array.isArray(value.eventKinds)
    && (!("endedAt" in value) || value.endedAt === undefined || typeof value.endedAt === "string");
};

const isStoreIndex = (value: unknown): value is StoreIndex =>
  typeof value === "object" && value !== null
    && "version" in value && value.version === 1
    && "sessions" in value && Array.isArray(value.sessions)
    && value.sessions.every(isSessionSummary);

const summarize = (record: SessionRecordLike): SessionSummaryLike => ({
  id: record.meta.id,
  startedAt: record.meta.startedAt,
  endedAt: record.meta.endedAt,
  eventCount: record.events.length,
  byteSize: JSON.stringify(record).length,
  eventKinds: [...new Set(record.events.map((event) => event.kind))]
});

const readIndex = async (): Promise<StoreIndex> => {
  const raw = await get<unknown>(INDEX_KEY);
  return isStoreIndex(raw) ? raw : { version: 1, sessions: [] };
};

const sessionKeys = async (): Promise<string[]> =>
  (await keys()).filter((key): key is string =>
    typeof key === "string" && key.startsWith(`${STORE_PREFIX}session:`));

export interface BrowserDiagnosticsStore {
  writeSession(record: SessionRecordLike): Promise<DiagnosticsStoreResult<void>>;
  readSession(id: string): Promise<DiagnosticsStoreResult<unknown>>;
  listSessions(): Promise<DiagnosticsStoreResult<readonly SessionSummaryLike[]>>;
  prune(): Promise<DiagnosticsStoreResult<void>>;
  clear(): Promise<DiagnosticsStoreResult<void>>;
}

export const createBrowserDiagnosticsStore = (): BrowserDiagnosticsStore => ({
  async writeSession(record) {
    try {
      const summary = summarize(record);
      await set(sessionKey(summary.id), record);
      const index = await readIndex();
      const sessions = [summary, ...index.sessions.filter((entry) => entry.id !== summary.id)]
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      await set(INDEX_KEY, { version: 1, sessions } satisfies StoreIndex);
      return ok(undefined);
    } catch (error) {
      return fail(error);
    }
  },

  async readSession(id) {
    try {
      return ok(await get<unknown>(sessionKey(id)));
    } catch (error) {
      return fail(error);
    }
  },

  async listSessions() {
    try {
      const index = await readIndex();
      return ok(index.sessions);
    } catch (error) {
      return fail(error);
    }
  },

  async prune() {
    try {
      const index = await readIndex();
      const sorted = [...index.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const kept: SessionSummaryLike[] = [];
      const dropped: SessionSummaryLike[] = [];
      let totalBytes = 0;
      for (const summary of sorted) {
        if (kept.length < MAX_KEPT_SESSIONS && totalBytes + summary.byteSize <= MAX_TOTAL_BYTES) {
          kept.push(summary);
          totalBytes += summary.byteSize;
        } else {
          dropped.push(summary);
        }
      }
      if (dropped.length === 0) {
        return ok(undefined);
      }
      for (const summary of dropped) {
        await del(sessionKey(summary.id));
      }
      await set(INDEX_KEY, { version: 1, sessions: kept } satisfies StoreIndex);
      return ok(undefined);
    } catch (error) {
      return fail(error);
    }
  },

  async clear() {
    try {
      const storeKeys = await sessionKeys();
      for (const key of storeKeys) {
        await del(key);
      }
      await del(INDEX_KEY);
      return ok(undefined);
    } catch (error) {
      return fail(error);
    }
  }
});
