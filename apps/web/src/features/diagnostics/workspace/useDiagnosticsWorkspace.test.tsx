import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChromeSurfacesSnapshot } from "../../navigation";
import type { TransferTask } from "../../transfers";
import {
  createFakeDiagnosticsRuntimePorts
} from "../testing/fakes";
import { emptyBugReportForm } from "../report/reportModel";
import { useDiagnosticsWorkspace } from "./useDiagnosticsWorkspace";
import type { DiagnosticsObservedContext, DiagnosticsWorkspaceInput } from "./ports";

const closedChrome = (): ChromeSurfacesSnapshot => ({
  navigation: false,
  search: false,
  mobileDetails: false,
  settings: false,
  transfers: false,
  quickActions: false
});

const baseContext = (overrides: Partial<DiagnosticsObservedContext> = {}): DiagnosticsObservedContext => ({
  accountId: "acct-1",
  sessionState: "active",
  backendKind: "nextcloud",
  currentPath: "Documents",
  searchActive: false,
  browserOffline: false,
  explicitOfflineMode: false,
  workerUnavailable: false,
  themeMode: "dark",
  chrome: closedChrome(),
  transferTasks: [],
  ...overrides
});

interface Harness {
  input: DiagnosticsWorkspaceInput;
  ports: ReturnType<typeof createFakeDiagnosticsRuntimePorts>;
  navigation: { reportBugOpen: boolean; opened: string[]; closed: string[] };
  announce: ReturnType<typeof vi.fn>;
  setContext(next: DiagnosticsObservedContext): void;
}

const createHarness = (enabled = true): Harness => {
  const ports = createFakeDiagnosticsRuntimePorts();
  const navigation = { reportBugOpen: false, opened: [] as string[], closed: [] as string[] };
  const announce = vi.fn();
  let context = baseContext();
  const input: DiagnosticsWorkspaceInput = {
    enabled,
    appBuild: "test-build",
    sessionToken: "session-token",
    getContext: () => context,
    ports,
    navigation: {
      get reportBugOpen() { return navigation.reportBugOpen; },
      openReportBugSurface: () => { navigation.opened.push("report-bug"); navigation.reportBugOpen = true; },
      closeReportBugSurface: () => { navigation.closed.push("report-bug"); navigation.reportBugOpen = false; }
    },
    announce
  };
  return {
    input,
    ports,
    navigation,
    announce,
    setContext(next) { context = next; }
  };
};

const flushMicrotasks = async () => {
  await act(async () => { await Promise.resolve(); });
};

describe("useDiagnosticsWorkspace", () => {
  it("stays fully inert while diagnostics are disabled", async () => {
    const harness = createHarness(false);
    const { result, unmount } = renderHook(() => useDiagnosticsWorkspace(harness.input));
    await flushMicrotasks();

    expect(harness.ports.fakeStore.records.size).toBe(0);
    expect(result.current.settingsSection.active).toBe(false);
    expect(result.current.reportBugQuickAction.visible).toBe(false);
    result.current.commands.recordAction("upload");
    result.current.commands.record({ kind: "app.visibility", state: "visible" });
    await flushMicrotasks();
    expect(harness.ports.fakeStore.records.size).toBe(0);
    unmount();
  });

  it("starts a session, captures environment, and flushes the record when enabled", async () => {
    const harness = createHarness();
    const { result, unmount } = renderHook(() => useDiagnosticsWorkspace(harness.input));
    await flushMicrotasks();

    const record = [...harness.ports.fakeStore.records.values()][0];
    expect(record?.meta.id).toBe("fake-session-1");
    expect(record?.environment?.appBuild).toBe("test-build");
    expect(record?.context?.accountAlias).toBe("account-1");
    expect(record?.events.some((event) => event.kind === "session.started")).toBe(true);
    expect(record?.events.some((event) => event.kind === "perf.marker" && event.name === "app.startup")).toBe(true);
    const initialNavigation = record?.events.find((event) => event.kind === "navigation.folder");
    expect(initialNavigation?.kind === "navigation.folder" && initialNavigation.path).toMatchObject({
      alias: "path-1",
      depth: 1,
      kind: "folder"
    });
    expect(result.current.settingsSection.active).toBe(true);
    unmount();
  });

  it("records context transitions: navigation, connectivity, offline mode, account", async () => {
    const harness = createHarness();
    const { rerender, unmount } = renderHook(() => useDiagnosticsWorkspace(harness.input));
    await flushMicrotasks();

    harness.setContext(baseContext({
      currentPath: "Photos",
      browserOffline: true,
      explicitOfflineMode: true,
      workerUnavailable: true,
      accountId: "acct-2"
    }));
    rerender();

    // Context events live in the recorder buffer; unmount ends the session and flushes.
    await flushMicrotasks();
    unmount();
    await flushMicrotasks();

    const record = [...harness.ports.fakeStore.records.values()][0];
    const kinds = record?.events.map((event) => event.kind) ?? [];
    expect(kinds).toContain("navigation.folder");
    expect(kinds).toContain("app.connectivity");
    expect(kinds).toContain("app.explicitOffline");
    expect(kinds).toContain("app.workerUnavailable");
    expect(kinds).toContain("account.context");

    const nav = record?.events.find((event) => event.kind === "navigation.folder");
    expect(nav?.kind === "navigation.folder" && nav.path.alias).toMatch(/^path-\d+$/);
    const account = record?.events.find((event) => event.kind === "account.context");
    expect(account?.kind === "account.context" && account.accountAlias).toBe("account-2");
  });

  it("records uncaught errors and rejections with sanitized messages", async () => {
    const harness = createHarness();
    const { unmount } = renderHook(() => useDiagnosticsWorkspace(harness.input));
    await flushMicrotasks();

    act(() => {
      harness.ports.fakeErrors.emit({ source: "error", message: "Failed at https://example.com/x?token=abc" });
      harness.ports.fakeErrors.emit({ source: "unhandledrejection", message: "promise blew up" });
    });
    unmount();
    await flushMicrotasks();

    const record = [...harness.ports.fakeStore.records.values()][0];
    const uncaught = record?.events.find((event) => event.kind === "error.uncaught");
    expect(uncaught?.kind === "error.uncaught" && uncaught.message).not.toContain("example.com");
    expect(record?.events.some((event) => event.kind === "error.rejection")).toBe(true);
  });

  it("records network observations as sanitized requests", async () => {
    const harness = createHarness();
    const { unmount } = renderHook(() => useDiagnosticsWorkspace(harness.input));
    await flushMicrotasks();

    act(() => {
      harness.ports.fakeNetwork.emit({
        method: "GET",
        url: "https://worker.example.com/api/files?path=/secret&token=zzz",
        durationMs: 120,
        result: "status",
        status: 200
      });
      harness.ports.fakeNetwork.emit({
        method: "POST",
        url: "https://worker.example.com/api/accounts/connect",
        durationMs: 10,
        result: "network-error"
      });
    });
    unmount();
    await flushMicrotasks();

    const record = [...harness.ports.fakeStore.records.values()][0];
    const requests = record?.events.filter((event) => event.kind === "network.request") ?? [];
    expect(requests).toHaveLength(2);
    expect(requests[0]?.kind === "network.request" && requests[0].route).toBe("/api/files");
    expect(requests[0]?.kind === "network.request" && requests[0].result).toBe("2xx");
    expect(requests[1]?.kind === "network.request" && requests[1].category).toBe("auth");
    expect(requests[1]?.kind === "network.request" && requests[1].result).toBe("network-error");
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("token=zzz");
    expect(serialized).not.toContain("/secret");
  });

  it("ends the session on pagehide and on disable", async () => {
    const harness = createHarness();
    const { unmount } = renderHook(() => useDiagnosticsWorkspace(harness.input));
    await flushMicrotasks();

    act(() => harness.ports.fakeLifecycle.emitPageHide());
    await flushMicrotasks();

    let record = [...harness.ports.fakeStore.records.values()][0];
    expect(record?.meta.endReason).toBe("pagehide");
    expect(record?.events.some((event) => event.kind === "session.ended")).toBe(true);
    unmount();

    const second = createHarness();
    const enabledView = renderHook((props: { enabled: boolean }) =>
      useDiagnosticsWorkspace({ ...second.input, enabled: props.enabled }), { initialProps: { enabled: true } });
    await flushMicrotasks();
    enabledView.rerender({ enabled: false });
    await flushMicrotasks();
    record = [...second.ports.fakeStore.records.values()][0];
    expect(record?.meta.endReason).toBe("disabled");
    enabledView.unmount();
  });

  it("opens the report surface through the navigation port and preselects the live session", async () => {
    const harness = createHarness();
    const { result, unmount } = renderHook(() => useDiagnosticsWorkspace(harness.input));
    await flushMicrotasks();

    act(() => result.current.commands.openReport());
    await flushMicrotasks();

    expect(harness.navigation.opened).toEqual(["report-bug"]);
    expect(result.current.reportStage.open).toBe(true);
    const currentEntry = result.current.reportStage.sessions.find((session) => session.isCurrent);
    expect(currentEntry?.selected).toBe(true);
    unmount();
  });

  it("exposes the PER-85 quick-action descriptor only while enabled", async () => {
    const harness = createHarness();
    const { result, unmount } = renderHook(() => useDiagnosticsWorkspace(harness.input));
    await flushMicrotasks();

    expect(result.current.reportBugQuickAction).toMatchObject({
      id: "report-bug",
      label: "Report bug",
      icon: "bug",
      visible: true
    });
    act(() => result.current.reportBugQuickAction.onSelect());
    expect(harness.navigation.opened).toEqual(["report-bug"]);
    unmount();
  });

  it("exports a report bundle through the download path with no network calls", async () => {
    const harness = createHarness();
    const { result, unmount } = renderHook(() => useDiagnosticsWorkspace(harness.input));
    await flushMicrotasks();
    act(() => result.current.commands.openReport());
    await flushMicrotasks();

    await act(async () => {
      await result.current.commands.exportReport(
        { ...emptyBugReportForm(), summary: "Broken upload" },
        "download"
      );
    });

    expect(harness.ports.fakeExport.saved).toHaveLength(1);
    expect(harness.ports.fakeExport.saved[0]?.filename).toMatch(/^davora-bug-report-.*\.zip$/);
    expect(harness.announce).toHaveBeenCalledWith(expect.stringContaining("downloaded"));
    expect(harness.navigation.closed).toContain("report-bug");
    unmount();
  });

  it("uploads one generated bundle on explicit request and retains the receipt", async () => {
    const harness = createHarness();
    const { result, unmount } = renderHook(() => useDiagnosticsWorkspace(harness.input));
    await flushMicrotasks();
    act(() => result.current.commands.openReport());
    await flushMicrotasks();

    await act(async () => {
      await result.current.commands.uploadReport({ ...emptyBugReportForm(), summary: "Missing folder" });
    });

    expect(harness.ports.fakeUpload.uploaded).toHaveLength(1);
    expect(harness.ports.fakeUpload.uploaded[0]).toMatchObject({
      token: "session-token",
      appBuild: "test-build",
      diagnosticsSchema: 2
    });
    expect(result.current.reportStage.uploadReceipt?.reportId).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(harness.navigation.closed).not.toContain("report-bug");
    unmount();
  });

  it("reuses the immutable report id and bundle after an ambiguous upload failure", async () => {
    const harness = createHarness();
    const upload = vi.spyOn(harness.ports.fakeUpload, "upload")
      .mockRejectedValueOnce(new TypeError("network response lost"))
      .mockResolvedValueOnce({
        reportId: "123e4567-e89b-42d3-a456-426614174000",
        acceptedAt: "2026-09-24T09:27:59.000Z",
        expiresAfterDays: 30,
        duplicate: true
      });
    const { result, unmount } = renderHook(() => useDiagnosticsWorkspace(harness.input));
    await flushMicrotasks();
    act(() => result.current.commands.openReport());
    await flushMicrotasks();
    const form = { ...emptyBugReportForm(), summary: "Missing folder" };

    await act(async () => { await result.current.commands.uploadReport(form); });
    expect(result.current.reportStage.uploadReceipt).toBeUndefined();
    await act(async () => { await result.current.commands.uploadReport(form); });

    expect(upload).toHaveBeenCalledTimes(2);
    const first = upload.mock.calls[0]?.[0];
    const second = upload.mock.calls[1]?.[0];
    expect(second?.reportId).toBe(first?.reportId);
    expect(second?.generatedAt).toBe(first?.generatedAt);
    expect(second?.blob).toBe(first?.blob);
    expect(result.current.reportStage.uploadReceipt?.duplicate).toBe(true);
    unmount();
  });

  it("does not offer upload without a session or while offline", async () => {
    const harness = createHarness();
    harness.input = { ...harness.input, sessionToken: undefined };
    const { result, unmount } = renderHook(() => useDiagnosticsWorkspace(harness.input));
    await flushMicrotasks();
    expect(result.current.reportStage.canUpload).toBe(false);
    unmount();
  });

  it("clears stored diagnostics on user request", async () => {
    const harness = createHarness();
    const { result, unmount } = renderHook(() => useDiagnosticsWorkspace(harness.input));
    await flushMicrotasks();
    expect(harness.ports.fakeStore.records.size).toBeGreaterThan(0);

    act(() => result.current.commands.clearData());
    await flushMicrotasks();

    expect(harness.ports.fakeStore.records.size).toBe(0);
    expect(harness.announce).toHaveBeenCalledWith(expect.stringContaining("cleared"));
    unmount();
  });

  it("records terminal transfer tasks once", async () => {
    const harness = createHarness();
    const { rerender, unmount } = renderHook(() => useDiagnosticsWorkspace(harness.input));
    await flushMicrotasks();

    const task: TransferTask = {
      id: "transfer-1",
      accountId: "acc-1",
      label: "download",
      kind: "download",
      phase: "done",
      totalBytes: 1024,
      loadedBytes: 1024,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z"
    };
    harness.setContext(baseContext({ transferTasks: [task] }));
    rerender();
    rerender(); // a second render must not duplicate the event
    unmount();
    await flushMicrotasks();

    const record = [...harness.ports.fakeStore.records.values()][0];
    const finished = record?.events.filter((event) => event.kind === "transfer.finished") ?? [];
    expect(finished).toHaveLength(1);
    expect(finished[0]?.kind === "transfer.finished" && finished[0].transferKind).toBe("download");
  });
});
