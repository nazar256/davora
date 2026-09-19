import { act, cleanup, fireEvent, render as renderTestingLibrary, screen, waitFor, within } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../../App";
import type { AppServices } from "../../../app/AppServices";
import type { AccountTransport } from "../../accounts";
import { createAccountRegistryService, type AccountRegistryService } from "../../accounts/registry";
import type { BrowsingCacheRepository, FavouritesService, FolderPorts, SearchPorts } from "../../browsing";
import { createMemoryFolderSortService } from "../../browsing/folderSort/testing/fakeStorage";
import type { ConnectivityPort, ConnectivitySnapshot } from "../connectivity";
import { OFFLINE_CONNECTIVITY_SNAPSHOT, ONLINE_CONNECTIVITY_SNAPSHOT } from "../connectivity";
import type { ExplicitOfflineModeRuntimePort } from "./ports";
import type { RetainedFile, RetainedRoot, RetainedSnapshot, RetentionAccount, RetentionRepository, RetentionResult } from "../retention";
import { retainedRootId } from "../retention";
import type { OperationRuntimePort } from "../../operations/workspace";
import type { ResponsiveViewportPort } from "../../navigation/viewport";
import { WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT } from "../../navigation/viewport";
import type { PreviewRuntimePort } from "../../preview/workspace";
import { DEFAULT_UI_SETTINGS } from "../../settings";
import { buildAccount, buildSession } from "../../../test/accounts";
import { buildHealthResponse } from "../../../test/api";
import { createDeferred } from "../../../test/primitives";

type ConnectedAccount = ReturnType<typeof buildAccount>;
type AppSession = ReturnType<typeof buildSession>;
type FileEntry = Parameters<FavouritesService["create"]>[0];
const EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY = "davora-explicit-offline-accounts";
type Mock = ReturnType<typeof vi.fn>;

interface ExplicitOfflineModeFixture {
  readonly services: AppServices;
  readonly calls: {
    readonly health: Mock;
    readonly createSession: Mock;
    readonly listFolder: Mock;
    readonly search: Mock;
    readonly browserSave: Mock;
    readonly retentionRead: Mock;
  };
  seedAccount(input: { account: ConnectedAccount; session?: AppSession; pendingReconnect?: { baseUrl: string; username: string; label?: string } }): void;
  setConnectivity(kind: "online" | "offline"): void;
  setPersistedMode(accountId: string, state: "enabled" | "disabled" | "corrupt"): void;
  seedFolderCache(account: ConnectedAccount, path: string, items: readonly FileEntry[]): void;
  seedRetainedPreview(account: ConnectedAccount, path: string, blob: Blob): void;
  deferRetainedPreview(account: ConnectedAccount, path: string): ReturnType<typeof createDeferred<Awaited<ReturnType<RetentionRepository["readPreview"]>>>>;
  seedRetentionSnapshot(account: ConnectedAccount, input: Omit<RetainedSnapshot, "account">): void;
}

function createDeterministicPreviewRuntime(): PreviewRuntimePort {
  const abortHandle = () => {
    const controller = new AbortController();
    return { id: "explicit-offline-preview-abort", signal: controller.signal, abort: () => controller.abort() };
  };
  return {
    session: { createSessionAdapters: () => ({
      cache: { read: async () => undefined, write: async () => ({ kind: "skipped", reason: "not-cacheable" as const }) },
      live: { acquire: async () => { throw new Error("Deterministic preview fixture has no live transport."); } },
      abort: { create: abortHandle },
      resources: { apply: (material) => ({ id: material.id, kind: material.kind }), release: () => undefined },
      failures: { classify: () => ({ kind: "ordinary", message: "Preview unavailable." }) },
      prefetch: { probe: async () => false, prefetch: async () => ({ kind: "skipped" as const }) },
      clock: { now: () => 0 }, resolveResourceUrl: () => undefined
    }) },
    modal: {
      startOriginalFileOpen: () => ({ completion: Promise.resolve(), cancel: () => undefined }),
      pdf: { loadPdfJs: async () => { throw new Error("PDF runtime unavailable in deterministic fixture."); }, fetch: async () => { throw new Error("PDF runtime unavailable in deterministic fixture."); }, requestAnimationFrame: () => 0, getDevicePixelRatio: () => 1, createResizeObserver: () => undefined },
      video: { setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs), clearTimeout: (timeoutId) => window.clearTimeout(timeoutId), getLocationHref: () => window.location.href },
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs), clearTimeout: (timeoutId) => window.clearTimeout(timeoutId), getLocationHref: () => window.location.href,
      addWindowKeydownListener: () => () => undefined, loadAudioPreviewPosition: () => undefined, saveAudioPreviewPosition: () => undefined, clearAudioPreviewPosition: () => undefined
    },
    folderAudio: { storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }, createStreamingFileUrl: async () => "blob:deterministic-preview", nowIso: () => "2026-01-01T00:00:00.000Z", loadAudioPreviewPosition: () => undefined, saveAudioPreviewPosition: () => undefined }
  };
}

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    offlineReady: [false, vi.fn()],
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(async () => undefined)
  })
}));

const healthResponse = buildHealthResponse();

function success<T>(value: T): RetentionResult<T> {
  return { kind: "success", value };
}

function storage() {
  return {
    readItem(key: string) {
      try { return { ok: true as const, value: localStorage.getItem(key) }; }
      catch (error) { return { ok: false as const, error: error instanceof Error ? error : new Error("Unable to read browser storage.") }; }
    },
    writeItem(key: string, value: string) {
      try { localStorage.setItem(key, value); return { ok: true as const }; }
      catch (error) { return { ok: false as const, error: error instanceof Error ? error : new Error("Unable to write browser storage.") }; }
    },
    deleteItem(key: string) {
      try { localStorage.removeItem(key); return { ok: true as const }; }
      catch (error) { return { ok: false as const, error: error instanceof Error ? error : new Error("Unable to delete browser storage.") }; }
    }
  };
}

function emptySnapshot(account: RetentionAccount): RetainedSnapshot {
  return { account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [], memberships: [] };
}

function retentionAccount(account: ConnectedAccount): RetentionAccount {
  return { accountId: account.id, cacheNamespace: account.cacheNamespace };
}

function retainedFile(path: string, options: Partial<RetainedFile> = {}): RetainedFile {
  const name = path.split("/").at(-1) ?? path;
  return { path, name, mimeType: "application/octet-stream", size: options.size ?? 9, blobSize: options.blobSize ?? 9, normalCacheOwnership: options.normalCacheOwnership ?? "none", readable: options.readable ?? true, ...options };
}

function retainedRoot(input: { rootPath: string; rootName?: string; kind?: "file" | "folder" | "batch"; folderRoots?: readonly string[] }): RetainedRoot {
  const rootPath = input.rootPath.replace(/^\/+|\/+$/g, "");
  const kind = input.kind ?? "file";
  return { id: retainedRootId({ kind, rootPath }), rootPath, rootName: input.rootName ?? rootPath.split("/").at(-1) ?? rootPath, kind, folderRoots: [...(input.folderRoots ?? [])], status: "complete", addedAt: "2026-01-01T00:00:00.000Z" };
}

function createFixture(): ExplicitOfflineModeFixture {
  const accountTransport = {
    getHealth: vi.fn<AccountTransport["getHealth"]>(),
    connectAccount: vi.fn<AccountTransport["connectAccount"]>(),
    createSession: vi.fn<AccountTransport["createSession"]>(),
    deleteConnectedAccount: vi.fn<AccountTransport["deleteConnectedAccount"]>()
  };
  const calls = {
    health: accountTransport.getHealth,
    createSession: accountTransport.createSession,
    listFolder: vi.fn(),
    search: vi.fn(),
    browserSave: vi.fn(),
    retentionRead: vi.fn()
  };
  const accountStorage = storage();
  let registryService: AccountRegistryService | undefined;
  const getRegistry = () => registryService ??= createAccountRegistryService(accountStorage, { isExpired: (expiresAt) => Date.parse(expiresAt) <= Date.now() });
  const cacheStore = new Map<string, { items: FileEntry[]; cachedAt: string }>();
  const snapshots = new Map<string, RetainedSnapshot>();
  const blobs = new Map<string, Blob>();
  const deferred = new Map<string, ReturnType<typeof createDeferred<Awaited<ReturnType<RetentionRepository["readPreview"]>>>> >();
  const connectivityListeners = new Set<(snapshot: ConnectivitySnapshot) => void>();
  let connectivity: ConnectivitySnapshot = ONLINE_CONNECTIVITY_SNAPSHOT;
  const abortHandle = () => { const controller = new AbortController(); return { signal: controller.signal, abort: () => controller.abort() }; };
  const listFiles = async (path: string, token = "", signal?: AbortSignal) => {
    const result = await calls.listFolder(path, token, signal);
    return result as { path: string; items: FileEntry[] };
  };
  const accountSession = {
    getHealth: accountTransport.getHealth,
    createSession: accountTransport.createSession,
    commitSession: (...args: Parameters<AccountRegistryService["commitSession"]>) => getRegistry().commitSession(...args),
    markAccountReconnectRequired: (...args: Parameters<AccountRegistryService["markAccountReconnectRequired"]>) => getRegistry().markAccountReconnectRequired(...args),
    clearAccountSession: (...args: Parameters<AccountRegistryService["clearAccountSession"]>) => getRegistry().clearAccountSession(...args),
    delay: async () => undefined
  };
  const cache: BrowsingCacheRepository = {
    readFolder: vi.fn((namespace: string, path: string) => cacheStore.get(`${namespace}:${path}`) ? { kind: "hit" as const, ...cacheStore.get(`${namespace}:${path}`)! } : { kind: "miss" as const }),
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
      if (signal.aborted) return { kind: "cancelled" };
      try { return { kind: "success", items: (await listFiles(path, token, signal)).items }; }
      catch (error) { return { kind: "failure", error: error instanceof Error ? error : new Error("Unable to load folder.") }; }
    },
    readCachedFolder: (namespace, path) => cacheStore.get(`${namespace}:${path}`),
    writeCachedFolder: (namespace, path, items) => { cacheStore.set(`${namespace}:${path}`, { items: [...items], cachedAt: "2026-05-21T10:00:00.000Z" }); }
  };
  const search: SearchPorts = {
    createAbortHandle: abortHandle,
    loadSearch: async ({ path, query, token, signal }) => {
      if (signal.aborted) return { kind: "cancelled" };
      try { return { kind: "success", items: await calls.search(path, query, token, signal) }; }
      catch (error) { return { kind: "failure", error: error instanceof Error ? error : new Error("Unable to search.") }; }
    },
    readCachedSearch: () => undefined,
    writeCachedSearch: () => undefined
  };
  const readSnapshot = async (account: RetentionAccount) => success(snapshots.get(account.cacheNamespace) ?? emptySnapshot(account));
  const retentionRepository: RetentionRepository = {
    readSnapshot,
    readPreview: async (account, path) => {
      calls.retentionRead(account, path);
      const pending = deferred.get(`${account.cacheNamespace}:${path}`);
      if (pending) return pending.promise;
      const blob = blobs.get(`${account.cacheNamespace}:${path}`);
      const file = snapshots.get(account.cacheNamespace)?.files.find((entry) => entry.path === path);
      return success(file && blob ? { file, blob } : undefined);
    },
    writePreview: async (account) => readSnapshot(account),
    beginRoot: async (account) => readSnapshot(account),
    persistRetainedFile: async (account) => readSnapshot(account),
    completeRoot: async (account) => readSnapshot(account),
    removeRoot: async (account) => readSnapshot(account),
    clearNormalCache: async (account) => readSnapshot(account),
    purgeAccountNamespace: async (account) => readSnapshot(account),
    configureNormalCacheLimit: async (account) => readSnapshot(account)
  };
  const explicitOfflineRuntime: ExplicitOfflineModeRuntimePort = {
    storage: {
      read: (accountId) => {
        if (accountStorage.readItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY).ok === false) return { kind: "failed", reason: "unavailable", error: new Error("Unable to read browser storage.") };
        const raw = accountStorage.readItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY);
        if (!raw.ok) return { kind: "failed", reason: "unavailable", error: raw.error };
        if (raw.value === "not-json") return { kind: "failed", reason: "corrupt", error: new Error("Corrupt explicit offline mode storage.") };
        if (!raw.value) return { kind: "ready", enabled: false };
        try { const parsed = JSON.parse(raw.value) as Record<string, boolean>; return { kind: "ready", enabled: Boolean(accountId && parsed[accountId]) }; }
        catch (error) { return { kind: "failed", reason: "corrupt", error: error instanceof Error ? error : new Error("Corrupt explicit offline mode storage.") }; }
      },
      commit: (accountId, enabled) => { const raw = accountStorage.readItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY); const state = raw.ok && raw.value && raw.value !== "not-json" ? JSON.parse(raw.value) as Record<string, boolean> : {}; state[accountId] = enabled; return accountStorage.writeItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY, JSON.stringify(state)).ok ? { kind: "committed" } : { kind: "failed", error: new Error("Unable to write browser storage.") }; },
      reset: () => accountStorage.deleteItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY).ok ? { kind: "committed" } : { kind: "failed", error: new Error("Unable to delete browser storage.") },
      repair: (repair) => repair.kind === "delete" ? (accountStorage.deleteItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY).ok ? { kind: "repaired" } : { kind: "failed", error: new Error("Unable to repair browser storage.") }) : (accountStorage.writeItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY, repair.value).ok ? { kind: "repaired" } : { kind: "failed", error: new Error("Unable to repair browser storage.") })
    },
    network: { setBlocked: () => undefined }
  };
  const operationRuntime: OperationRuntimePort = {
    request: { createAbortHandle: abortHandle, createTransferId: () => "explicit-offline-transfer" },
    mutation: { createFolder: async () => ({ action: "createFolder", parentPath: "", path: "" }), deleteFile: async () => ({ action: "delete", parentPath: "", path: "" }), uploadFile: async () => ({ action: "upload", parentPath: "", path: "" }), copyOrMove: async () => ({ action: "copy", parentPath: "", path: "" }), listDestination: async (path) => listFiles(path) },
    download: { prepareDownloadFile: vi.fn(), fetchDownloadBlob: vi.fn(), listFiles: async (path, token, signal) => listFiles(path, token, signal), triggerBrowserDownload: calls.browserSave, saveDownload: calls.browserSave },
    batch: { downloadSelectionAsZip: vi.fn() },
    uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) },
    isUnauthorized: () => false,
    isReconnectRequired: () => false,
    toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback
  };
  const registry = {
    getState: () => getRegistry().getState(), getSnapshot: () => getRegistry().getSnapshot(), subscribe: (listener: () => void) => getRegistry().subscribe(listener), repair: () => getRegistry().repair(),
    connectAccount: (...args: Parameters<AccountRegistryService["connectAccount"]>) => getRegistry().connectAccount(...args), commitConnectedAccount: (...args: Parameters<AccountRegistryService["commitConnectedAccount"]>) => getRegistry().commitConnectedAccount(...args), commitSession: (...args: Parameters<AccountRegistryService["commitSession"]>) => getRegistry().commitSession(...args), clearAccountSession: (...args: Parameters<AccountRegistryService["clearAccountSession"]>) => getRegistry().clearAccountSession(...args), markAccountReconnectRequired: (...args: Parameters<AccountRegistryService["markAccountReconnectRequired"]>) => getRegistry().markAccountReconnectRequired(...args), switchAccount: (...args: Parameters<AccountRegistryService["switchAccount"]>) => getRegistry().switchAccount(...args), removeAccount: (...args: Parameters<AccountRegistryService["removeAccount"]>) => getRegistry().removeAccount(...args), retryRemovalCommit: (...args: Parameters<AccountRegistryService["retryRemovalCommit"]>) => getRegistry().retryRemovalCommit(...args)
  };
  const services = {
    accountRegistry: registry, accountTransport, accountSession, browsingCache: cache, favouriteResolveRuntime: { listFiles: async () => ({ items: [] }), cacheFolder: () => undefined },
    connectivity: { read: () => connectivity, subscribe: (listener: (snapshot: ConnectivitySnapshot) => void) => { connectivityListeners.add(listener); return () => connectivityListeners.delete(listener); } } satisfies ConnectivityPort,
    explicitOfflineRuntime, clock: { nowIso: () => "2026-01-01T00:00:00.000Z" }, favourites: { load: () => ({ kind: "loaded", entries: [] }), save: () => ({ kind: "saved", entries: [] }), clear: () => ({ kind: "cleared" }), create: (entry: FileEntry) => ({ ...entry, accountId: "alpha", accountBackend: "mock", accountRootPath: "", cacheNamespace: "ns-alpha", addedAt: "2026-01-01T00:00:00.000Z" }) },
    favouritesPointerEnvironment: { elementFromPoint: () => null, addWindowListener: () => () => undefined }, folder, folderSorts: createMemoryFolderSortService(), history: { pushState: (state: unknown, url?: string) => window.history.pushState(state, "", url), replaceState: (state: unknown, url?: string) => window.history.replaceState(state, "", url), getState: () => null, getLocation: () => ({ href: window.location.href, search: window.location.search }), subscribe: () => () => undefined }, pullToRefreshEnvironment: { getWindowScrollY: () => window.scrollY }, responsiveViewport: { getSnapshot: () => WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT, subscribe: () => () => undefined } satisfies ResponsiveViewportPort, search, settings: { load: () => DEFAULT_UI_SETTINGS, save: (value) => value }, operationRuntime, offlineSyncRuntime: { createAbortHandle: abortHandle, createTransferId: () => "explicit-offline-sync", listFiles, fetchDownloadBlob: vi.fn(), readBlobText: async () => "", isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback }, retentionRepository, previewRuntime: createDeterministicPreviewRuntime(), accountRemovalRuntime: { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined }
  } satisfies AppServices;
  const fixture: ExplicitOfflineModeFixture = {
    services, calls,
    seedAccount: ({ account, session, pendingReconnect }) => localStorage.setItem("davora-account-state", JSON.stringify({ activeAccountId: account.id, accounts: [{ account, session, pendingReconnect }] })),
    setConnectivity: (kind) => { connectivity = kind === "online" ? ONLINE_CONNECTIVITY_SNAPSHOT : OFFLINE_CONNECTIVITY_SNAPSHOT; for (const listener of connectivityListeners) listener(connectivity); },
    setPersistedMode: (accountId, state) => { if (state === "corrupt") { localStorage.setItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY, "not-json"); return; } if (state === "disabled") { localStorage.removeItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY); return; } localStorage.setItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY, JSON.stringify({ [accountId]: true })); },
    seedFolderCache: (account, path, items) => cacheStore.set(`${account.cacheNamespace}:${path}`, { items: [...items], cachedAt: "2026-05-21T10:00:00.000Z" }),
    seedRetainedPreview: (account, path, blob) => { blobs.set(`${account.cacheNamespace}:${path}`, blob); },
    deferRetainedPreview: (account, path) => { const pending = createDeferred<Awaited<ReturnType<RetentionRepository["readPreview"]>>>(); deferred.set(`${account.cacheNamespace}:${path}`, pending); return pending; },
    seedRetentionSnapshot: (account, input) => { snapshots.set(account.cacheNamespace, { ...input, account: retentionAccount(account) }); }
  };
  accountTransport.getHealth.mockResolvedValue(healthResponse);
  accountTransport.connectAccount.mockResolvedValue({ kind: "http-success", data: { account: buildAccount("connected") } });
  accountTransport.createSession.mockImplementation(async ({ accountId }) => buildSession(buildAccount(accountId)));
  accountTransport.deleteConnectedAccount.mockResolvedValue(undefined);
  calls.listFolder.mockImplementation(async (path: string) => path === "Projects" ? { path, items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] } : { path, items: [{ path: "Projects", name: "Projects", isFolder: true }, { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] });
  calls.search.mockResolvedValue([]);
  return fixture;
}

let fixture: ExplicitOfflineModeFixture;
function render(ui: ReactElement) { const injected = (element: ReactElement) => cloneElement(element, { services: fixture.services }); const view = renderTestingLibrary(injected(ui)); return { ...view, rerender: (next: ReactElement) => view.rerender(injected(next)) }; }
function seedAccount(fixtureValue: ExplicitOfflineModeFixture, account: ConnectedAccount, session?: AppSession, pendingReconnect?: { baseUrl: string; username: string; label?: string }) { fixtureValue.seedAccount({ account, session, pendingReconnect }); }

beforeEach(() => { cleanup(); localStorage.clear(); window.history.replaceState(null, "", "/"); Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true }); Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) }); Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: vi.fn(() => "blob:explicit-offline") }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: vi.fn() }); vi.clearAllMocks(); fixture = createFixture(); });
afterEach(() => cleanup());

describe("explicit offline mode App integration", () => {
  it("keeps an offline cached shell usable while the live session is unavailable", async () => {
    const account = buildAccount("alpha", { displayName: "Offline shell workspace" });
    seedAccount(fixture, account); fixture.setConnectivity("offline"); fixture.seedFolderCache(account, "", [{ path: "Projects", name: "Projects", isFolder: true }]);
    render(<App />);
    expect(await screen.findByText(/Offline cache only for Offline shell workspace/i)).toBeInTheDocument(); expect(screen.getByRole("button", { name: /Open folder Projects/i })).toBeInTheDocument(); expect(screen.queryByRole("heading", { name: /Reconnect Offline shell workspace/i })).not.toBeInTheDocument();
  });

  it("recovers the live workspace after browser connectivity is restored", async () => {
    const account = buildAccount("alpha", { displayName: "Connectivity recovery workspace" });
    seedAccount(fixture, account); fixture.setConnectivity("offline"); fixture.seedFolderCache(account, "", [{ path: "Projects", name: "Projects", isFolder: true }]);
    render(<App />); expect(await screen.findByText(/Offline cache only for Connectivity recovery workspace/i)).toBeInTheDocument(); const createSessionCallsBeforeRecovery = fixture.calls.createSession.mock.calls.length;
    fixture.setConnectivity("online"); await waitFor(() => expect(fixture.calls.createSession.mock.calls.length).toBeGreaterThan(createSessionCallsBeforeRecovery)); await waitFor(() => expect(fixture.calls.listFolder).toHaveBeenCalled()); await waitFor(() => expect(screen.queryByText(/Offline cache only for Connectivity recovery workspace/i)).not.toBeInTheDocument()); expect(screen.getByRole("button", { name: /Create folder/i })).toBeEnabled();
  });

  it("keeps persisted explicit offline mode active after browser connectivity is restored", async () => {
    const account = buildAccount("alpha", { displayName: "Explicit gate recovery workspace" }); seedAccount(fixture, account, buildSession(account)); fixture.setPersistedMode(account.id, "enabled"); fixture.setConnectivity("offline"); fixture.seedFolderCache(account, "", [{ path: "Projects", name: "Projects", isFolder: true }]);
    render(<App />); expect(await screen.findByRole("button", { name: /Go online/i })).toBeInTheDocument(); expect(fixture.calls.health).not.toHaveBeenCalled(); expect(fixture.calls.listFolder).not.toHaveBeenCalled(); fixture.setConnectivity("online"); await act(async () => undefined); expect(screen.getByRole("button", { name: /Go online/i })).toBeInTheDocument(); expect(fixture.calls.health).not.toHaveBeenCalled(); expect(fixture.calls.listFolder).not.toHaveBeenCalled(); expect(fixture.calls.createSession).not.toHaveBeenCalled();
  });

  it("fails closed on corrupt offline-mode storage, reports recovery guidance, and resets on Go online", async () => {
    const account = buildAccount("alpha", { displayName: "Corrupt storage workspace" }); seedAccount(fixture, account, buildSession(account)); fixture.setPersistedMode(account.id, "corrupt");
    render(<App />); expect(await screen.findByText(/Explicit offline mode storage is corrupt/i)).toBeInTheDocument(); expect(fixture.calls.health).not.toHaveBeenCalled(); expect(fixture.calls.listFolder).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: /Go online/i })); await waitFor(() => expect(fixture.calls.health).toHaveBeenCalledTimes(1)); expect(localStorage.getItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY)).toBeNull();
  });

  it("restores explicit offline mode without probes and exposes only readable offline files and ancestors", async () => {
    const account = buildAccount("alpha", { displayName: "Explicit offline workspace" }); seedAccount(fixture, account, buildSession(account)); fixture.setPersistedMode(account.id, "enabled"); fixture.seedFolderCache(account, "", [{ path: "Online-only", name: "Online-only", isFolder: true }]);
    const root = retainedRoot({ rootPath: "Documents", rootName: "Documents", kind: "folder", folderRoots: ["Documents", "Documents/trips", "Documents/trips/2026"] }); const preview = { path: "Documents/trips/2026/photo.jpg", name: "photo.jpg", isFolder: false, size: 5, mimeType: "image/jpeg", viewer: "image" as const, content: "", encoding: "none" as const, truncated: false, bytesRead: 0, requiresOriginalBlob: true };
    fixture.seedRetentionSnapshot(account, { normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 }, roots: [root], files: [{ ...retainedFile(preview.path, { mimeType: "image/jpeg", size: 5, blobSize: 5 }), preview }], memberships: [{ rootId: root.id, filePath: preview.path }] }); fixture.seedRetainedPreview(account, preview.path, new Blob(["photo"], { type: "image/jpeg" }));
    render(<App />); expect(await screen.findByRole("button", { name: /Go online/i })).toBeInTheDocument(); expect(screen.getByText(/Explicit offline mode is active/i)).toBeInTheDocument(); expect(await screen.findByRole("button", { name: /Open folder Documents/i })).toBeInTheDocument(); expect(screen.queryByRole("button", { name: /Open folder Online-only/i })).not.toBeInTheDocument(); expect(fixture.calls.health).not.toHaveBeenCalled(); expect(fixture.calls.listFolder).not.toHaveBeenCalled(); expect(fixture.calls.createSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i })); const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i }); expect(within(settingsDialog).getByRole("button", { name: /Add account/i })).toBeDisabled(); expect(within(settingsDialog).getByRole("button", { name: /Reconnect/i })).toBeDisabled(); expect(within(settingsDialog).getByRole("button", { name: /^Remove$/i })).toBeDisabled(); expect(within(settingsDialog).getByText(/Account changes require online mode/i)).toBeInTheDocument(); fireEvent.click(within(settingsDialog).getByRole("button", { name: /^Close$/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /Search files/i }), { target: { value: "photo" } }); expect(await screen.findByRole("button", { name: /Open file photo.jpg/i })).toBeInTheDocument(); expect(fixture.calls.search).not.toHaveBeenCalled(); fireEvent.change(screen.getByRole("textbox", { name: /Search files/i }), { target: { value: "" } }); fireEvent.click(screen.getByRole("button", { name: /Open folder Documents/i })); expect(await screen.findByRole("button", { name: /Open folder trips/i })).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: /Open folder trips/i })); fireEvent.click(await screen.findByRole("button", { name: /Open folder 2026/i })); fireEvent.click(await screen.findByRole("button", { name: /Open file photo.jpg/i })); expect(await screen.findByRole("dialog", { name: /Preview photo.jpg/i })).toBeInTheDocument(); expect(fixture.calls.listFolder).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: /Back/i })); expect(screen.getByRole("button", { name: /Create folder/i })).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: /Go online/i })); await waitFor(() => expect(fixture.calls.health).toHaveBeenCalledTimes(1)); await waitFor(() => expect(fixture.calls.listFolder).toHaveBeenCalledWith("Documents/trips/2026", "token-alpha", expect.any(AbortSignal)));
  });

  it("does not download a deferred Alpha offline copy after switching to Beta", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" }); const beta = buildAccount("beta", { displayName: "Beta workspace" }); fixture.seedAccount({ account: alpha, session: buildSession(alpha) }); localStorage.setItem("davora-account-state", JSON.stringify({ activeAccountId: alpha.id, accounts: [{ account: alpha, session: buildSession(alpha) }, { account: beta, session: buildSession(beta) }] })); fixture.setPersistedMode(alpha.id, "enabled"); const alphaRoot = retainedRoot({ rootPath: "Archive/report.zip", rootName: "report.zip" }); fixture.seedRetentionSnapshot(alpha, { normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 }, roots: [alphaRoot], files: [retainedFile("Archive/report.zip", { mimeType: "application/zip" })], memberships: [{ rootId: alphaRoot.id, filePath: "Archive/report.zip" }] }); fixture.seedRetentionSnapshot(beta, { normalCache: { itemCount: 1, totalBytes: 22, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [retainedFile("beta.txt", { blobSize: 22, normalCacheOwnership: "owned" })], memberships: [] }); const deferredRead = fixture.deferRetainedPreview(alpha, "Archive/report.zip");
    render(<App />); fireEvent.click(await screen.findByRole("button", { name: /Open folder Archive/i })); fireEvent.click(await screen.findByRole("button", { name: /Open file report.zip/i })); await waitFor(() => expect(fixture.calls.retentionRead).toHaveBeenCalledWith(retentionAccount(alpha), "Archive/report.zip")); fireEvent.click(screen.getByRole("button", { name: /Go online/i })); await waitFor(() => expect(fixture.calls.health).toHaveBeenCalled()); fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i })); const settings = await screen.findByRole("dialog", { name: /Profile and settings/i }); fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } }); await waitFor(() => expect(within(settings).getByLabelText(/Active account/i)).toHaveValue(beta.id)); expect(within(settings).getByText((_, element) => element?.textContent === "1 cached file • 22 B used")).toBeInTheDocument(); deferredRead.resolve({ kind: "success", value: { file: retainedFile("Archive/report.zip", { mimeType: "application/zip" }), blob: new Blob(["alpha zip"], { type: "application/zip" }) } }); await act(async () => undefined); expect(fixture.calls.browserSave).not.toHaveBeenCalled(); expect(within(settings).getByText((_, element) => element?.textContent === "1 cached file • 22 B used")).toBeInTheDocument(); expect(screen.queryByText(/Opened the local offline copy of Archive\/report.zip/i)).not.toBeInTheDocument();
  });

  it("downloads a current-account explicit-offline copy after its repository read", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace" }); seedAccount(fixture, account, buildSession(account)); fixture.setPersistedMode(account.id, "enabled"); const root = retainedRoot({ rootPath: "Archive/report.zip", rootName: "report.zip" }); fixture.seedRetentionSnapshot(account, { normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 }, roots: [root], files: [retainedFile("Archive/report.zip", { mimeType: "application/zip" })], memberships: [{ rootId: root.id, filePath: "Archive/report.zip" }] }); fixture.seedRetainedPreview(account, "Archive/report.zip", new Blob(["alpha zip"], { type: "application/zip" })); render(<App />); fireEvent.click(await screen.findByRole("button", { name: /Open folder Archive/i })); fireEvent.click(await screen.findByRole("button", { name: /Open file report.zip/i })); await waitFor(() => expect(fixture.calls.browserSave).toHaveBeenCalledWith(expect.any(Blob), "report.zip"));
  });

  it("keeps an offline cached shell usable even when browser state is reconnect_required", async () => {
    const account = buildAccount("alpha", { displayName: "Offline reconnect workspace", connectionState: "reconnect_required" }); seedAccount(fixture, account, undefined, { baseUrl: account.baseUrl, username: account.username, label: account.label }); fixture.setConnectivity("offline"); fixture.seedFolderCache(account, "", [{ path: "Projects", name: "Projects", isFolder: true }]); render(<App />); expect(await screen.findByText(/Offline cache only for Offline reconnect workspace/i)).toBeInTheDocument(); expect(screen.getByRole("button", { name: /Open folder Projects/i })).toBeInTheDocument(); expect(screen.queryByRole("heading", { name: /Reconnect Offline reconnect workspace/i })).not.toBeInTheDocument();
  });

  it("keeps a cached shell usable when the local worker is unreachable while the browser stays online", async () => {
    vi.useFakeTimers(); try { const account = buildAccount("alpha", { displayName: "Stopped server workspace" }); seedAccount(fixture, account); fixture.calls.health.mockRejectedValue(new TypeError("fetch failed")); fixture.calls.createSession.mockRejectedValue(new TypeError("fetch failed")); fixture.seedFolderCache(account, "", [{ path: "Projects", name: "Projects", isFolder: true }]); render(<App />); await act(async () => { await vi.runAllTimersAsync(); }); expect(screen.getByText(/Cached shell only for Stopped server workspace/i)).toBeInTheDocument(); expect(screen.getByRole("button", { name: /Open folder Projects/i })).toBeInTheDocument(); expect(screen.getByText(/Showing cached data while the local server is unavailable/i)).toBeInTheDocument(); expect(screen.getByText("Server unavailable")).toBeInTheDocument(); expect(screen.queryByLabelText("Workspace details")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: /Create folder/i })).toBeDisabled(); expect(screen.queryByRole("button", { name: /Retry restore/i })).not.toBeInTheDocument(); } finally { vi.useRealTimers(); }
  });

  it("uses account-scoped stale folder cache when offline", async () => {
    const account = buildAccount("alpha", { displayName: "Offline workspace" }); seedAccount(fixture, account, buildSession(account)); fixture.setConnectivity("offline"); fixture.seedFolderCache(account, "", [{ path: "Projects", name: "Projects", isFolder: true }]); fixture.calls.listFolder.mockRejectedValueOnce(new Error("offline")); render(<App />); expect(await screen.findByText(/Showing cached data while offline/i)).toBeInTheDocument(); expect(screen.getByRole("button", { name: /Open folder Projects/i })).toBeInTheDocument(); expect(screen.getByRole("button", { name: /Create folder/i })).toBeDisabled();
  });
});
