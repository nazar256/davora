import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../../diagnostics/testing/fakes";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../../App";
import type { AppServices } from "../../../app/AppServices";
import type { BrowseHeaderStageProps, FileListStageProps } from "..";
import { createMemoryFolderSortService } from "../folderSort/testing/fakeStorage";
type AccountSnapshot = ReturnType<AppServices["accountRegistry"]["getSnapshot"]>;
type AccountState = ReturnType<AppServices["accountRegistry"]["getState"]>;
type SeedRecord = AccountSnapshot["accounts"][number];
type ConnectedAccount = SeedRecord["account"];
type AppSession = Awaited<ReturnType<AppServices["accountSession"]["createSession"]>>;
type FileEntry = Extract<Awaited<ReturnType<AppServices["folder"]["loadFolder"]>>, { kind: "success" }>["items"][number];
type SearchResult = Extract<Awaited<ReturnType<AppServices["search"]["loadSearch"]>>, { kind: "success" }>["items"][number];
type BrowsingCacheRepository = AppServices["browsingCache"];
type UiSettings = ReturnType<AppServices["settings"]["load"]>;
type ResponsiveViewportPort = AppServices["responsiveViewport"];
type ResponsiveViewportSnapshot = ReturnType<ResponsiveViewportPort["getSnapshot"]>;
type ResponsiveViewportListener = Parameters<ResponsiveViewportPort["subscribe"]>[0];
const NEXT_CLOUD_ACCOUNT_TYPE: ConnectedAccount["type"] = "nextcloud";
const NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT = { kind: "narrow" } as const satisfies ResponsiveViewportSnapshot;
const WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT = { kind: "wide" } as const satisfies ResponsiveViewportSnapshot;

function buildAccount(id: string, overrides: Partial<ConnectedAccount> = {}): ConnectedAccount {
  return {
    id,
    type: NEXT_CLOUD_ACCOUNT_TYPE,
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
  };
}

function buildSession(account: ConnectedAccount, overrides: Partial<Omit<AppSession, "account">> = {}): AppSession {
  return {
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
    ...overrides,
    account
  };
}

function buildHealthResponse(): Awaited<ReturnType<AppServices["accountTransport"]["getHealth"]>> {
  return {
    app: "davora",
    configLoaded: true,
    backend: "mock",
    rootPath: ".davora-agent-test",
    unlockRequired: false,
    connectionMode: "in_app",
    supportedAccountTypes: [NEXT_CLOUD_ACCOUNT_TYPE]
  };
}

type CapturedAppShellProps = {
  readonly kind: "bootstrap";
} | {
  readonly kind: "workspace";
  readonly workspace: {
    readonly browseHeader: BrowseHeaderStageProps;
    readonly fileList: { readonly props: FileListStageProps; readonly ref?: unknown };
  };
};

const appShellCapture = {
  latest: undefined as CapturedAppShellProps | undefined,
  history: [] as CapturedAppShellProps[]
};
var renderActualAppShell: ((props: CapturedAppShellProps) => ReactNode) | undefined;

function captureAppShell(props: CapturedAppShellProps): ReactNode {
  appShellCapture.latest = props;
  appShellCapture.history.push(props);
  return renderActualAppShell?.(props) ?? null;
}

vi.mock("../../../app/AppShell", async () => {
  const actual = await vi.importActual<{ AppShell: (props: CapturedAppShellProps) => ReactNode }>("../../../app/AppShell");
  renderActualAppShell = actual.AppShell;
  return { AppShell: captureAppShell };
});

type FolderResponse = { readonly path: string; readonly items: FileEntry[] };
type SearchResponse = { readonly query: string; readonly path: string; readonly items: SearchResult[] };
type MockedApi = {
  readonly listFiles: ReturnType<typeof vi.fn<(path: string) => Promise<FolderResponse>>>;
  readonly searchFiles: ReturnType<typeof vi.fn<(path: string, query: string, token: string, signal: AbortSignal) => Promise<SearchResponse>>>;
  readonly uploadFileWithProgress: ReturnType<typeof vi.fn<(input: unknown, token: string) => Promise<{ readonly result: { readonly action: "upload"; readonly parentPath: string; readonly path: string } }>>>;
  readonly deleteFile: ReturnType<typeof vi.fn<(input: { readonly path: string; readonly confirmName: string }, token: string) => Promise<{ readonly result: { readonly action: "delete"; readonly parentPath: string; readonly path: string } }>>>;
};
let mockedApi!: MockedApi;
let api!: Pick<MockedApi, "listFiles" | "deleteFile">;
let mockedCache!: {
  readonly readFolder: ReturnType<typeof vi.fn<BrowsingCacheRepository["readFolder"]>>;
  readonly writeFolder: ReturnType<typeof vi.fn<BrowsingCacheRepository["writeFolder"]>>;
  readonly readSearch: ReturnType<typeof vi.fn<BrowsingCacheRepository["readSearch"]>>;
  readonly writeSearch: ReturnType<typeof vi.fn<BrowsingCacheRepository["writeSearch"]>>;
  readonly clearNamespace: ReturnType<typeof vi.fn<BrowsingCacheRepository["clearNamespace"]>>;
  readonly clearFolderPath: ReturnType<typeof vi.fn<BrowsingCacheRepository["clearFolderPath"]>>;
  readonly clearNamespaceOrThrow: ReturnType<typeof vi.fn<BrowsingCacheRepository["clearNamespaceOrThrow"]>>;
  readonly clearFolderPathOrThrow: ReturnType<typeof vi.fn<BrowsingCacheRepository["clearFolderPathOrThrow"]>>;
};

let accountSnapshot: AccountSnapshot = { accounts: [] };
let accountState: AccountState = { kind: "ready", snapshot: accountSnapshot };
let accountListeners!: Set<() => void>;
const onlineSnapshot = { kind: "online" } as const;
const offlineSnapshot = { kind: "offline" } as const;
const wideViewportSnapshot = { kind: "wide" } as const;
const defaultSettings: UiSettings = {
  themeMode: "system" as const,
  fileSizeDisplayMode: "human" as const,
  maxCacheableFileSizeBytes: 15 * 1024 * 1024,
  imagePreviewFitMode: "fill" as const,
  previewFreshnessIntervalSeconds: 60,
  keepAwakeEnabled: true,
  showHiddenFiles: false,
  experimentalHeicPreviewEnabled: false, experimentalFolderAppShortcutsEnabled: false, diagnosticsEnabled: false,
  sortMode: "name-asc" as const
};
let settings: UiSettings = { ...defaultSettings };

function publishAccounts(next: AccountSnapshot): void {
  accountSnapshot = next;
  accountState = { kind: "ready", snapshot: next };
  for (const listener of accountListeners) listener();
}

function updateAccount(accountId: string, update: (record: SeedRecord) => SeedRecord): void {
  publishAccounts({
    activeAccountId: accountSnapshot.activeAccountId,
    accounts: accountSnapshot.accounts.map((record) => record.account.id === accountId ? update(record) : record)
  });
}

function createResponsiveViewportFixture(initial: ResponsiveViewportSnapshot): { readonly port: ResponsiveViewportPort; readonly emit: (next: ResponsiveViewportSnapshot) => void } {
  let snapshot = initial;
  const listeners = new Set<ResponsiveViewportListener>();
  const port: ResponsiveViewportPort = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  return {
    port,
    emit: (next) => {
      snapshot = next;
      for (const listener of [...listeners]) listener();
    }
  };
}


let explicitOfflineState!: Map<string, boolean>;
let browsingListenerDisposers!: Set<() => void>;
let pendingMutationDisposers!: Set<() => void>;

function disposeBrowsingListeners(): void {
  for (const dispose of browsingListenerDisposers) dispose();
  browsingListenerDisposers.clear();
}

function createBrowserExplicitOfflineModeStorage() {
  return {
    read: (accountId?: string) => ({ kind: "ready" as const, enabled: accountId ? explicitOfflineState.get(accountId) ?? false : false }),
    commit: (accountId: string, enabled: boolean) => {
      explicitOfflineState.set(accountId, enabled);
      return { kind: "committed" as const };
    },
    reset: (accountId?: string) => {
      if (accountId) explicitOfflineState.delete(accountId);
      return { kind: "committed" as const };
    },
    repair: () => ({ kind: "repaired" as const })
  };
}

function createBrowsingFixture(): AppServices {
  const accountRegistry: AppServices["accountRegistry"] = {
    getState: () => accountState,
    getSnapshot: () => accountSnapshot,
    subscribe: (listener) => {
      accountListeners.add(listener);
      return () => accountListeners.delete(listener);
    },
    repair: () => ({ kind: "committed", snapshot: accountSnapshot }),
    connectAccount: async () => ({ kind: "failed", message: "Not used by the browsing integration fixture.", clearCredential: false }),
    commitConnectedAccount: (account) => {
      const record = { account };
      publishAccounts({ activeAccountId: account.id, accounts: [...accountSnapshot.accounts, record] });
      return { kind: "committed", snapshot: accountSnapshot };
    },
    commitSession: (accountId, session) => {
      updateAccount(accountId, (record) => ({ ...record, session }));
      return { kind: "committed", snapshot: accountSnapshot };
    },
    clearAccountSession: (accountId) => {
      updateAccount(accountId, (record) => ({ account: record.account }));
      return { kind: "committed", snapshot: accountSnapshot };
    },
    markAccountReconnectRequired: (accountId) => {
      updateAccount(accountId, (record) => ({ ...record, session: undefined }));
      return { kind: "committed", snapshot: accountSnapshot };
    },
    switchAccount: (accountId) => {
      publishAccounts({ activeAccountId: accountId, accounts: accountSnapshot.accounts });
      return { kind: "committed", snapshot: accountSnapshot };
    },
    removeAccount: async (accountId) => {
      const accounts = accountSnapshot.accounts.filter((record) => record.account.id !== accountId);
      publishAccounts({ activeAccountId: accounts[0]?.account.id, accounts });
      return { kind: "committed", snapshot: accountSnapshot };
    },
    retryRemovalCommit: () => ({ kind: "committed", snapshot: accountSnapshot })
  };

  const abortHandle = () => {
    const controller = new AbortController();
    return { signal: controller.signal, abort: () => controller.abort() };
  };
  const folder: AppServices["folder"] = {
    createAbortHandle: abortHandle,
    loadFolder: async ({ path }) => {
      try {
        const response = await mockedApi.listFiles(path);
        return { kind: "success", items: response.items };
      } catch (error) {
        return { kind: "failure", error: error instanceof Error ? error : new Error("Folder listing failed") };
      }
    },
    readCachedFolder: (namespace, path) => {
      const cached = mockedCache.readFolder(namespace, path);
      return cached.kind === "hit" ? { items: cached.items, cachedAt: cached.cachedAt } : undefined;
    },
    writeCachedFolder: (namespace, path, items) => {
      mockedCache.writeFolder(namespace, path, items);
    }
  };
  const search: AppServices["search"] = {
    createAbortHandle: abortHandle,
    loadSearch: async ({ path, query, token, signal }) => {
      try {
        const response = await mockedApi.searchFiles(path, query, token, signal);
        return { kind: "success", items: response.items };
      } catch (error) {
        return { kind: "failure", error: error instanceof Error ? error : new Error("Search failed") };
      }
    },
    readCachedSearch: (namespace, path, query) => {
      const cached = mockedCache.readSearch(namespace, path, query);
      return cached.kind === "hit" ? cached.items : undefined;
    },
    writeCachedSearch: (namespace, path, query, items) => {
      mockedCache.writeSearch(namespace, path, query, items);
    }
  };
  const connectivity: AppServices["connectivity"] = {
    read: () => navigator.onLine === false ? offlineSnapshot : onlineSnapshot,
    subscribe: (listener) => {
      const online = () => listener(onlineSnapshot);
      const offline = () => listener(offlineSnapshot);
      window.addEventListener("online", online);
      window.addEventListener("offline", offline);
      const dispose = () => {
        window.removeEventListener("online", online);
        window.removeEventListener("offline", offline);
      };
      browsingListenerDisposers.add(dispose);
      return () => {
        dispose();
        browsingListenerDisposers.delete(dispose);
      };
    }
  };
  const browsingCache: AppServices["browsingCache"] = mockedCache;
  const accountTransport: AppServices["accountTransport"] = {
    getHealth: async () => buildHealthResponse(),
    connectAccount: async () => ({ kind: "invalid-http-success" }),
    createSession: async ({ accountId }) => buildSession(buildAccount(accountId)),
    deleteConnectedAccount: async () => undefined
  };
  const accountSession: AppServices["accountSession"] = {
    getHealth: async () => buildHealthResponse(),
    createSession: async ({ accountId }) => buildSession(buildAccount(accountId)),
    commitSession: accountRegistry.commitSession,
    markAccountReconnectRequired: accountRegistry.markAccountReconnectRequired,
    clearAccountSession: accountRegistry.clearAccountSession,
    delay: async () => undefined
  };
  const retentionSnapshot = (account: { readonly accountId: string; readonly cacheNamespace: string }) => ({
    account,
    normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 },
    roots: [], files: [], memberships: []
  });
  const retentionRepository: AppServices["retentionRepository"] = {
    readSnapshot: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    readPreview: async () => ({ kind: "success", value: undefined }),
    writePreview: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    beginRoot: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    persistRetainedFile: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    completeRoot: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    removeRoot: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    clearNormalCache: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    purgeAccountNamespace: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    configureNormalCacheLimit: async (account) => ({ kind: "success", value: retentionSnapshot(account) })
  };
  const previewRuntime: AppServices["previewRuntime"] = {
    session: {
      createSessionAdapters: () => ({
        cache: { read: async () => undefined, write: async () => ({ kind: "skipped", reason: "not-cacheable" }) },
        live: { acquire: async () => { throw new Error("Preview is not used by the browsing integration fixture."); } },
        abort: { create: () => ({ id: "browsing-preview", abort: () => undefined }) },
        resources: { apply: (material: { readonly id: string; readonly kind: "blob" | "stream" }) => material, release: () => undefined },
        failures: { classify: () => ({ kind: "ordinary", message: "Preview failed." }) },
        failurePublication: { publishFailure: () => true }, publication: { publish: () => true },
        cachePublication: { publishSnapshot: () => true, publishEvent: () => true },
        prefetch: { probe: async () => false, prefetch: async () => ({ kind: "skipped" }) },
        clock: { now: () => Date.now() }, resolveResourceUrl: () => undefined
      })
    },
    modal: {
      startOriginalFileOpen: () => ({ completion: Promise.resolve(), cancel: () => undefined }),
      pdf: { loadPdfJs: async () => { throw new Error("PDF is not used by the browsing integration fixture."); }, fetch: async () => new Response(), requestAnimationFrame: (callback) => requestAnimationFrame(callback), getDevicePixelRatio: () => 1, createResizeObserver: () => undefined },
      video: { setTimeout, clearTimeout, getLocationHref: () => window.location.href },
      setTimeout, clearTimeout, getLocationHref: () => window.location.href,
      addWindowKeydownListener: () => () => undefined, loadAudioPreviewPosition: () => undefined,
      saveAudioPreviewPosition: () => undefined, clearAudioPreviewPosition: () => undefined
    },
    folderAudio: {
      storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      createStreamingFileUrl: async () => "", nowIso: () => "2026-01-01T00:00:00.000Z",
      loadAudioPreviewPosition: () => undefined, saveAudioPreviewPosition: () => undefined
    }
  };
  return {
    accountRegistry, accountTransport, accountSession, browsingCache,
    favouriteResolveRuntime: { listFiles: async () => ({ items: [] }), cacheFolder: () => undefined },
    connectivity,
    explicitOfflineRuntime: { storage: createBrowserExplicitOfflineModeStorage(), network: { setBlocked: () => undefined } },
    clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
    favourites: { load: () => ({ kind: "loaded", entries: [] }), save: (_account, entries) => ({ kind: "saved", entries: [...entries] }), clear: () => ({ kind: "cleared" }), create: (entry, account) => ({ ...entry, accountId: account.id, accountBackend: account.backend, accountRootPath: account.rootPath, cacheNamespace: account.cacheNamespace, addedAt: "2026-01-01T00:00:00.000Z" }) },
    favouritesPointerEnvironment: { elementFromPoint: () => null, addWindowListener: () => () => undefined },
    folder,
    folderSorts: createMemoryFolderSortService(),
    history: { pushState: (state, url) => window.history.pushState(state, "", url), replaceState: (state, url) => window.history.replaceState(state, "", url), getState: (): unknown => window.history.state, getLocation: () => ({ href: window.location.href, search: window.location.search }), subscribe: (listener) => { const handler = () => listener(window.history.state); window.addEventListener("popstate", handler); return () => window.removeEventListener("popstate", handler); } },
    pullToRefreshEnvironment: { getWindowScrollY: () => window.scrollY },
    responsiveViewport: { getSnapshot: () => wideViewportSnapshot, subscribe: () => () => undefined },
    search,
    settings: { load: () => settings, save: (next) => { settings = next; return next; } },
    operationRuntime: { request: { createAbortHandle: abortHandle, createTransferId: () => "browsing-transfer" }, mutation: { createFolder: async () => ({ action: "createFolder", parentPath: "", path: "" }), deleteFile: async (path, confirmName, token) => (await mockedApi.deleteFile({ path, confirmName }, token)).result, uploadFile: async (input, token) => (await mockedApi.uploadFileWithProgress(input, token)).result, copyOrMove: async () => ({ action: "copy", parentPath: "", path: "" }), listDestination: async () => ({ items: [] }) }, download: { prepareDownloadFile: async () => ({ blob: new Blob(), filename: "" }), fetchDownloadBlob: async () => ({ blob: new Blob() }), listFiles: async (path) => mockedApi.listFiles(path), triggerBrowserDownload: () => undefined, saveDownload: () => undefined }, batch: { downloadSelectionAsZip: async () => { throw new Error("Batch download is not used by the browsing integration fixture."); } }, uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) }, isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback },
    offlineSyncRuntime: { createAbortHandle: abortHandle, createTransferId: () => "browsing-sync", listFiles: async () => ({ path: "", items: [] }), fetchDownloadBlob: async () => ({ blob: new Blob() }), readBlobText: async () => "", isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback },
    retentionRepository, previewRuntime,
    accountRemovalRuntime: { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined }, diagnostics: createFakeDiagnosticsRuntimePorts()
  };
}
let services!: AppServices;
function disposePendingMutationResolve(): void {
  for (const dispose of pendingMutationDisposers) dispose();
  pendingMutationDisposers.clear();
}
function seedAccounts(records: Array<{ account: ConnectedAccount; session?: AppSession }>, activeAccountId?: string): void {
  publishAccounts({ activeAccountId: activeAccountId ?? records[0]?.account.id, accounts: records });
}

function createDeferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T | PromiseLike<T>) => void; readonly reject: (reason?: unknown) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  pendingMutationDisposers.add(() => reject(new Error("Deferred browsing fixture operation disposed during teardown.")));
  return { promise, resolve, reject };
}

beforeEach(() => {
  cleanup();
  accountSnapshot = { accounts: [] };
  accountState = { kind: "ready", snapshot: accountSnapshot };
  settings = { ...defaultSettings };
  mockedApi = {
    listFiles: vi.fn<(path: string) => Promise<FolderResponse>>(),
    searchFiles: vi.fn<(path: string, query: string, token: string, signal: AbortSignal) => Promise<SearchResponse>>(),
    uploadFileWithProgress: vi.fn<(input: unknown, token: string) => Promise<{ readonly result: { readonly action: "upload"; readonly parentPath: string; readonly path: string } }>>(),
    deleteFile: vi.fn<(input: { readonly path: string; readonly confirmName: string }, token: string) => Promise<{ readonly result: { readonly action: "delete"; readonly parentPath: string; readonly path: string } }>>()
  };
  api = { listFiles: mockedApi.listFiles, deleteFile: mockedApi.deleteFile };
  void api;
  mockedCache = {
    readFolder: vi.fn<BrowsingCacheRepository["readFolder"]>(),
    writeFolder: vi.fn<BrowsingCacheRepository["writeFolder"]>(),
    readSearch: vi.fn<BrowsingCacheRepository["readSearch"]>(),
    writeSearch: vi.fn<BrowsingCacheRepository["writeSearch"]>(),
    clearNamespace: vi.fn<BrowsingCacheRepository["clearNamespace"]>(),
    clearFolderPath: vi.fn<BrowsingCacheRepository["clearFolderPath"]>(),
    clearNamespaceOrThrow: vi.fn<BrowsingCacheRepository["clearNamespaceOrThrow"]>(),
    clearFolderPathOrThrow: vi.fn<BrowsingCacheRepository["clearFolderPathOrThrow"]>()
  };
  accountListeners = new Set();
  explicitOfflineState = new Map();
  browsingListenerDisposers = new Set();
  pendingMutationDisposers = new Set();
  services = createBrowsingFixture();
  mockedApi.listFiles.mockReset();
  mockedApi.searchFiles.mockReset();
  mockedApi.uploadFileWithProgress.mockReset();
  mockedApi.deleteFile.mockReset();
  mockedCache.readFolder.mockReset();
  mockedCache.writeFolder.mockReset();
  mockedCache.readSearch.mockReset();
  mockedCache.writeSearch.mockReset();
  mockedCache.clearNamespace.mockReset();
  mockedCache.clearFolderPath.mockReset();
  mockedCache.clearNamespaceOrThrow.mockReset();
  mockedCache.clearFolderPathOrThrow.mockReset();
  mockedApi.listFiles.mockResolvedValue({ path: "", items: [
    { path: "Projects", name: "Projects", isFolder: true },
    { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }
  ] });
  mockedApi.searchFiles.mockResolvedValue({
    query: "roadmap",
    path: "",
    items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain", score: 75 }]
  });
  mockedApi.uploadFileWithProgress.mockResolvedValue({ result: { action: "upload", parentPath: "", path: "Projects/dropped.txt" } });
  mockedApi.deleteFile.mockResolvedValue({ result: { action: "delete", parentPath: "Projects", path: "Projects/roadmap.txt" } });
  mockedCache.readFolder.mockReturnValue({ kind: "miss" });
  mockedCache.writeFolder.mockReturnValue({ kind: "written" });
  mockedCache.readSearch.mockReturnValue({ kind: "miss" });
  mockedCache.writeSearch.mockReturnValue({ kind: "written" });
  mockedCache.clearNamespace.mockReturnValue({ kind: "cleared" });
  mockedCache.clearFolderPath.mockReturnValue({ kind: "cleared" });
  mockedCache.clearNamespaceOrThrow.mockImplementation(() => undefined);
  mockedCache.clearFolderPathOrThrow.mockImplementation(() => undefined);
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) });
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  explicitOfflineState.clear();
  appShellCapture.latest = undefined;
  appShellCapture.history.length = 0;
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  disposeBrowsingListeners();
  disposePendingMutationResolve();
  appShellCapture.latest = undefined;
  appShellCapture.history.length = 0;
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
describe("AppBrowsingSurfaceIntegration", () => {
  it("characterizes the current BrowseHeaderStage and FileListStage binding contract", async () => {
    const account = buildAccount("alpha", { displayName: "Browsing surface workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    render(<App services={services} />);
    await screen.findByRole("button", { name: /Create folder/i });

    const workspaceProps = [...appShellCapture.history].reverse().find((props) => props.kind === "workspace");
    expect(workspaceProps?.kind).toBe("workspace");
    if (!workspaceProps || workspaceProps.kind !== "workspace") {
      throw new Error("Expected a workspace AppShell capture");
    }
    const { browseHeader, fileList } = workspaceProps.workspace;
    expect(Object.keys(browseHeader).sort()).toEqual([
      "browseStatusLabel", "breadcrumbs", "cacheOnlyMode", "canCopyMoveBatchSelection",
      "canCreateFolder", "canDeleteBatchSelection", "canDownloadBatchSelection",
      "canSyncBatchOffline", "canUploadFiles", "canUploadFolders", "currentFolderLabel", "currentLocationLabel",
      "currentPath", "directoryUploadInputRef", "fileSizeDisplayMode", "folderDropActive", "mutationBusy",
      "onClearSearch", "onClearSelection", "onCopyMoveSelection", "onCreateFolder", "onDeleteSelection",
      "onDownloadSelection", "onFileSizeDisplayModeChange", "onKeepOfflineSelection", "onNavigateToPath",
      "onSearchQueryChange", "onSortModeChange", "onUploadFiles", "refreshingFolder", "searchActive", "searchQuery",
      "selectionSummaryLabel", "showBreadcrumbs", "sortMode", "sortReset", "staleFolder", "status"
    ].sort());
    expect(Object.keys(fileList.props).sort()).toEqual([
      "batchModeActive", "canDeselectAll", "canMarkForBatchDownload", "canSelectAll", "clearRowOpenSuppression", "emptyStatus", "emptyTitle", "fileSizeDisplayMode",
      "folderDropActive", "getItemSubtitle", "getRowOpenSuppressed", "isItemAvailableOffline", "isItemBatchSelected",
      "isItemSelected", "items", "onClearSearch", "onDragEnter", "onDragLeave", "onDragOver", "onDrop",
      "onRetryFolder", "onRowOpenClick", "onRowPointerCancel", "onRowPointerDown", "onRowPointerLeave",
      "onRowPointerUp", "onToggleBatchSelection", "onToggleEntrySelection", "onToggleSelectAll", "selectAllState", "selectionModeActive",
      "showClearSearchButton", "showEmptyState", "showRetryFolderButton", "suppressNarrowScreenContextMenu"
    ].sort());
    expect(browseHeader).toMatchObject({
      currentFolderLabel: "Home",
      currentPath: "",
      currentLocationLabel: "/",
      searchActive: false,
      searchQuery: "",
      showBreadcrumbs: false,
      fileSizeDisplayMode: "human",
      sortMode: "name-asc",
      refreshingFolder: false,
      staleFolder: false,
      cacheOnlyMode: false,
      folderDropActive: false,
      mutationBusy: false
    });
    expect(fileList.props.items).toEqual([
      { path: "Projects", name: "Projects", isFolder: true },
      { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }
    ]);
    expect(fileList.props.selectionModeActive).toBe(false);
    expect(fileList.props.batchModeActive).toBe(false);
    expect(fileList.props.suppressNarrowScreenContextMenu).toBe(false);
    expect(fileList.props.isItemAvailableOffline(fileList.props.items[0])).toBe(false);
    expect(fileList.props.getItemSubtitle(fileList.props.items[1])).toBeUndefined();
    expect(typeof browseHeader.directoryUploadInputRef).toBe("function");
    expect(fileList.ref).toBeDefined();
  });
  it("routes current header commands and folder/file row opens without changing selection ownership", async () => {
    const account = buildAccount("alpha", { displayName: "Browsing command workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const view = render(<App services={services} />);
    await screen.findByRole("button", { name: /Create folder/i });

    const currentWorkspace = () => {
      const props = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
      if (!props || props.kind !== "workspace") throw new Error("Expected workspace capture");
      return props.workspace;
    };
    const first = currentWorkspace();
    const firstSearch = first.browseHeader.onSearchQueryChange;
    first.browseHeader.onSearchQueryChange("roadmap");
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Search files/i })).toHaveValue("roadmap"));
    currentWorkspace().browseHeader.onClearSearch();
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Search files/i })).toHaveValue(""));

    const folder = { path: "Projects", name: "Projects", isFolder: true } as const;
    const file = { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" } as const;
    currentWorkspace().fileList.props.onRowOpenClick(folder);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Projects" })).toBeVisible());
    expect(screen.queryByRole("dialog", { name: /Preview/i })).not.toBeInTheDocument();
    expect(currentWorkspace().browseHeader.currentPath).toBe("Projects");
    currentWorkspace().browseHeader.onNavigateToPath("");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Home" })).toBeVisible());
    currentWorkspace().browseHeader.onNavigateToPath("Projects");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Projects" })).toBeVisible());
    currentWorkspace().fileList.props.onRowOpenClick(file);
    await waitFor(() => expect(screen.getByRole("dialog", { name: /Preview/i })).toBeVisible());
    expect(currentWorkspace().browseHeader.currentPath).toBe("Projects");

    view.rerender(<App services={services} />);
    const second = currentWorkspace();
    expect(second.browseHeader.onSearchQueryChange).toBe(firstSearch);
    expect(second.fileList.props.onRowOpenClick).not.toBe(first.fileList.props.onRowOpenClick);
  });
  it("replaces browsing bindings across viewport and selection context, then leaves old callbacks inert after unmount", async () => {
    const viewport = createResponsiveViewportFixture(WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT);
    const account = buildAccount("alpha", { displayName: "Browsing replacement workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const services = createBrowsingFixture();
    const view = render(<App services={{ ...services, responsiveViewport: viewport.port }} />);
    await screen.findByRole("button", { name: /Create folder/i });
    const first = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (!first || first.kind !== "workspace") throw new Error("Expected initial workspace capture");
    const oldFileList = first.workspace.fileList.props;
    const oldSearch = first.workspace.browseHeader.onSearchQueryChange;
    const oldHistoryLength = appShellCapture.history.length;

    viewport.emit(NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT);
    await waitFor(() => {
      const latest = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
      expect(latest?.kind).toBe("workspace");
      if (latest?.kind === "workspace") {
        expect(latest.workspace.fileList.props.suppressNarrowScreenContextMenu).toBe(true);
      }
    });
    const replacement = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (!replacement || replacement.kind !== "workspace") throw new Error("Expected replacement workspace capture");
    expect(replacement.workspace.fileList.props).not.toBe(oldFileList);
    expect(replacement.workspace.browseHeader.onSearchQueryChange).toBe(oldSearch);
    replacement.workspace.browseHeader.onSearchQueryChange("roadmap");
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Search files/i })).toHaveValue("roadmap"));
    expect(replacement.workspace.fileList.props.suppressNarrowScreenContextMenu).toBe(true);

    view.unmount();
    const historyAfterUnmount = appShellCapture.history.length;
    oldSearch("late-query");
    oldFileList.onRowOpenClick({ path: "Projects", name: "Projects", isFolder: true });
    await act(async () => undefined);
    expect(appShellCapture.history.length).toBe(historyAfterUnmount);
    expect(historyAfterUnmount).toBeGreaterThan(oldHistoryLength);
  });
  it("forwards upload drag/drop, directory-input, selection suppression, and list-ref contracts", async () => {
    const account = buildAccount("alpha", { displayName: "Browsing interaction workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const viewport = createResponsiveViewportFixture(NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT);
    const services = createBrowsingFixture();
    const view = render(<App services={{ ...services, responsiveViewport: viewport.port }} />);
    await screen.findByRole("button", { name: /Create folder/i });
    const props = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (!props || props.kind !== "workspace") throw new Error("Expected workspace capture");
    const { browseHeader, fileList } = props.workspace;
    const input = document.createElement("input");
    browseHeader.directoryUploadInputRef(input);
    expect(input.hasAttribute("webkitdirectory")).toBe(true);
    const dropZone = document.querySelector<HTMLElement>(".file-list-panel");
    if (!dropZone) throw new Error("Expected the captured file-list drop zone");
    const file = new File(["dropped"], "dropped.txt", { type: "text/plain" });
    const dragEvent = (type: string) => {
      return {
        currentTarget: dropZone,
        dataTransfer: { files: [file], types: ["Files"], dropEffect: "none" },
        preventDefault: vi.fn(),
        type
      };
    };
    const dragEnter = dragEvent("dragenter");
    Reflect.apply(fileList.props.onDragEnter, undefined, [dragEnter]);
    await waitFor(() => expect(dropZone.className).toContain("file-list-panel-drop-active"));
    const dragOver = dragEvent("dragover");
    Reflect.apply(fileList.props.onDragOver, undefined, [dragOver]);
    expect(dragOver.preventDefault).toHaveBeenCalled();
    const dragLeave = { ...dragEvent("dragleave"), relatedTarget: document.body };
    Reflect.apply(fileList.props.onDragLeave, undefined, [dragLeave]);
    await waitFor(() => expect(dropZone.className).not.toContain("file-list-panel-drop-active"));
    Reflect.apply(fileList.props.onDragEnter, undefined, [dragEnter]);
    await waitFor(() => expect(dropZone.className).toContain("file-list-panel-drop-active"));
    Reflect.apply(fileList.props.onDrop, undefined, [dragEvent("drop")]);
    await waitFor(() => expect(mockedApi.uploadFileWithProgress).toHaveBeenCalled());
    await waitFor(() => expect(mockedApi.listFiles.mock.calls.length).toBeGreaterThan(1));
    expect(fileList.props.getRowOpenSuppressed()).toBe(false);
    fileList.props.onRowPointerDown({ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
    fileList.props.onRowPointerUp();
    expect(screen.getByRole("button", { name: /actions for roadmap.txt/ })).toBeInTheDocument();
    const selectedCheckbox = screen.getByRole("checkbox", { name: /roadmap.txt file/ });
    expect(selectedCheckbox).toBeChecked();
    expect(screen.queryByRole("dialog", { name: /Preview/i })).not.toBeInTheDocument();
    expect(selectedCheckbox).toBeChecked();
    const currentWorkspace = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (!currentWorkspace || currentWorkspace.kind !== "workspace") throw new Error("Expected current workspace capture");
    currentWorkspace.workspace.fileList.props.onToggleBatchSelection({ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /roadmap.txt file/ })).not.toBeChecked());
    expect(fileList.ref).toBe(currentWorkspace.workspace.fileList.ref);
    view.unmount();
  });
  it("keeps captured drag/drop inert when upload capability is unavailable", async () => {
    const account = buildAccount("alpha", { displayName: "Read-only browsing drop workspace" });
    seedAccounts([{
      account,
      session: buildSession(account, { capabilities: { ...buildSession(account).capabilities, upload: false, createFolder: false } })
    }], account.id);
    const view = render(<App services={services} />);
    await screen.findByRole("button", { name: /Create folder/i });
    const props = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (!props || props.kind !== "workspace") throw new Error("Expected workspace capture");
    const dropZone = document.querySelector<HTMLElement>(".file-list-panel");
    if (!dropZone) throw new Error("Expected the file-list drop zone");
    const file = new File(["dropped"], "dropped.txt", { type: "text/plain" });
    const dragEnter = { currentTarget: dropZone, dataTransfer: { files: [file], types: ["Files"], dropEffect: "none" }, preventDefault: vi.fn() };
    const drop = { currentTarget: dropZone, dataTransfer: { files: [file], types: ["Files"], dropEffect: "none" }, preventDefault: vi.fn() };
    Reflect.apply(props.workspace.fileList.props.onDragEnter, undefined, [dragEnter]);
    Reflect.apply(props.workspace.fileList.props.onDrop, undefined, [drop]);
    await act(async () => undefined);
    expect(dragEnter.preventDefault).not.toHaveBeenCalled();
    expect(drop.preventDefault).not.toHaveBeenCalled();
    expect(dropZone.className).not.toContain("file-list-panel-drop-active");
    expect(mockedApi.uploadFileWithProgress).not.toHaveBeenCalled();
    view.unmount();
  });
  it("captures active-search, selection, sort/file-size, and narrow-screen projection branches", async () => {
    const viewport = createResponsiveViewportFixture(WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT);
    const account = buildAccount("alpha", { displayName: "Browsing projection matrix workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const services = createBrowsingFixture();
    render(<App services={{ ...services, responsiveViewport: viewport.port }} />);
    await screen.findByRole("button", { name: /Create folder/i });
    const currentWorkspace = () => {
      const entry = [...appShellCapture.history].reverse().find((item) => item.kind === "workspace");
      if (!entry || entry.kind !== "workspace") throw new Error("Expected workspace capture");
      return entry.workspace;
    };
    const initial = currentWorkspace();
    initial.browseHeader.onSearchQueryChange("roadmap");
    await waitFor(() => {
      expect(currentWorkspace().browseHeader.searchActive).toBe(true);
      expect(currentWorkspace().fileList.props.items).toHaveLength(1);
    });
    const searching = currentWorkspace();
    expect(searching.browseHeader.searchQuery).toBe("roadmap");
    expect(searching.browseHeader.showBreadcrumbs).toBe(false);
    expect(searching.fileList.props.showClearSearchButton).toBe(true);
    expect(searching.fileList.props.items).toEqual([
      { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain", score: 75 }
    ]);
    expect(searching.fileList.props.getItemSubtitle(searching.fileList.props.items[0])).toBe("/Projects");
    fireEvent.change(screen.getByRole("combobox", { name: "Sort files and folders" }), { target: { value: "name-desc" } });
    fireEvent.change(screen.getByRole("combobox", { name: "File size display in file list" }), { target: { value: "kb" } });
    await waitFor(() => {
      expect(currentWorkspace().browseHeader.sortMode).toBe("name-desc");
      expect(currentWorkspace().browseHeader.fileSizeDisplayMode).toBe("kb");
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select roadmap.txt file/i }));
    await waitFor(() => expect(currentWorkspace().browseHeader.selectionSummaryLabel).toMatch(/1 item selected/i));
    const selected = currentWorkspace();
    expect(selected.browseHeader.canDownloadBatchSelection).toBe(true);
    expect(selected.browseHeader.canSyncBatchOffline).toBe(true);
    expect(selected.browseHeader.canCopyMoveBatchSelection).toBe(true);
    expect(selected.browseHeader.canDeleteBatchSelection).toBe(true);
    expect(selected.fileList.props.batchModeActive).toBe(true);
    expect(selected.fileList.props.selectionModeActive).toBe(true);
    expect(selected.fileList.props.isItemBatchSelected(selected.fileList.props.items[0])).toBe(true);

    viewport.emit(NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT);
    await waitFor(() => expect(currentWorkspace().fileList.props.suppressNarrowScreenContextMenu).toBe(true));
  });

  it("captures loading, stale, empty, error/retry, and persisted explicit-offline projections", async () => {
    const pending = createDeferred<Awaited<ReturnType<typeof api.listFiles>>>();
    mockedApi.listFiles.mockReturnValueOnce(pending.promise);
    const account = buildAccount("alpha", { displayName: "Browsing state matrix workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedCache.readFolder.mockReturnValue({
      kind: "hit",
      cachedAt: "2026-05-21T10:00:00.000Z",
      items: [{ path: "Cached", name: "Cached", isFolder: true }]
    });
    render(<App services={services} />);
    await screen.findByRole("button", { name: /Create folder/i });
    const stateWorkspace = () => {
      const entry = [...appShellCapture.history].reverse().find((item) => item.kind === "workspace");
      if (!entry || entry.kind !== "workspace") throw new Error("Expected workspace capture");
      return entry.workspace;
    };
    await waitFor(() => expect(stateWorkspace().browseHeader.staleFolder).toBe(true));
    expect(stateWorkspace().browseHeader.refreshingFolder).toBe(true);
    pending.resolve({ path: "", items: [] });
    await waitFor(() => expect(stateWorkspace().fileList.props.showEmptyState).toBe(true));
    expect(stateWorkspace().fileList.props.emptyTitle).toBe("This folder is empty.");

    mockedCache.readFolder.mockReturnValue({ kind: "miss" });
    mockedApi.listFiles.mockRejectedValueOnce(new Error("State matrix folder failure"));
    stateWorkspace().fileList.props.onRetryFolder();
    await waitFor(() => expect(stateWorkspace().fileList.props.showRetryFolderButton).toBe(true));
    expect(stateWorkspace().fileList.props.emptyTitle).toMatch(/Unable to load|Couldn't load/);

    cleanup();
    appShellCapture.latest = undefined;
    appShellCapture.history.length = 0;
    const offlineAccount = buildAccount("beta", { displayName: "Persisted offline matrix workspace" });
    seedAccounts([{ account: offlineAccount, session: buildSession(offlineAccount) }], offlineAccount.id);
    createBrowserExplicitOfflineModeStorage().commit(offlineAccount.id, true);
    render(<App services={services} />);
    await waitFor(() => expect(appShellCapture.history.some((entry) => entry.kind === "workspace")).toBe(true));
    const offline = stateWorkspace();
    expect(offline.browseHeader.cacheOnlyMode).toBe(true);
    expect(offline.browseHeader.canCreateFolder).toBe(false);
    expect(offline.browseHeader.canUploadFiles).toBe(false);
    expect(offline.browseHeader.canUploadFolders).toBe(false);
    expect(offline.fileList.props.showRetryFolderButton).toBe(false);
  });

  it("characterizes read-only capability and explicit-offline stage projections", async () => {
    const account = buildAccount("alpha", { displayName: "Browsing capability workspace" });
    seedAccounts([{
      account,
      session: buildSession(account, { capabilities: { ...buildSession(account).capabilities, readOnly: true, upload: false, createFolder: false, delete: false, move: false, copy: false } })
    }], account.id);
    render(<App services={services} />);
    await screen.findByRole("button", { name: /Create folder/i });
    const initial = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (!initial || initial.kind !== "workspace") throw new Error("Expected workspace capture");
    expect(initial.workspace.browseHeader.canCreateFolder).toBe(false);
    expect(initial.workspace.browseHeader.canUploadFiles).toBe(false);
    expect(initial.workspace.browseHeader.canUploadFolders).toBe(false);
    expect(initial.workspace.fileList.props.canMarkForBatchDownload).toBe(true);
    const historyLengthBeforeOffline = appShellCapture.history.length;
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    window.dispatchEvent(new Event("offline"));
    await waitFor(() => expect(appShellCapture.history.length).toBeGreaterThan(historyLengthBeforeOffline));
    const offline = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (!offline || offline.kind !== "workspace") throw new Error("Expected offline workspace capture");
    expect(offline.workspace.browseHeader.cacheOnlyMode).toBe(true);
    expect(offline.workspace.fileList.props.showRetryFolderButton).toBe(false);
  });

  it("captures pending mutation busy projection with a non-empty batch selection", async () => {
    const account = buildAccount("alpha", { displayName: "Pending mutation projection workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const pending = createDeferred<Awaited<ReturnType<typeof api.deleteFile>>>();
    mockedApi.deleteFile.mockReturnValueOnce(pending.promise);

    render(<App services={services} />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select roadmap.txt file/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Delete selected$/i })[0]);
    const dialog = await screen.findByRole("dialog", { name: /Delete item/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Delete$/i }));
    await waitFor(() => expect(mockedApi.deleteFile).toHaveBeenCalledTimes(1));

    const currentWorkspace = () => {
      const entry = [...appShellCapture.history].reverse().find((item) => item.kind === "workspace");
      if (!entry || entry.kind !== "workspace") throw new Error("Expected workspace capture");
      return entry.workspace;
    };
    await waitFor(() => expect(currentWorkspace().browseHeader.mutationBusy).toBe(true));
    const busy = currentWorkspace();
    expect(busy.browseHeader.selectionSummaryLabel).toMatch(/1 item selected/i);
    expect(busy.browseHeader.canDownloadBatchSelection).toBe(true);
    expect(busy.browseHeader.canSyncBatchOffline).toBe(true);
    expect(busy.browseHeader.canCopyMoveBatchSelection).toBe(true);
    expect(busy.browseHeader.canDeleteBatchSelection).toBe(true);
    expect(busy.browseHeader.canCreateFolder).toBe(true);
    expect(busy.browseHeader.canUploadFiles).toBe(true);
    expect(busy.browseHeader.canUploadFolders).toBe(true);
    expect(busy.fileList.props.batchModeActive).toBe(true);
    expect(busy.fileList.props.selectionModeActive).toBe(true);
    const busySelectedItem = busy.fileList.props.items.find((item) => item.path === "Projects/roadmap.txt");
    expect(busySelectedItem).toBeDefined();
    if (!busySelectedItem) throw new Error("Expected selected roadmap item");
    expect(busy.fileList.props.isItemBatchSelected(busySelectedItem)).toBe(true);

    pending.resolve({ result: { action: "delete", parentPath: "Projects", path: "Projects/roadmap.txt" } });
    await act(async () => pending.promise);
  });

  it("distinguishes selected restricted capabilities from offline mode projections", async () => {
    const account = buildAccount("alpha", { displayName: "Restricted selected projection workspace" });
    const session = buildSession(account, {
      capabilities: {
        ...buildSession(account).capabilities,
        createFolder: false,
        upload: false,
        download: true,
        copy: true,
        move: false,
        delete: false
      }
    });
    seedAccounts([{ account, session }], account.id);
    render(<App services={services} />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select roadmap.txt file/i }));
    const currentWorkspace = () => {
      const entry = [...appShellCapture.history].reverse().find((item) => item.kind === "workspace");
      if (!entry || entry.kind !== "workspace") throw new Error("Expected workspace capture");
      return entry.workspace;
    };
    await waitFor(() => expect(currentWorkspace().browseHeader.selectionSummaryLabel).toMatch(/1 item selected/i));
    const restricted = currentWorkspace();
    expect(restricted.browseHeader.canDownloadBatchSelection).toBe(true);
    expect(restricted.browseHeader.canSyncBatchOffline).toBe(true);
    expect(restricted.browseHeader.canCopyMoveBatchSelection).toBe(false);
    expect(restricted.browseHeader.canDeleteBatchSelection).toBe(false);
    expect(restricted.browseHeader.canCreateFolder).toBe(false);
    expect(restricted.browseHeader.canUploadFiles).toBe(false);
    expect(restricted.browseHeader.canUploadFolders).toBe(false);
    expect(restricted.fileList.props.canMarkForBatchDownload).toBe(true);
    const restrictedSelectedItem = restricted.fileList.props.items.find((item) => item.path === "Projects/roadmap.txt");
    expect(restrictedSelectedItem).toBeDefined();
    if (!restrictedSelectedItem) throw new Error("Expected selected roadmap item");
    expect(restricted.fileList.props.isItemBatchSelected(restrictedSelectedItem)).toBe(true);
    expect(screen.getAllByRole("button", { name: /^Keep offline$/i })[0]).toBeEnabled();
    expect(screen.getAllByRole("button", { name: /^Copy or move selected$/i })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /^Delete selected$/i })[0]).toBeDisabled();

    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    window.dispatchEvent(new Event("offline"));
    await waitFor(() => expect(currentWorkspace().browseHeader.cacheOnlyMode).toBe(true));
    const offline = currentWorkspace();
    expect(offline.browseHeader.selectionSummaryLabel).toMatch(/1 item selected/i);
    expect(offline.browseHeader.canDownloadBatchSelection).toBe(false);
    expect(offline.browseHeader.canSyncBatchOffline).toBe(false);
    expect(offline.browseHeader.canCopyMoveBatchSelection).toBe(false);
    expect(offline.browseHeader.canDeleteBatchSelection).toBe(false);
    expect(offline.browseHeader.canCreateFolder).toBe(false);
    expect(offline.browseHeader.canUploadFiles).toBe(false);
    expect(offline.browseHeader.canUploadFolders).toBe(false);
  });
});
