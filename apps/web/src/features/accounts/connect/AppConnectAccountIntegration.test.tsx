import { cleanup, fireEvent, render as renderTestingLibrary, screen, waitFor, within } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../../diagnostics/testing/fakes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../../App";
import type { AppServices } from "../../../app/AppServices";
import type { AccountTransport } from "../index";
import { createMemoryFolderSortService } from "../../browsing/folderSort/testing/fakeStorage";
import { buildAccount, buildSession } from "../../../test/accounts";
import { buildHealthResponse } from "../../../test/api";

const { registerSwMock } = vi.hoisted(() => ({
  registerSwMock: vi.fn(() => ({
    offlineReady: [false, vi.fn()] as [boolean, (value: boolean) => void],
    needRefresh: [false, vi.fn()] as [boolean, (value: boolean) => void],
    updateServiceWorker: vi.fn(async () => undefined)
  }))
}));

vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: registerSwMock }));

const healthResponse = buildHealthResponse();
const matchMediaMock = vi.fn((query?: string) => ({
  matches: false,
  media: query ?? "",
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn()
}));
const mockedApi = {
  getHealth: vi.fn<AppServices["accountTransport"]["getHealth"]>(),
  connectAccount: vi.fn<AccountTransport["connectAccount"]>(),
  createSession: vi.fn<AccountTransport["createSession"]>(),
  deleteConnectedAccount: vi.fn<AccountTransport["deleteConnectedAccount"]>(),
  listFiles: vi.fn<(path: string) => Promise<{ path: string; items: Array<{ path: string; name: string; isFolder: boolean; size?: number; mimeType?: string }> }>>()
};

type AccountSnapshot = ReturnType<AppServices["accountRegistry"]["getSnapshot"]>;
type AccountState = ReturnType<AppServices["accountRegistry"]["getState"]>;
type PreviewMaterial = { readonly id: string; readonly kind: "blob" | "stream" };
type PreviewResource = { readonly id: string; readonly kind: "blob" | "stream" };
function isAccountSnapshot(value: unknown): value is AccountSnapshot {
  return typeof value === "object" && value !== null && "accounts" in value && Array.isArray(value.accounts);
}
function isAccountPayload(value: unknown): value is { readonly account: ReturnType<typeof buildAccount> } {
  return typeof value === "object" && value !== null && "account" in value && typeof value.account === "object" && value.account !== null;
}

function createAccountFixture(): AppServices {
  let snapshot: AccountSnapshot = { accounts: [] };
  let state: AccountState = { kind: "ready", snapshot };
  let snapshotSource: string | null | undefined;
  let lastConnectedAccount: ReturnType<typeof buildAccount> | undefined;
  const listeners = new Set<() => void>();
  const readSnapshot = (): AccountSnapshot => {
    const stored = localStorage.getItem("davora-account-state");
    if (stored === snapshotSource) return snapshot;
    snapshotSource = stored;
    const parsed: unknown = stored ? JSON.parse(stored) : undefined;
    snapshot = isAccountSnapshot(parsed) ? parsed : { accounts: [] };
    state = { kind: "ready", snapshot };
    return snapshot;
  };
  const persist = (next: AccountSnapshot): void => {
    localStorage.setItem("davora-account-state", JSON.stringify(next));
    snapshotSource = localStorage.getItem("davora-account-state");
    snapshot = next;
    state = { kind: "ready", snapshot };
    for (const listener of listeners) listener();
  };
  const accountRegistry: AppServices["accountRegistry"] = {
    getState: () => { readSnapshot(); return state; },
    getSnapshot: () => readSnapshot(),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    repair: () => ({ kind: "committed", snapshot }),
    connectAccount: async (request, transport) => {
      const remote = await transport(request);
      if (remote.kind !== "http-success") throw new Error("Account connection failed in the account-connect fixture.");
      if (!isAccountPayload(remote.data)) throw new Error("Account connection payload was invalid in the account-connect fixture.");
      const account = remote.data.account;
      lastConnectedAccount = account;
      const current = readSnapshot();
      const records = current.accounts.filter((record) => record.account.id !== account.id);
      try {
        persist({ activeAccountId: account.id, accounts: [...records, { account }] });
        return { kind: "committed", snapshot, account };
      } catch {
        return { kind: "partial", message: "Connected remotely, but could not be saved in this browser.", clearCredential: true };
      }
    },
    commitConnectedAccount: (account) => {
      const current = readSnapshot();
      persist({ activeAccountId: account.id, accounts: [...current.accounts.filter((record) => record.account.id !== account.id), { account }] });
      return { kind: "committed", snapshot };
    },
    commitSession: (accountId, session) => {
      const current = readSnapshot();
      persist({ activeAccountId: accountId, accounts: current.accounts.map((record) => record.account.id === accountId ? { account: session.account, session } : record) });
      return { kind: "committed", snapshot };
    },
    clearAccountSession: () => ({ kind: "committed", snapshot }),
    markAccountReconnectRequired: () => ({ kind: "committed", snapshot }),
    switchAccount: (accountId) => { const current = readSnapshot(); persist({ ...current, activeAccountId: accountId }); return { kind: "committed", snapshot }; },
    removeAccount: async () => ({ kind: "committed", snapshot }),
    retryRemovalCommit: () => ({ kind: "committed", snapshot })
  };
  const abortHandle = () => { const controller = new AbortController(); return { signal: controller.signal, abort: () => controller.abort() }; };
  const accountTransport: AccountTransport = {
    getHealth: mockedApi.getHealth,
    connectAccount: mockedApi.connectAccount,
    createSession: mockedApi.createSession,
    deleteConnectedAccount: mockedApi.deleteConnectedAccount
  };
  const accountSession: AppServices["accountSession"] = {
    getHealth: accountTransport.getHealth,
    createSession: async (input) => {
      const session = await accountTransport.createSession(input);
      return lastConnectedAccount && session.account.id === input.accountId ? { ...session, account: lastConnectedAccount } : session;
    },
    commitSession: accountRegistry.commitSession,
    markAccountReconnectRequired: accountRegistry.markAccountReconnectRequired,
    clearAccountSession: accountRegistry.clearAccountSession,
    delay: async () => undefined
  };
  const folder: AppServices["folder"] = {
    createAbortHandle: abortHandle,
    loadFolder: async ({ path }) => ({ kind: "success", items: (await mockedApi.listFiles(path)).items }),
    readCachedFolder: () => undefined,
    writeCachedFolder: () => undefined
  };
  const search: AppServices["search"] = { createAbortHandle: abortHandle, loadSearch: async () => ({ kind: "success", items: [] }), readCachedSearch: () => undefined, writeCachedSearch: () => undefined };
  const online: ReturnType<AppServices["connectivity"]["read"]> = { kind: "online" };
  const wide: ReturnType<AppServices["responsiveViewport"]["getSnapshot"]> = { kind: "wide" };
  const emptySnapshot = (account: { accountId: string; cacheNamespace: string }) => ({ account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 1 }, roots: [], files: [], memberships: [] });
  const retentionRepository: AppServices["retentionRepository"] = {
    readSnapshot: async (account) => ({ kind: "success", value: emptySnapshot(account) }),
    readPreview: async () => ({ kind: "success", value: undefined }),
    writePreview: async (account) => ({ kind: "success", value: emptySnapshot(account) }),
    beginRoot: async (account) => ({ kind: "success", value: emptySnapshot(account) }),
    persistRetainedFile: async (account) => ({ kind: "success", value: emptySnapshot(account) }),
    completeRoot: async (account) => ({ kind: "success", value: emptySnapshot(account) }),
    removeRoot: async (account) => ({ kind: "success", value: emptySnapshot(account) }),
    clearNormalCache: async (account) => ({ kind: "success", value: emptySnapshot(account) }),
    purgeAccountNamespace: async (account) => ({ kind: "success", value: emptySnapshot(account) }),
    configureNormalCacheLimit: async (account) => ({ kind: "success", value: emptySnapshot(account) })
  };
  const previewRuntime: AppServices["previewRuntime"] = {
    session: { createSessionAdapters: () => ({ cache: { read: async () => undefined, write: async () => ({ kind: "skipped", reason: "not-cacheable" }) }, live: { acquire: async () => { throw new Error("Preview is not used by the account-connect fixture."); } }, abort: { create: () => ({ id: "connect-preview", abort: () => undefined }) }, resources: { apply: (material: PreviewMaterial): PreviewResource => material, release: () => undefined }, failures: { classify: () => ({ kind: "ordinary", message: "Preview failed." }) }, failurePublication: { publishFailure: () => true }, publication: { publish: () => true }, cachePublication: { publishSnapshot: () => true, publishEvent: () => true }, prefetch: { probe: async () => false, prefetch: async () => ({ kind: "skipped" }) }, clock: { now: () => Date.now() }, resolveResourceUrl: () => undefined }) },
    modal: { startOriginalFileOpen: () => ({ completion: Promise.resolve(), cancel: () => undefined }), pdf: { loadPdfJs: async () => { throw new Error("PDF is not used by the account-connect fixture."); }, fetch: async () => new Response(), requestAnimationFrame: (callback) => requestAnimationFrame(callback), getDevicePixelRatio: () => 1, createResizeObserver: () => undefined }, video: { setTimeout, clearTimeout, getLocationHref: () => window.location.href }, setTimeout, clearTimeout, getLocationHref: () => window.location.href, addWindowKeydownListener: () => () => undefined, loadAudioPreviewPosition: () => undefined, saveAudioPreviewPosition: () => undefined, clearAudioPreviewPosition: () => undefined },
    folderAudio: { storage: { getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: (key) => localStorage.removeItem(key) }, createStreamingFileUrl: async () => "", nowIso: () => "2026-01-01T00:00:00.000Z", loadAudioPreviewPosition: () => undefined, saveAudioPreviewPosition: () => undefined }
  };
  const browsingCache: AppServices["browsingCache"] = { readFolder: () => ({ kind: "miss" }), writeFolder: () => ({ kind: "written" }), readSearch: () => ({ kind: "miss" }), writeSearch: () => ({ kind: "written" }), clearNamespace: () => ({ kind: "cleared" }), clearFolderPath: () => ({ kind: "cleared" }), clearNamespaceOrThrow: () => undefined, clearFolderPathOrThrow: () => undefined };
  const operationRuntime: AppServices["operationRuntime"] = { request: { createAbortHandle: abortHandle, createTransferId: () => "connect-transfer" }, mutation: { createFolder: async () => ({ action: "createFolder", parentPath: "", path: "" }), deleteFile: async () => ({ action: "delete", parentPath: "", path: "" }), uploadFile: async () => ({ action: "upload", parentPath: "", path: "" }), copyOrMove: async () => ({ action: "copy", parentPath: "", path: "" }), listDestination: async () => ({ items: [] }) }, download: { prepareDownloadFile: async () => ({ blob: new Blob(), filename: "" }), fetchDownloadBlob: async () => ({ blob: new Blob() }), listFiles: async () => ({ items: [] }), triggerBrowserDownload: () => undefined, saveDownload: () => undefined }, batch: { downloadSelectionAsZip: async () => ({ blob: new Blob(), plan: { archiveName: "connect.zip", selectedCount: 0, selectedFileCount: 0, selectedDirectoryCount: 0, directories: [], files: [], failedFiles: [] } }) }, preview: { createFileStreamUrl: async () => "" }, time: { wait: async () => {} }, uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) }, isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback };
  const history: AppServices["history"] = { pushState: (state, url) => { window.history.pushState(state, "", url); }, replaceState: (state, url) => { window.history.replaceState(state, "", url); }, getState: () => null, getLocation: () => ({ href: window.location.href, search: window.location.search }), subscribe: () => () => undefined };
  return {
    accountRegistry, accountTransport, accountSession, browsingCache,
    favouriteResolveRuntime: { listFiles: async () => ({ items: [] }), cacheFolder: () => undefined },
    connectivity: { read: () => online, subscribe: () => () => undefined },
    explicitOfflineRuntime: { storage: { read: () => ({ kind: "ready", enabled: false }), commit: () => ({ kind: "committed" }), reset: () => ({ kind: "committed" }), repair: () => ({ kind: "repaired" }) }, network: { setBlocked: () => undefined } },
    clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
    favourites: { load: () => ({ kind: "loaded", entries: [] }), save: () => ({ kind: "saved", entries: [] }), clear: () => ({ kind: "cleared" }), create: (entry) => ({ ...entry, accountId: "alpha", accountBackend: "mock", accountRootPath: "", cacheNamespace: "ns-alpha", addedAt: "2026-01-01T00:00:00.000Z" }) },
    favouritesPointerEnvironment: { elementFromPoint: () => null, addWindowListener: () => () => undefined }, folder,
    folderSorts: createMemoryFolderSortService(),
    history,
    pullToRefreshEnvironment: { getWindowScrollY: () => window.scrollY }, responsiveViewport: { getSnapshot: () => wide, subscribe: () => () => undefined }, search,
    settings: { load: () => ({ themeMode: "system", fileSizeDisplayMode: "human", maxCacheableFileSizeBytes: 1000000, imagePreviewFitMode: "fill", previewFreshnessIntervalSeconds: 60, keepAwakeEnabled: true, showHiddenFiles: false, experimentalHeicPreviewEnabled: false, experimentalFolderAppShortcutsEnabled: false, diagnosticsEnabled: false, sortMode: "name-asc", videoMuted: false }), save: (value) => value },
    operationRuntime, offlineSyncRuntime: { createAbortHandle: abortHandle, createTransferId: () => "connect-sync", listFiles: async () => ({ path: "", items: [] }), fetchDownloadBlob: async () => ({ blob: new Blob() }), readBlobText: async () => "", isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback },
    retentionRepository, previewRuntime, accountRemovalRuntime: { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined }, diagnostics: createFakeDiagnosticsRuntimePorts()
  } satisfies AppServices;
}

let testServices: AppServices;
function createConnectFixture(baseServices: AppServices): AppServices {
  const fixture = {
    accountRegistry: baseServices.accountRegistry,
    accountTransport: baseServices.accountTransport,
    accountSession: baseServices.accountSession,
    browsingCache: baseServices.browsingCache,
    favouriteResolveRuntime: baseServices.favouriteResolveRuntime,
    connectivity: baseServices.connectivity,
    explicitOfflineRuntime: baseServices.explicitOfflineRuntime,
    clock: baseServices.clock,
    favourites: baseServices.favourites,
    favouritesPointerEnvironment: baseServices.favouritesPointerEnvironment,
    folder: baseServices.folder,
    folderSorts: baseServices.folderSorts,
    history: baseServices.history,
    pullToRefreshEnvironment: baseServices.pullToRefreshEnvironment,
    responsiveViewport: baseServices.responsiveViewport,
    search: baseServices.search,
    settings: baseServices.settings,
    operationRuntime: baseServices.operationRuntime,
    offlineSyncRuntime: baseServices.offlineSyncRuntime,
    retentionRepository: baseServices.retentionRepository,
    previewRuntime: baseServices.previewRuntime,
    accountRemovalRuntime: baseServices.accountRemovalRuntime,
    diagnostics: baseServices.diagnostics
  } satisfies AppServices;
  return fixture satisfies AppServices;
}

function render(_ui: Parameters<typeof renderTestingLibrary>[0]) {
  return renderTestingLibrary(<App services={createConnectFixture(testServices)} />);
}

function seedAccounts(records: Array<{ account: ReturnType<typeof buildAccount>; session?: ReturnType<typeof buildSession> }>, activeAccountId?: string): void {
  localStorage.setItem("davora-account-state", JSON.stringify({ activeAccountId: activeAccountId ?? records[0]?.account.id, accounts: records }));
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
  registerSwMock.mockReturnValue({ offlineReady: [false, vi.fn()], needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn(async () => undefined) });
  Object.defineProperty(window, "matchMedia", { value: matchMediaMock, configurable: true, writable: true });
  mockedApi.getHealth.mockResolvedValue(healthResponse);
  mockedApi.connectAccount.mockImplementation(async (request) => ({ kind: "http-success", data: { account: buildAccount(request.accountId ?? "connected", { displayName: request.label?.trim() || `${request.username}@${new URL(request.baseUrl).hostname}`, label: request.label, baseUrl: request.baseUrl, username: request.username, rootPath: request.rootPath ?? "", cacheNamespace: request.cacheNamespace ?? `ns-${request.accountId ?? "connected"}` }) } }));
  mockedApi.createSession.mockImplementation(async ({ accountId }) => buildSession(buildAccount(accountId)));
  mockedApi.deleteConnectedAccount.mockResolvedValue(undefined);
  mockedApi.listFiles.mockResolvedValue({ path: "", items: [{ path: "Projects", name: "Projects", isFolder: true }, { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] });
  testServices = createAccountFixture();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  registerSwMock.mockReset();
});

describe("account-connect App integration", () => {
  it("keeps the connect form open after remote success when account storage cannot commit", async () => {
    const originalSetItem = Storage.prototype.setItem;
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "davora-account-state") {
        throw new Error("quota password-sentinel");
      }
      return originalSetItem.call(this, key, value);
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Connect account/i }));
    await screen.findByRole("heading", { name: /Connect Nextcloud account/i });
    fireEvent.change(screen.getByLabelText(/Base URL/i), { target: { value: "https://cloud.example.com" } });
    fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText(/App password/i), { target: { value: "password-sentinel" } });
    fireEvent.submit(screen.getByRole("button", { name: /^Connect account$/i }).closest("form")!);

    expect(await screen.findByText(/connected remotely, but could not be saved in this browser/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Connect Nextcloud account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/App password/i)).toHaveValue("");
    expect(mockedApi.createSession).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("password-sentinel");
    expect(localStorage.getItem("davora-account-state") ?? "").not.toContain("password-sentinel");
    expect(JSON.stringify([consoleLog, consoleWarn, consoleError].flatMap((spy) => spy.mock.calls))).not.toContain("password-sentinel");
    setItemSpy.mockRestore();
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it("connects an account and loads a session", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Connect account/i }));
    await screen.findByRole("heading", { name: /Connect Nextcloud account/i });
    const rootInput = screen.getByLabelText(/Root folder/i);
    expect(rootInput).toHaveValue("");
    expect(rootInput).toHaveAttribute("placeholder", "Account root (/)");
    fireEvent.change(screen.getByLabelText(/Base URL/i), { target: { value: "https://cloud.example.com" } });
    fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText(/App password/i), { target: { value: "secret" } });
    fireEvent.change(screen.getByLabelText(/^Label$/i), { target: { value: "Personal" } });
    fireEvent.submit(screen.getByRole("button", { name: /^Connect account$/i }).closest("form")!);

    await waitFor(() => expect(mockedApi.connectAccount).toHaveBeenCalled());
    expect(mockedApi.connectAccount.mock.calls[0][0].rootPath).toBeUndefined();
    await waitFor(() => expect(mockedApi.createSession).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: /Create folder/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Profile & settings/i })).toBeInTheDocument();
  });

  it("activates newly added B and closes the add-account modal after the committed App outcome", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace", label: "Beta workspace" });
    seedAccounts([{ account: alpha, session: buildSession(alpha) }], alpha.id);
    mockedApi.connectAccount.mockResolvedValueOnce({ kind: "http-success", data: { account: beta } });
    mockedApi.createSession.mockResolvedValueOnce(buildSession(beta));

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(within(settingsDialog).getByRole("button", { name: /Add account/i }));
    await screen.findByRole("heading", { name: /Add Nextcloud account/i });
    fireEvent.change(screen.getByLabelText(/Base URL/i), { target: { value: beta.baseUrl } });
    fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: beta.username } });
    fireEvent.change(screen.getByLabelText(/App password/i), { target: { value: "beta-password" } });
    fireEvent.submit(screen.getByRole("button", { name: /^Add account$/i }).closest("form")!);

    await waitFor(() => expect(mockedApi.createSession).toHaveBeenCalledWith({ accountId: beta.id }));
    expect(screen.queryByRole("heading", { name: /Add Nextcloud account/i })).not.toBeInTheDocument();
    expect(localStorage.getItem("davora-account-state")).toContain(`"activeAccountId":"${beta.id}"`);
  });

  it("submits an explicit test root folder only when the user enters it", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Connect account/i }));
    await screen.findByRole("heading", { name: /Connect Nextcloud account/i });
    fireEvent.change(screen.getByLabelText(/Base URL/i), { target: { value: "https://cloud.example.com" } });
    fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText(/App password/i), { target: { value: "secret" } });
    fireEvent.change(screen.getByLabelText(/Root folder/i), { target: { value: ".davora-agent-test" } });
    fireEvent.submit(screen.getByRole("button", { name: /^Connect account$/i }).closest("form")!);

    await waitFor(() => expect(mockedApi.connectAccount).toHaveBeenCalled());
    expect(mockedApi.connectAccount.mock.calls[0][0].rootPath).toBe(".davora-agent-test");
  });
});
