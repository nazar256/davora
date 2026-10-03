import { cleanup, fireEvent, render as renderTestingLibrary, screen, waitFor, within } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../../diagnostics/testing/fakes";
import { cloneElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSession, ConnectedAccount, FileEntry } from "@davora/shared";
import App from "../../../App";
import type { AppServices } from "../../../app/AppServices";
import { createAccountRegistryService, type AccountRegistryService } from "../registry";
import type { AccountTransport } from "../transport";
import type { BrowsingCacheRepository, FolderPorts, SearchPorts } from "../../browsing";
import { createMemoryFolderSortService } from "../../browsing/folderSort/testing/fakeStorage";
import type { ConnectivityPort } from "../../offline/connectivity";
import type { ExplicitOfflineModeRuntimePort } from "../../offline/mode";
import type { OperationRuntimePort } from "../../operations/workspace";
import type { RetentionAccount, RetentionRepository, RetentionResult } from "../../offline/retention";
import type { ResponsiveViewportPort } from "../../navigation/viewport";
import { WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT } from "../../navigation/viewport";
import { DEFAULT_UI_SETTINGS } from "../../settings";
import { createPreviewComposition } from "../../../app/createPreviewComposition";
import { ApiRequestError } from "../../../lib/api";
import { EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY } from "../../../platform/storage/browserExplicitOfflineModeStorage";
import { buildAccount, buildSession } from "../../../test/accounts";
import { buildHealthResponse } from "../../../test/api";

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    offlineReady: [false, vi.fn()],
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(async () => undefined)
  })
}));

const healthResponse = buildHealthResponse();

const mockedApi = {
  getHealth: vi.fn<AccountTransport["getHealth"]>(),
  connectAccount: vi.fn<AccountTransport["connectAccount"]>(),
  createSession: vi.fn<AccountTransport["createSession"]>(),
  deleteConnectedAccount: vi.fn<AccountTransport["deleteConnectedAccount"]>(),
  listFiles: vi.fn()
};

const ONLINE = { kind: "online" } as const;

function success<T>(value: T): RetentionResult<T> {
  return { kind: "success", value };
}

function createRetentionRepository(): RetentionRepository {
  const snapshot = (account: { accountId: string; cacheNamespace: string }) => success({
    account,
    normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 },
    roots: [],
    files: [],
    memberships: []
  });
  return {
    readSnapshot: vi.fn(async (account: RetentionAccount) => snapshot(account)),
    readPreview: vi.fn(async (_account: RetentionAccount) => success(undefined)),
    writePreview: vi.fn(async (account: RetentionAccount) => snapshot(account)),
    beginRoot: vi.fn(async (account: RetentionAccount) => snapshot(account)),
    persistRetainedFile: vi.fn(async (account: RetentionAccount) => snapshot(account)),
    completeRoot: vi.fn(async (account: RetentionAccount) => snapshot(account)),
    removeRoot: vi.fn(async (account: RetentionAccount) => snapshot(account)),
    clearNormalCache: vi.fn(async (account: RetentionAccount) => snapshot(account)),
    purgeAccountNamespace: vi.fn(async (account: RetentionAccount) => snapshot(account)),
    configureNormalCacheLimit: vi.fn(async (account: RetentionAccount) => snapshot(account))
  };
}

function createStorage() {
  return {
    readItem(key: string) {
      try {
        return { ok: true as const, value: localStorage.getItem(key) };
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error : new Error("Unable to read browser storage.") };
      }
    },
    writeItem(key: string, value: string) {
      try {
        localStorage.setItem(key, value);
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error : new Error("Unable to write browser storage.") };
      }
    },
    deleteItem(key: string) {
      try {
        localStorage.removeItem(key);
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error : new Error("Unable to delete browser storage.") };
      }
    }
  };
}

function createAccountFixture(): AppServices {
  const storage = createStorage();
  let accountRegistry: AccountRegistryService | undefined;
  const getAccountRegistry = () => accountRegistry ??= createAccountRegistryService(storage, { isExpired: (expiresAt) => Date.parse(expiresAt) <= Date.now() });
  const listFiles = async (path: string) => path === "Projects"
    ? { completeness: "complete" as const, path, items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] }
    : { completeness: "complete" as const, path, items: [{ path: "Projects", name: "Projects", isFolder: true }, { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] };
  const accountTransport: AccountTransport = {
    getHealth: mockedApi.getHealth,
    connectAccount: mockedApi.connectAccount,
    createSession: mockedApi.createSession,
    deleteConnectedAccount: mockedApi.deleteConnectedAccount
  };
  const accountSession = {
    getHealth: accountTransport.getHealth,
    createSession: accountTransport.createSession,
    commitSession: (...args: Parameters<AccountRegistryService["commitSession"]>) => getAccountRegistry().commitSession(...args),
    markAccountReconnectRequired: (...args: Parameters<AccountRegistryService["markAccountReconnectRequired"]>) => getAccountRegistry().markAccountReconnectRequired(...args),
    clearAccountSession: (...args: Parameters<AccountRegistryService["clearAccountSession"]>) => getAccountRegistry().clearAccountSession(...args),
    delay: async () => undefined
  };
  const cache: BrowsingCacheRepository = {
    readFolder: vi.fn(() => ({ kind: "miss" as const })),
    writeFolder: vi.fn(() => ({ kind: "written" as const })),
    readSearch: vi.fn(() => ({ kind: "miss" as const })),
    writeSearch: vi.fn(() => ({ kind: "written" as const })),
    clearNamespace: vi.fn(() => ({ kind: "cleared" as const })),
    clearFolderPath: vi.fn(() => ({ kind: "cleared" as const })),
    clearNamespaceOrThrow: vi.fn(),
    clearFolderPathOrThrow: vi.fn()
  };
  const abortHandle = () => {
    const controller = new AbortController();
    return { signal: controller.signal, abort: () => controller.abort() };
  };
  const folder: FolderPorts = {
    createAbortHandle: abortHandle,
    loadFolder: async ({ path, signal }) => {
      if (signal.aborted) return { kind: "cancelled" };
      try {
        const result = await listFiles(path);
        return { completeness: "complete" as const, kind: "success", items: result.items };
      } catch (error) {
        return { kind: "failure", error: error instanceof Error ? error : new Error("Unable to load folder.") };
      }
    },
    readCachedFolder: () => undefined,
    writeCachedFolder: vi.fn()
  };
  const search: SearchPorts = {
    createAbortHandle: abortHandle,
    loadSearch: async () => ({ completeness: "complete" as const, kind: "success", items: [] }),
    readCachedSearch: () => undefined,
    writeCachedSearch: vi.fn()
  };
  const retentionRepository = createRetentionRepository();
  const operationRuntime: OperationRuntimePort = {
    request: { createAbortHandle: abortHandle, createTransferId: () => "account-bootstrap-transfer" },
    mutation: {
      createFolder: async () => ({ action: "createFolder", parentPath: "", path: "" }),
      deleteFile: async () => ({ action: "delete", parentPath: "", path: "" }),
      uploadFile: async () => ({ action: "upload", parentPath: "", path: "" }),
      copyOrMove: async () => ({ action: "copy", parentPath: "", path: "" }),
      listDestination: async (path) => listFiles(path)
    },
    download: { prepareDownloadFile: vi.fn(), fetchDownloadBlob: vi.fn(), listFiles, triggerBrowserDownload: vi.fn(), saveDownload: vi.fn() },
    batch: { downloadSelectionAsZip: vi.fn() },
    preview: { createFileStreamUrl: async () => "" }, time: { wait: async () => {} }, uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) },
    isUnauthorized: (error) => error instanceof ApiRequestError && error.status === 401,
    isReconnectRequired: (error) => error instanceof ApiRequestError && error.code === "account_reconnect_required",
    toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback
  };
  const registry = {
    getState: () => getAccountRegistry().getState(),
    getSnapshot: () => getAccountRegistry().getSnapshot(),
    subscribe: (listener: () => void) => getAccountRegistry().subscribe(listener),
    repair: () => getAccountRegistry().repair(),
    connectAccount: (...args: Parameters<AccountRegistryService["connectAccount"]>) => getAccountRegistry().connectAccount(...args),
    commitConnectedAccount: (...args: Parameters<AccountRegistryService["commitConnectedAccount"]>) => getAccountRegistry().commitConnectedAccount(...args),
    commitSession: (...args: Parameters<AccountRegistryService["commitSession"]>) => getAccountRegistry().commitSession(...args),
    clearAccountSession: (...args: Parameters<AccountRegistryService["clearAccountSession"]>) => getAccountRegistry().clearAccountSession(...args),
    markAccountReconnectRequired: (...args: Parameters<AccountRegistryService["markAccountReconnectRequired"]>) => getAccountRegistry().markAccountReconnectRequired(...args),
    switchAccount: (...args: Parameters<AccountRegistryService["switchAccount"]>) => getAccountRegistry().switchAccount(...args),
    removeAccount: (...args: Parameters<AccountRegistryService["removeAccount"]>) => getAccountRegistry().removeAccount(...args),
    retryRemovalCommit: (...args: Parameters<AccountRegistryService["retryRemovalCommit"]>) => getAccountRegistry().retryRemovalCommit(...args)
  };
  const explicitOfflineRuntime: ExplicitOfflineModeRuntimePort = {
    storage: {
      read: () => ({ kind: "ready", enabled: false }),
      commit: () => ({ kind: "committed" }),
      reset: () => ({ kind: "committed" }),
      repair: () => ({ kind: "repaired" })
    },
    network: { setBlocked: () => undefined }
  };
  const connectivity: ConnectivityPort = { read: () => ONLINE, subscribe: () => () => undefined };
  const responsiveViewport: ResponsiveViewportPort = { getSnapshot: () => WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT, subscribe: () => () => undefined };
  const clock = { nowIso: () => "2026-01-01T00:00:00.000Z" };
  return {
    accountRegistry: registry,
    accountTransport,
    accountSession,
    browsingCache: cache,
    favouriteResolveRuntime: { listFiles: async () => ({ completeness: "complete" as const, items: [] }), cacheFolder: () => undefined },
    connectivity,
    explicitOfflineRuntime,
    clock,
    favourites: {
      load: () => ({ kind: "loaded", entries: [] }),
      save: () => ({ kind: "saved", entries: [] }),
      clear: () => ({ kind: "cleared" }),
      create: (entry: FileEntry) => ({ ...entry, accountId: "alpha", accountBackend: "mock", accountRootPath: "", cacheNamespace: "ns-alpha", addedAt: clock.nowIso() })
    },
    favouritesPointerEnvironment: { elementFromPoint: () => null, addWindowListener: () => () => undefined },
    folder,
    folderSorts: createMemoryFolderSortService(),
    history: {
      pushState: (state: unknown, url?: string) => window.history.pushState(state, "", url),
      replaceState: (state: unknown, url?: string) => window.history.replaceState(state, "", url),
      getState: () => null,
      getLocation: () => ({ href: window.location.href, search: window.location.search }),
      subscribe: (_listener: (state: unknown) => void) => () => undefined
    },
    pullToRefreshEnvironment: { getWindowScrollY: () => window.scrollY },
    responsiveViewport,
    search,
    settings: { load: () => DEFAULT_UI_SETTINGS, save: (settings) => settings },
    operationRuntime,
    offlineSyncRuntime: {
      createAbortHandle: abortHandle,
      createTransferId: () => "account-bootstrap-sync",
      listFiles,
      fetchDownloadBlob: vi.fn(),
      readBlobText: async () => "",
      isUnauthorized: () => false,
      isReconnectRequired: () => false,
      toErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
    },
    retentionRepository,
    previewRuntime: createPreviewComposition({ retentionRepository }),
    accountRemovalRuntime: { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined }, diagnostics: createFakeDiagnosticsRuntimePorts()
  } satisfies AppServices;
}

let testServices: AppServices;

function render(ui: ReactElement) {
  const injectServices = (element: ReactElement) => cloneElement(element, { services: testServices });
  const view = renderTestingLibrary(injectServices(ui));
  return { ...view, rerender: (nextUi: ReactElement) => view.rerender(injectServices(nextUi)) };
}

function seedAccounts(records: Array<{ account: ConnectedAccount; session?: { token: string; expiresAt: string; rootPath: string; capabilities: AppSession["capabilities"] }; pendingRemoval?: { phase: "revoke" | "purge" }; pendingReconnect?: { baseUrl: string; username: string; label?: string } }>, activeAccountId?: string) {
  localStorage.setItem("davora-account-state", JSON.stringify({ activeAccountId: activeAccountId ?? records[0]?.account.id, accounts: records }));
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) });
  testServices = createAccountFixture();
  mockedApi.getHealth.mockReset();
  mockedApi.connectAccount.mockReset();
  mockedApi.createSession.mockReset();
  mockedApi.deleteConnectedAccount.mockReset();
  mockedApi.getHealth.mockResolvedValue(healthResponse);
  mockedApi.connectAccount.mockImplementation(async (request) => ({ kind: "http-success", data: { account: buildAccount(request.accountId ?? "connected", { displayName: request.label?.trim() || `${request.username}@${new URL(request.baseUrl).hostname}`, label: request.label, baseUrl: request.baseUrl, username: request.username, rootPath: request.rootPath ?? "", cacheNamespace: request.cacheNamespace ?? `ns-${request.accountId ?? "connected"}` }) } }));
  mockedApi.createSession.mockImplementation(async ({ accountId }) => buildSession(buildAccount(accountId)));
  mockedApi.deleteConnectedAccount.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("account bootstrap App integration", () => {
  it("shows the first-run connect account flow", async () => {
    render(<App />);

    await waitFor(() => expect(mockedApi.getHealth).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: /No connected accounts yet/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect account/i })).toBeInTheDocument();
  });

  it("repairs corrupt account storage without blocking the first-run flow", async () => {
    localStorage.setItem("davora-account-state", "not-json");

    const view = render(<App />);

    expect(await screen.findByRole("heading", { name: /No connected accounts yet/i })).toBeInTheDocument();
    expect(await screen.findByText(/Saved account data was invalid and has been reset/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Saved account data was invalid and has been reset/i)).toHaveLength(1);
    await waitFor(() => expect(localStorage.getItem("davora-account-state")).toBeNull());

    view.rerender(<App />);
    expect(screen.getAllByText(/Saved account data was invalid and has been reset/i)).toHaveLength(1);
  });

  it("uses the first operational account for bootstrap while settings keeps a pending management target", async () => {
    const pending = buildAccount("alpha", { displayName: "Pending Alpha", label: "Pending Alpha" });
    const operational = buildAccount("beta", { displayName: "Operational Beta", label: "Operational Beta" });
    seedAccounts([
      { account: pending, pendingRemoval: { phase: "revoke" } },
      { account: operational, session: buildSession(operational) }
    ], pending.id);

    render(<App />);

    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeInTheDocument();
    expect(mockedApi.createSession).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Profile & settings/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(settings).getByRole("heading", { name: "Pending Alpha" })).toBeInTheDocument();
    expect(within(settings).getByLabelText(/Active account/i)).toHaveValue(operational.id);
    expect(settings).toHaveTextContent(/Removal pending for Pending Alpha \(remote revoke\)/i);
    expect(settings).toHaveTextContent(/Operational Beta/);
  });

  it("keeps an all-pending registry visible for management without bootstrapping an operational session", async () => {
    const revokePending = buildAccount("alpha", { displayName: "Revoke Pending", label: "Revoke Pending" });
    const purgePending = buildAccount("beta", { displayName: "Purge Pending", label: "Purge Pending" });
    seedAccounts([
      { account: revokePending, pendingRemoval: { phase: "revoke" } },
      { account: purgePending, pendingRemoval: { phase: "purge" } }
    ], revokePending.id);

    render(<App />);

    expect(await screen.findByRole("heading", { name: /No connected accounts yet/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect account/i })).toBeInTheDocument();
    expect(mockedApi.createSession).not.toHaveBeenCalled();
    expect(mockedApi.listFiles).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(settings).getByRole("heading", { name: "Revoke Pending" })).toBeInTheDocument();
    expect(settings).toHaveTextContent(/Removal pending for Revoke Pending \(remote revoke\)/i);
    expect(settings).toHaveTextContent(/Removal pending for Purge Pending \(browser cleanup\)/i);
    expect(within(settings).getByRole("button", { name: /Retry removal/i })).toBeInTheDocument();
    expect(within(settings).getByText(/Connected accounts/i).nextElementSibling).toHaveTextContent("2");
  });

  it("repairs a stale active id to the first account before bootstrap without inventing a warning", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    localStorage.setItem("davora-account-state", JSON.stringify({
      activeAccountId: "missing-account",
      accounts: [{ account: alpha, session: buildSession(alpha) }, { account: beta, session: buildSession(beta) }]
    }));

    const view = render(<App />);

    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(settings).getByLabelText(/Active account/i)).toHaveValue(alpha.id);
    expect(screen.queryByText(/Saved account data was invalid/i)).not.toBeInTheDocument();

    view.rerender(<App />);
    expect(screen.queryAllByText(/Saved account data was invalid/i)).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem("davora-account-state") ?? "{}")).toMatchObject({ activeAccountId: alpha.id });
  });

  it("drops an expired stored session, keeps the account, and restores through the transport", async () => {
    const account = buildAccount("alpha", { displayName: "Expired stored session workspace" });
    seedAccounts([{ account, session: buildSession(account, { expiresAt: "2026-07-22T00:00:00.000Z" }) }], account.id);

    render(<App />);

    await waitFor(() => expect(mockedApi.createSession).toHaveBeenCalledWith({ accountId: account.id }));
    await waitFor(() => expect(localStorage.getItem("davora-account-state")).toContain(`"id":"${account.id}"`));
  });

  it("fails closed before account transports when account registry storage is unavailable", async () => {
    const originalGetItem = Storage.prototype.getItem;
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
      if (key === "davora-account-state") {
        throw new Error("blocked storage password-sentinel");
      }
      return originalGetItem.call(this, key);
    });

    render(<App />);

    expect(await screen.findByText(/Saved account data is unavailable\. Restore browser storage access, then reload Davora\./i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Connect account/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Base URL|Username|App password/i)).not.toBeInTheDocument();
    expect(mockedApi.connectAccount).not.toHaveBeenCalled();
    expect(mockedApi.createSession).not.toHaveBeenCalled();
    expect(mockedApi.deleteConnectedAccount).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("blocked storage password-sentinel");
    expect(JSON.stringify([consoleLog, consoleWarn, consoleError].flatMap((spy) => spy.mock.calls))).not.toContain("blocked storage password-sentinel");
    getItemSpy.mockRestore();
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it("does not let account-keyed corrupt offline state block the first-run flow", async () => {
    localStorage.setItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY, "not-json");

    render(<App />);

    await waitFor(() => expect(mockedApi.getHealth).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: /No connected accounts yet/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect account/i })).toBeInTheDocument();
    expect(localStorage.getItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY)).toBe("not-json");
  });

  it("surfaces missing SESSION_SECRET from health before the operator reaches a broken release flow", async () => {
    mockedApi.getHealth.mockResolvedValue({
      ...healthResponse,
      configLoaded: false,
      backend: "nextcloud",
      missing: ["SESSION_SECRET"]
    });

    render(<App />);

    expect(await screen.findByText(/SESSION_SECRET is missing/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect account/i })).toBeInTheDocument();
  });

  it("auto-restores an account even if browser state is marked reconnect_required but worker state is still intact", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace", label: "Alpha workspace", connectionState: "reconnect_required" });
    seedAccounts([
      {
        account,
        pendingReconnect: { baseUrl: account.baseUrl, username: account.username, label: account.label }
      }
    ], account.id);

    render(<App />);

    await waitFor(() => expect(mockedApi.createSession).toHaveBeenCalledWith({ accountId: account.id }));
    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeInTheDocument();
  });

  it("shows reconnect form with prefilled account info when auto-restore pauses after reconnect failure", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace", label: "Alpha workspace", connectionState: "reconnect_required" });
    seedAccounts([
      {
        account,
        pendingReconnect: { baseUrl: account.baseUrl, username: account.username, label: account.label }
      }
    ], account.id);
    mockedApi.createSession.mockRejectedValueOnce(new ApiRequestError("Reconnect this account.", 409, "account_reconnect_required"));

    render(<App />);

    expect(await screen.findByRole("heading", { name: /Reconnect Alpha workspace/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue(account.baseUrl)).toBeInTheDocument();
    expect(screen.getByDisplayValue(account.username)).toBeInTheDocument();
    expect(screen.getByLabelText("Label")).toHaveValue(account.label ?? "");
    expect(screen.getByRole("button", { name: /Reconnect account/i })).toBeInTheDocument();
  });

  it("pauses automatic restore after a terminal session failure until the user retries manually", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace", label: "Alpha workspace" });
    seedAccounts([{ account }], account.id);
    mockedApi.createSession
      .mockRejectedValueOnce(new ApiRequestError("Session expired", 401, "session_invalid"))
      .mockImplementationOnce(async () => buildSession(account));

    render(<App />);

    await waitFor(() => expect(mockedApi.createSession).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: /Retry restore/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Retry restore/i }));

    await waitFor(() => expect(mockedApi.createSession).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeInTheDocument();
  });
});
