import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../../../diagnostics/testing/fakes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSession, ConnectedAccount, FileEntry, MutationResult, SearchResult } from "@davora/shared";

import App from "../../../../App";
import type { AppServices } from "../../../../app/AppServices";
import { createPreviewComposition } from "../../../../app/createPreviewComposition";
import { downloadSelectionAsZip } from "../../../../lib/batchDownload";
import { setBackendNetworkBlocked } from "../../../../lib/networkPolicy";
import { createAccountRegistryService } from "../../../../features/accounts/registry";
import type { AccountTransport } from "../../../../features/accounts";
import type { BrowsingCacheRepository, FolderPorts, SearchPorts } from "../../../../features/browsing";
import { createMemoryFolderSortService } from "../../../../features/browsing/folderSort/testing/fakeStorage";
import type { ConnectivityPort } from "../../../../features/offline/connectivity";
import type { ExplicitOfflineModeRuntimePort } from "../../../../features/offline/mode";
import { WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT, type ResponsiveViewportPort } from "../../../../features/navigation/viewport";
import type { OperationRuntimePort } from "../../workspace";
import type { RetentionRepository, RetentionResult } from "../../../../features/offline/retention";
import { DEFAULT_UI_SETTINGS } from "../../../../features/settings";
import { buildAccount, buildSession } from "../../../../test/accounts";
import { buildHealthResponse } from "../../../../test/api";
import { createDeferred } from "../../../../test/primitives";

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
    preview: { createFileStreamUrl: async () => "" }, uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) },
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
    folderSorts: createMemoryFolderSortService(),
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

describe("download App integration", () => {
it("aborts a direct download before browser save when explicit offline mode invalidates it", async () => {
    const account = buildAccount("alpha", { displayName: "Abort download workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    let capturedSignal: AbortSignal | undefined;
    mockedApi.prepareDownloadFile.mockImplementation((_path: string, _token: string, options?: {
      onProgress?: (loadedBytes: number, totalBytes?: number) => void;
      signal?: AbortSignal;
    }) => {
      capturedSignal = options?.signal;
      return new Promise((_, reject) => options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    });

    render(<App services={createDownloadFixture()} />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Download$/i }));
    await waitFor(() => expect(mockedApi.prepareDownloadFile).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Go offline$/i }));

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
    expect(mockedApi.triggerBrowserDownload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Transfers$/i }));
    expect(await screen.findByText(/Download stopped because its account or connection context changed/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Done$/i)).not.toBeInTheDocument();
  })

it("aborts a direct download when its App owner unmounts", async () => {
    const account = buildAccount("alpha", { displayName: "Unmount download workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    let capturedSignal: AbortSignal | undefined;
    let reportProgress: ((loadedBytes: number, totalBytes?: number) => void) | undefined;
    mockedApi.prepareDownloadFile.mockImplementation((_path: string, _token: string, options?: {
      onProgress?: (loadedBytes: number, totalBytes?: number) => void;
      signal?: AbortSignal;
    }) => {
      capturedSignal = options?.signal;
      reportProgress = options?.onProgress;
      return new Promise((_, reject) => options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    });

    const app = render(<App services={createDownloadFixture()} />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Download$/i }));
    await waitFor(() => expect(mockedApi.prepareDownloadFile).toHaveBeenCalledTimes(1));

    app.unmount();

    expect(capturedSignal?.aborted).toBe(true);
    reportProgress?.(50, 100);
    await act(async () => Promise.resolve());
    expect(mockedApi.triggerBrowserDownload).not.toHaveBeenCalled();
  })

it("contains a late focused download when its account context is replaced", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha download workspace" });
    const beta = buildAccount("beta", { displayName: "Beta download workspace" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);
    const download = createDeferred<{ blob: Blob; filename: string }>();
    let capturedSignal: AbortSignal | undefined;
    mockedApi.prepareDownloadFile.mockImplementation((_path: string, _token: string, options?: {
      onProgress?: (loadedBytes: number, totalBytes?: number) => void;
      signal?: AbortSignal;
    }) => {
      capturedSignal = options?.signal;
      return download.promise;
    });

    render(<App services={createDownloadFixture()} />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Download$/i }));
    await waitFor(() => {
      const call = mockedApi.prepareDownloadFile.mock.calls.at(-1);
      expect(call?.[0]).toBe("Projects/roadmap.txt");
      expect(call?.[1]).toBe("token-alpha");
      expect(call?.[2]?.signal).toBeInstanceOf(AbortSignal);
    });

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } });

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
    download.resolve({ blob: new Blob(["late"]), filename: "roadmap.txt" });
    await act(async () => { await download.promise.catch(() => undefined); });
    expect(mockedApi.triggerBrowserDownload).not.toHaveBeenCalled();
  })

it("does not issue an old-token batch child request after account replacement", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha batch download workspace" });
    const beta = buildAccount("beta", { displayName: "Beta batch download workspace" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);
    const deferredListing = createDeferred<{ path: string; items: FileEntry[] }>();
    let alphaListSignal: AbortSignal | undefined;
    const listingSettled = deferredListing.promise.then(() => true);
    mockedApi.listFiles.mockImplementation(async (path: string, token?: string, signal?: AbortSignal) => {
      if (path === "Projects" && token === "token-alpha") {
        alphaListSignal = signal;
        return deferredListing.promise;
      }
      if (path === "Projects") {
        return {
          path,
          items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }]
        };
      }
      return {
        path,
        items: [
          { path: "Projects", name: "Projects", isFolder: true },
          { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }
        ]
      };
    });

    render(<App services={createDownloadFixture()} />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Projects folder/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Download selected$/i })[0]);
    await waitFor(() => expect(mockedApi.listFiles.mock.calls.length).toBeGreaterThan(1));

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } });
    deferredListing.resolve({
      path: "Projects",
      items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }]
    });
    await expect(listingSettled).resolves.toBe(true);
    expect(mockedApi.listFiles).toHaveBeenCalledWith("Projects", "token-alpha", expect.any(AbortSignal));
    expect(alphaListSignal).toBeInstanceOf(AbortSignal);
    expect(alphaListSignal?.aborted).toBe(true);

    expect(mockedApi.fetchDownloadBlob).not.toHaveBeenCalled();
    expect(mockedApi.triggerBrowserDownload).not.toHaveBeenCalled();
  })

it("downloads a mixed file and folder batch as one zip archive", async () => {
    const account = buildAccount("alpha", { displayName: "Batch download workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Archive") {
        return {
          path,
          items: [{ path: "Archive/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" }]
        };
      }

      return {
        path,
        items: [
          { path: "Archive", name: "Archive", isFolder: true },
          { path: "notes.txt", name: "notes.txt", isFolder: false, size: 9, mimeType: "text/plain" }
        ]
      };
    });

    render(<App services={createDownloadFixture()} />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Archive folder/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select notes.txt file/i }));

    expect(await screen.findByText(/2 items selected \(1 file and 1 folder\)/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /^Download selected$/i })[0]!);

    await waitFor(() => expect(mockedApi.fetchDownloadBlob).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockedApi.triggerBrowserDownload).toHaveBeenCalled());
    expect(mockedApi.fetchDownloadBlob).toHaveBeenNthCalledWith(1, "Archive/photo.png", "token-alpha", expect.any(Object));
    expect(mockedApi.fetchDownloadBlob).toHaveBeenNthCalledWith(2, "notes.txt", "token-alpha", expect.any(Object));
    expect(mockedApi.triggerBrowserDownload).toHaveBeenCalledWith(expect.any(Blob), "davora-home-download.zip");
    expect(await screen.findByText(/Downloaded 1 file and 1 folder as davora-home-download.zip in Batch download workspace\./i)).toBeInTheDocument();
  })

it("keeps single-item details download on the existing direct file path", async () => {
    const account = buildAccount("alpha", { displayName: "Single download workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App services={createDownloadFixture()} />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Download$/i }));

    await waitFor(() => expect(mockedApi.prepareDownloadFile).toHaveBeenCalledTimes(1));
    const [path, token, options] = mockedApi.prepareDownloadFile.mock.calls[0] ?? [];
    expect(path).toBe("Projects/roadmap.txt");
    expect(token).toBe("token-alpha");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(mockedApi.fetchDownloadBlob).not.toHaveBeenCalled();
    expect(mockedApi.triggerBrowserDownload).toHaveBeenCalledWith(expect.any(Blob), "download.bin");
  })

it("disables batch-download checkboxes when downloads are unavailable", async () => {
    const account = buildAccount("alpha", { displayName: "Read only cached workspace" });
    seedAccounts([{ account }], account.id);
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    mockedCache.readFolder.mockReturnValue({
      kind: "hit",
      cachedAt: "2026-05-21T10:00:00.000Z",
      items: [{ path: "Projects", name: "Projects", isFolder: true }]
    });

    render(<App services={createDownloadFixture()} />);

    const checkbox = await screen.findByRole("checkbox", { name: /Select Projects folder/i });
    expect(checkbox).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));
    expect(screen.queryByRole("button", { name: /Add to batch download/i })).not.toBeInTheDocument();
  })

it("does not bypass download capability through an unsupported file preview fallback", async () => {
    const account = buildAccount("alpha", { displayName: "No download workspace" });
    const session = buildSession(account);
    session.capabilities = { ...session.capabilities, download: false };
    seedAccounts([{ account, session }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "archive.bin", name: "archive.bin", isFolder: false, size: 12, mimeType: "application/octet-stream" }]
    });

    render(<App services={createDownloadFixture()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open file archive.bin/i }));

    await act(async () => Promise.resolve());
    expect(mockedApi.prepareDownloadFile).not.toHaveBeenCalled();
    expect(screen.queryByText(/Starting browser download/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open file archive.bin/i })).toBeInTheDocument();
  })

it("downloads unsupported files directly and reports the browser download state", async () => {
    const account = buildAccount("alpha", { displayName: "Unsupported download workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "archive.bin", name: "archive.bin", isFolder: false, size: 12, mimeType: "application/octet-stream" }]
    });

    render(<App services={createDownloadFixture()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open file archive.bin/i }));

    await waitFor(() => expect(mockedApi.prepareDownloadFile).toHaveBeenCalled());
    expect(await screen.findByText(/Starting browser download for \/archive\.bin/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /Preview archive\.bin/i })).not.toBeInTheDocument();
  })
});
