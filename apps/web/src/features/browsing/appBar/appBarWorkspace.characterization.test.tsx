// @vitest-environment jsdom

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { isValidElement, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppBarStage, type AppBarStageProps } from "./AppBarStage";
import { useAppBarSortPanel } from "./useAppBarSortPanel";
import type { AppBarSortPanelBinding } from "./useAppBarSortPanel";
import { useAppBarWorkspace, type AppBarWorkspaceOwners } from "./workspace";
import type { FolderSortResetBinding } from "../folderSort";
import type { SortMode } from "../model";
import { useTransferTray } from "../../transfers/tray/useTransferTray";
import { TransferTrayStage } from "../../transfers/tray/TransferTrayStage";
import type { TransferTask } from "../../transfers/model";

const presentationSource = readFileSync(resolve(process.cwd(), "src/app/useAppWorkspacePresentation.ts"), "utf8");
const appBarPath = resolve(process.cwd(), "src/features/browsing/appBar");

function buildResetBinding(overrides: Partial<FolderSortResetBinding> = {}): FolderSortResetBinding {
  return { confirming: false, count: 0, request: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), ...overrides };
}

function buildSortPanel(overrides: Partial<AppBarSortPanelBinding> = {}): AppBarSortPanelBinding {
  return { open: false, toggle: vi.fn(), select: vi.fn(), reset: buildResetBinding(), ...overrides };
}

function buildProps(overrides: Partial<AppBarStageProps> = {}): AppBarStageProps {
  return {
    supportText: "Online",
    hasAccounts: true,
    compactMobileHeader: false,
    navigationDrawerOpen: false,
    mobileSearchOpen: false,
    searchQuery: "",
    currentPath: "Projects/Plans",
    currentFolderLabel: "Plans",
    sortPanel: buildSortPanel(),
    sortMode: "name-asc",
    showRoutineCachedRefresh: false,
    cacheOnlyMode: false,
    explicitOfflineMode: false,
    offline: false,
    workerUnavailable: false,
    install: { available: false, busy: false, onInstall: vi.fn() },
    hasSession: true,
    screenWakeLockActive: false,
    screenWakeLockReasonLabel: "media playback",
    onOpenNavigationDrawer: vi.fn(),
    onSearchQueryChange: vi.fn(),
    onCloseMobileSearch: vi.fn(),
    onNavigateUp: vi.fn(),
    onOpenMobileSearch: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides
  };
}

function buildWorkspaceOwners(currentPath: string, navigateToPath: (path: string) => void): AppBarWorkspaceOwners {
  return {
    account: { totalAccountCount: 0 },
    session: {},
    bootstrap: { gate: { kind: "continue" }, appBarSupportText: "Online", cacheOnlyMode: false, workerUnavailable: false },
    connectivity: { offline: false },
    viewport: { isNarrowScreen: false },
    browsing: {
      query: { raw: "", set: vi.fn() },
      presentation: { folderLabel: "Home", locationLabel: "Online", showRoutineCachedRefresh: false },
      sort: { mode: "name-asc", saved: false, select: vi.fn(), reset: buildResetBinding() }
    },
    navigation: {
      currentPath,
      navigationDrawerOpen: false,
      mobileSearchOpen: false,
      transferOpen: false,
      openChrome: vi.fn(),
      closeChrome: vi.fn(),
      navigateToPath
    },
    offline: { explicitOfflineMode: false },
    pwa: { install: { available: false, busy: false, onInstall: vi.fn() } },
    wakeLock: { active: false, reasonLabel: "media playback" },
    transfers: { tasks: [], clearAccountHistory: vi.fn() },
    offlineSync: { commands: { retry: vi.fn() } }
  };
}

describe("AppBar application boundary characterization", () => {
  afterEach(cleanup);

  it("projects bootstrap, workspace, account, session, compact, and status facts", () => {
    const { rerender } = render(<AppBarStage {...buildProps({ hasAccounts: false, hasSession: false, supportText: "Connect an account", offline: true, workerUnavailable: true, cacheOnlyMode: true })} />);
    expect(screen.getByRole("heading", { name: "Davora" })).toBeInTheDocument();
    expect(screen.getByText("Connect an account")).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open navigation menu/i })).not.toBeInTheDocument();

    rerender(<AppBarStage {...buildProps({ compactMobileHeader: true, currentPath: "", currentFolderLabel: "Home", explicitOfflineMode: true, showRoutineCachedRefresh: true, workerUnavailable: true })} />);
    expect(screen.getByText("Home")).toHaveClass("mobile-app-bar-title");
    expect(screen.getByRole("status", { name: "Refreshing cached folder" })).toBeInTheDocument();
    expect(screen.queryByText("Online")).not.toBeInTheDocument();
    cleanup();
  });

  it("forwards drawer, search, settings, query, close, and navigate-up commands", () => {
    const commands = {
      drawer: vi.fn(), search: vi.fn(), close: vi.fn(), settings: vi.fn(), query: vi.fn(), up: vi.fn()
    };
    render(<AppBarStage {...buildProps({ compactMobileHeader: true, mobileSearchOpen: true, onOpenNavigationDrawer: commands.drawer, onOpenMobileSearch: commands.search, onCloseMobileSearch: commands.close, onOpenSettings: commands.settings, onSearchQueryChange: commands.query, onNavigateUp: commands.up })} />);
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search files" }), { target: { value: "road" } });
    expect(commands.close).toHaveBeenCalledTimes(1);
    expect(commands.query).toHaveBeenCalledWith("road");

    cleanup();
    render(<AppBarStage {...buildProps({ compactMobileHeader: true, mobileSearchOpen: false, onOpenNavigationDrawer: commands.drawer, onOpenMobileSearch: commands.search, onOpenSettings: commands.settings, onNavigateUp: commands.up })} />);
    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    fireEvent.click(screen.getByRole("button", { name: "Go up one folder level" }));
    expect(commands.drawer).toHaveBeenCalledTimes(1);
    expect(commands.search).toHaveBeenCalledTimes(1);
    expect(commands.up).toHaveBeenCalledTimes(1);
  });

  it("preserves sort select-before-close, newest callback, throw-keeps-open, StrictMode, and unmount behavior", () => {
    const changes: string[] = [];
    const { result, rerender, unmount } = renderHook(({ callback }) => useAppBarSortPanel({ sort: { select: callback, reset: buildResetBinding() } }), {
      initialProps: { callback: (mode: SortMode) => { changes.push(mode); } },
      wrapper: StrictMode
    });
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => result.current.select("name-desc"));
    expect(changes).toEqual(["name-desc"]);
    expect(result.current.open).toBe(false);
    rerender({ callback: () => { throw new Error("sort failure"); } });
    act(() => result.current.toggle());
    expect(() => result.current.select("name-asc")).toThrow("sort failure");
    expect(result.current.open).toBe(true);
    unmount();
  });

  it("keeps transfer tray account-scoped and delegates toggle, clear, retry, replacement, and no-account behavior", () => {
    const alphaTask: TransferTask = { id: "alpha-sync", accountId: "alpha", kind: "sync", dedupeKey: "alpha-sync", syncRootEntries: [], label: "Alpha sync", loadedBytes: 0, startedAt: "2026-08-05T00:00:00Z", phase: "error", finishedAt: "2026-08-05T00:01:00Z", errorMessage: "retry alpha", failedFiles: [{ sourcePath: "alpha.txt", error: "retry alpha" }] };
    const betaTask: TransferTask = { id: "beta-sync", accountId: "beta", kind: "sync", dedupeKey: "beta-sync", syncRootEntries: [], label: "Beta sync", loadedBytes: 0, startedAt: "2026-08-05T00:00:00Z", phase: "error", finishedAt: "2026-08-05T00:01:00Z", errorMessage: "retry beta", failedFiles: [{ sourcePath: "beta.txt", error: "retry beta" }] };
    const activeAlpha: TransferTask = { id: "alpha-active", accountId: "alpha", kind: "upload", label: "alpha.txt", loadedBytes: 0, startedAt: "2026-08-05T00:00:00Z", phase: "transferring" };
    const ledger = [alphaTask, betaTask, activeAlpha];
    const alphaChrome = { isOpen: true, open: vi.fn(), close: vi.fn() };
    const betaChrome = { isOpen: false, open: vi.fn(), close: vi.fn() };
    const alphaClear = vi.fn();
    const betaClear = vi.fn();
    const alphaRetry = vi.fn();
    const betaRetry = vi.fn();
    let stage: ReturnType<typeof useTransferTray>["stage"] | undefined;
    function Probe({ ports }: Parameters<typeof useTransferTray>[0]) {
      stage = useTransferTray({ ports }).stage;
      return null;
    }
    const { rerender } = render(<Probe ports={{ chrome: alphaChrome, transfers: { tasks: ledger, clearAccountHistory: alphaClear }, accountId: "alpha", onRetryFailedSync: alphaRetry }} />);
    if (!stage) throw new Error("transfer stage missing");
    const alphaStage = stage;
    expect(alphaStage.tasks.map((task) => task.accountId)).toEqual(["alpha", "alpha"]);
    alphaStage.onToggleOpen();
    alphaStage.onClearFinished();
    alphaStage.onRetryFailedSync?.(alphaTask);
    expect(alphaChrome.close).toHaveBeenCalledTimes(1);
    expect(alphaChrome.open).not.toHaveBeenCalled();
    expect(alphaClear).toHaveBeenCalledWith("alpha");
    expect(alphaRetry).toHaveBeenCalledTimes(1);
    expect(alphaRetry).toHaveBeenCalledWith(alphaTask);

    rerender(<Probe ports={{ chrome: betaChrome, transfers: { tasks: ledger, clearAccountHistory: betaClear }, accountId: "beta", onRetryFailedSync: betaRetry }} />);
    if (!stage) throw new Error("replacement transfer stage missing");
    const betaStage = stage;
    expect(betaStage.tasks.map((task) => task.accountId)).toEqual(["beta"]);
    betaStage.onToggleOpen();
    betaStage.onClearFinished();
    betaStage.onRetryFailedSync?.(betaTask);
    expect(betaChrome.open).toHaveBeenCalledTimes(1);
    expect(betaClear).toHaveBeenCalledWith("beta");
    expect(betaRetry).toHaveBeenCalledTimes(1);
    expect(betaRetry).toHaveBeenCalledWith(betaTask);

    alphaStage.onToggleOpen();
    alphaStage.onClearFinished();
    alphaStage.onRetryFailedSync?.(alphaTask);
    expect(alphaChrome.close).toHaveBeenCalledTimes(2);
    expect(alphaClear).toHaveBeenCalledTimes(2);
    expect(alphaRetry).toHaveBeenCalledTimes(2);

    rerender(<Probe ports={{ chrome: { isOpen: false, open: vi.fn(), close: vi.fn() }, transfers: { tasks: ledger, clearAccountHistory: vi.fn() }, accountId: undefined, onRetryFailedSync: vi.fn() }} />);
    expect(stage?.tasks).toEqual([]);
  });

  it("projects active, completed, partial, failed, and failed-sync summaries with exact retry", () => {
    const tasks: TransferTask[] = [
      { id: "active", accountId: "alpha", kind: "upload", label: "active.txt", loadedBytes: 1, totalBytes: 2, startedAt: "2026-08-05T00:00:00Z", phase: "transferring" },
      { id: "done", accountId: "alpha", kind: "download", label: "done.txt", loadedBytes: 1, totalBytes: 1, startedAt: "2026-08-05T00:00:00Z", phase: "done", finishedAt: "2026-08-05T00:01:00Z" },
      { id: "partial", accountId: "alpha", kind: "sync", dedupeKey: "partial", syncRootEntries: [], label: "partial", loadedBytes: 1, totalBytes: 2, startedAt: "2026-08-05T00:00:00Z", phase: "partial", finishedAt: "2026-08-05T00:01:00Z", errorMessage: "one failed", failedFiles: [{ sourcePath: "a.txt", error: "failed" }] },
      { id: "failed", accountId: "alpha", kind: "download", label: "failed", loadedBytes: 0, startedAt: "2026-08-05T00:00:00Z", phase: "error", finishedAt: "2026-08-05T00:01:00Z", errorMessage: "network" },
      { id: "failed-sync", accountId: "alpha", kind: "sync", dedupeKey: "failed-sync", syncRootEntries: [], label: "failed sync", loadedBytes: 0, startedAt: "2026-08-05T00:00:00Z", phase: "error", finishedAt: "2026-08-05T00:01:00Z", errorMessage: "sync failed", failedFiles: [{ sourcePath: "b.txt", error: "retry me" }] }
    ];
    const toggle = vi.fn();
    const clear = vi.fn();
    const retry = vi.fn();
    render(<TransferTrayStage tasks={tasks} open onToggleOpen={toggle} onClearFinished={clear} onRetryFailedSync={retry} />);
    expect(screen.getByText("active.txt")).toBeInTheDocument();
    expect(screen.getByText("done.txt")).toBeInTheDocument();
    expect(screen.getByText("partial")).toBeInTheDocument();
    expect(screen.getAllByText("failed").length).toBeGreaterThan(0);
    const failedSyncItem = screen.getByText("failed sync").closest("li");
    expect(failedSyncItem).not.toBeNull();
    fireEvent.click(within(failedSyncItem as HTMLElement).getByRole("button", { name: "Retry failed sync" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear finished transfers" }));
    fireEvent.click(screen.getByRole("button", { name: "Close transfer status" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith(tasks[4]);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("forwards install and wake-lock presentation without acquiring either lifecycle", () => {
    const onInstall = vi.fn();
    render(<AppBarStage {...buildProps({ install: { available: true, busy: false, onInstall }, screenWakeLockActive: true, screenWakeLockReasonLabel: "transfers" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Install app" }));
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status", { name: "Keeping screen awake for transfers" })).toBeInTheDocument();
  });

  it("serializes authoritative transfer metadata while containing credentials and capabilities", () => {
    const sessionToken = "sentinel-session-token";
    const rawError = "sentinel-raw-error";
    const cacheNamespace = "sentinel-cache-namespace";
    const transferPayload = "sentinel-transfer-payload";
    const credential = "sentinel-credential";
    const requestHeader = "sentinel-request-header";
    const blobContent = "sentinel-blob-content";
    const apiObject = "sentinel-api-object";
    const safeSummary = "Safe transfer summary";
    const actions = {
      install: vi.fn(),
      drawer: vi.fn(),
      query: vi.fn(),
      closeSearch: vi.fn(),
      up: vi.fn(),
      search: vi.fn(),
      settings: vi.fn(),
      sortToggle: vi.fn(),
      sortSelect: vi.fn(),
      trayToggle: vi.fn(),
      trayClear: vi.fn(),
      trayRetry: vi.fn()
    };
    const forbidden = {
      deleteFile: vi.fn(),
      webdavRequest: vi.fn(),
      removeAccount: vi.fn(),
      clearCache: vi.fn(),
      clearRetention: vi.fn()
    };
    const transferTask: TransferTask = {
      id: "safe-transfer",
      accountId: "alpha",
      kind: "sync",
      dedupeKey: transferPayload,
      syncRootEntries: [{ path: transferPayload, name: "Safe transfer", isFolder: true }],
      label: safeSummary,
      loadedBytes: 0,
      startedAt: "2026-08-05T00:00:00Z",
      phase: "error",
      finishedAt: "2026-08-05T00:01:00Z",
      errorMessage: rawError,
      failedFiles: [{ sourcePath: transferPayload, error: rawError }]
    };
    const transferElement = <TransferTrayStage
      tasks={[transferTask]}
      open={true}
      onToggleOpen={actions.trayToggle}
      onClearFinished={actions.trayClear}
      onRetryFailedSync={actions.trayRetry}
    />;
    const props = buildProps({
      hasSession: Boolean(sessionToken),
      transferTray: transferElement,
      install: { available: true, busy: false, onInstall: actions.install },
      sortPanel: { open: false, toggle: actions.sortToggle, select: actions.sortSelect, reset: buildResetBinding() },
      onOpenNavigationDrawer: actions.drawer,
      onSearchQueryChange: actions.query,
      onCloseMobileSearch: actions.closeSearch,
      onNavigateUp: actions.up,
      onOpenMobileSearch: actions.search,
      onOpenSettings: actions.settings
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const serialized = JSON.stringify(props, (key, value: unknown) => {
        if (key === "_owner") return undefined;
        if (typeof value === "function") return "[function]";
        return value;
      });
      for (const sentinel of [sessionToken, cacheNamespace, credential, requestHeader, blobContent, apiObject]) {
        expect(serialized).not.toContain(sentinel);
        expect(window.location.href).not.toContain(sentinel);
        expect(JSON.stringify(localStorage)).not.toContain(sentinel);
        expect(JSON.stringify(sessionStorage)).not.toContain(sentinel);
        expect(consoleError.mock.calls.flat().join(" ")).not.toContain(sentinel);
        expect(consoleWarn.mock.calls.flat().join(" ")).not.toContain(sentinel);
      }
      expect(serialized).toContain(transferTask.accountId);
      expect(serialized).toContain(transferTask.dedupeKey);
      expect(serialized).toContain(transferTask.syncRootEntries[0]?.path);
      expect(serialized).toContain(transferTask.errorMessage);
      expect(serialized).toContain(transferTask.failedFiles?.[0]?.sourcePath);
      expect(props.hasSession).toBe(true);
      expect(typeof props.hasSession).toBe("boolean");
      const topLevelCallablePaths = [
        ["install.onInstall", props.install.onInstall], ["sortPanel.toggle", props.sortPanel.toggle], ["sortPanel.select", props.sortPanel.select],
        ["onOpenNavigationDrawer", props.onOpenNavigationDrawer], ["onSearchQueryChange", props.onSearchQueryChange],
        ["onCloseMobileSearch", props.onCloseMobileSearch], ["onNavigateUp", props.onNavigateUp],
        ["onOpenMobileSearch", props.onOpenMobileSearch], ["onOpenSettings", props.onOpenSettings]
      ].filter(([, value]) => typeof value === "function").map(([path]) => path);
      expect(topLevelCallablePaths).toEqual([
        "install.onInstall", "sortPanel.toggle", "sortPanel.select", "onOpenNavigationDrawer",
        "onSearchQueryChange", "onCloseMobileSearch", "onNavigateUp", "onOpenMobileSearch", "onOpenSettings"
      ]);
      expect(isValidElement(props.transferTray)).toBe(true);
      if (isValidElement(props.transferTray)) {
        const trayProps = props.transferTray.props as Record<string, unknown>;
        expect(Object.keys(trayProps).sort()).toEqual(["onClearFinished", "onRetryFailedSync", "onToggleOpen", "open", "tasks"].sort());
        expect(trayProps.tasks).toEqual([transferTask]);
        const serializedTrayProps = JSON.stringify(trayProps, (_key, value: unknown) => typeof value === "function" ? "[function]" : value);
        expect(serializedTrayProps).not.toContain(sessionToken);
        expect(serializedTrayProps).not.toContain(cacheNamespace);
        expect(serializedTrayProps).toContain(transferPayload);
        expect(serializedTrayProps).toContain(rawError);
        const callablePaths = Object.keys(trayProps).filter((key) => typeof trayProps[key] === "function").map((key) => `transferTray.props.${key}`).sort();
        expect(callablePaths).toEqual([
          "transferTray.props.onClearFinished",
          "transferTray.props.onRetryFailedSync",
          "transferTray.props.onToggleOpen"
        ]);
        expect(callablePaths.some((key) => /delete|webdav|nextcloud/i.test(key))).toBe(false);
        expect(Object.values(transferTask).some((value) => typeof value === "function")).toBe(false);
        expect(transferTask.syncRootEntries.some((entry) => Object.values(entry).some((value) => typeof value === "function"))).toBe(false);
      }
      render(<AppBarStage {...props} />);
      expect(screen.getByText(safeSummary)).toBeInTheDocument();
      expect(screen.getAllByText(rawError).length).toBeGreaterThan(0);
      expect(screen.getByText(transferPayload)).toBeInTheDocument();
      props.install.onInstall();
      props.sortPanel.toggle();
      props.sortPanel.select("name-desc");
      props.onOpenNavigationDrawer();
      props.onSearchQueryChange("safe-query");
      props.onCloseMobileSearch();
      props.onNavigateUp();
      props.onOpenMobileSearch();
      props.onOpenSettings();
      fireEvent.click(screen.getByRole("button", { name: "Transfers" }));
      if (isValidElement(props.transferTray)) {
        const trayProps = props.transferTray.props as Record<string, unknown>;
        (trayProps.onToggleOpen as () => void)();
        (trayProps.onClearFinished as () => void)();
        (trayProps.onRetryFailedSync as (task: TransferTask) => void)(transferTask);
      }
      expect(actions.install).toHaveBeenCalledTimes(1);
      expect(actions.sortToggle).toHaveBeenCalledTimes(1);
      expect(actions.sortSelect).toHaveBeenCalledWith("name-desc");
      expect(actions.drawer).toHaveBeenCalledTimes(1);
      expect(actions.query).toHaveBeenCalledWith("safe-query");
      expect(actions.closeSearch).toHaveBeenCalledTimes(1);
      expect(actions.up).toHaveBeenCalledTimes(1);
      expect(actions.search).toHaveBeenCalledTimes(1);
      expect(actions.settings).toHaveBeenCalledTimes(1);
      expect(actions.trayToggle).toHaveBeenCalledTimes(2);
      expect(actions.trayClear).toHaveBeenCalledTimes(1);
      expect(actions.trayRetry).toHaveBeenCalledWith(transferTask);
      for (const forbiddenCall of Object.values(forbidden)) {
        expect(forbiddenCall).not.toHaveBeenCalled();
      }
      const postActionSinks = [
        document.body.textContent ?? "",
        window.location.href,
        JSON.stringify(localStorage),
        JSON.stringify(sessionStorage),
        consoleError.mock.calls.flat().join(" "),
        consoleWarn.mock.calls.flat().join(" ")
      ].join(" ");
      for (const sentinel of [sessionToken, cacheNamespace, credential, requestHeader, blobContent, apiObject]) {
        expect(postActionSinks).not.toContain(sentinel);
      }
      expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining(sessionToken));
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it("requires one public AppBar workspace module and barrel exports", () => {
    const workspacePath = resolve(appBarPath, "workspace");
    expect(existsSync(workspacePath)).toBe(true);
    if (!existsSync(workspacePath)) return;
    const appBarIndex = readFileSync(resolve(appBarPath, "index.ts"), "utf8");
    const browsingIndex = readFileSync(resolve(appBarPath, "..", "index.ts"), "utf8");
    expect(appBarIndex).toMatch(/useAppBarWorkspace/);
    expect(browsingIndex).toMatch(/from ["']\.\/appBar["']/);
  });

  it("uses normalized shared dirname for root and nested navigate-up paths", () => {
    const navigateToPath = vi.fn();
    const { result, rerender } = renderHook(({ currentPath }) => useAppBarWorkspace({
      owners: buildWorkspaceOwners(currentPath, navigateToPath)
    }), { initialProps: { currentPath: "" } });

    act(() => result.current.binding.onNavigateUp());
    expect(navigateToPath).toHaveBeenLastCalledWith("");

    rerender({ currentPath: "Projects//Plans/" });
    act(() => result.current.binding.onNavigateUp());
    expect(navigateToPath).toHaveBeenLastCalledWith("Projects");
  });

  it("forwards every authoritative AppBar owner directly to the public parent", () => {
    const appBarCall = presentationSource.match(/const appBarWorkspace = useAppBarWorkspace\(\{[\s\S]*?\n\s*\}\);/)?.[0] ?? "";
    expect(appBarCall).toContain("useAppBarWorkspace");
    for (const owner of [
      "accountContext", "session", "bootstrap", "connectivity", "viewport", "browsingWorkspace",
      "workspaceNavigation", "offlineApplication", "pwa", "wakeLock", "transfers",
      "offlineSyncWorkspace"
    ]) {
      expect(appBarCall).toContain(owner);
    }
    expect(appBarCall).not.toMatch(/buildAppBarBindings|transferTrayPorts|transferTrayMount|useAppBarSortPanel|useTransferTray|TransferTrayStage/);
  });

  it("retires the complete App-local AppBar graph at the single shell call site", () => {
    expect((presentationSource.match(/useAppBarWorkspace\s*\(/g) ?? []).length).toBe(1);
    for (const retired of [
      "useAppBarSortPanel", "sortPanel", "transferTrayPorts", "transferTrayMount", "useTransferTray",
      "TransferTrayStage", "compactMobileHeader", "buildAppBarBindings", "accountBootstrapAppBarSupportText",
      "onCloseMobileSearch", "onNavigateUp", "onOpenMobileSearch", "onOpenNavigationDrawer", "onOpenSettings",
      "onSearchQueryChange"
    ]) {
      expect(presentationSource).not.toMatch(new RegExp(`\\b${retired}\\b`));
    }
    const appBarAssignments = presentationSource.match(/^\s*appBar:\s*[^,\n]+/gm) ?? [];
    expect(appBarAssignments).toEqual(["      appBar: appBarWorkspace.binding"]);
    expect(presentationSource).not.toMatch(/supportText:\s*accountBootstrapAppBarSupportText/);
  });

  it("keeps the AppBar parent public and free of leaf effects or mutation capabilities", () => {
    const workspacePath = resolve(appBarPath, "workspace");
    expect(existsSync(workspacePath)).toBe(true);
    if (!existsSync(workspacePath)) return;
    const parentSource = readdirSync(workspacePath)
      .filter((entry) => /\.(?:ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx"))
      .map((entry) => readFileSync(resolve(workspacePath, entry), "utf8"))
      .join("\n");
    expect(parentSource).not.toMatch(/useEffect|useLayoutEffect|useRef|addEventListener|setTimeout|setInterval|fetch\(|request\(|headers|localStorage|sessionStorage|indexedDB|createContext|Provider/);
    expect(parentSource).not.toMatch(/deleteFile|deleteSelection|removeAccount|revoke|purge|operationRuntime|mutation|webdav|nextcloud|WebDAV|TransferTrayPorts|buildAppBarBindings/i);
    expect(parentSource).not.toMatch(/from\s+["'][^"']*(?:\/use(?:AppBarSortPanel|TransferTray)|\/AppBarStage|\/TransferTrayStage)["']/);
  });
});
