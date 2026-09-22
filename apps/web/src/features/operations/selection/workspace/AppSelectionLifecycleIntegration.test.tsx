import { cleanup, fireEvent, render as renderTestingLibrary, screen, waitFor, within } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../../../diagnostics/testing/fakes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../../../App";
import type { AppServices } from "../../../../app/AppServices";
import { createMemoryFolderSortService } from "../../../../features/browsing/folderSort/testing/fakeStorage";
import { ApiRequestError } from "../../../../lib/api";
import { buildAccount, buildSession } from "../../../../test/accounts";
import { buildHealthResponse } from "../../../../test/api";

type AccountSnapshot = ReturnType<AppServices["accountRegistry"]["getSnapshot"]>;
type FixtureFolderFile = { readonly path: string; readonly name: string; readonly isFolder: boolean; readonly size?: number; readonly mimeType?: string };
type FixtureSearchFile = FixtureFolderFile & { readonly score: number };
type FixtureListResponse = { readonly path: string; readonly items: FixtureFolderFile[] };
type FixtureSearchResponse = { readonly query: string; readonly path: string; readonly items: FixtureSearchFile[] };
type MutationResult = Awaited<ReturnType<AppServices["operationRuntime"]["mutation"]["deleteFile"]>>;
type FixtureSession = Awaited<ReturnType<AppServices["accountTransport"]["createSession"]>>;

const mockedApi = {
  listFiles: vi.fn<(path: string, token: string, signal?: AbortSignal) => Promise<FixtureListResponse>>(),
  searchFiles: vi.fn<(path: string, query: string, token: string, signal?: AbortSignal) => Promise<FixtureSearchResponse>>(),
  getFile: vi.fn(),
  deleteFile: vi.fn<(input: { readonly path: string; readonly confirmName: string }, token: string) => Promise<{ readonly result: MutationResult }>>(),
  createSession: vi.fn<(input: { readonly accountId: string }) => Promise<FixtureSession>>()
};

let matchMediaMatches = false;
const wideViewport = { kind: "wide" } as const;
const narrowViewport = { kind: "narrow" } as const;
const onlineSnapshot = { kind: "online" } as const;
vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    offlineReady: [false, vi.fn()] as [boolean, (value: boolean) => void],
    needRefresh: [false, vi.fn()] as [boolean, (value: boolean) => void],
    updateServiceWorker: vi.fn(async () => undefined)
  })
}));

function abortHandle() {
  const controller = new AbortController();
  return { signal: controller.signal, abort: () => controller.abort() };
}

function createSelectionFixture(): AppServices {
  const rawState = localStorage.getItem("davora-account-state");
  const parsedState: unknown = rawState ? JSON.parse(rawState) : undefined;
  const isAccountSnapshot = (value: unknown): value is AccountSnapshot => typeof value === "object" && value !== null && "accounts" in value && Array.isArray(value.accounts);
  let snapshot: AccountSnapshot = isAccountSnapshot(parsedState) ? parsedState : { accounts: [] };
  let state: ReturnType<AppServices["accountRegistry"]["getState"]> = { kind: "ready", snapshot };
  const listeners = new Set<() => void>();
  const publish = (next: typeof snapshot) => {
    snapshot = next;
    state = { kind: "ready", snapshot };
    localStorage.setItem("davora-account-state", JSON.stringify(next));
    listeners.forEach((listener) => listener());
  };
  const committed = () => ({ kind: "committed" as const, snapshot });
  const accountRegistry: AppServices["accountRegistry"] = {
    getState: () => state,
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    repair: committed,
    connectAccount: async () => ({ kind: "failed", message: "fixture", clearCredential: false }),
    commitConnectedAccount: (account) => { publish({ activeAccountId: account.id, accounts: [...snapshot.accounts, { account }] }); return committed(); },
    commitSession: (accountId, session) => { publish({ ...snapshot, accounts: snapshot.accounts.map((record) => record.account.id === accountId ? { ...record, session } : record) }); return committed(); },
    clearAccountSession: (accountId) => { publish({ ...snapshot, accounts: snapshot.accounts.map((record) => record.account.id === accountId ? { account: record.account } : record) }); return committed(); },
    markAccountReconnectRequired: (accountId) => { publish({ ...snapshot, accounts: snapshot.accounts.map((record) => record.account.id === accountId ? { ...record, session: undefined } : record) }); return committed(); },
    switchAccount: (accountId) => { publish({ ...snapshot, activeAccountId: accountId }); return committed(); },
    removeAccount: async (accountId) => { publish({ accounts: snapshot.accounts.filter((record) => record.account.id !== accountId) }); return committed(); },
    retryRemovalCommit: () => committed()
  };
  const browsingCache: AppServices["browsingCache"] = {
    readFolder: () => ({ kind: "miss" }), writeFolder: () => ({ kind: "written" }),
    readSearch: () => ({ kind: "miss" }), writeSearch: () => ({ kind: "written" }),
    clearNamespace: () => ({ kind: "cleared" }), clearFolderPath: () => ({ kind: "cleared" }),
    clearNamespaceOrThrow: () => undefined, clearFolderPathOrThrow: () => undefined
  };
  const folder: AppServices["folder"] = {
    createAbortHandle: abortHandle,
    loadFolder: async ({ path, token, signal }) => {
      const response = await mockedApi.listFiles(path, token, signal);
      return { kind: "success", items: response.items };
    },
    readCachedFolder: () => undefined, writeCachedFolder: () => undefined
  };
  const search: AppServices["search"] = {
    createAbortHandle: abortHandle,
    loadSearch: async ({ path, query, token, signal }) => {
      const response = await mockedApi.searchFiles(path, query, token, signal);
      return { kind: "success", items: response.items };
    },
    readCachedSearch: () => undefined, writeCachedSearch: () => undefined
  };
  const healthResponse = buildHealthResponse();
  const accountTransport: AppServices["accountTransport"] = {
    getHealth: async () => healthResponse,
    connectAccount: async () => ({ kind: "invalid-http-success" }),
    createSession: async ({ accountId }) => {
      const session = await mockedApi.createSession({ accountId });
      return session;
    },
    deleteConnectedAccount: async () => undefined
  };
  const accountSession: AppServices["accountSession"] = {
    getHealth: accountTransport.getHealth,
    createSession: accountTransport.createSession,
    commitSession: (...args) => accountRegistry.commitSession(...args),
    markAccountReconnectRequired: (...args) => accountRegistry.markAccountReconnectRequired(...args),
    clearAccountSession: (...args) => accountRegistry.clearAccountSession(...args),
    delay: async () => undefined
  };
  const operationRuntime: AppServices["operationRuntime"] = {
    request: { createAbortHandle: abortHandle, createTransferId: () => "selection-transfer" },
    mutation: {
      createFolder: async () => ({ action: "createFolder", parentPath: "", path: "" }),
      deleteFile: async (path, confirmName, token) => {
        try {
          const response = await mockedApi.deleteFile({ path, confirmName }, token);
          return response.result;
        } catch (error) {
          throw error;
        }
      },
      uploadFile: async () => ({ action: "upload", parentPath: "", path: "" }),
      copyOrMove: async () => ({ action: "copy", parentPath: "", path: "" }),
      listDestination: async () => ({ path: "", items: [] })
    },
    download: { prepareDownloadFile: async () => ({ blob: new Blob(), filename: "fixture" }), fetchDownloadBlob: async () => ({ blob: new Blob(), filename: "fixture" }), listFiles: async () => ({ path: "", items: [] }), triggerBrowserDownload: () => undefined, saveDownload: () => undefined },
    batch: { downloadSelectionAsZip: async () => ({ blob: new Blob(), plan: { archiveName: "fixture", selectedCount: 0, selectedFileCount: 0, selectedDirectoryCount: 0, directories: [], files: [], failedFiles: [] } }) },
    preview: { createFileStreamUrl: async () => "" }, time: { wait: async () => {} }, uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) },
    isUnauthorized: (error) => error instanceof ApiRequestError && error.status === 401,
    isReconnectRequired: () => false,
    toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback
  };
  const retentionSnapshot = (account: Parameters<AppServices["retentionRepository"]["readSnapshot"]>[0]) => ({ account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 1 }, roots: [], files: [], memberships: [] });
  const retentionRepository: AppServices["retentionRepository"] = {
    readSnapshot: async (account) => ({ kind: "success", value: retentionSnapshot(account) }), readPreview: async () => ({ kind: "success", value: undefined }),
    writePreview: async (account) => ({ kind: "success", value: retentionSnapshot(account) }), beginRoot: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    persistRetainedFile: async (account) => ({ kind: "success", value: retentionSnapshot(account) }), completeRoot: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    removeRoot: async (account) => ({ kind: "success", value: retentionSnapshot(account) }), clearNormalCache: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    purgeAccountNamespace: async (account) => ({ kind: "success", value: retentionSnapshot(account) }), configureNormalCacheLimit: async (account) => ({ kind: "success", value: retentionSnapshot(account) })
  };
  const previewRuntime: AppServices["previewRuntime"] = {
    session: { createSessionAdapters: () => ({ cache: { read: async () => undefined, write: async () => ({ kind: "skipped", reason: "not-cacheable" }) }, live: { acquire: async () => { throw new Error("Preview is not part of this workflow."); } }, abort: { create: () => ({ id: "selection-preview", abort: () => undefined }) }, resources: { apply: (material) => material, release: () => undefined }, failures: { classify: () => ({ kind: "ordinary", message: "Preview failed." }) }, prefetch: { probe: async () => false, prefetch: async () => ({ kind: "skipped" }) }, clock: { now: () => Date.now() }, resolveResourceUrl: () => undefined }) },
    modal: { startOriginalFileOpen: () => ({ completion: Promise.resolve(), cancel: () => undefined }), pdf: { loadPdfJs: async () => { throw new Error("PDF preview is not part of this workflow."); }, fetch: async () => new Response(), requestAnimationFrame: (callback) => requestAnimationFrame(callback), getDevicePixelRatio: () => 1, createResizeObserver: () => undefined }, video: { setTimeout, clearTimeout, getLocationHref: () => window.location.href }, setTimeout, clearTimeout, getLocationHref: () => window.location.href, addWindowKeydownListener: () => () => undefined, loadAudioPreviewPosition: () => undefined, saveAudioPreviewPosition: () => undefined, clearAudioPreviewPosition: () => undefined },
    folderAudio: { storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }, createStreamingFileUrl: async () => "", nowIso: () => "", loadAudioPreviewPosition: () => undefined, saveAudioPreviewPosition: () => undefined }
  };
  const services = {
    accountRegistry, accountTransport, accountSession, browsingCache,
    favouriteResolveRuntime: { listFiles: async () => ({ items: [] }), cacheFolder: () => undefined }, connectivity: { read: () => onlineSnapshot, subscribe: () => () => undefined },
    explicitOfflineRuntime: { storage: { read: () => ({ kind: "ready" as const, enabled: false }), commit: () => ({ kind: "committed" as const }), reset: () => ({ kind: "committed" as const }), repair: () => ({ kind: "repaired" as const }) }, network: { setBlocked: () => undefined } }, clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
    favourites: { load: () => ({ kind: "loaded" as const, entries: [] }), save: (_account, entries) => ({ kind: "saved" as const, entries: [...entries] }), clear: () => ({ kind: "cleared" as const }), create: (entry, account) => ({ ...entry, accountId: account.id, accountBackend: account.backend, accountRootPath: account.rootPath, cacheNamespace: account.cacheNamespace, addedAt: "2026-01-01T00:00:00.000Z" }) },
    favouritesPointerEnvironment: { elementFromPoint: () => null, addWindowListener: () => () => undefined }, folder,
    folderSorts: createMemoryFolderSortService(),
    history: { pushState: (state: unknown, url?: string): void => { window.history.pushState(state, "", url); }, replaceState: (state: unknown, url?: string): void => { window.history.replaceState(state, "", url); }, getState: (): unknown => window.history.state, getLocation: (): { readonly href: string; readonly search: string } => ({ href: window.location.href, search: window.location.search }), subscribe: (listener: (state: unknown) => void): (() => void) => { const handler = () => { listener(window.history.state); }; window.addEventListener("popstate", handler); return () => { window.removeEventListener("popstate", handler); }; } },
    pullToRefreshEnvironment: { getWindowScrollY: () => 0 }, responsiveViewport: { getSnapshot: () => matchMediaMatches ? narrowViewport : wideViewport, subscribe: () => () => undefined }, search,
    settings: { load: () => ({ themeMode: "system" as const, showHiddenFiles: false, sortMode: "name-asc" as const, keepAwakeEnabled: true, previewFreshnessIntervalSeconds: 300, maxCacheableFileSizeBytes: 1, fileSizeDisplayMode: "human" as const, imagePreviewFitMode: "fill" as const, experimentalHeicPreviewEnabled: false, experimentalFolderAppShortcutsEnabled: false, diagnosticsEnabled: false, videoMuted: false }), save: (settings) => settings },
    operationRuntime, offlineSyncRuntime: { createAbortHandle: abortHandle, createTransferId: () => "selection-sync", listFiles: async () => ({ path: "", items: [] }), fetchDownloadBlob: async () => ({ blob: new Blob(), filename: "fixture" }), readBlobText: async () => "", isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback },
    retentionRepository, previewRuntime, accountRemovalRuntime: { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined }, diagnostics: createFakeDiagnosticsRuntimePorts()
  } satisfies AppServices;
  return services;
}

function render(_ui: unknown) {
  return renderTestingLibrary(<App services={createSelectionFixture()} />);
}

function seedAccounts(records: Array<{ account: ReturnType<typeof buildAccount>; session?: ReturnType<typeof buildSession> }>, activeAccountId?: string): void {
  localStorage.setItem("davora-account-state", JSON.stringify({ activeAccountId: activeAccountId ?? records[0]?.account.id, accounts: records }));
}

beforeEach(() => {
  cleanup();
  localStorage.removeItem("davora-account-state");
  window.history.replaceState(null, "", "/");
  matchMediaMatches = false;
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: matchMediaMatches, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) });
  mockedApi.listFiles.mockImplementation(async (path: string) => path === "Projects" ? { path, items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] } : { path, items: [{ path: "Projects", name: "Projects", isFolder: true }, { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] });
  mockedApi.searchFiles.mockResolvedValue({ query: "", path: "", items: [] });
  mockedApi.getFile.mockResolvedValue({ file: { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain", content: "preview" } });
  mockedApi.deleteFile.mockResolvedValue({ result: { action: "delete", parentPath: "", path: "Projects/roadmap.txt" } });
  mockedApi.createSession.mockImplementation(async ({ accountId }: { accountId: string }) => buildSession(buildAccount(accountId)));
});

afterEach(() => { cleanup(); localStorage.removeItem("davora-account-state"); window.history.replaceState(null, "", "/"); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("selection lifecycle App integration", () => {
  it("retains focused selection when search is replaced or cleared", async () => {
    const account = buildAccount("alpha", { displayName: "Search focus workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.searchFiles
      .mockResolvedValueOnce({
        query: "old",
        path: "",
        items: [{ path: "old.txt", name: "old.txt", isFolder: false, score: 1 }]
      })
      .mockResolvedValueOnce({
        query: "new",
        path: "",
        items: [{ path: "new.txt", name: "new.txt", isFolder: false, score: 1 }]
      });

    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });
    const input = screen.getByLabelText(/Search files/i);
    fireEvent.change(input, { target: { value: "old" } });
    await screen.findByRole("button", { name: /Open file old.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for old.txt/i }));
    expect(await screen.findByLabelText("Details for old.txt")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "new" } });
    await screen.findByRole("button", { name: /Open file new.txt/i });
    expect(screen.getByLabelText("Details for old.txt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Clear search/i }));
    await screen.findByRole("button", { name: /Open folder Projects/i });
    expect(screen.getByLabelText("Details for old.txt")).toBeInTheDocument();
  });

  it("clears focused selection when navigation replaces the current path", async () => {
    const account = buildAccount("alpha", { displayName: "Path selection workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Open actions for roadmap\.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap\.txt/i }));
    expect(await screen.findByLabelText("Details for roadmap.txt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));

    await screen.findByRole("button", { name: /Open file roadmap\.txt/i });
    expect(screen.queryByLabelText("Details for roadmap.txt")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Close actions for roadmap\.txt/i })).not.toBeInTheDocument();
  });

  it("clears focused selection when the active account changes", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha selection workspace" });
    const beta = buildAccount("beta", { displayName: "Beta selection workspace" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);

    render(<App />);

    await screen.findByRole("button", { name: /Open actions for roadmap\.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap\.txt/i }));
    expect(await screen.findByLabelText("Details for roadmap.txt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } });

    await screen.findByRole("button", { name: /Open actions for roadmap\.txt/i });
    expect(screen.queryByLabelText("Details for roadmap.txt")).not.toBeInTheDocument();
  });

  it("clears focused selection on session replacement", async () => {
    const account = buildAccount("alpha", { displayName: "Session selection workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.deleteFile.mockRejectedValueOnce(new ApiRequestError("Session expired", 401, "session_invalid"));
    mockedApi.createSession
      .mockRejectedValueOnce(new ApiRequestError("Session expired", 401, "session_invalid"))
      .mockImplementationOnce(async () => buildSession(account));

    render(<App />);

    await screen.findByRole("button", { name: /Open actions for roadmap\.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap\.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    const dialog = await screen.findByRole("dialog", { name: /Delete item/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Delete$/i }));

    await waitFor(() => expect(mockedApi.deleteFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText("Details for roadmap.txt")).not.toBeInTheDocument());
    expect(await screen.findByRole("button", { name: /Retry restore/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Retry restore/i }));
    await screen.findByRole("button", { name: /Create folder/i });
    expect(screen.queryByLabelText("Details for roadmap.txt")).not.toBeInTheDocument();
  });

  it("uses a clear mobile actions and details sheet flow", async () => {
    matchMediaMatches = true;
    const account = buildAccount("alpha", { displayName: "Action details workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Open actions for Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));

    const panel = await screen.findByRole("region", { name: /Details for Projects/i });
    expect(panel).toHaveClass("details-panel-sheet-open");
    expect(panel).not.toHaveClass("details-panel-sheet-details-open");
    expect(screen.getByRole("button", { name: /Dismiss item actions/i })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /View details/i })).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: /View details/i }));

    expect(panel).toHaveClass("details-panel-sheet-details-open");
    expect(within(panel).getByRole("button", { name: /Back to actions/i })).toBeInTheDocument();
    expect(within(panel).getByText("Location")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: /Back to actions/i }));

    expect(panel).not.toHaveClass("details-panel-sheet-details-open");

    fireEvent.click(screen.getByRole("button", { name: /Dismiss item actions/i }));

    await waitFor(() => expect(document.querySelector(".details-panel")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Dismiss item actions/i })).not.toBeInTheDocument();
  });

  it("toggles selection from row taps while selection mode is active", async () => {
    const account = buildAccount("alpha", { displayName: "Row selection workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select roadmap.txt file/i }));
    expect(await screen.findByText(/1 item selected \(1 file\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));
    expect(screen.getByText(/1 item selected \(1 file\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Select Projects folder/i }));
    expect(await screen.findByText(/2 items selected \(1 file and 1 folder\)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Deselect Projects folder/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Deselect Projects folder/i }));
    expect(await screen.findByText(/1 item selected \(1 file\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Deselect roadmap.txt file/i }));
    await waitFor(() => expect(screen.queryByText(/item selected/i)).not.toBeInTheDocument());
    expect(mockedApi.getFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Open folder Projects/i })).not.toBeInTheDocument());
  });
});
