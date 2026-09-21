import { act, cleanup, fireEvent, render as renderTestingLibrary, screen, waitFor, within } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../../diagnostics/testing/fakes";
import { cloneElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredAccountRecord } from "../../accounts/registry/model";
import type { FavouritesService } from "../../browsing/favourites/ports";
import type { RetainedFile, RetainedRoot, RetainedSnapshot, RetentionAccount, RetentionRepository, RetentionResult } from "../retention";
import { retainedBatchRootPath, retainedRootId } from "../retention";
import App from "../../../App";
import type { AppServices } from "../../../app/AppServices";
import { createAccountRegistryService, type AccountRegistryService } from "../../accounts/registry";
import type { AccountTransport } from "../../accounts/transport";
import type { BrowsingCacheRepository, FolderPorts, SearchPorts } from "../../browsing";
import { createMemoryFolderSortService } from "../../browsing/folderSort/testing/fakeStorage";
import type { ConnectivityPort } from "../connectivity";
import type { ExplicitOfflineModeRuntimePort } from "../mode";
import type { OperationRuntimePort } from "../../operations/workspace";

import type { ResponsiveViewportPort } from "../../navigation/viewport";
import { WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT } from "../../navigation/viewport";
import { DEFAULT_UI_SETTINGS } from "../../settings";
import { createPreviewComposition } from "../../../app/createPreviewComposition";
import { buildFilePreview } from "../../../test/files";
import { createDeferred } from "../../../test/primitives";
import { buildAccount, buildSession } from "../../../test/accounts";
import { buildHealthResponse } from "../../../test/api";

type ConnectedAccount = StoredAccountRecord["account"];
type AppSession = ReturnType<typeof buildSession>;
type FileEntry = Parameters<FavouritesService["create"]>[0];
type MockListFiles = (path: string, token: string, signal?: AbortSignal) => Promise<{ path: string; items: FileEntry[] }>;

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
  listFiles: vi.fn<MockListFiles>(),
  fetchDownloadBlob: vi.fn<OperationRuntimePort["download"]["fetchDownloadBlob"]>(),
  prepareDownloadFile: vi.fn<OperationRuntimePort["download"]["prepareDownloadFile"]>(),
  triggerBrowserDownload: vi.fn<OperationRuntimePort["download"]["triggerBrowserDownload"]>(),
  deleteFile: vi.fn()
};

const mockedCache: BrowsingCacheRepository = {
  readFolder: vi.fn(() => ({ kind: "miss" as const })),
  writeFolder: vi.fn(() => ({ kind: "written" as const })),
  readSearch: vi.fn(() => ({ kind: "miss" as const })),
  writeSearch: vi.fn(() => ({ kind: "written" as const })),
  clearNamespace: vi.fn(() => ({ kind: "cleared" as const })),
  clearFolderPath: vi.fn(() => ({ kind: "cleared" as const })),
  clearNamespaceOrThrow: vi.fn(),
  clearFolderPathOrThrow: vi.fn()
};

const ONLINE = { kind: "online" } as const;
let matchMediaMatches = false;

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
  let explicitOfflineEnabled = false;
  let accountRegistry: AccountRegistryService | undefined;
  const getAccountRegistry = () => accountRegistry ??= createAccountRegistryService(storage, { isExpired: (expiresAt) => Date.parse(expiresAt) <= Date.now() });
  const listFiles = async (path: string, token = "", signal?: AbortSignal) => mockedApi.listFiles(path, token, signal);
  const listFilesForRuntime = async (path: string, token: string, signal?: AbortSignal) => ({ items: (await listFiles(path, token, signal)).items });
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
  const cache = mockedCache;
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
        return { kind: "success", items: result.items };
      } catch (error) {
        return { kind: "failure", error: error instanceof Error ? error : new Error("Unable to load folder.") };
      }
    },
    readCachedFolder: () => undefined,
    writeCachedFolder: vi.fn()
  };
  const search: SearchPorts = {
    createAbortHandle: abortHandle,
    loadSearch: async () => ({ kind: "success", items: [] }),
    readCachedSearch: () => undefined,
    writeCachedSearch: vi.fn()
  };
  const retentionRepository = retentionFixture.repository;
  const operationRuntime: OperationRuntimePort = {
    request: { createAbortHandle: abortHandle, createTransferId: () => "account-bootstrap-transfer" },
    mutation: {
      createFolder: async () => ({ action: "createFolder", parentPath: "", path: "" }),
      deleteFile: async () => ({ action: "delete", parentPath: "", path: "" }),
      uploadFile: async () => ({ action: "upload", parentPath: "", path: "" }),
      copyOrMove: async () => ({ action: "copy", parentPath: "", path: "" }),
      listDestination: async (path) => listFiles(path)
    },
    download: { prepareDownloadFile: mockedApi.prepareDownloadFile, fetchDownloadBlob: mockedApi.fetchDownloadBlob, listFiles: listFilesForRuntime, triggerBrowserDownload: mockedApi.triggerBrowserDownload, saveDownload: vi.fn() },
    batch: { downloadSelectionAsZip: vi.fn() },
    preview: { createFileStreamUrl: async () => "" }, time: { wait: async () => {} }, uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) },
    isUnauthorized: () => false,
    isReconnectRequired: () => false,
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
      read: () => ({ kind: "ready", enabled: explicitOfflineEnabled }),
      commit: (_accountId, enabled) => { explicitOfflineEnabled = enabled; return { kind: "committed" }; },
      reset: () => { explicitOfflineEnabled = false; return { kind: "committed" }; },
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
    favouriteResolveRuntime: { listFiles: async () => ({ items: [] }), cacheFolder: () => undefined },
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
      fetchDownloadBlob: mockedApi.fetchDownloadBlob,
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
  matchMediaMatches = false;
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: matchMediaMatches, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) });
  vi.clearAllMocks();
  testServices = createAccountFixture();
  retentionFixture.reset();
  mockedApi.getHealth.mockReset();
  mockedApi.connectAccount.mockReset();
  mockedApi.createSession.mockReset();
  mockedApi.deleteConnectedAccount.mockReset();
  mockedApi.listFiles.mockReset();
  mockedApi.fetchDownloadBlob.mockReset();
  mockedApi.prepareDownloadFile.mockReset();
  mockedApi.triggerBrowserDownload.mockReset();
  mockedApi.getHealth.mockResolvedValue(healthResponse);
  mockedApi.connectAccount.mockImplementation(async (request) => ({ kind: "http-success", data: { account: buildAccount(request.accountId ?? "connected", { displayName: request.label?.trim() || `${request.username}@${new URL(request.baseUrl).hostname}`, label: request.label, baseUrl: request.baseUrl, username: request.username, rootPath: request.rootPath ?? "", cacheNamespace: request.cacheNamespace ?? `ns-${request.accountId ?? "connected"}` }) } }));
  mockedApi.createSession.mockImplementation(async ({ accountId }) => buildSession(buildAccount(accountId)));
  mockedApi.deleteConnectedAccount.mockResolvedValue(undefined);
  mockedApi.listFiles.mockImplementation(async (path, _token, _signal) => path === "Projects"
    ? { path, items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] }
    : { path, items: [{ path: "Projects", name: "Projects", isFolder: true }, { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] });
  mockedApi.fetchDownloadBlob.mockResolvedValue({ blob: new Blob(["download"], { type: "application/octet-stream" }), filename: undefined });
  mockedApi.prepareDownloadFile.mockResolvedValue({ blob: new Blob(["download"], { type: "application/octet-stream" }), filename: "download.bin" });
});

afterEach(() => cleanup());


const retentionFixture = (() => {
  const DEFAULT_LIMIT = 24 * 1024 * 1024;
  interface Store {
    account: RetentionAccount;
    limitBytes: number;
    files: Map<string, RetainedFile>;
    roots: Map<string, RetainedRoot>;
    memberships: Map<string, Set<string>>;
    blobs: Map<string, Blob>;
  }

  const stores = new Map<string, Store>();

  const success = <T,>(value: T): RetentionResult<T> => ({ kind: "success", value });
  const failure = (message: string): RetentionResult<never> => ({ kind: "failure", message });
  const normalizedPath = (path: string) => path.replace(/^\/+|\/+$/g, "");
  const rootId = (kind: RetainedRoot["kind"], rootPath: string) => `retained-root:${encodeURIComponent(kind)}:${encodeURIComponent(normalizedPath(rootPath))}`;
  const storeFor = (account: RetentionAccount): Store => {
    const existing = stores.get(account.cacheNamespace);
    if (existing) return existing;
    const store: Store = {
      account: { ...account },
      limitBytes: DEFAULT_LIMIT,
      files: new Map<string, RetainedFile>(),
      roots: new Map<string, RetainedRoot>(),
      memberships: new Map<string, Set<string>>(),
      blobs: new Map<string, Blob>()
    };
    stores.set(account.cacheNamespace, store);
    return store;
  };
  const snapshotFor = (account: RetentionAccount): RetainedSnapshot => {
    const store = storeFor(account);
    const retainedPaths = new Set([...store.memberships.entries()].filter(([, rootIds]) => rootIds.size > 0).map(([path]) => path));
    const files = [...store.files.values()].map((file) => ({
      ...file,
      readable: file.readable || store.blobs.has(file.path)
    })).sort((left, right) => left.path.localeCompare(right.path));
    const normalFiles = files.filter((file) => file.normalCacheOwnership === "owned" && !retainedPaths.has(file.path));
    return {
      account: { ...store.account },
      normalCache: { itemCount: normalFiles.length, totalBytes: normalFiles.reduce((total, file) => total + file.blobSize, 0), limitBytes: store.limitBytes },
      roots: [...store.roots.values()].sort((left, right) => left.id.localeCompare(right.id)),
      files,
      memberships: [...store.memberships.entries()].flatMap(([filePath, rootIds]) => [...rootIds].map((rootId) => ({ rootId, filePath }))).sort((left, right) => left.rootId.localeCompare(right.rootId) || left.filePath.localeCompare(right.filePath))
    };
  };
  const repository = {
    readSnapshot: vi.fn<RetentionRepository["readSnapshot"]>(),
    readPreview: vi.fn<RetentionRepository["readPreview"]>(),
    writePreview: vi.fn<RetentionRepository["writePreview"]>(),
    beginRoot: vi.fn<RetentionRepository["beginRoot"]>(),
    persistRetainedFile: vi.fn<RetentionRepository["persistRetainedFile"]>(),
    completeRoot: vi.fn<RetentionRepository["completeRoot"]>(),
    removeRoot: vi.fn<RetentionRepository["removeRoot"]>(),
    clearNormalCache: vi.fn<RetentionRepository["clearNormalCache"]>(),
    purgeAccountNamespace: vi.fn<RetentionRepository["purgeAccountNamespace"]>(),
    configureNormalCacheLimit: vi.fn<RetentionRepository["configureNormalCacheLimit"]>()
  };
  const install = () => {
    repository.readSnapshot.mockImplementation(async (account) => success(snapshotFor(account)));
    repository.readPreview.mockImplementation(async (account, path) => {
      const store = storeFor(account);
      const file = store.files.get(normalizedPath(path));
      return success(file ? { file: { ...file, readable: file.readable || store.blobs.has(normalizedPath(path)) }, blob: store.blobs.get(normalizedPath(path)) } : undefined);
    });
    repository.writePreview.mockImplementation(async (account, input) => {
      const store = storeFor(account);
      const path = normalizedPath(input.file.path);
      const existing = store.files.get(path);
      store.files.set(path, { ...existing, ...input.file, path, normalCacheOwnership: "owned", readable: Boolean(input.file.readable) || Boolean(input.blob) || Boolean(existing?.readable) });
      if (input.blob) store.blobs.set(path, input.blob);
      return success(snapshotFor(account));
    });
    repository.beginRoot.mockImplementation(async (account, root) => {
      const store = storeFor(account);
      const id = rootId(root.kind, root.rootPath);
      const existing = store.roots.get(id);
      store.roots.set(id, { id, rootPath: normalizedPath(root.rootPath), rootName: root.rootName, kind: root.kind, folderRoots: [...root.folderRoots], status: "incomplete", addedAt: existing?.addedAt ?? new Date().toISOString() });
      return success(snapshotFor(account));
    });
    repository.persistRetainedFile.mockImplementation(async (account, input) => {
      const store = storeFor(account);
      if (!store.roots.has(input.rootId)) return failure("Unknown retained root.");
      const path = normalizedPath(input.file.path);
      const existing = store.files.get(path);
      store.files.set(path, { ...existing, ...input.file, path, normalCacheOwnership: existing?.normalCacheOwnership === "owned" ? "owned" : input.file.normalCacheOwnership ?? "none", readable: Boolean(input.file.readable) || Boolean(input.blob) || Boolean(existing?.readable) });
      if (input.blob) store.blobs.set(path, input.blob);
      const memberships = store.memberships.get(path) ?? new Set<string>();
      memberships.add(input.rootId);
      store.memberships.set(path, memberships);
      return success(snapshotFor(account));
    });
    repository.completeRoot.mockImplementation(async (account, id) => {
      const store = storeFor(account);
      const root = store.roots.get(id);
      if (!root) return failure("Unknown retained root.");
      store.roots.set(id, { ...root, status: "complete" });
      return success(snapshotFor(account));
    });
    repository.removeRoot.mockImplementation(async (account, id) => {
      const store = storeFor(account);
      store.roots.delete(id);
      for (const [path, rootIds] of store.memberships) {
        rootIds.delete(id);
        if (rootIds.size > 0) continue;
        store.memberships.delete(path);
        if (store.files.get(path)?.normalCacheOwnership !== "owned") {
          store.files.delete(path);
          store.blobs.delete(path);
        }
      }
      return success(snapshotFor(account));
    });
    repository.clearNormalCache.mockImplementation(async (account) => {
      const store = storeFor(account);
      for (const [path, file] of store.files) {
        if ((store.memberships.get(path)?.size ?? 0) > 0) {
          store.files.set(path, { ...file, normalCacheOwnership: "none" });
        } else {
          store.files.delete(path);
          store.blobs.delete(path);
        }
      }
      return success(snapshotFor(account));
    });
    repository.purgeAccountNamespace.mockImplementation(async (account) => {
      stores.delete(account.cacheNamespace);
      return success(snapshotFor(account));
    });
    repository.configureNormalCacheLimit.mockImplementation(async (account, limitBytes) => {
      storeFor(account).limitBytes = limitBytes;
      return success(snapshotFor(account));
    });
  };
  const reset = () => {
    stores.clear();
    install();
  };
  const seed = (account: RetentionAccount, snapshot: Omit<RetainedSnapshot, "account">, blobs: Record<string, Blob | undefined> = {}) => {
    const store = storeFor(account);
    store.limitBytes = snapshot.normalCache.limitBytes;
    for (const root of snapshot.roots) store.roots.set(root.id, { ...root });
    for (const file of snapshot.files) store.files.set(normalizedPath(file.path), { ...file, path: normalizedPath(file.path) });
    for (const membership of snapshot.memberships) {
      const path = normalizedPath(membership.filePath);
      const rootIds = store.memberships.get(path) ?? new Set<string>();
      rootIds.add(membership.rootId);
      store.memberships.set(path, rootIds);
    }
    for (const [path, blob] of Object.entries(blobs)) if (blob) store.blobs.set(normalizedPath(path), blob);
  };
  return { repository, reset, seed };
})();


const mockedRetentionRepository = retentionFixture.repository;
const api: { listFiles: MockListFiles } = { listFiles: mockedApi.listFiles };
void api;
const textPreview = buildFilePreview("Projects/roadmap.txt", {
  size: 70,
  content: "normalized API preview",
  bytesRead: 22
});

function retentionAccountFor(account: ConnectedAccount): RetentionAccount {
  return { accountId: account.id, cacheNamespace: account.cacheNamespace };
}

function retainedFileFixture(path: string, options: Partial<RetainedSnapshot["files"][number]> = {}) {
  return { path, name: path.split("/").at(-1) ?? path, mimeType: "text/plain", size: 0, blobSize: 0, readable: true, normalCacheOwnership: "none" as const, ...options };
}

function retainedRootFixture(input: { rootPath: string; rootName?: string; kind?: "file" | "folder" | "batch"; folderRoots?: readonly string[]; status?: "incomplete" | "complete"; addedAt?: string }) {
  const kind = input.kind ?? "file";
  return { id: retainedRootId({ kind, rootPath: input.rootPath }), rootPath: input.rootPath, rootName: input.rootName ?? input.rootPath.split("/").at(-1) ?? input.rootPath, kind, folderRoots: input.folderRoots ?? [], status: input.status ?? "complete", addedAt: input.addedAt ?? "2026-07-14T08:00:00.000Z" };
}

function seedRetentionSnapshot(account: ConnectedAccount, input: Omit<RetainedSnapshot, "account">) {
  retentionFixture.seed(retentionAccountFor(account), input);
}

function expectRetainedFilePersisted(path?: string) {
  const call = mockedRetentionRepository.persistRetainedFile.mock.calls.find(([, input]) => path === undefined || input.file.path === path);
  expect(call).toBeDefined();
  return call;
}

function primaryKeepOfflineButton() {
  const button = screen.getAllByRole("button", { name: /^Keep offline$/i })[0];
  if (!button) throw new Error("Expected a primary Keep offline button.");
  return button;
}

describe("offline application App integration", () => {
  it("keeps a single file offline only after storage confirmation", async () => {
    const account = buildAccount("alpha", { displayName: "Offline sync workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.fetchDownloadBlob.mockResolvedValue({ blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" });

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));

    const dialog = await screen.findByRole("dialog", { name: /Keep offline confirmation/i });
    expect(within(dialog).getByText(/Kept-offline files are excluded from normal automatic cache eviction and remain until you remove them from this device/i)).toBeInTheDocument();
    expect(mockedRetentionRepository.persistRetainedFile).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /Start sync/i }));

    await waitFor(() => expect(mockedApi.fetchDownloadBlob).toHaveBeenCalledWith("Projects/roadmap.txt", "token-alpha", expect.any(Object)));
    await waitFor(() => expectRetainedFilePersisted("Projects/roadmap.txt"));
    expect(mockedRetentionRepository.beginRoot).toHaveBeenCalledWith(retentionAccountFor(account), expect.objectContaining({ rootPath: "Projects/roadmap.txt", kind: "file" }));
    expect(await screen.findByText(/Kept roadmap.txt offline on this device/i)).toBeInTheDocument();
  });

  it("starts keep-offline sync as a background transfer and closes the confirmation dialog", async () => {
    const account = buildAccount("alpha", { displayName: "Background sync workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const download = createDeferred<{ blob: Blob; filename?: string }>();
    mockedApi.fetchDownloadBlob.mockReturnValue(download.promise);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));

    const dialog = await screen.findByRole("dialog", { name: /Keep offline confirmation/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Start sync/i }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Keep offline confirmation/i })).not.toBeInTheDocument());
    expect(await screen.findByText(/Started offline sync for roadmap.txt/i)).toBeInTheDocument();
    const transferStatus = await screen.findByRole("dialog", { name: /Transfer status/i });
    expect(within(transferStatus).getByText("roadmap.txt")).toBeInTheDocument();
    expect(within(transferStatus).getByText(/Offline sync/i)).toBeInTheDocument();
    expect(mockedRetentionRepository.persistRetainedFile).not.toHaveBeenCalled();

    download.resolve({ blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" });

    await waitFor(() => expectRetainedFilePersisted("Projects/roadmap.txt"));
  });

  it("aborts a superseded offline sync before persisting into the replaced account cache", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);
    seedRetentionSnapshot(alpha, {
      normalCache: { itemCount: 1, totalBytes: 128, limitBytes: 24 * 1024 * 1024 },
      roots: [],
      files: [retainedFileFixture("cached.txt", { blobSize: 128, normalCacheOwnership: "owned" })],
      memberships: []
    });
    const download = createDeferred<{ blob: Blob; filename?: string }>();
    mockedApi.fetchDownloadBlob.mockReturnValue(download.promise);

    render(<App />);
    await screen.findByRole("button", { name: /Open actions for roadmap.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));
    await waitFor(() => expect(mockedApi.fetchDownloadBlob).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } });
    await waitFor(() => expect(within(settings).getByText((_, element) => element?.textContent === "0 cached files • 0 B used")).toBeInTheDocument());

    download.resolve({ blob: new Blob(["alpha offline"], { type: "text/plain" }), filename: "roadmap.txt" });
    await waitFor(() => expect(mockedApi.fetchDownloadBlob.mock.calls[0]?.[2]?.signal?.aborted).toBe(true));
    expect(mockedRetentionRepository.persistRetainedFile).not.toHaveBeenCalled();
    expect(mockedRetentionRepository.completeRoot).not.toHaveBeenCalled();
    expect(within(settings).getByText((_, element) => element?.textContent === "0 cached files • 0 B used")).toBeInTheDocument();
    expect(within(settings).queryByText((_, element) => element?.textContent === "1 cached file • 128 B used")).not.toBeInTheDocument();
  });

  it("does not enqueue a duplicate background offline sync for the same root", async () => {
    const account = buildAccount("alpha", { displayName: "Duplicate sync workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const download = createDeferred<{ blob: Blob; filename?: string }>();
    mockedApi.fetchDownloadBlob.mockReturnValue(download.promise);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Keep offline confirmation/i })).not.toBeInTheDocument());
    expect(mockedApi.fetchDownloadBlob).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));

    await waitFor(() => expect(screen.getByText(/Offline sync is already running for roadmap.txt/i)).toBeInTheDocument());
    expect(mockedApi.fetchDownloadBlob).toHaveBeenCalledTimes(1);

    download.resolve({ blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" });
    await waitFor(() => expectRetainedFilePersisted("Projects/roadmap.txt"));
  });

  it("uses injective batch root and dedupe identities for historical delimiter collisions", async () => {
    const account = buildAccount("alpha", { displayName: "Batch identity workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "a|b", name: "a|b", isFolder: false, size: 1, mimeType: "text/plain" },
        { path: "c", name: "c", isFolder: false, size: 1, mimeType: "text/plain" },
        { path: "a", name: "a", isFolder: false, size: 1, mimeType: "text/plain" },
        { path: "b|c", name: "b|c", isFolder: false, size: 1, mimeType: "text/plain" }
      ]
    });
    mockedApi.fetchDownloadBlob.mockImplementation(async (path: string) => ({ blob: new Blob([path], { type: "text/plain" }), filename: path }));

    render(<App />);
    await screen.findByRole("checkbox", { name: /Select a\|b file/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select a\|b file/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select c file/i }));
    fireEvent.click(primaryKeepOfflineButton());
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));
    await waitFor(() => expect(mockedRetentionRepository.beginRoot).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Select a file/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: /Select a file/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select b\|c file/i }));
    fireEvent.click(primaryKeepOfflineButton());
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));

    await waitFor(() => expect(mockedRetentionRepository.beginRoot).toHaveBeenCalledTimes(2));
    const rootPaths = mockedRetentionRepository.beginRoot.mock.calls.map(([, root]) => root.rootPath);
    expect(rootPaths).toEqual([
      retainedBatchRootPath(["a|b", "c"]),
      retainedBatchRootPath(["a", "b|c"])
    ]);
    expect(rootPaths[0]).not.toBe(rootPaths[1]);
  });

  it("does not publish a deferred Alpha cache-limit snapshot after switching to Beta", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);
    seedRetentionSnapshot(alpha, { normalCache: { itemCount: 1, totalBytes: 11, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [retainedFileFixture("alpha.txt", { blobSize: 11, normalCacheOwnership: "owned" })], memberships: [] });
    seedRetentionSnapshot(beta, { normalCache: { itemCount: 1, totalBytes: 22, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [retainedFileFixture("beta.txt", { blobSize: 22, normalCacheOwnership: "owned" })], memberships: [] });
    const deferred = createDeferred<Awaited<ReturnType<typeof retentionFixture.repository.configureNormalCacheLimit>>>();
    mockedRetentionRepository.configureNormalCacheLimit.mockImplementationOnce(async () => deferred.promise);

    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.change(within(settings).getByLabelText(/Opened-file cache limit slider/i), { target: { value: "512" } });
    await waitFor(() => expect(mockedRetentionRepository.configureNormalCacheLimit).toHaveBeenCalledWith(retentionAccountFor(alpha), 512 * 1024 * 1024));

    fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } });
    await waitFor(() => expect(within(settings).getByLabelText(/Active account/i)).toHaveValue(beta.id));
    await waitFor(() => expect(within(settings).getByText((_, element) => element?.textContent === "1 cached file • 22 B used")).toBeInTheDocument());
    deferred.resolve({
      kind: "success",
      value: {
        account: retentionAccountFor(alpha),
        normalCache: { itemCount: 9, totalBytes: 999, limitBytes: 512 * 1024 * 1024 },
        roots: [],
        files: [],
        memberships: []
      }
    });

    await act(async () => undefined);
    expect(within(settings).getByText((_, element) => element?.textContent === "1 cached file • 22 B used")).toBeInTheDocument();
    expect(screen.queryByText(/Opened-file cache limit set .*Alpha workspace/i)).not.toBeInTheDocument();
  });

  it("does not invalidate Beta folder/search cache when a deferred Alpha offline-root removal completes", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    const alphaRoot = retainedRootFixture({ rootPath: "Projects", rootName: "Projects", kind: "folder" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);
    seedRetentionSnapshot(alpha, { normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 }, roots: [alphaRoot], files: [retainedFileFixture("Projects/roadmap.txt")], memberships: [{ rootId: alphaRoot.id, filePath: "Projects/roadmap.txt" }] });
    seedRetentionSnapshot(beta, { normalCache: { itemCount: 1, totalBytes: 22, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [retainedFileFixture("beta.txt", { blobSize: 22, normalCacheOwnership: "owned" })], memberships: [] });
    const deferred = createDeferred<Awaited<ReturnType<typeof retentionFixture.repository.removeRoot>>>();
    mockedRetentionRepository.removeRoot.mockImplementationOnce(async () => deferred.promise);

    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(await within(settings).findByRole("button", { name: /Remove offline copy for Projects from this device/i }));
    await waitFor(() => expect(mockedRetentionRepository.removeRoot).toHaveBeenCalledWith(retentionAccountFor(alpha), alphaRoot.id));

    fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } });
    await waitFor(() => expect(within(settings).getByLabelText(/Active account/i)).toHaveValue(beta.id));
    deferred.resolve({ kind: "success", value: { account: retentionAccountFor(alpha), normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [], memberships: [] } });

    await act(async () => undefined);
    expect(mockedCache.clearFolderPathOrThrow).not.toHaveBeenCalled();
    expect(within(settings).getByText((_, element) => element?.textContent === "1 cached file • 22 B used")).toBeInTheDocument();
    expect(screen.queryByText(/Removed offline copy for Projects/i)).not.toBeInTheDocument();
  });

  it("does not clear Beta cache UI or invalidate its folder/search cache when a deferred Alpha clear completes", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);
    seedRetentionSnapshot(alpha, { normalCache: { itemCount: 1, totalBytes: 11, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [retainedFileFixture("alpha.txt", { blobSize: 11, normalCacheOwnership: "owned" })], memberships: [] });
    seedRetentionSnapshot(beta, { normalCache: { itemCount: 1, totalBytes: 22, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [retainedFileFixture("beta.txt", { blobSize: 22, normalCacheOwnership: "owned" })], memberships: [] });
    const deferred = createDeferred<Awaited<ReturnType<typeof retentionFixture.repository.clearNormalCache>>>();
    mockedRetentionRepository.clearNormalCache.mockImplementationOnce(async () => deferred.promise);

    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(within(settings).getByRole("button", { name: /Clear cache/i }));
    await waitFor(() => expect(mockedRetentionRepository.clearNormalCache).toHaveBeenCalledWith(retentionAccountFor(alpha)));

    fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } });
    await waitFor(() => expect(within(settings).getByLabelText(/Active account/i)).toHaveValue(beta.id));
    deferred.resolve({ kind: "success", value: { account: retentionAccountFor(alpha), normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [], memberships: [] } });

    await act(async () => undefined);
    expect(mockedCache.clearNamespaceOrThrow).not.toHaveBeenCalled();
    expect(within(settings).getByText((_, element) => element?.textContent === "1 cached file • 22 B used")).toBeInTheDocument();
    expect(screen.queryByText(/Offline cache cleared for Alpha workspace/i)).not.toBeInTheDocument();
  });

  it("does not publish a deferred Alpha sync completion after switching to Beta", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);
    seedRetentionSnapshot(beta, { normalCache: { itemCount: 1, totalBytes: 22, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [retainedFileFixture("beta.txt", { blobSize: 22, normalCacheOwnership: "owned" })], memberships: [] });
    mockedApi.fetchDownloadBlob.mockResolvedValue({ blob: new Blob(["alpha"], { type: "text/plain" }), filename: "roadmap.txt" });
    const deferred = createDeferred<Awaited<ReturnType<typeof retentionFixture.repository.completeRoot>>>();
    mockedRetentionRepository.completeRoot.mockImplementationOnce(async () => deferred.promise);

    render(<App />);
    await screen.findByRole("button", { name: /Open actions for roadmap.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));
    await waitFor(() => expect(mockedRetentionRepository.completeRoot).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } });
    await waitFor(() => expect(within(settings).getByLabelText(/Active account/i)).toHaveValue(beta.id));
    deferred.resolve({
      kind: "success",
      value: {
        account: retentionAccountFor(alpha),
        normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 },
        roots: [retainedRootFixture({ rootPath: "Projects/roadmap.txt", rootName: "roadmap.txt" })],
        files: [retainedFileFixture("Projects/roadmap.txt")],
        memberships: [{ rootId: retainedRootId({ kind: "file", rootPath: "Projects/roadmap.txt" }), filePath: "Projects/roadmap.txt" }]
      }
    });

    await act(async () => undefined);
    expect(within(settings).getByText((_, element) => element?.textContent === "1 cached file • 22 B used")).toBeInTheDocument();
    expect(screen.queryByText(/Kept roadmap.txt offline on this device for Alpha workspace/i)).not.toBeInTheDocument();
  });

  it("keeps a folder recursively offline and records cached folder contents", async () => {
    const account = buildAccount("alpha", { displayName: "Recursive offline workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects") {
        return {
          path,
          items: [
            { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 16, mimeType: "text/plain" },
            { path: "Projects/Nested", name: "Nested", isFolder: true }
          ]
        };
      }
      if (path === "Projects/Nested") {
        return {
          path,
          items: [{ path: "Projects/Nested/notes.txt", name: "notes.txt", isFolder: false, size: 8, mimeType: "text/plain" }]
        };
      }
      return { path, items: [{ path: "Projects", name: "Projects", isFolder: true }] };
    });
    mockedApi.fetchDownloadBlob.mockImplementation(async (path: string) => ({ blob: new Blob([path], { type: "text/plain" }), filename: path.split("/").pop() }));

    render(<App />);

    await screen.findByRole("button", { name: /Open actions for Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));

    const dialog = await screen.findByRole("dialog", { name: /Keep offline confirmation/i });
    expect(within(dialog).getByText(/Synced recursively/i)).toBeInTheDocument();
    expect(within(dialog).getByText("2")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Start sync/i }));

    await waitFor(() => expectRetainedFilePersisted("Projects/Nested/notes.txt"));
    expect(mockedRetentionRepository.beginRoot).toHaveBeenCalledWith(retentionAccountFor(account), expect.objectContaining({ rootPath: "Projects", kind: "folder" }));
    expect(mockedCache.writeFolder).toHaveBeenCalledWith("ns-alpha", "Projects", expect.any(Array));
    expect(mockedCache.writeFolder).toHaveBeenCalledWith("ns-alpha", "Projects/Nested", expect.any(Array));
  });

  it("aborts a deferred recursive estimate when entering explicit offline mode", async () => {
    const account = buildAccount("alpha", { displayName: "Abort recursive estimate workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const deferred = createDeferred<Awaited<ReturnType<typeof api.listFiles>>>();
    let estimateSignal: AbortSignal | undefined;
    mockedApi.listFiles.mockImplementation(async (path: string, _token: string, signal?: AbortSignal) => {
      if (path === "") {
        return { path, items: [{ path: "Projects", name: "Projects", isFolder: true }] };
      }
      if (path === "Projects") {
        estimateSignal = signal;
        return deferred.promise;
      }
      return { path, items: [{ path: `${path}/late.txt`, name: "late.txt", isFolder: false, size: 1 }] };
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Open actions for Projects/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    await screen.findByRole("dialog", { name: /Keep offline confirmation/i });
    await waitFor(() => expect(mockedApi.listFiles).toHaveBeenCalledWith("Projects", "token-alpha", expect.any(AbortSignal)));

    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Go offline$/i }));
    await waitFor(() => expect(estimateSignal?.aborted).toBe(true));

    deferred.resolve({
      path: "Projects",
      items: [{ path: "Projects/Nested", name: "Nested", isFolder: true }]
    });
    await act(async () => { await Promise.resolve(); });
    expect(mockedApi.listFiles).not.toHaveBeenCalledWith("Projects/Nested", "token-alpha", expect.anything());
    expect(mockedCache.writeFolder).not.toHaveBeenCalledWith("ns-alpha", "Projects", expect.any(Array));
    expect(screen.queryByRole("dialog", { name: /Keep offline confirmation/i })).not.toBeInTheDocument();
  });

  it("keeps a batch selection offline and removes offline copies from settings without server delete", async () => {
    const account = buildAccount("alpha", { displayName: "Batch offline workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Archive") {
        return {
          path,
          items: [{ path: "Archive/photo.png", name: "photo.png", isFolder: false, size: 4, mimeType: "image/png" }]
        };
      }
      return {
        path,
        items: [
          { path: "Archive", name: "Archive", isFolder: true },
          { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 12, mimeType: "text/plain" }
        ]
      };
    });
    mockedApi.fetchDownloadBlob.mockImplementation(async (path: string) => ({ blob: new Blob([path], { type: path.endsWith(".png") ? "image/png" : "text/plain" }), filename: path.split("/").pop() }));
    const archiveRoot = retainedRootFixture({ rootPath: "Archive", rootName: "Archive", kind: "folder" });
    seedRetentionSnapshot(account, {
      normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 },
      roots: [archiveRoot],
      files: [retainedFileFixture("Archive/photo.png", { preview: { ...textPreview, path: "Archive/photo.png", name: "photo.png" }, mimeType: "image/png", blobSize: 4 })],
      memberships: [{ rootId: archiveRoot.id, filePath: "Archive/photo.png" }]
    });

    render(<App />);

    await screen.findByRole("checkbox", { name: /Select Archive folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Archive folder/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select roadmap.txt file/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Keep offline$/i })[0]);
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));
    await waitFor(() => expect(mockedRetentionRepository.beginRoot).toHaveBeenCalledWith(retentionAccountFor(account), expect.objectContaining({ kind: "batch" })));

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(settingsDialog).getByRole("button", { name: /Remove offline copy for Archive from this device/i })).toBeInTheDocument();
    fireEvent.click(within(settingsDialog).getByRole("button", { name: /Remove offline copy for Archive from this device/i }));

    await waitFor(() => expect(mockedRetentionRepository.removeRoot).toHaveBeenCalledWith(retentionAccountFor(account), archiveRoot.id));
    expect(mockedCache.clearFolderPathOrThrow).toHaveBeenCalledWith("ns-alpha", "Archive");
    expect(mockedApi.deleteFile).not.toHaveBeenCalled();
  });

  it("does not clear a newer selection when a detached batch offline sync completes", async () => {
    const account = buildAccount("alpha", { displayName: "Offline selection isolation workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const download = createDeferred<{ blob: Blob; filename?: string }>();
    mockedApi.listFiles.mockImplementation(async (path: string) => path === "Archive"
      ? { path, items: [{ path: "Archive/photo.png", name: "photo.png", isFolder: false, size: 4, mimeType: "image/png" }] }
      : { path, items: [
        { path: "Archive", name: "Archive", isFolder: true },
        { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 12, mimeType: "text/plain" }
      ] });
    mockedApi.fetchDownloadBlob.mockReturnValueOnce(download.promise);

    render(<App />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Select Archive folder/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Keep offline$/i })[0]);
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));
    await waitFor(() => expect(mockedApi.fetchDownloadBlob).toHaveBeenCalled());

    fireEvent.click(screen.getAllByRole("button", { name: /Clear selection/i })[0]);
    fireEvent.click(screen.getByRole("checkbox", { name: /Select roadmap.txt file/i }));
    download.resolve({ blob: new Blob(["photo"], { type: "image/png" }), filename: "photo.png" });

    await waitFor(() => expectRetainedFilePersisted());
    expect(await screen.findByText(/1 item selected \(1 file\)/i)).toBeInTheDocument();
  });

  it("allows failed offline sync files to be retried from the transfer tray", async () => {
    const account = buildAccount("alpha", { displayName: "Retry offline workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.fetchDownloadBlob
      .mockRejectedValueOnce(new Error("Temporary sync failure."))
      .mockResolvedValueOnce({ blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" });

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select roadmap.txt file/i }));
    fireEvent.click(primaryKeepOfflineButton());
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));

    expect(await screen.findByText(/Synced 0 of 1 files for offline use in Retry offline workspace/i)).toBeInTheDocument();
    const transferStatus = await screen.findByRole("dialog", { name: /Transfer status/i });
    fireEvent.click(within(transferStatus).getByRole("button", { name: /Retry failed sync/i }));

    const retryDialog = await screen.findByRole("dialog", { name: /Keep offline confirmation/i });
    fireEvent.click(within(retryDialog).getByRole("button", { name: /Start sync/i }));

    await waitFor(() => expectRetainedFilePersisted("Projects/roadmap.txt"));
  });

  it("does not retry a failed offline sync after switching to another account", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);
    mockedApi.fetchDownloadBlob.mockRejectedValueOnce(new Error("Temporary sync failure."));

    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select roadmap.txt file/i }));
    fireEvent.click(primaryKeepOfflineButton());
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));

    const transferStatus = await screen.findByRole("dialog", { name: /Transfer status/i });
    const detachedRetry = within(transferStatus).getByRole("button", { name: /Retry failed sync/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } });

    await waitFor(() => expect(within(settings).getByLabelText(/Active account/i)).toHaveValue(beta.id));
    expect(within(transferStatus).queryByRole("button", { name: /Retry failed sync/i })).not.toBeInTheDocument();
    fireEvent.click(detachedRetry);
    expect(screen.queryByRole("dialog", { name: /Keep offline confirmation/i })).not.toBeInTheDocument();
    expect(mockedApi.fetchDownloadBlob).toHaveBeenCalledTimes(1);
  });

  it("retries failed recursive offline sync from the original folder root", async () => {
    const account = buildAccount("alpha", { displayName: "Retry folder sync workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    let badPathAttempts = 0;
    mockedApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects") {
        return {
          path,
          items: [
            { path: "Projects/bad.pdf", name: "bad.pdf", isFolder: false, size: 10, mimeType: "application/pdf" },
            { path: "Projects/good.txt", name: "good.txt", isFolder: false, size: 10, mimeType: "text/plain" }
          ]
        };
      }
      return {
        path,
        items: [{ path: "Projects", name: "Projects", isFolder: true }]
      };
    });
    mockedApi.fetchDownloadBlob.mockImplementation(async (path: string) => {
      if (path === "Projects/bad.pdf") {
        badPathAttempts += 1;
        if (badPathAttempts === 1) {
          throw new Error("Temporary sync failure.");
        }
      }
      return { blob: new Blob([path], { type: "text/plain" }), filename: path.split("/").pop() };
    });

    render(<App />);

    await screen.findByRole("button", { name: /Open actions for Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));

    expect(await screen.findByText(/Synced 1 of 2 files for offline use in Retry folder sync workspace/i)).toBeInTheDocument();
    const transferStatus = await screen.findByRole("dialog", { name: /Transfer status/i });
    expect(within(transferStatus).getByText("Projects/bad.pdf")).toBeInTheDocument();
    fireEvent.click(within(transferStatus).getByRole("button", { name: /Retry failed sync/i }));

    const retryDialog = await screen.findByRole("dialog", { name: /Keep offline confirmation/i });
    await waitFor(() => expect(within(retryDialog).getByText("Projects")).toBeInTheDocument());
    expect(within(retryDialog).getByText(/Synced recursively/i)).toBeInTheDocument();
    expect(within(retryDialog).getByText("2")).toBeInTheDocument();
    expect(within(retryDialog).queryByText("bad.pdf")).not.toBeInTheDocument();

    fireEvent.click(within(retryDialog).getByRole("button", { name: /Start sync/i }));

    await waitFor(() => expectRetainedFilePersisted("Projects/bad.pdf"));
    expect(mockedRetentionRepository.beginRoot).toHaveBeenCalledWith(retentionAccountFor(account), expect.objectContaining({ rootPath: "Projects", kind: "folder" }));
  });

  it("clears normal cache without removing explicitly kept-offline copies", async () => {
    const account = buildAccount("alpha", { displayName: "Clear cache workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.fetchDownloadBlob.mockResolvedValue({ blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" });

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));
    await waitFor(() => expectRetainedFilePersisted("Projects/roadmap.txt"));
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    await within(settingsDialog).findByRole("button", { name: /Remove offline copy for roadmap.txt from this device/i });
    fireEvent.click(within(settingsDialog).getByRole("button", { name: /Clear cache/i }));

    await waitFor(() => expect(mockedRetentionRepository.clearNormalCache).toHaveBeenCalledWith(retentionAccountFor(account)));
    expect(mockedCache.clearNamespaceOrThrow).toHaveBeenCalledWith("ns-alpha", { preserveFolderPaths: ["Projects"] });
    expect(mockedRetentionRepository.removeRoot).not.toHaveBeenCalled();
    expect(within(settingsDialog).getByRole("button", { name: /Remove offline copy for roadmap.txt from this device/i })).toBeInTheDocument();
  });

  it("shows kept-offline items separately from the normal cache summary", async () => {
    const account = buildAccount("alpha", { displayName: "Offline accounting workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const root = retainedRootFixture({ rootPath: "Projects/roadmap.txt", rootName: "roadmap.txt" });
    seedRetentionSnapshot(account, {
      normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 },
      roots: [root],
      files: [retainedFileFixture("Projects/roadmap.txt", { preview: textPreview, blobSize: 16 })],
      memberships: [{ rootId: root.id, filePath: "Projects/roadmap.txt" }]
    });

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    await waitFor(() => expect(mockedRetentionRepository.readSnapshot).toHaveBeenCalledWith(retentionAccountFor(account)));
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });

    expect(within(settingsDialog).getByText((_, element) => element?.textContent === "0 cached files • 0 B used")).toBeInTheDocument();
    expect(await within(settingsDialog).findByText("roadmap.txt")).toBeInTheDocument();
    expect(within(settingsDialog).getByRole("button", { name: /Remove offline copy for roadmap.txt from this device/i })).toBeInTheDocument();
  });
});
