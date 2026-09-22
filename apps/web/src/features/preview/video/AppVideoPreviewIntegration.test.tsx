import { cleanup, fireEvent, render as renderTestingLibrary, screen, waitFor, within } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../../diagnostics/testing/fakes";
import { cloneElement, type ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import App from "../../../App";
import type { AppServices } from "../../../app/AppServices";
import { createPreviewComposition } from "../../../app/createPreviewComposition";
import { createAccountRegistryService } from "../../accounts";
import type { AccountTransport } from "../../accounts";
import type { BrowsingCacheRepository, FolderPorts, SearchPorts } from "../../browsing";
import { createMemoryFolderSortService } from "../../browsing/folderSort/testing/fakeStorage";
import { DEFAULT_UI_SETTINGS, normalizeUiSettings } from "../../settings";
import { WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT, type ResponsiveViewportPort } from "../../navigation";
type ConnectedAccount = ReturnType<AppServices["accountRegistry"]["getState"]>["snapshot"]["accounts"][number]["account"];
type AccountRegistryService = AppServices["accountRegistry"];

type FileEntry = Parameters<AppServices["favourites"]["create"]>[0];
type FilePreview = FileEntry & { viewer: "text" | "markdown" | "image" | "audio" | "video" | "pdf" | "unsupported"; content: string; encoding: "utf8" | "none"; truncated: boolean; bytesRead: number; requiresOriginalBlob?: boolean };
type AppSession = Awaited<ReturnType<AccountTransport["createSession"]>>;
type ConnectivityPort = AppServices["connectivity"];
type ExplicitOfflineModeRuntimePort = AppServices["explicitOfflineRuntime"];
type OperationRuntimePort = AppServices["operationRuntime"];
type RetentionRepository = AppServices["retentionRepository"];
type RetentionAccount = Parameters<RetentionRepository["readSnapshot"]>[0];
type RetentionResult<T> = { kind: "success"; value: T } | { kind: "failure"; message: string };
type RetainedSnapshot = Extract<Awaited<ReturnType<RetentionRepository["readSnapshot"]>>, { kind: "success" }>["value"];
type RetainedFile = RetainedSnapshot extends { files: readonly (infer T)[] } ? T : never;
type RetainedRoot = RetainedSnapshot extends { roots: readonly (infer T)[] } ? T : never;
interface PreviewTransport {
  getFile(path: string, token: string, signal?: AbortSignal): Promise<{ file: FilePreview }>;
  fetchOriginalFile(path: string, token: string, signal?: AbortSignal): Promise<{ blob: Blob; mimeType: string; filename: string }>;
  createStreamingFileUrl(path: string, token: string, signal?: AbortSignal): Promise<string>;
}
const buildAccount = (id: string, overrides: Partial<ConnectedAccount> = {}): ConnectedAccount => ({ id, type: "nextcloud", displayName: `Account ${id}`, label: `Account ${id}`, baseUrl: `https://${id}.example.com`, username: `${id}-user`, rootPath: ".davora-agent-test", backend: "mock", connectionState: "connected", lastValidatedAt: "2026-05-21T10:00:00.000Z", cacheNamespace: `ns-${id}`, ...overrides });
const buildSession = (account: ConnectedAccount, overrides: Partial<AppSession> = {}): AppSession => ({ token: `token-${account.id}`, expiresAt: "2099-01-01T00:00:00.000Z", rootPath: account.rootPath, capabilities: { backend: account.backend, readOnly: false, search: true, preview: true, download: true, offlineCache: true, createFolder: true, upload: true, move: true, copy: true, delete: true, mediaPreview: true, markdownPreview: true, openedFileCache: true }, account, ...overrides });
const buildHealthResponse = (): Awaited<ReturnType<AccountTransport["getHealth"]>> => ({ app: "davora", configLoaded: true, backend: "mock", rootPath: ".davora-agent-test", unlockRequired: false, connectionMode: "in_app", supportedAccountTypes: ["nextcloud"] });

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({ offlineReady: [false, vi.fn()], needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn(async () => undefined) })
}));

const mockedApi = {
  getHealth: vi.fn<AccountTransport["getHealth"]>(),
  connectAccount: vi.fn<AccountTransport["connectAccount"]>(),
  createSession: vi.fn<AccountTransport["createSession"]>(),
  deleteConnectedAccount: vi.fn<AccountTransport["deleteConnectedAccount"]>(),
  listFiles: vi.fn<(path: string, token: string, signal: AbortSignal) => Promise<{ path: string; items: FileEntry[] }>>(),
  getFile: vi.fn<PreviewTransport["getFile"]>(),
  fetchOriginalFile: vi.fn<PreviewTransport["fetchOriginalFile"]>(),
  createStreamingFileUrl: vi.fn<PreviewTransport["createStreamingFileUrl"]>(),
  triggerBrowserDownload: vi.fn()
};
const healthResponse = buildHealthResponse();
const ONLINE = { kind: "online" } as const;
const createObjectUrlMock = vi.fn(() => "blob:preview");
const revokeObjectUrlMock = vi.fn();

const success = <T,>(value: T): RetentionResult<T> => ({ kind: "success", value });
type RetentionStore = { account: RetentionAccount; files: Map<string, RetainedFile>; roots: Map<string, RetainedRoot>; memberships: Map<string, Set<string>>; blobs: Map<string, Blob>; limitBytes: number };
const retentionFixture = (() => {
  const stores = new Map<string, RetentionStore>();
  const normalizePath = (path: string) => path.replace(/^\/+|\/+$/g, "");
  const storeFor = (account: RetentionAccount) => {
    const existing = stores.get(account.cacheNamespace);
    if (existing) return existing;
    const store: RetentionStore = { account: { ...account }, files: new Map(), roots: new Map(), memberships: new Map(), blobs: new Map(), limitBytes: 24 * 1024 * 1024 };
    stores.set(account.cacheNamespace, store);
    return store;
  };
  const snapshotFor = (account: RetentionAccount): RetainedSnapshot => {
    const store = storeFor(account);
    return {
      account: { ...store.account },
      normalCache: { itemCount: [...store.files.values()].filter((file) => file.normalCacheOwnership === "owned").length, totalBytes: [...store.files.values()].filter((file) => file.normalCacheOwnership === "owned").reduce((sum, file) => sum + file.blobSize, 0), limitBytes: store.limitBytes },
      roots: [...store.roots.values()], files: [...store.files.values()],
      memberships: [...store.memberships.entries()].flatMap(([filePath, rootIds]) => [...rootIds].map((rootId) => ({ rootId, filePath })))
    };
  };
  const repository = {
    readSnapshot: vi.fn(async (account) => success(snapshotFor(account))),
    readPreview: vi.fn(async (account, path) => {
      const store = storeFor(account); const normalized = normalizePath(path); const file = store.files.get(normalized);
      return success(file ? { file: { ...file, readable: file.readable || store.blobs.has(normalized) }, blob: store.blobs.get(normalized) } : undefined);
    }),
    writePreview: vi.fn(async (account, input) => {
      const store = storeFor(account); const path = normalizePath(input.file.path);
      store.files.set(path, { ...input.file, path, normalCacheOwnership: "owned", readable: Boolean(input.file.readable) || Boolean(input.blob), blobSize: input.blob?.size ?? input.file.blobSize });
      if (input.blob) store.blobs.set(path, input.blob);
      return success(snapshotFor(account));
    }),
    beginRoot: vi.fn(async (account, root) => { const store = storeFor(account); store.roots.set(`${root.kind}:${root.rootPath}`, { ...root, id: `${root.kind}:${root.rootPath}` }); return success(snapshotFor(account)); }),
    persistRetainedFile: vi.fn(async (account) => success(snapshotFor(account))),
    completeRoot: vi.fn(async (account) => success(snapshotFor(account))),
    removeRoot: vi.fn(async (account) => success(snapshotFor(account))),
    clearNormalCache: vi.fn(async (account) => success(snapshotFor(account))),
    purgeAccountNamespace: vi.fn(async (account) => { stores.delete(account.cacheNamespace); return success(snapshotFor(account)); }),
    configureNormalCacheLimit: vi.fn(async (account, limitBytes) => { storeFor(account).limitBytes = limitBytes; return success(snapshotFor(account)); })
  };
  return {
    repository,
    reset() { stores.clear(); },
    seed(account: RetentionAccount, snapshot: Omit<RetainedSnapshot, "account">, blobs: Record<string, Blob | undefined> = {}) {
      const store = storeFor(account); store.limitBytes = snapshot.normalCache.limitBytes;
      for (const file of snapshot.files) store.files.set(normalizePath(file.path), { ...file, path: normalizePath(file.path) });
      for (const root of snapshot.roots) store.roots.set(root.id, { ...root });
      for (const membership of snapshot.memberships) { const roots = store.memberships.get(normalizePath(membership.filePath)) ?? new Set<string>(); roots.add(membership.rootId); store.memberships.set(normalizePath(membership.filePath), roots); }
      for (const [path, blob] of Object.entries(blobs)) if (blob) store.blobs.set(normalizePath(path), blob);
    }
  };
})();
const mediaPlayMock = vi.fn<() => Promise<void>>(async () => undefined);
const mediaPauseMock = vi.fn<() => void>(() => undefined);

function createStorage() {
  return {
    readItem: (key: string) => ({ ok: true as const, value: localStorage.getItem(key) }),
    writeItem: (key: string, value: string) => { localStorage.setItem(key, value); return { ok: true as const }; },
    deleteItem: (key: string) => { localStorage.removeItem(key); return { ok: true as const }; }
  };
}

function createAudioFixture(): AppServices {
  const storage = createStorage();
  let accountRegistry: AccountRegistryService | undefined;
  const getAccountRegistry = () => accountRegistry ??= createAccountRegistryService(storage, { isExpired: (expiresAt) => Date.parse(expiresAt) <= Date.now() });
  const abortHandle = () => { const controller = new AbortController(); return { signal: controller.signal, abort: () => controller.abort() }; };
  const accountTransport: AccountTransport = { getHealth: mockedApi.getHealth, connectAccount: mockedApi.connectAccount, createSession: mockedApi.createSession, deleteConnectedAccount: mockedApi.deleteConnectedAccount };
  const listFiles = async (path: string, token: string, signal: AbortSignal) => mockedApi.listFiles(path, token, signal);
  const folder: FolderPorts = {
    createAbortHandle: abortHandle,
    loadFolder: async ({ path, token, signal }) => { try { const result = await listFiles(path, token, signal); return { kind: "success", items: result.items }; } catch (error) { return { kind: "failure", error: error instanceof Error ? error : new Error("Unable to load folder.") }; } },
    readCachedFolder: () => undefined, writeCachedFolder: vi.fn()
  };
  const cache: BrowsingCacheRepository = {
    readFolder: vi.fn(() => ({ kind: "miss" as const })), writeFolder: vi.fn(() => ({ kind: "written" as const })), readSearch: vi.fn(() => ({ kind: "miss" as const })), writeSearch: vi.fn(() => ({ kind: "written" as const })), clearNamespace: vi.fn(() => ({ kind: "cleared" as const })), clearFolderPath: vi.fn(() => ({ kind: "cleared" as const })), clearNamespaceOrThrow: vi.fn(), clearFolderPathOrThrow: vi.fn()
  };
  const search: SearchPorts = { createAbortHandle: abortHandle, loadSearch: async () => ({ kind: "success", items: [] }), readCachedSearch: () => undefined, writeCachedSearch: vi.fn() };
  const accountSession = { getHealth: accountTransport.getHealth, createSession: accountTransport.createSession, commitSession: (...args: Parameters<AccountRegistryService["commitSession"]>) => getAccountRegistry().commitSession(...args), markAccountReconnectRequired: (...args: Parameters<AccountRegistryService["markAccountReconnectRequired"]>) => getAccountRegistry().markAccountReconnectRequired(...args), clearAccountSession: (...args: Parameters<AccountRegistryService["clearAccountSession"]>) => getAccountRegistry().clearAccountSession(...args), delay: async () => undefined };
  const registry = { getState: () => getAccountRegistry().getState(), getSnapshot: () => getAccountRegistry().getSnapshot(), subscribe: (listener: () => void) => getAccountRegistry().subscribe(listener), repair: () => getAccountRegistry().repair(), connectAccount: (...args: Parameters<AccountRegistryService["connectAccount"]>) => getAccountRegistry().connectAccount(...args), commitConnectedAccount: (...args: Parameters<AccountRegistryService["commitConnectedAccount"]>) => getAccountRegistry().commitConnectedAccount(...args), commitSession: (...args: Parameters<AccountRegistryService["commitSession"]>) => getAccountRegistry().commitSession(...args), clearAccountSession: (...args: Parameters<AccountRegistryService["clearAccountSession"]>) => getAccountRegistry().clearAccountSession(...args), markAccountReconnectRequired: (...args: Parameters<AccountRegistryService["markAccountReconnectRequired"]>) => getAccountRegistry().markAccountReconnectRequired(...args), switchAccount: (...args: Parameters<AccountRegistryService["switchAccount"]>) => getAccountRegistry().switchAccount(...args), removeAccount: (...args: Parameters<AccountRegistryService["removeAccount"]>) => getAccountRegistry().removeAccount(...args), retryRemovalCommit: (...args: Parameters<AccountRegistryService["retryRemovalCommit"]>) => getAccountRegistry().retryRemovalCommit(...args) };
  const operationRuntime: OperationRuntimePort = {
    request: { createAbortHandle: abortHandle, createTransferId: () => "image-transfer" },
    mutation: { createFolder: async () => ({ action: "createFolder", parentPath: "", path: "" }), deleteFile: async () => ({ action: "delete", parentPath: "", path: "" }), uploadFile: async () => ({ action: "upload", parentPath: "", path: "" }), copyOrMove: async () => ({ action: "copy", parentPath: "", path: "" }), listDestination: async (path, token) => listFiles(path, token, new AbortController().signal) },
    download: { prepareDownloadFile: vi.fn(), fetchDownloadBlob: vi.fn(), listFiles: async (path, token, signal) => listFiles(path, token, signal ?? new AbortController().signal), triggerBrowserDownload: mockedApi.triggerBrowserDownload, saveDownload: vi.fn() },
    batch: { downloadSelectionAsZip: vi.fn() }, preview: { createFileStreamUrl: async () => "" }, time: { wait: async () => {} }, uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) },
    isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback
  };
  const responsiveViewport: ResponsiveViewportPort = { getSnapshot: () => WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT, subscribe: () => () => undefined };
  const explicitOfflineRuntime: ExplicitOfflineModeRuntimePort = { storage: { read: () => ({ kind: "ready", enabled: false }), commit: () => ({ kind: "committed" }), reset: () => ({ kind: "committed" }), repair: () => ({ kind: "repaired" }) }, network: { setBlocked: () => undefined } };
  const connectivity: ConnectivityPort = { read: () => ONLINE, subscribe: () => () => undefined };
  const clock = { nowIso: () => "2026-01-01T00:00:00.000Z" };
  const settings = { load: () => { try { return normalizeUiSettings(JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}")); } catch { return DEFAULT_UI_SETTINGS; } }, save: (value: typeof DEFAULT_UI_SETTINGS) => { localStorage.setItem("davora-ui-settings", JSON.stringify(value)); return value; } };
  const previewTransport: PreviewTransport = { getFile: mockedApi.getFile, fetchOriginalFile: mockedApi.fetchOriginalFile, createStreamingFileUrl: mockedApi.createStreamingFileUrl };
  return {
    accountRegistry: registry, accountTransport, accountSession, browsingCache: cache, favouriteResolveRuntime: { listFiles: async () => ({ items: [] }), cacheFolder: () => undefined }, connectivity, explicitOfflineRuntime, clock,
    favourites: { load: () => ({ kind: "loaded", entries: [] }), save: () => ({ kind: "saved", entries: [] }), clear: () => ({ kind: "cleared" }), create: (entry: FileEntry) => ({ ...entry, accountId: "alpha", accountBackend: "mock", accountRootPath: "", cacheNamespace: "ns-alpha", addedAt: clock.nowIso() }) },
    favouritesPointerEnvironment: { elementFromPoint: () => null, addWindowListener: () => () => undefined }, folder,
    folderSorts: createMemoryFolderSortService(),
    history: { pushState: (state: unknown, url?: string) => window.history.pushState(state, "", url), replaceState: (state: unknown, url?: string) => window.history.replaceState(state, "", url), getState: (): unknown => window.history.state, getLocation: () => ({ href: window.location.href, search: window.location.search }), subscribe: (listener: (state: unknown) => void) => { const handler = () => listener(window.history.state); window.addEventListener("popstate", handler); return () => window.removeEventListener("popstate", handler); } },
    pullToRefreshEnvironment: { getWindowScrollY: () => window.scrollY }, responsiveViewport, search, settings, operationRuntime,
    offlineSyncRuntime: { createAbortHandle: abortHandle, createTransferId: () => "image-sync", listFiles: async (path) => ({ path, items: [] }), fetchDownloadBlob: vi.fn(), readBlobText: async () => "", isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback },
    retentionRepository: retentionFixture.repository, previewRuntime: createPreviewComposition({ retentionRepository: retentionFixture.repository, previewTransport }), accountRemovalRuntime: { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined }, diagnostics: createFakeDiagnosticsRuntimePorts()
  } satisfies AppServices;
}

let testServices: AppServices;
function renderInjectedApp() { return renderTestingLibrary(<App services={testServices} />); }
function render(ui: ReactElement) { const injectServices = (element: ReactElement) => cloneElement(element, { services: testServices }); const view = ui.type === App ? renderInjectedApp() : renderTestingLibrary(injectServices(ui)); return { ...view, rerender: (nextUi: ReactElement) => view.rerender(injectServices(nextUi)) }; }
function seedAccounts(records: Array<{ account: ConnectedAccount; session?: { token: string; expiresAt: string; rootPath: string; capabilities: AppSession["capabilities"] } }>, activeAccountId?: string) { localStorage.setItem("davora-account-state", JSON.stringify({ activeAccountId: activeAccountId ?? records[0]?.account.id, accounts: records })); }
const textPreview = { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, mimeType: "text/plain", viewer: "text", content: "normalized API preview", encoding: "utf8", truncated: false, bytesRead: 22, size: 70 } satisfies FilePreview;

beforeEach(() => {
  cleanup(); localStorage.clear(); window.history.replaceState(null, "", "/"); Reflect.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  Reflect.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) });
  Reflect.defineProperty(URL, "createObjectURL", { value: createObjectUrlMock, configurable: true, writable: true });
  Reflect.defineProperty(URL, "revokeObjectURL", { value: revokeObjectUrlMock, configurable: true, writable: true });
  testServices = createAudioFixture(); retentionFixture.reset(); vi.clearAllMocks();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(mediaPlayMock);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(mediaPauseMock);
  mockedApi.getHealth.mockResolvedValue(healthResponse);
  mockedApi.connectAccount.mockImplementation(async (request) => ({ kind: "http-success", data: { account: buildAccount(request.accountId ?? "connected", { displayName: request.label?.trim() || `${request.username}@${new URL(request.baseUrl).hostname}`, label: request.label, baseUrl: request.baseUrl, username: request.username, rootPath: request.rootPath ?? "", cacheNamespace: request.cacheNamespace ?? `ns-${request.accountId ?? "connected"}` }) } }));
  mockedApi.createSession.mockImplementation(async ({ accountId }) => buildSession(buildAccount(accountId)));
  mockedApi.deleteConnectedAccount.mockResolvedValue(undefined);
  mockedApi.listFiles.mockResolvedValue({ path: "", items: [] });
  mockedApi.getFile.mockResolvedValue({ file: textPreview });
  mockedApi.fetchOriginalFile.mockResolvedValue({ blob: new Blob(["binary"], { type: "image/png" }), mimeType: "image/png", filename: "photo.png" });
  mockedApi.createStreamingFileUrl.mockImplementation(async (path: string) => `/api/file/stream?path=${encodeURIComponent(path)}&streamToken=stream-token-alpha`);
  mockedApi.triggerBrowserDownload.mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});



it("navigates video previews across videos only and exposes disabled toolbar boundaries", async () => {
    const account = buildAccount("alpha", { displayName: "Video navigation workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Projects/a-clip.mp4", name: "a-clip.mp4", isFolder: false, size: 20, mimeType: "video/mp4" },
        { path: "Projects/notes.txt", name: "notes.txt", isFolder: false, size: 10, mimeType: "text/plain" },
        { path: "Projects/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" },
        { path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 18, mimeType: "audio/mpeg" },
        { path: "Projects/z-clip.webm", name: "z-clip.webm", isFolder: false, size: 22, mimeType: "video/webm" }
      ]
    });
    mockedApi.getFile.mockImplementation(async (path: string) => ({
      file: {
        ...textPreview,
        path,
        name: path.split("/").pop() ?? path,
        mimeType: path.endsWith(".webm") ? "video/webm" : "video/mp4",
        viewer: "video",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true,
        size: 20
      }
    }));

    const playbackEvents: string[] = [];
    mediaPlayMock.mockImplementation(async () => {
      playbackEvents.push("play");
    });
    mediaPauseMock.mockImplementation(() => {
      playbackEvents.push("pause");
    });

    render(<App />);

    await screen.findByRole("button", { name: /Open file a-clip.mp4/i });
    fireEvent.change(screen.getByLabelText(/Sort files and folders/i), { target: { value: "name-desc" } });
    fireEvent.click(await screen.findByRole("button", { name: /Open file z-clip.webm/i }));
    const firstPreview = await screen.findByRole("dialog", { name: /Preview z-clip.webm/i });
    const firstNavigation = within(firstPreview).getByRole("group", { name: /Video navigation/i });
    expect(within(firstNavigation).getByRole("button", { name: /Previous video/i })).toBeDisabled();
    expect(within(firstNavigation).getByRole("button", { name: /Next video/i })).toBeEnabled();
    expect(within(firstPreview).queryByRole("button", { name: /Next media item/i })).not.toBeInTheDocument();

    await waitFor(() => expect(playbackEvents).toContain("play"));
    playbackEvents.length = 0;
    mediaPauseMock.mockClear();
    fireEvent.click(within(firstNavigation).getByRole("button", { name: /Next video/i }));

    const lastPreview = await screen.findByRole("dialog", { name: /Preview a-clip.mp4/i });
    const lastNavigation = within(lastPreview).getByRole("group", { name: /Video navigation/i });
    expect(within(lastNavigation).getByRole("button", { name: /Previous video/i })).toBeEnabled();
    expect(within(lastNavigation).getByRole("button", { name: /Next video/i })).toBeDisabled();
    await waitFor(() => expect(playbackEvents).toContain("play"));
    expect(playbackEvents.slice(0, 2)).toEqual(["pause", "play"]);
    expect(mockedApi.getFile.mock.calls.map(([path]) => path)).toEqual([
      "Projects/z-clip.webm",
      "Projects/a-clip.mp4"
    ]);
  })

it("opens video preview honoring the persisted mute preference", async () => {
    const account = buildAccount("alpha", { displayName: "Video workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Projects/clip.mp4", name: "clip.mp4", isFolder: false, size: 16, mimeType: "video/mp4" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Projects/clip.mp4",
        name: "clip.mp4",
        mimeType: "video/mp4",
        viewer: "video",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true
      }
    });
    mockedApi.fetchOriginalFile.mockResolvedValue({
      blob: new Blob([new Uint8Array([0, 0, 0, 24])], { type: "video/mp4" }),
      mimeType: "video/mp4",
      filename: "clip.mp4"
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file clip.mp4/i }));
    const previewDialog = await screen.findByRole("dialog", { name: /Preview clip.mp4/i });
    const video = within(previewDialog).getByLabelText<HTMLVideoElement>(/Video preview clip.mp4/i);
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(false);
    expect(video.playsInline).toBe(true);

    video.muted = true;
    fireEvent(video, new Event("volumechange"));
    expect(JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}")).toMatchObject({ videoMuted: true });
  })

it("opens video preview muted when the persisted preference is muted", async () => {
    localStorage.setItem("davora-ui-settings", JSON.stringify({ ...DEFAULT_UI_SETTINGS, videoMuted: true }));
    const account = buildAccount("alpha", { displayName: "Muted video workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Projects/clip.mp4", name: "clip.mp4", isFolder: false, size: 16, mimeType: "video/mp4" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Projects/clip.mp4",
        name: "clip.mp4",
        mimeType: "video/mp4",
        viewer: "video",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true
      }
    });
    mockedApi.fetchOriginalFile.mockResolvedValue({
      blob: new Blob([new Uint8Array([0, 0, 0, 24])], { type: "video/mp4" }),
      mimeType: "video/mp4",
      filename: "clip.mp4"
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file clip.mp4/i }));
    const previewDialog = await screen.findByRole("dialog", { name: /Preview clip.mp4/i });
    const video = within(previewDialog).getByLabelText<HTMLVideoElement>(/Video preview clip.mp4/i);
    expect(video.muted).toBe(true);
  })
