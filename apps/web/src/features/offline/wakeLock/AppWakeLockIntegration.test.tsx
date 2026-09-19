import { cleanup, fireEvent, render as renderTestingLibrary, screen, waitFor, within } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSession, ConnectedAccount, FileEntry, FilePreview } from "@davora/shared";

import App from "../../../App";
import type { AppServices } from "../../../app/AppServices";
import { createPreviewComposition } from "../../../app/createPreviewComposition";
import { createAccountRegistryService } from "../../accounts/registry";
import { createFakeDiagnosticsRuntimePorts } from "../../diagnostics/testing/fakes";
import type { AccountTransport } from "../../accounts";
import type { BrowsingCacheRepository, FolderPorts, SearchPorts } from "../../browsing";
import type { ConnectivityPort } from "../connectivity";
import type { ExplicitOfflineModeRuntimePort } from "../mode";
import type { FolderAudioRuntimePorts } from "../../preview/folderAudio";
import { DEFAULT_UI_SETTINGS, normalizeUiSettings } from "../../settings";
import { WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT, type ResponsiveViewportPort } from "../../navigation";

type OperationRuntimePort = AppServices["operationRuntime"];
type RetentionRepository = AppServices["retentionRepository"];
type RetentionAccount = Parameters<RetentionRepository["readSnapshot"]>[0];
type RetentionSnapshot = Extract<Awaited<ReturnType<RetentionRepository["readSnapshot"]>>, { kind: "success" }>["value"];
type RetentionResult<T> = { readonly kind: "success"; readonly value: T } | { readonly kind: "failure"; readonly message: string };

class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

const buildAccount = (id: string, overrides: Partial<ConnectedAccount> = {}): ConnectedAccount => ({
  id,
  type: "nextcloud",
  displayName: `Account ${id}`,
  label: `Account ${id}`,
  baseUrl: `https://${id}.example.com`,
  username: `${id}-user`,
  rootPath: ".davora-agent-test",
  backend: "mock",
  connectionState: "connected",
  lastValidatedAt: "2026-05-21T10:00:00.000Z",
  cacheNamespace: `ns-${id}`,
  ...overrides
});

const buildSession = (account: ConnectedAccount, overrides: Partial<AppSession> = {}): AppSession => ({
  token: `token-${account.id}`,
  expiresAt: "2099-01-01T00:00:00.000Z",
  rootPath: account.rootPath,
  capabilities: {
    backend: account.backend,
    readOnly: false,
    search: true,
    preview: true,
    download: true,
    offlineCache: true,
    createFolder: true,
    upload: true,
    move: true,
    copy: true,
    delete: true,
    mediaPreview: true,
    markdownPreview: true,
    openedFileCache: true
  },
  account,
  ...overrides
});

const buildHealthResponse = (): Awaited<ReturnType<AccountTransport["getHealth"]>> => ({
  app: "davora",
  configLoaded: true,
  backend: "mock",
  rootPath: ".davora-agent-test",
  unlockRequired: false,
  connectionMode: "in_app",
  supportedAccountTypes: ["nextcloud"]
});

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    offlineReady: [false, vi.fn()],
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(async () => undefined)
  })
}));

const mockedApi = {
  getHealth: vi.fn<AccountTransport["getHealth"]>(),
  connectAccount: vi.fn<AccountTransport["connectAccount"]>(),
  createSession: vi.fn<AccountTransport["createSession"]>(),
  deleteConnectedAccount: vi.fn<AccountTransport["deleteConnectedAccount"]>(),
  listFiles: vi.fn<(path: string, token: string, signal?: AbortSignal) => Promise<{ path: string; items: FileEntry[] }>>(),
  getFile: vi.fn<(path: string, token: string, signal?: AbortSignal) => Promise<{ file: FilePreview }>>(),
  prepareDownloadFile: vi.fn<OperationRuntimePort["download"]["prepareDownloadFile"]>(),
  fetchDownloadBlob: vi.fn<OperationRuntimePort["download"]["fetchDownloadBlob"]>(),
  createStreamingFileUrl: vi.fn<(path: string, token: string, signal?: AbortSignal) => Promise<string>>(),
  triggerBrowserDownload: vi.fn<OperationRuntimePort["download"]["triggerBrowserDownload"]>()
};

const healthResponse = buildHealthResponse();
const ONLINE = { kind: "online" } as const;
const textPreview: FilePreview = {
  path: "Projects/roadmap.txt",
  name: "roadmap.txt",
  isFolder: false,
  mimeType: "text/plain",
  viewer: "text",
  content: "normalized API preview",
  encoding: "utf8",
  truncated: false,
  bytesRead: 22,
  size: 70
};
const mediaPlayMock = vi.fn<() => Promise<void>>(async () => undefined);
const mediaPauseMock = vi.fn<() => void>(() => undefined);

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installWakeLockMock() {
  const sentinel = Object.assign(new EventTarget(), {
    released: false,
    release: vi.fn(async () => {
      if (sentinel.released) return;
      sentinel.released = true;
      sentinel.dispatchEvent(new Event("release"));
    })
  });
  const request = vi.fn(async () => sentinel);
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
  return { request, sentinel };
}

function createRetentionRepository(): RetentionRepository {
  const snapshot = (account: RetentionAccount): RetentionSnapshot => ({
    account,
    normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 },
    roots: [],
    files: [],
    memberships: []
  });
  const success = <T,>(value: T): RetentionResult<T> => ({ kind: "success", value });
  return {
    readSnapshot: vi.fn(async (account) => success(snapshot(account))),
    readPreview: vi.fn(async () => success(undefined)),
    writePreview: vi.fn(async (account) => success(snapshot(account))),
    beginRoot: vi.fn(async (account) => success(snapshot(account))),
    persistRetainedFile: vi.fn(async (account) => success(snapshot(account))),
    completeRoot: vi.fn(async (account) => success(snapshot(account))),
    removeRoot: vi.fn(async (account) => success(snapshot(account))),
    clearNormalCache: vi.fn(async (account) => success(snapshot(account))),
    purgeAccountNamespace: vi.fn(async (account) => success(snapshot(account))),
    configureNormalCacheLimit: vi.fn(async (account) => success(snapshot(account)))
  };
}

function createWakeLockFixture(): AppServices {
  const storage = {
    readItem: (key: string) => ({ ok: true as const, value: localStorage.getItem(key) }),
    writeItem: (key: string, value: string) => { localStorage.setItem(key, value); return { ok: true as const }; },
    deleteItem: (key: string) => { localStorage.removeItem(key); return { ok: true as const }; }
  };
  let accountRegistry: ReturnType<typeof createAccountRegistryService> | undefined;
  const getAccountRegistry = () => accountRegistry ??= createAccountRegistryService(storage, { isExpired: (expiresAt) => Date.parse(expiresAt) <= Date.now() });
  const abortHandle = () => { const controller = new AbortController(); return { signal: controller.signal, abort: () => controller.abort() }; };
  const accountTransport: AccountTransport = {
    getHealth: mockedApi.getHealth,
    connectAccount: mockedApi.connectAccount,
    createSession: mockedApi.createSession,
    deleteConnectedAccount: mockedApi.deleteConnectedAccount
  };
  const accountSession = {
    getHealth: accountTransport.getHealth,
    createSession: accountTransport.createSession,
    commitSession: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["commitSession"]>) => getAccountRegistry().commitSession(...args),
    markAccountReconnectRequired: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["markAccountReconnectRequired"]>) => getAccountRegistry().markAccountReconnectRequired(...args),
    clearAccountSession: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["clearAccountSession"]>) => getAccountRegistry().clearAccountSession(...args),
    delay: async () => undefined
  };
  const accountRemovalRuntime: AppServices["accountRemovalRuntime"] = { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined };
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
  const folder: FolderPorts = {
    createAbortHandle: abortHandle,
    loadFolder: async ({ path, token, signal }) => {
      try {
        return { kind: "success", items: (await mockedApi.listFiles(path, token, signal)).items } as const;
      } catch (error) {
        return { kind: "failure", error: error instanceof Error ? error : new Error("Unable to load folder.") } as const;
      }
    },
    readCachedFolder: () => undefined,
    writeCachedFolder: () => undefined
  };
  const search: SearchPorts = {
    createAbortHandle: abortHandle,
    loadSearch: async () => ({ kind: "success", items: [] }),
    readCachedSearch: () => undefined,
    writeCachedSearch: () => undefined
  };
  const retentionRepository = createRetentionRepository();
  const operationRuntime: OperationRuntimePort = {
    request: { createAbortHandle: abortHandle, createTransferId: (() => { let next = 0; return () => `wake-lock-transfer-${++next}`; })() },
    mutation: {
      createFolder: async () => ({ action: "createFolder", parentPath: "", path: "" }),
      deleteFile: async () => ({ action: "delete", parentPath: "", path: "" }),
      uploadFile: async () => ({ action: "upload", parentPath: "", path: "" }),
      copyOrMove: async () => ({ action: "copy", parentPath: "", path: "" }),
      listDestination: async (path, token) => mockedApi.listFiles(path, token)
    },
    download: {
      prepareDownloadFile: mockedApi.prepareDownloadFile,
      fetchDownloadBlob: mockedApi.fetchDownloadBlob,
      listFiles: async (path, token, signal) => mockedApi.listFiles(path, token, signal),
      triggerBrowserDownload: mockedApi.triggerBrowserDownload,
      saveDownload: mockedApi.triggerBrowserDownload
    },
    batch: { downloadSelectionAsZip: vi.fn() },
    uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) },
    isUnauthorized: (error) => error instanceof ApiRequestError && error.status === 401,
    isReconnectRequired: () => false,
    toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback
  };
  const previewTransport = {
    getFile: async (path: string) => ({ file: { ...textPreview, path, name: path.split("/").at(-1) ?? path, mimeType: "audio/mp4", viewer: "audio" as const, content: "", encoding: "none" as const, bytesRead: 0, size: 18 } }),
    fetchOriginalFile: async () => ({ blob: new Blob(["audio"]), mimeType: "audio/mp4", filename: "chapter.m4a" }),
    createStreamingFileUrl: (path: string, token: string, signal?: AbortSignal) => mockedApi.createStreamingFileUrl(path, token, signal)
  };
  const folderAudioRuntime: FolderAudioRuntimePorts = {
    storage: localStorage,
    createStreamingFileUrl: (path, token) => mockedApi.createStreamingFileUrl(path, token),
    nowIso: () => "2026-01-01T00:00:00.000Z",
    loadAudioPreviewPosition: () => undefined,
    saveAudioPreviewPosition: () => undefined
  };
  const settings: AppServices["settings"] = {
    load: () => {
      try { return normalizeUiSettings(JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}")); }
      catch { return DEFAULT_UI_SETTINGS; }
    },
    save: (value) => { localStorage.setItem("davora-ui-settings", JSON.stringify(value)); return value; }
  };
  const connectivity: ConnectivityPort = { read: () => ONLINE, subscribe: () => () => undefined };
  const explicitOfflineRuntime: ExplicitOfflineModeRuntimePort = {
    storage: { read: () => ({ kind: "ready", enabled: false }), commit: () => ({ kind: "committed" }), reset: () => ({ kind: "committed" }), repair: () => ({ kind: "repaired" }) },
    network: { setBlocked: () => undefined }
  };
  return {
    accountRegistry: {
      getState: () => getAccountRegistry().getState(),
      getSnapshot: () => getAccountRegistry().getSnapshot(),
      subscribe: (listener: () => void) => getAccountRegistry().subscribe(listener),
      repair: () => getAccountRegistry().repair(),
      connectAccount: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["connectAccount"]>) => getAccountRegistry().connectAccount(...args),
      commitConnectedAccount: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["commitConnectedAccount"]>) => getAccountRegistry().commitConnectedAccount(...args),
      commitSession: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["commitSession"]>) => getAccountRegistry().commitSession(...args),
      clearAccountSession: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["clearAccountSession"]>) => getAccountRegistry().clearAccountSession(...args),
      markAccountReconnectRequired: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["markAccountReconnectRequired"]>) => getAccountRegistry().markAccountReconnectRequired(...args),
      switchAccount: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["switchAccount"]>) => getAccountRegistry().switchAccount(...args),
      removeAccount: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["removeAccount"]>) => getAccountRegistry().removeAccount(...args),
      retryRemovalCommit: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["retryRemovalCommit"]>) => getAccountRegistry().retryRemovalCommit(...args)
    },
    accountTransport,
    accountSession,
    browsingCache: cache,
    favouriteResolveRuntime: { listFiles: async () => ({ items: [] }), cacheFolder: () => undefined },
    connectivity,
    explicitOfflineRuntime,
    clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
    favourites: {
      load: () => ({ kind: "loaded", entries: [] }),
      save: () => ({ kind: "saved", entries: [] }),
      clear: () => ({ kind: "cleared" }),
      create: (entry, account) => ({ ...entry, accountId: account.id, accountBackend: account.backend, accountRootPath: account.rootPath, cacheNamespace: account.cacheNamespace, addedAt: "2026-01-01T00:00:00.000Z" })
    },
    favouritesPointerEnvironment: { elementFromPoint: () => null, addWindowListener: () => () => undefined },
    folder,
    history: { pushState: (state: unknown, url?: string): void => { window.history.pushState(state, "", url); }, replaceState: (state: unknown, url?: string): void => { window.history.replaceState(state, "", url); }, getState: (): unknown => window.history.state, getLocation: () => ({ href: window.location.href, search: window.location.search }), subscribe: () => () => undefined },
    pullToRefreshEnvironment: { getWindowScrollY: () => window.scrollY },
    responsiveViewport: { getSnapshot: () => WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT, subscribe: () => () => undefined } satisfies ResponsiveViewportPort,
    search,
    settings,
    operationRuntime,
    offlineSyncRuntime: { createAbortHandle: abortHandle, createTransferId: () => "wake-lock-sync", listFiles: async (path) => ({ path, items: [] }), fetchDownloadBlob: mockedApi.fetchDownloadBlob, readBlobText: async () => "", isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback },
    retentionRepository,
    previewRuntime: createPreviewComposition({ retentionRepository, previewTransport, folderAudioRuntime }),
    accountRemovalRuntime,
    diagnostics: createFakeDiagnosticsRuntimePorts()
  } satisfies AppServices;
}

function render(ui: ReactElement) {
  const view = renderTestingLibrary(ui.type === App ? ui : cloneElement(ui, {}));
  return { ...view, rerender: (nextUi: ReactElement) => view.rerender(nextUi) };
}

function seedAccounts(records: Array<{ account: ConnectedAccount; session?: { token: string; expiresAt: string; rootPath: string; capabilities: AppSession["capabilities"] } }>, activeAccountId?: string) {
  localStorage.setItem("davora-account-state", JSON.stringify({ activeAccountId: activeAccountId ?? records[0]?.account.id, accounts: records }));
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) });
  Object.defineProperty(HTMLMediaElement.prototype, "play", { value: mediaPlayMock, configurable: true, writable: true });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { value: mediaPauseMock, configurable: true, writable: true });
  Reflect.deleteProperty(navigator, "wakeLock");
  vi.clearAllMocks();
  mockedApi.getHealth.mockResolvedValue(healthResponse);
  mockedApi.connectAccount.mockResolvedValue({ kind: "invalid-http-success" });
  mockedApi.createSession.mockImplementation(async ({ accountId }) => buildSession(buildAccount(accountId)));
  mockedApi.deleteConnectedAccount.mockResolvedValue(undefined);
  mockedApi.listFiles.mockImplementation(async (path: string) => path === "Projects" ? { path, items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] } : { path, items: [{ path: "Projects", name: "Projects", isFolder: true }, { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] });
  mockedApi.getFile.mockResolvedValue({ file: textPreview });
  mockedApi.prepareDownloadFile.mockResolvedValue({ blob: new Blob(["download"]), filename: "download.bin" });
  mockedApi.fetchDownloadBlob.mockResolvedValue({ blob: new Blob(["download"]), filename: "download.bin" });
  mockedApi.createStreamingFileUrl.mockImplementation(async (path: string) => `/api/file/stream?path=${encodeURIComponent(path)}&streamToken=stream-token-alpha`);
  mockedApi.triggerBrowserDownload.mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "wakeLock");
});

describe("wake-lock App integration", () => {
  it("keeps one wake lock for an active download and releases it on completion", async () => {
    const account = buildAccount("alpha", { displayName: "Wake lock workspace" });
    seedAccounts([{ account }], account.id);
    const download = createDeferred<{ blob: Blob; filename: string }>();
    mockedApi.prepareDownloadFile.mockReturnValue(download.promise);
    const wakeLock = installWakeLockMock();

    render(<App services={createWakeLockFixture()} />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Select roadmap.txt/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Download selected$/i })[0]);

    await waitFor(() => expect(wakeLock.request).toHaveBeenCalledWith("screen"));
    expect(screen.getByRole("status", { name: /Keeping screen awake for downloads/i })).toBeInTheDocument();

    download.resolve({ blob: new Blob(["download"]), filename: "roadmap.txt" });

    await waitFor(() => expect(wakeLock.sentinel.release).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status", { name: /Keeping screen awake/i })).not.toBeInTheDocument();
  });

  it("releases the wake lock when session expiry terminates an active download", async () => {
    const account = buildAccount("alpha", { displayName: "Expired transfer workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const download = createDeferred<{ blob: Blob; filename: string }>();
    mockedApi.prepareDownloadFile.mockReturnValue(download.promise);
    const wakeLock = installWakeLockMock();

    render(<App services={createWakeLockFixture()} />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select roadmap.txt/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Download selected$/i })[0]);
    await waitFor(() => expect(wakeLock.request).toHaveBeenCalledWith("screen"));

    download.reject(new ApiRequestError("Session expired", 401, "unauthorized"));

    await waitFor(() => {
      expect(wakeLock.sentinel.release).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("status", { name: /Keeping screen awake/i })).not.toBeInTheDocument();
    });
  });

  it("keeps the screen awake only while folder audio is actually playing", async () => {
    const account = buildAccount("alpha", { displayName: "Wake lock media workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockImplementation(async (path: string) => path === "Projects"
      ? {
        path,
        items: [{ path: "Projects/chapter.m4a", name: "chapter.m4a", isFolder: false, size: 18, mimeType: "audio/mp4" }]
      }
      : { path, items: [{ path: "Projects", name: "Projects", isFolder: true }] });
    const wakeLock = installWakeLockMock();

    render(<App services={createWakeLockFixture()} />);

    fireEvent.click(await screen.findByRole("button", { name: /Open folder Projects/i }));
    mediaPlayMock.mockClear();
    fireEvent.click(await screen.findByRole("button", { name: /Open file chapter.m4a/i }));
    const player = await screen.findByRole("region", { name: /Audio playlist for Projects/i });
    const audio = player.querySelector("audio") as HTMLAudioElement;
    await waitFor(() => expect(audio).toHaveAttribute("src", "/api/file/stream?path=Projects%2Fchapter.m4a&streamToken=stream-token-alpha"));
    expect(wakeLock.request).not.toHaveBeenCalled();

    fireEvent.play(audio);
    await waitFor(() => expect(wakeLock.request).toHaveBeenCalledWith("screen"));
    expect(screen.getByRole("status", { name: /Keeping screen awake for media playback/i })).toBeInTheDocument();

    fireEvent.pause(audio);
    await waitFor(() => expect(wakeLock.sentinel.release).toHaveBeenCalledTimes(1));
  });

  it("keeps folder audio paused when its stream URL is unavailable", async () => {
    const account = buildAccount("alpha", { displayName: "Unavailable audio workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockImplementation(async (path: string) => path === "Projects"
      ? {
        path,
        items: [{ path: "Projects/chapter.m4a", name: "chapter.m4a", isFolder: false, size: 18, mimeType: "audio/mp4" }]
      }
      : { path, items: [{ path: "Projects", name: "Projects", isFolder: true }] });
    mockedApi.createStreamingFileUrl.mockRejectedValueOnce(new Error("stream unavailable"));
    const wakeLock = installWakeLockMock();
    mediaPlayMock.mockClear();

    render(<App services={createWakeLockFixture()} />);

    fireEvent.click(await screen.findByRole("button", { name: /Open folder Projects/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Open file chapter.m4a/i }));
    const player = await screen.findByRole("region", { name: /Audio playlist for Projects/i });

    await waitFor(() => expect(within(player).getByText(/Audio stream is unavailable right now/i)).toBeInTheDocument());
    expect(within(player).getByRole("button", { name: /Play folder audio/i })).toBeDisabled();
    expect(within(player).queryByRole("button", { name: /Pause folder audio/i })).not.toBeInTheDocument();
    expect(mediaPlayMock).not.toHaveBeenCalled();
    expect(wakeLock.request).not.toHaveBeenCalled();
    expect(screen.queryByRole("status", { name: /Keeping screen awake for media playback/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Open file chapter.m4a/i }));
    await waitFor(() => expect(mockedApi.createStreamingFileUrl).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(player.querySelector("audio")).toHaveAttribute("src", "/api/file/stream?path=Projects%2Fchapter.m4a&streamToken=stream-token-alpha"));
    await waitFor(() => expect(mediaPlayMock).toHaveBeenCalledTimes(1));
  });

  it("persists the keep-awake opt-out and reports unsupported browsers", async () => {
    const account = buildAccount("alpha");
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App services={createWakeLockFixture()} />);

    fireEvent.click(await screen.findByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    const keepAwakeToggle = within(settingsDialog).getByLabelText(/Keep screen awake during active work/i);

    expect(keepAwakeToggle).toBeChecked();
    expect(within(settingsDialog).getByText(/Unavailable in this browser; work continues normally/i)).toBeInTheDocument();
    fireEvent.click(keepAwakeToggle);

    expect(JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}")).toMatchObject({ keepAwakeEnabled: false });
    expect(within(settingsDialog).getByText(/Disabled on this device/i)).toBeInTheDocument();
  });
});
