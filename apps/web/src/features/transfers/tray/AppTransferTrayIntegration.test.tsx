import "@testing-library/jest-dom/vitest";
import { createFakeDiagnosticsRuntimePorts } from "../../diagnostics/testing/fakes";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FileEntry = { readonly path: string; readonly name: string; readonly isFolder: boolean; readonly size?: number; readonly mimeType?: string; readonly lastModified?: string; readonly etag?: string; readonly permissions?: string; readonly ownerDisplayName?: string };
type SearchResult = FileEntry & { readonly score: number };
type MutationResult = { readonly action: "createFolder" | "upload" | "move" | "copy" | "delete"; readonly parentPath: string; readonly path: string; readonly destinationPath?: string; readonly item?: FileEntry };
type ConnectedAccount = { readonly id: string; readonly type: "nextcloud"; readonly displayName: string; readonly baseUrl: string; readonly username: string; readonly rootPath: string; readonly backend: "mock" | "nextcloud"; readonly connectionState: "connected" | "reconnect_required"; readonly lastValidatedAt: string; readonly cacheNamespace: string; readonly label?: string };
type AppSession = { readonly token: string; readonly expiresAt: string; readonly rootPath: string; readonly capabilities: { readonly backend: "mock" | "nextcloud"; readonly readOnly: boolean; readonly search: boolean; readonly preview: boolean; readonly download: boolean; readonly offlineCache: boolean; readonly createFolder: boolean; readonly upload: boolean; readonly move: boolean; readonly copy: boolean; readonly delete: boolean; readonly mediaPreview: boolean; readonly markdownPreview: boolean; readonly openedFileCache: boolean }; readonly account: ConnectedAccount };

import RealApp from "../../../App";
const App = () => <RealApp services={createDownloadFixture()} />;
import type { AppServices } from "../../../app/AppServices";
import { createPreviewComposition } from "../../../app/createPreviewComposition";
import { downloadSelectionAsZip } from "../../../lib/batchDownload";
import { setBackendNetworkBlocked } from "../../../lib/networkPolicy";
import { createAccountRegistryService } from "../../../features/accounts/registry";
import type { AccountTransport } from "../../../features/accounts";
import type { BrowsingCacheRepository, FolderPorts, SearchPorts } from "../../../features/browsing";
import type { ConnectivityPort } from "../../../features/offline/connectivity";
import type { ExplicitOfflineModeRuntimePort } from "../../../features/offline/mode";
import { WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT, type ResponsiveViewportPort } from "../../../features/navigation/viewport";
import type { OperationRuntimePort } from "../../../features/operations/workspace";
import type { RetentionRepository, RetentionResult } from "../../../features/offline/retention";
import { DEFAULT_UI_SETTINGS } from "../../../features/settings";
import { buildAccount, buildSession } from "../../../test/accounts";
import { buildHealthResponse } from "../../../test/api";
import { createDeferred } from "../../../test/primitives";

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

const { registerSwMock } = vi.hoisted(() => ({
  registerSwMock: vi.fn(() => ({
    offlineReady: [false, vi.fn()] as [boolean, (value: boolean) => void],
    needRefresh: [false, vi.fn()] as [boolean, (value: boolean) => void],
    updateServiceWorker: vi.fn(async () => undefined)
  }))
}));

vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: registerSwMock }));

const healthResponse = buildHealthResponse();
const ONLINE = { kind: "online" } as const;
const OFFLINE = { kind: "offline" } as const;
const WIDE_VIEWPORT = WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT;

const mockedCache = {
  readFolder: vi.fn<BrowsingCacheRepository["readFolder"]>(() => ({ kind: "miss" })),
  writeFolder: vi.fn<BrowsingCacheRepository["writeFolder"]>(() => ({ kind: "written" })),
  readSearch: vi.fn<BrowsingCacheRepository["readSearch"]>(() => ({ kind: "miss" })),
  writeSearch: vi.fn<BrowsingCacheRepository["writeSearch"]>(() => ({ kind: "written" })),
  clearNamespace: vi.fn<BrowsingCacheRepository["clearNamespace"]>(() => ({ kind: "cleared" })),
  clearFolderPath: vi.fn<BrowsingCacheRepository["clearFolderPath"]>(() => ({ kind: "cleared" })),
  clearNamespaceOrThrow: vi.fn<BrowsingCacheRepository["clearNamespaceOrThrow"]>(),
  clearFolderPathOrThrow: vi.fn<BrowsingCacheRepository["clearFolderPathOrThrow"]>()
} satisfies BrowsingCacheRepository;

type ListResponse = { readonly path: string; readonly items: FileEntry[] };
type SearchResponse = { readonly query: string; readonly path: string; readonly items: SearchResult[] };
type MutationResponse = { readonly result: MutationResult };

const mockedApi = {
  getHealth: vi.fn<AccountTransport["getHealth"]>(),
  connectAccount: vi.fn<AccountTransport["connectAccount"]>(),
  createSession: vi.fn<AccountTransport["createSession"]>(),
  deleteConnectedAccount: vi.fn<AccountTransport["deleteConnectedAccount"]>(),
  listFiles: vi.fn<(path: string, token: string, signal?: AbortSignal) => Promise<ListResponse>>(),
  getFile: vi.fn<(path: string, token: string, signal?: AbortSignal) => Promise<unknown>>(),
  searchFiles: vi.fn<(query: string, path: string, token: string, signal?: AbortSignal) => Promise<SearchResponse>>(),
  fetchDownloadBlob: vi.fn<AppServices["operationRuntime"]["download"]["fetchDownloadBlob"]>(),
  prepareDownloadFile: vi.fn<AppServices["operationRuntime"]["download"]["prepareDownloadFile"]>(),
  fetchOriginalFile: vi.fn<(path: string, token: string) => Promise<unknown>>(),
  createStreamingFileUrl: vi.fn<(path: string, token: string) => Promise<string>>(),
  triggerBrowserDownload: vi.fn<AppServices["operationRuntime"]["download"]["triggerBrowserDownload"]>(),
  createFolder: vi.fn<(input: { path: string; name: string }, token: string) => Promise<MutationResponse>>(),
  uploadFileWithProgress: vi.fn<(
    input: { readonly path: string; readonly name: string; readonly mimeType: string; readonly contentBase64: string },
    token: string,
    onProgress: (loadedBytes: number, totalBytes: number) => void,
    signal: AbortSignal
  ) => Promise<MutationResponse>>(),
  moveFile: vi.fn<(input: { path: string; destinationPath: string }, token: string) => Promise<MutationResponse>>(),
  copyFile: vi.fn<(input: { path: string; destinationPath: string }, token: string) => Promise<MutationResponse>>(),
  deleteFile: vi.fn<(input: { path: string; confirmName: string }, token: string) => Promise<MutationResponse>>()
};

const downloadAbortController = new AbortController();
const downloadTransferState = { reset: vi.fn(() => undefined) };
const accountStateStore = globalThis.localStorage;

function abortHandle() {
  const controller = new AbortController();
  return { signal: controller.signal, abort: () => controller.abort() };
}

function createRetentionRepository(): RetentionRepository {
  const snapshot = (account: Parameters<RetentionRepository["readSnapshot"]>[0]) => ({
    account,
    normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 },
    roots: [], files: [], memberships: []
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

function createDownloadFixture(): AppServices {
  const storage = {
    readItem: (key: string) => ({ ok: true as const, value: accountStateStore.getItem(key) }),
    writeItem: (key: string, value: string) => { accountStateStore.setItem(key, value); return { ok: true as const }; },
    deleteItem: (key: string) => { accountStateStore.removeItem(key); return { ok: true as const }; }
  };
  const accountRegistry = createAccountRegistryService(storage, { isExpired: () => false });
  const browsingCache = mockedCache;
  const listFiles = async (path: string, token: string, signal?: AbortSignal) => mockedApi.listFiles(path, token, signal);
  const folder: FolderPorts = {
    createAbortHandle: abortHandle,
    loadFolder: async ({ path, token, signal }) => {
      try { return { kind: "success", items: (await listFiles(path, token, signal)).items as FileEntry[] } as const; }
      catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return { kind: "cancelled" } as const;
        if (error instanceof ApiRequestError && error.status === 401) return { kind: "unauthorized", error } as const;
        if (error instanceof ApiRequestError && error.code === "account_reconnect_required") return { kind: "reconnect-required", error } as const;
        return { kind: "failure", error: error instanceof Error ? error : new Error("Unable to load folder.") } as const;
      }
    },
    readCachedFolder: (account, path) => {
      const cached = browsingCache.readFolder(account, path);
      return cached.kind === "hit" ? { items: cached.items, cachedAt: cached.cachedAt } : undefined;
    },
    writeCachedFolder: () => undefined
  };
  const search: SearchPorts = {
    createAbortHandle: abortHandle,
    loadSearch: async ({ query, path, token, signal }) => ({ kind: "success", items: (await mockedApi.searchFiles(query, path, token, signal)).items }),
    readCachedSearch: () => undefined,
    writeCachedSearch: () => undefined
  };
  const accountTransport: AccountTransport = {
    getHealth: (...args) => mockedApi.getHealth(...args),
    connectAccount: (...args) => mockedApi.connectAccount(...args),
    createSession: (...args) => mockedApi.createSession(...args),
    deleteConnectedAccount: (...args) => mockedApi.deleteConnectedAccount(...args)
  };
  const accountSession = {
    getHealth: accountTransport.getHealth,
    createSession: accountTransport.createSession,
    commitSession: (...args: Parameters<typeof accountRegistry.commitSession>) => accountRegistry.commitSession(...args),
    markAccountReconnectRequired: (...args: Parameters<typeof accountRegistry.markAccountReconnectRequired>) => accountRegistry.markAccountReconnectRequired(...args),
    clearAccountSession: (...args: Parameters<typeof accountRegistry.clearAccountSession>) => accountRegistry.clearAccountSession(...args),
    delay: async () => undefined
  };
  const operationRuntime: OperationRuntimePort = {
    request: { createAbortHandle: abortHandle, createTransferId: (() => { let next = 0; return () => `download-transfer-${++next}`; })() },
    mutation: {
      createFolder: async () => ({ action: "createFolder", parentPath: "", path: "" }),
      deleteFile: async (path, confirmName, token) => (await mockedApi.deleteFile({ path, confirmName }, token)).result,
      uploadFile: async () => ({ action: "upload", parentPath: "", path: "" }),
      copyOrMove: async () => ({ action: "copy", parentPath: "", path: "" }),
      listDestination: async (path, token) => mockedApi.listFiles(path, token)
    },
    download: {
      prepareDownloadFile: mockedApi.prepareDownloadFile,
      fetchDownloadBlob: mockedApi.fetchDownloadBlob,
      listFiles: mockedApi.listFiles,
      triggerBrowserDownload: mockedApi.triggerBrowserDownload,
      saveDownload: mockedApi.triggerBrowserDownload
    },
    batch: { downloadSelectionAsZip },
    uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) },
    isUnauthorized: (error) => error instanceof ApiRequestError && error.status === 401,
    isReconnectRequired: (error) => error instanceof ApiRequestError && error.code === "account_reconnect_required",
    toErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
  };
  const retentionRepository = createRetentionRepository();
  const responsiveViewport: ResponsiveViewportPort = { getSnapshot: () => WIDE_VIEWPORT, subscribe: () => () => undefined };
  const connectivity: ConnectivityPort = {
    read: () => window.navigator.onLine === false ? OFFLINE : ONLINE,
    subscribe: () => () => undefined
  };
  let explicitOfflineEnabled = false;
  const explicitOfflineRuntime: ExplicitOfflineModeRuntimePort = {
    storage: { read: () => ({ kind: "ready", enabled: explicitOfflineEnabled }), commit: (_accountId, enabled) => { explicitOfflineEnabled = enabled; return { kind: "committed" }; }, reset: () => { explicitOfflineEnabled = false; return { kind: "committed" }; }, repair: () => ({ kind: "repaired" }) },
    network: { setBlocked: setBackendNetworkBlocked }
  };
  return {
    accountRegistry, accountTransport, accountSession, browsingCache,
    favouriteResolveRuntime: { listFiles: async () => ({ items: [] }), cacheFolder: () => undefined },
    connectivity, explicitOfflineRuntime, clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
    favourites: { load: () => ({ kind: "loaded", entries: [] }), save: (_account: ConnectedAccount, entries: never[]) => ({ kind: "saved", entries: [...entries] }), clear: () => ({ kind: "cleared" }), create: (entry: FileEntry, account: ConnectedAccount) => ({ ...entry, accountId: account.id, accountBackend: account.backend, accountRootPath: account.rootPath, cacheNamespace: account.cacheNamespace, addedAt: "2026-01-01T00:00:00.000Z" }) },
    favouritesPointerEnvironment: { elementFromPoint: () => null, addWindowListener: () => () => undefined },
    folder,
    history: { pushState: (state: unknown, url?: string) => window.history.pushState(state, "", url), replaceState: (state: unknown, url?: string) => window.history.replaceState(state, "", url), getState: () => window.history.state as unknown, getLocation: () => ({ href: window.location.href, search: window.location.search }), subscribe: () => () => undefined },
    pullToRefreshEnvironment: { getWindowScrollY: () => window.scrollY }, responsiveViewport, search,
    settings: { load: () => DEFAULT_UI_SETTINGS, save: (settings: typeof DEFAULT_UI_SETTINGS) => settings },
    operationRuntime,
    offlineSyncRuntime: { createAbortHandle: abortHandle, createTransferId: () => "download-sync", listFiles: async (path: string) => ({ path, items: [] }), fetchDownloadBlob: mockedApi.fetchDownloadBlob, readBlobText: async () => "", isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback },
    retentionRepository,
    previewRuntime: createPreviewComposition({ retentionRepository }),
    accountRemovalRuntime: { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined }, diagnostics: createFakeDiagnosticsRuntimePorts(),
    downloadAbortController, downloadTransferState
  } as AppServices;
}

function seedAccounts(records: Array<{ account: ConnectedAccount; session?: { token: string; expiresAt: string; rootPath: string; capabilities: AppSession["capabilities"] } }>, activeAccountId?: string): void {
  accountStateStore.setItem("davora-account-state", JSON.stringify({ activeAccountId: activeAccountId ?? records[0]?.account.id, accounts: records }));
}

beforeEach(() => {
  cleanup();
  setBackendNetworkBlocked(false);
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  Reflect.deleteProperty(navigator, "wakeLock");
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) });
  registerSwMock.mockReturnValue({ offlineReady: [false, vi.fn()], needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn(async () => undefined) });
  mockedApi.getHealth.mockResolvedValue(healthResponse);
  mockedApi.connectAccount.mockResolvedValue({ kind: "invalid-http-success" });
  mockedApi.createSession.mockImplementation(async ({ accountId }: { accountId: string }) => buildSession(buildAccount(accountId)));
  mockedApi.deleteConnectedAccount.mockResolvedValue(undefined);
  mockedApi.listFiles.mockImplementation(async (path: string) => path === "Projects" ? { path, items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] } : { path, items: [{ path: "Projects", name: "Projects", isFolder: true }, { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] });
  mockedApi.searchFiles.mockResolvedValue({ query: "", path: "", items: [] });
  mockedApi.fetchDownloadBlob.mockResolvedValue({ blob: new Blob(["download"], { type: "application/octet-stream" }), filename: undefined });
  mockedApi.prepareDownloadFile.mockResolvedValue({ blob: new Blob(["download"], { type: "application/octet-stream" }), filename: "download.bin" });
  mockedApi.fetchOriginalFile.mockResolvedValue({ blob: new Blob(["binary"], { type: "image/png" }), mimeType: "image/png", filename: "photo.png" });
  mockedApi.createStreamingFileUrl.mockResolvedValue("/stream");
  mockedApi.triggerBrowserDownload.mockImplementation(() => undefined);
  mockedApi.createFolder.mockResolvedValue({ result: { action: "createFolder", parentPath: "", path: "Plans" } });
  mockedApi.uploadFileWithProgress.mockResolvedValue({ result: { action: "upload", parentPath: "", path: "Projects/roadmap.txt" } });
  mockedApi.moveFile.mockResolvedValue({ result: { action: "move", parentPath: "", path: "Projects/roadmap.txt" } });
  mockedApi.copyFile.mockResolvedValue({ result: { action: "copy", parentPath: "", path: "Projects/roadmap.txt" } });
  mockedApi.deleteFile.mockResolvedValue({ result: { action: "delete", parentPath: "", path: "Projects/roadmap.txt" } });
  mockedCache.readFolder.mockReturnValue({ kind: "miss" });
  mockedCache.writeFolder.mockReturnValue({ kind: "written" });
  mockedCache.readSearch.mockReturnValue({ kind: "miss" });
  mockedCache.writeSearch.mockReturnValue({ kind: "written" });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.resetAllMocks();
  downloadAbortController.abort();
  downloadTransferState.reset();
  Reflect.deleteProperty(navigator, "wakeLock");
});


it("shows exact failed child paths and partial success in the transfer tray", async () => {
    const account = buildAccount("alpha", { displayName: "Partial batch workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Documents") {
        return {
          path,
          items: [
            { path: "Documents/good.txt", name: "good.txt", isFolder: false, size: 12, mimeType: "text/plain" },
            { path: "Documents/bad%file.txt", name: "bad%file.txt", isFolder: false, size: 8, mimeType: "text/plain" }
          ]
        };
      }

      return {
        path,
        items: [{ path: "Documents", name: "Documents", isFolder: true }]
      };
    });
    mockedApi.fetchDownloadBlob.mockImplementation(async (path: string) => {
      if (path === "Documents/bad%file.txt") {
        throw new Error("Path contains invalid percent-encoding.");
      }

      return { blob: new Blob(["ok"], { type: "text/plain" }) };
    });

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Documents folder/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Download selected$/i })[0]!);

    await waitFor(() => expect(mockedApi.fetchDownloadBlob).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockedApi.triggerBrowserDownload).toHaveBeenCalledWith(expect.any(Blob), "documents.zip"));

    fireEvent.click(screen.getByRole("button", { name: /^Transfers$/i }));
    const transferStatus = await screen.findByRole("dialog", { name: /Transfer status/i });

    expect(within(transferStatus).getByText("documents.zip")).toBeInTheDocument();
    expect(within(transferStatus).getByText("Partial")).toBeInTheDocument();
    expect(within(transferStatus).getByText(/Downloaded 1 of 2 files; 1 failed\./i)).toBeInTheDocument();
    expect(within(transferStatus).getByText("Documents/bad%file.txt")).toBeInTheDocument();
    expect(within(transferStatus).getByText("Path contains invalid percent-encoding.")).toBeInTheDocument();
    expect(within(transferStatus).queryByText("1 item selected")).not.toBeInTheDocument();
    expect(await screen.findByText(/Downloaded 1 folder as documents.zip in Partial batch workspace\. Downloaded 1 of 2 files; 1 failed\./i)).toBeInTheDocument();

    fireEvent.click(within(transferStatus).getByRole("button", { name: /Clear finished transfers/i }));
    expect(within(transferStatus).queryByText("documents.zip")).not.toBeInTheDocument();
    expect(within(transferStatus).getByText("No transfers yet.")).toBeInTheDocument();
  })

void act;
void describe;
void createDeferred;
