import type {
  DiagnosticsSessionRecord,
  DiagnosticsSessionSummary
} from "../model";
import { isDiagnosticsSessionRecord, summarizeSessionRecord } from "../model";
import type {
  CapturedDiagnosticError,
  DiagnosticsClock,
  DiagnosticsEnvironmentPort,
  DiagnosticsErrorCapturePort,
  DiagnosticsExportPort,
  DiagnosticsIdGenerator,
  DiagnosticsLifecyclePort,
  DiagnosticsNetworkObservation,
  DiagnosticsNetworkObservationPort,
  DiagnosticsRuntimePorts,
  DiagnosticsStore,
  DiagnosticsStoreResult
} from "../ports";

export interface FakeDiagnosticsStore extends DiagnosticsStore {
  readonly records: Map<string, DiagnosticsSessionRecord>;
}

const ok = <T>(value: T): DiagnosticsStoreResult<T> => ({ ok: true, value });
const SESSION_LIMIT = 4;

export const createFakeDiagnosticsStore = (): FakeDiagnosticsStore => {
  const records = new Map<string, DiagnosticsSessionRecord>();
  return {
    records,
    async writeSession(record) {
      records.set(record.meta.id, record);
      return ok(undefined);
    },
    async readSession(id) {
      const record = records.get(id);
      return ok(record && isDiagnosticsSessionRecord(record) ? record : undefined);
    },
    async listSessions() {
      const summaries: DiagnosticsSessionSummary[] = [...records.values()]
        .map((record) => summarizeSessionRecord(record, JSON.stringify(record).length))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return ok(summaries);
    },
    async prune() {
      while (records.size > SESSION_LIMIT) {
        const oldest = [...records.values()].sort((a, b) => a.meta.startedAt.localeCompare(b.meta.startedAt))[0];
        if (!oldest) break;
        records.delete(oldest.meta.id);
      }
      return ok(undefined);
    },
    async clear() {
      records.clear();
      return ok(undefined);
    }
  };
};

export const createFakeDiagnosticsClock = (startMs = 1_700_000_000_000): DiagnosticsClock & { readonly advance: (ms: number) => void } => {
  let current = startMs;
  return {
    nowMs: () => current,
    nowIso: () => new Date(current).toISOString(),
    advance: (ms: number) => {
      current += ms;
    }
  };
};

export const createFakeDiagnosticsIds = (): DiagnosticsIdGenerator => {
  let counter = 0;
  return {
    next: () => `fake-session-${(counter += 1)}`
  };
};

export const createFakeDiagnosticsEnvironment = (): DiagnosticsEnvironmentPort => ({
  capture: () => ({
    appBuild: "test-build",
    userAgent: "fake-agent",
    platform: "test",
    language: "en",
    viewport: { width: 1280, height: 800 },
    displayMode: "browser",
    onLine: true
  })
});

export const createFakeDiagnosticsErrorCapture = (): DiagnosticsErrorCapturePort & {
  readonly emit: (error: CapturedDiagnosticError) => void;
} => {
  const listeners = new Set<(error: CapturedDiagnosticError) => void>();
  return {
    subscribe(onError) {
      listeners.add(onError);
      return () => listeners.delete(onError);
    },
    emit(error) {
      for (const listener of listeners) {
        listener(error);
      }
    }
  };
};

export const createFakeDiagnosticsLifecycle = (): DiagnosticsLifecyclePort & {
  readonly emitVisibility: (state: "visible" | "hidden") => void;
  readonly emitPageHide: () => void;
  readonly flushNow: () => void;
} => {
  const visibility = new Set<(state: "visible" | "hidden") => void>();
  const pageHide = new Set<() => void>();
  let scheduled: (() => void) | undefined;
  return {
    onVisibilityChange(callback) {
      visibility.add(callback);
      return () => visibility.delete(callback);
    },
    onPageHide(callback) {
      pageHide.add(callback);
      return () => pageHide.delete(callback);
    },
    scheduleFlush(callback) {
      scheduled = callback;
      return () => {
        if (scheduled === callback) {
          scheduled = undefined;
        }
      };
    },
    startupDurationMs: () => 1234,
    emitVisibility(state) {
      for (const callback of visibility) {
        callback(state);
      }
    },
    emitPageHide() {
      for (const callback of pageHide) {
        callback();
      }
    },
    flushNow() {
      scheduled?.();
    }
  };
};

export const createFakeDiagnosticsExport = (): DiagnosticsExportPort & {
  readonly saved: { blob: Blob; filename: string }[];
  readonly shared: { blob: Blob; filename: string; title: string }[];
} => ({
  saved: [],
  shared: [],
  saveFile(blob, filename) {
    this.saved.push({ blob, filename });
  },
  sharingSupported: () => true,
  async share(blob, filename, title) {
    this.shared.push({ blob, filename, title });
    return true;
  }
});

export const createFakeDiagnosticsNetwork = (): DiagnosticsNetworkObservationPort & {
  readonly emit: (observation: DiagnosticsNetworkObservation) => void;
} => {
  let observer: ((observation: DiagnosticsNetworkObservation) => void) | null = null;
  return {
    setObserver(next) {
      observer = next;
    },
    emit(observation) {
      observer?.(observation);
    }
  };
};

export const createFakeDiagnosticsRuntimePorts = (): DiagnosticsRuntimePorts & {
  readonly fakeStore: FakeDiagnosticsStore;
  readonly fakeErrors: ReturnType<typeof createFakeDiagnosticsErrorCapture>;
  readonly fakeLifecycle: ReturnType<typeof createFakeDiagnosticsLifecycle>;
  readonly fakeExport: ReturnType<typeof createFakeDiagnosticsExport>;
  readonly fakeNetwork: ReturnType<typeof createFakeDiagnosticsNetwork>;
} => {
  const fakeStore = createFakeDiagnosticsStore();
  const fakeErrors = createFakeDiagnosticsErrorCapture();
  const fakeLifecycle = createFakeDiagnosticsLifecycle();
  const fakeExport = createFakeDiagnosticsExport();
  const fakeNetwork = createFakeDiagnosticsNetwork();
  return {
    store: fakeStore,
    environment: createFakeDiagnosticsEnvironment(),
    errorCapture: fakeErrors,
    lifecycle: fakeLifecycle,
    exportPort: fakeExport,
    network: fakeNetwork,
    clock: createFakeDiagnosticsClock(),
    ids: createFakeDiagnosticsIds(),
    fakeStore,
    fakeErrors,
    fakeLifecycle,
    fakeExport,
    fakeNetwork
  };
};
