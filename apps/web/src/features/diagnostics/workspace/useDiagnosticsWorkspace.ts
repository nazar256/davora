import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CHROME_SURFACE_KEYS } from "../../navigation";
import type { TransferTask } from "../../transfers";
import {
  isDiagnosticsSessionRecord,
  summaryCategories,
  type DiagnosticsSessionContext,
  type DiagnosticsSessionRecord,
  type DiagnosticsSessionSummary
} from "../model";
import { createDiagnosticsRecorder, type DiagnosticsRecorder } from "../recorder";
import { categorizeApiRoute, createDiagnosticsRedactor } from "../redaction";
import { buildBugReportBundle } from "../report/bundle";
import {
  buildSessionPickerEntries,
  type BugReportForm,
  type ReportBundlePreview
} from "../report/reportModel";
import type {
  DiagnosticsObservedContext,
  DiagnosticsWorkspace,
  DiagnosticsWorkspaceInput
} from "./ports";

const TERMINAL_TRANSFER_PHASES = new Set(["done", "partial", "error"]);

const CHROME_SURFACE_KEY_LIST = Object.values(CHROME_SURFACE_KEYS);

const formatBytesApprox = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const isTerminalTransferPhase = (phase: TransferTask["phase"]): phase is "done" | "partial" | "error" =>
  TERMINAL_TRANSFER_PHASES.has(phase);

const errorKindOf = (error: unknown): string =>
  error instanceof Error ? error.name : "Error";

/** Redactor used for call-site redaction when no live session exists. */
const fallbackRedactor = createDiagnosticsRedactor();

export function useDiagnosticsWorkspace(input: DiagnosticsWorkspaceInput): DiagnosticsWorkspace {
  const { enabled, ports } = input;
  const inputRef = useRef(input);
  inputRef.current = input;

  const recorderRef = useRef<DiagnosticsRecorder | undefined>(undefined);
  const observedContextRef = useRef<DiagnosticsObservedContext | undefined>(undefined);
  const emittedTransferIdsRef = useRef<Set<string>>(new Set());
  const [sessions, setSessions] = useState<readonly DiagnosticsSessionSummary[]>([]);
  const [selectedSessionIds, setSelectedSessionIds] = useState<ReadonlySet<string>>(new Set());
  const selectedSessionIdsRef = useRef(selectedSessionIds);
  selectedSessionIdsRef.current = selectedSessionIds;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | undefined>(undefined);

  const refreshSessions = useCallback(async () => {
    const result = await inputRef.current.ports.store.listSessions();
    if (result.ok) {
      setSessions(result.value);
    }
  }, []);

  // Recorder lifecycle: create when diagnostics are enabled, end on disable,
  // StrictMode replay, or unmount. All platform listeners live here so a
  // disabled state carries zero listeners, zero timers, and zero writes.
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const recorder = createDiagnosticsRecorder({
      store: ports.store,
      clock: ports.clock,
      ids: ports.ids,
      requestFlush: (flush) => {
        ports.lifecycle.scheduleFlush(() => {
          flush();
        }, 2_000);
      }
    });
    recorderRef.current = recorder;
    observedContextRef.current = undefined;
    emittedTransferIdsRef.current = new Set();
    setSelectedSessionIds(new Set());

    let disposed = false;
    void Promise.resolve(ports.environment.capture()).then((environment) => {
      if (disposed || !recorder.isActive()) {
        return;
      }
      recorder.setEnvironment(environment);
      const observed = inputRef.current.getContext();
      const context: DiagnosticsSessionContext = {
        themeMode: observed.themeMode,
        explicitOffline: observed.explicitOfflineMode,
        backendKind: observed.backendKind,
        accountAlias: recorder.redactor.alias("account", observed.accountId)
      };
      recorder.setContext(context);
      recorder.record({ kind: "session.started", environment, context });
      const startupMs = ports.lifecycle.startupDurationMs?.();
      if (typeof startupMs === "number" && Number.isFinite(startupMs)) {
        recorder.record({ kind: "perf.marker", name: "app.startup", durationMs: Math.round(startupMs) });
      }
      void recorder.flush();
    }).catch(() => undefined);

    const unsubscribeErrors = ports.errorCapture.subscribe((captured) => {
      if (captured.source === "error") {
        recorder.record({
          kind: "error.uncaught",
          message: recorder.redactor.message(captured.message),
          stack: captured.stack ? recorder.redactor.message(captured.stack, 1200) : undefined
        });
      } else {
        recorder.record({
          kind: "error.rejection",
          reasonKind: "unhandledrejection",
          message: recorder.redactor.message(captured.message)
        });
      }
    });
    const unsubscribeVisibility = ports.lifecycle.onVisibilityChange((state) => {
      recorder.record({ kind: "app.visibility", state });
      if (state === "hidden") {
        void recorder.flush();
      }
    });
    const unsubscribePageHide = ports.lifecycle.onPageHide(() => {
      void recorder.end("pagehide");
    });
    ports.network.setObserver((observation) => {
      const route = recorder.redactor.route(observation.url);
      recorder.record({
        kind: "network.request",
        category: categorizeApiRoute(route),
        method: observation.method,
        route,
        durationMs: Math.round(observation.durationMs),
        result: observation.result === "status"
          ? observation.status === undefined
            ? "network-error"
            : observation.status < 400 ? "2xx" : observation.status < 500 ? "4xx" : "5xx"
          : observation.result
      });
    });
    void refreshSessions();

    return () => {
      disposed = true;
      unsubscribeErrors();
      unsubscribeVisibility();
      unsubscribePageHide();
      ports.network.setObserver(null);
      if (recorderRef.current === recorder) {
        recorderRef.current = undefined;
      }
      void recorder.end(inputRef.current.enabled ? "replaced" : "disabled");
    };
  }, [enabled, ports, refreshSessions]);

  // Context diffing: translate observed app state transitions into events.
  // Runs on every render while enabled; the previous-snapshot ref dedupes.
  useEffect(() => {
    const recorder = recorderRef.current;
    if (!recorder || !recorder.isActive()) {
      return;
    }
    const context = inputRef.current.getContext();
    const previous = observedContextRef.current;
    observedContextRef.current = context;
    if (!previous) {
      return;
    }

    if (previous.currentPath !== context.currentPath) {
      recorder.record({
        kind: "navigation.folder",
        path: recorder.redactor.path(context.currentPath, "folder")
      });
    }
    if (previous.searchActive !== context.searchActive
      || (context.searchActive && previous.searchResultCount !== context.searchResultCount)) {
      recorder.record({
        kind: "navigation.search",
        active: context.searchActive,
        resultCount: context.searchResultCount
      });
    }
    if (previous.browserOffline !== context.browserOffline) {
      recorder.record({
        kind: "app.connectivity",
        state: context.browserOffline ? "offline" : "online"
      });
    }
    if (previous.explicitOfflineMode !== context.explicitOfflineMode) {
      recorder.record({ kind: "app.explicitOffline", enabled: context.explicitOfflineMode });
    }
    if (previous.workerUnavailable !== context.workerUnavailable) {
      recorder.record({ kind: "app.workerUnavailable", unavailable: context.workerUnavailable });
    }
    if (previous.accountId !== context.accountId || previous.sessionState !== context.sessionState) {
      recorder.record({
        kind: "account.context",
        accountAlias: recorder.redactor.alias("account", context.accountId),
        backendKind: context.backendKind,
        sessionState: context.sessionState
      });
    }
    if (previous.themeMode !== context.themeMode
      || previous.explicitOfflineMode !== context.explicitOfflineMode) {
      recorder.setContext({
        themeMode: context.themeMode,
        explicitOffline: context.explicitOfflineMode,
        backendKind: context.backendKind,
        accountAlias: recorder.redactor.alias("account", context.accountId)
      });
    }
    for (const key of CHROME_SURFACE_KEY_LIST) {
      if (previous.chrome[key] !== context.chrome[key]) {
        recorder.record({
          kind: "navigation.surface",
          surface: key,
          state: context.chrome[key] ? "opened" : "closed"
        });
      }
    }
    for (const task of context.transferTasks) {
      if (isTerminalTransferPhase(task.phase) && !emittedTransferIdsRef.current.has(task.id)) {
        emittedTransferIdsRef.current.add(task.id);
        recorder.record({
          kind: "transfer.finished",
          transferKind: task.kind,
          phase: task.phase,
          itemCount: task.kind === "sync" ? task.syncRootEntries.length : undefined,
          bytes: task.totalBytes ?? task.loadedBytes
        });
      }
    }
  });

  const openReport = useCallback(() => {
    const recorder = recorderRef.current;
    recorder?.recordAction("report-bug");
    if (recorder) {
      setSelectedSessionIds((previous) => {
        const next = new Set(previous);
        next.add(recorder.sessionId);
        return next;
      });
      // Flush first so the live session appears in the picker with real counts.
      void recorder.flush().then(() => refreshSessions()).catch(() => undefined);
    } else {
      void refreshSessions();
    }
    setExportError(undefined);
    inputRef.current.navigation.openReportBugSurface();
  }, [refreshSessions]);

  const closeReport = useCallback(() => {
    inputRef.current.navigation.closeReportBugSurface();
  }, []);

  const toggleSession = useCallback((sessionId: string) => {
    setSelectedSessionIds((previous) => {
      const next = new Set(previous);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const exportReport = useCallback(async (form: BugReportForm, mode: "download" | "share") => {
    const current = inputRef.current;
    setExporting(true);
    setExportError(undefined);
    try {
      const recorder = recorderRef.current;
      if (recorder) {
        await recorder.flush();
      }
      const records: DiagnosticsSessionRecord[] = [];
      for (const sessionId of selectedSessionIdsRef.current) {
        const result = await current.ports.store.readSession(sessionId);
        if (result.ok && isDiagnosticsSessionRecord(result.value)) {
          records.push(result.value);
        }
      }
      const bundle = await buildBugReportBundle({
        form,
        sessions: records,
        generatedAt: current.ports.clock.nowIso(),
        appBuild: current.appBuild
      });
      if (mode === "share") {
        const shared = await current.ports.exportPort.share(
          bundle.blob,
          bundle.filename,
          "Davora bug report"
        );
        if (!shared) {
          setExporting(false);
          return;
        }
      } else {
        current.ports.exportPort.saveFile(bundle.blob, bundle.filename);
      }
      recorder?.recordActionResult("export-report", "success", undefined, undefined);
      current.announce(mode === "share" ? "Bug report shared." : `Bug report downloaded as ${bundle.filename}.`);
      current.navigation.closeReportBugSurface();
    } catch (error) {
      recorderRef.current?.recordActionResult("export-report", "failure", undefined, errorKindOf(error));
      setExportError(errorKindOf(error));
    } finally {
      setExporting(false);
    }
  }, []);

  const clearData = useCallback(() => {
    const current = inputRef.current;
    current.ports.store.clear()
      .then((result) => {
        if (result.ok) {
          setSessions([]);
          setSelectedSessionIds(new Set());
          recorderRef.current?.recordAction("clear-diagnostics");
          current.announce("Diagnostic data cleared from this device.");
        } else {
          current.announce(`Could not clear diagnostic data: ${result.message}`);
        }
      })
      .catch((error: unknown) => {
        current.announce(`Could not clear diagnostic data: ${errorKindOf(error)}`);
      });
  }, []);

  const canShare = useMemo(() => {
    try {
      return ports.exportPort.sharingSupported();
    } catch {
      return false;
    }
  }, [ports.exportPort]);

  const listedSessions = useMemo<readonly DiagnosticsSessionSummary[]>(() => {
    const recorder = recorderRef.current;
    if (!recorder || sessions.some((session) => session.id === recorder.sessionId)) {
      return sessions;
    }
    const liveSummary: DiagnosticsSessionSummary = {
      id: recorder.sessionId,
      startedAt: recorder.sessionStartedAt,
      eventCount: recorder.bufferedEventCount(),
      byteSize: 0,
      eventKinds: []
    };
    return [liveSummary, ...sessions];
  }, [sessions]);

  const pickerSessions = useMemo(
    () => buildSessionPickerEntries(listedSessions, recorderRef.current?.sessionId, selectedSessionIds),
    [listedSessions, selectedSessionIds]
  );

  const preview = useMemo<ReportBundlePreview | undefined>(() => {
    const selected = listedSessions.filter((session) => selectedSessionIds.has(session.id));
    if (selected.length === 0) {
      return undefined;
    }
    return {
      sessionCount: selected.length,
      eventCount: selected.reduce((total, session) => total + session.eventCount, 0),
      estimatedBytes: selected.reduce((total, session) => total + session.byteSize, 0),
      categories: summaryCategories(selected)
    };
  }, [listedSessions, selectedSessionIds]);

  return {
    settingsSection: {
      active: enabled,
      storageSummary: enabled
        ? sessions.length > 0
          ? `${sessions.length} session log${sessions.length === 1 ? "" : "s"}, ${formatBytesApprox(sessions.reduce((total, session) => total + session.byteSize, 0))}`
          : "Logging active; no sessions written yet"
        : sessions.length > 0
          ? `${sessions.length} stored session log${sessions.length === 1 ? "" : "s"} kept on this device`
          : undefined,
      onClearData: clearData,
      onOpenReport: openReport
    },
    reportStage: {
      open: input.navigation.reportBugOpen,
      sessions: pickerSessions,
      preview,
      canShare,
      exporting,
      exportError,
      onClose: closeReport,
      onToggleSession: toggleSession,
      onExport: (form, mode) => { void exportReport(form, mode); }
    },
    reportBugQuickAction: {
      id: "report-bug",
      label: "Report bug",
      icon: "bug",
      visible: enabled,
      onSelect: openReport
    },
    commands: {
      openReport,
      closeReport,
      clearData,
      exportReport,
      recordAction: (action, detail) => { recorderRef.current?.recordAction(action, detail); },
      recordActionResult: (action, outcome, durationMs, errorKind) => {
        recorderRef.current?.recordActionResult(action, outcome, durationMs, errorKind);
      },
      record: (event) => { recorderRef.current?.record(event); },
      redactPath: (path, kind) => (recorderRef.current?.redactor ?? fallbackRedactor).path(path, kind)
    },
    refreshStorageSummary: () => { void refreshSessions(); }
  };
}
