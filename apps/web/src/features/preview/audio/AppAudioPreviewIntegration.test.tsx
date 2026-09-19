import { act, cleanup, fireEvent, render as renderTestingLibrary, screen, waitFor, within } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../../diagnostics/testing/fakes";
import { cloneElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../../App";
import type { AppServices } from "../../../app/AppServices";
import { createPreviewComposition } from "../../../app/createPreviewComposition";
import { createAccountRegistryService } from "../../accounts";
import type { AccountTransport } from "../../accounts";
import type { BrowsingCacheRepository, FolderPorts, SearchPorts } from "../../browsing";
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
const mockedRetentionRepository = retentionFixture.repository;
const mediaPlayMock = vi.fn<() => Promise<void>>(async () => undefined);
const mediaPauseMock = vi.fn<() => void>(() => undefined);

type OpenedFileRepository = { readPreview: typeof retentionFixture.repository.readPreview };
function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
function buildFilePreview(path: string, overrides: Partial<FilePreview> = {}): FilePreview {
  return { path, name: path.split("/").at(-1) ?? path, isFolder: false, mimeType: "text/plain", viewer: "text", content: "", encoding: "utf8", truncated: false, bytesRead: 0, size: 0, ...overrides };
}

function createStorage() {
  return {
    readItem: (key: string) => ({ ok: true as const, value: localStorage.getItem(key) }),
    writeItem: (key: string, value: string) => { localStorage.setItem(key, value); return { ok: true as const }; },
    deleteItem: (key: string) => { localStorage.removeItem(key); return { ok: true as const }; }
  };
}
function retentionAccountFor(account: ConnectedAccount): RetentionAccount { return { accountId: account.id, cacheNamespace: account.cacheNamespace }; }
function retainedFileFixture(path: string, options: Partial<RetainedFile> = {}): RetainedFile { return { path, name: path.split("/").at(-1) ?? path, mimeType: "text/plain", size: 0, blobSize: 0, readable: true, normalCacheOwnership: "none", ...options }; }

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
    batch: { downloadSelectionAsZip: vi.fn() }, uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) },
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


describe("audio preview App integration", () => {
  it("shows a clear play action when browser autoplay blocks media", async () => {
    const account = buildAccount("alpha", { displayName: "Blocked autoplay workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Projects/a-photo.png", name: "a-photo.png", isFolder: false, size: 12, mimeType: "image/png" },
        { path: "Projects/chapter.m4a", name: "chapter.m4a", isFolder: false, size: 18, mimeType: "audio/mp4" }
      ]
    });
    mockedApi.getFile.mockImplementation(async (path: string) => ({
      file: {
        ...textPreview,
        path,
        name: path.split("/").pop() ?? path,
        mimeType: path.endsWith(".png") ? "image/png" : "audio/mp4",
        viewer: path.endsWith(".png") ? "image" : "audio",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true,
        size: path.endsWith(".png") ? 12 : 18
      }
    }));
    render(<App services={testServices} />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file a-photo.png/i }));
    const imagePreview = await screen.findByRole("dialog", { name: /Preview a-photo.png/i });
    mediaPlayMock.mockClear();
    mediaPlayMock.mockRejectedValueOnce(new DOMException("Autoplay blocked", "NotAllowedError"));
    fireEvent.click(within(imagePreview).getByRole("button", { name: /Next media item/i }));
    const previewDialog = await screen.findByRole("dialog", { name: /Preview chapter.m4a/i });
    expect(await within(previewDialog).findByText(/Autoplay was blocked by the browser/i)).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Play media/i })).toBeInTheDocument();
    expect(within(previewDialog).getByText(/Streaming now/i)).toBeInTheDocument();

    mediaPlayMock.mockResolvedValueOnce(undefined);
    fireEvent.click(within(previewDialog).getByRole("button", { name: /Play media/i }));

    await waitFor(() => expect(mediaPlayMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(previewDialog).queryByText(/Autoplay was blocked by the browser/i)).not.toBeInTheDocument());
  });


  it("retries interrupted media streams with bounded backoff and then offers manual retry", async () => {
    let fakeTimersEnabled = false;
    try {
      const account = buildAccount("alpha", { displayName: "Retry streaming workspace" });
      seedAccounts([{ account, session: buildSession(account) }], account.id);
      mockedApi.listFiles.mockResolvedValue({
        path: "",
        items: [
          { path: "Projects/a-photo.png", name: "a-photo.png", isFolder: false, size: 12, mimeType: "image/png" },
          { path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 20 * 1024 * 1024, mimeType: "audio/mpeg" }
        ]
      });
      mockedApi.getFile.mockImplementation(async (path: string) => ({
        file: {
          ...textPreview,
          path,
          name: path.split("/").pop() ?? path,
          mimeType: path.endsWith(".png") ? "image/png" : "audio/mpeg",
          viewer: path.endsWith(".png") ? "image" : "audio",
          content: "",
          encoding: "none",
          bytesRead: 0,
          requiresOriginalBlob: true,
          size: 20 * 1024 * 1024
        }
      }));

      render(<App services={testServices} />);

      fireEvent.click(await screen.findByRole("button", { name: /Open file a-photo.png/i }));
      const imagePreview = await screen.findByRole("dialog", { name: /Preview a-photo.png/i });
      fireEvent.click(within(imagePreview).getByRole("button", { name: /Next media item/i }));
      const previewDialog = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
      vi.useFakeTimers();
      fakeTimersEnabled = true;
      let audio = previewDialog.querySelector("audio") as HTMLAudioElement;
      expect(audio).toHaveAttribute("src", "/api/file/stream?path=Projects%2Fsong.mp3&streamToken=stream-token-alpha");

      fireEvent.error(audio);
      expect(within(previewDialog).getByText(/Stream interrupted\. Retrying playback shortly \(1\/3\)/i)).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      audio = previewDialog.querySelector("audio") as HTMLAudioElement;
      expect(audio).toHaveAttribute("src", expect.stringContaining("streamRetry=1"));

      fireEvent.error(audio);
      expect(within(previewDialog).getByText(/Stream interrupted\. Retrying playback shortly \(2\/3\)/i)).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      audio = previewDialog.querySelector("audio") as HTMLAudioElement;
      expect(audio).toHaveAttribute("src", expect.stringContaining("streamRetry=2"));

      fireEvent.error(audio);
      expect(within(previewDialog).getByText(/Stream interrupted\. Retrying playback shortly \(3\/3\)/i)).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      audio = previewDialog.querySelector("audio") as HTMLAudioElement;
      expect(audio).toHaveAttribute("src", expect.stringContaining("streamRetry=3"));

      fireEvent.error(audio);
      expect(within(previewDialog).getByText(/Media playback could not continue after several retries/i)).toBeInTheDocument();
      fireEvent.click(within(previewDialog).getByRole("button", { name: /Retry playback/i }));
      audio = previewDialog.querySelector("audio") as HTMLAudioElement;
      expect(audio).toHaveAttribute("src", expect.stringContaining("streamRetry=4"));
      expect(within(previewDialog).queryByText(/Media playback could not continue after several retries/i)).not.toBeInTheDocument();
    } finally {
      if (fakeTimersEnabled) {
        vi.useRealTimers();
      }
    }
  });


  it("restores the last known audio position when reopening the same file for the same account", async () => {
    const account = buildAccount("alpha", { displayName: "Audio resume workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Projects/a-photo.png", name: "a-photo.png", isFolder: false, size: 12, mimeType: "image/png" },
        { path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 18, mimeType: "audio/mpeg" }
      ]
    });
    mockedApi.getFile.mockImplementation(async (path: string) => ({
      file: {
        ...textPreview,
        path,
        name: path.split("/").pop() ?? path,
        mimeType: path.endsWith(".png") ? "image/png" : "audio/mpeg",
        viewer: path.endsWith(".png") ? "image" : "audio",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true,
        size: path.endsWith(".png") ? 12 : 18
      }
    }));
    mockedApi.fetchOriginalFile.mockResolvedValue({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
      mimeType: "audio/mpeg",
      filename: "song.mp3"
    });

    render(<App services={testServices} />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file a-photo.png/i }));
    let imagePreview = await screen.findByRole("dialog", { name: /Preview a-photo.png/i });
    fireEvent.click(within(imagePreview).getByRole("button", { name: /Next media item/i }));
    const previewDialog = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
    const firstAudio = previewDialog.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(firstAudio, "currentTime", { configurable: true, writable: true, value: 37.25 });
    Object.defineProperty(firstAudio, "duration", { configurable: true, writable: true, value: 180 });
    fireEvent.timeUpdate(firstAudio);
    fireEvent.pause(firstAudio);
    expect(localStorage.getItem("davora-audio-preview-position:alpha:Projects/song.mp3")).toBe("37.25");

    fireEvent.click(within(previewDialog).getByRole("button", { name: /Back to files/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Preview song.mp3/i })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Open file a-photo.png/i }));
    imagePreview = await screen.findByRole("dialog", { name: /Preview a-photo.png/i });
    fireEvent.click(within(imagePreview).getByRole("button", { name: /Next media item/i }));
    const reopenedPreview = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
    const reopenedAudio = reopenedPreview.querySelector("audio");
    if (!(reopenedAudio instanceof HTMLAudioElement)) {
      throw new Error("Expected the reopened delayed cached audio preview to render an audio element");
    }
    Object.defineProperty(reopenedAudio, "currentTime", { configurable: true, writable: true, value: 0 });
    Object.defineProperty(reopenedAudio, "duration", { configurable: true, writable: true, value: 180 });

    fireEvent(reopenedAudio, new Event("loadedmetadata"));

    await waitFor(() => expect(reopenedAudio.currentTime).toBeCloseTo(37.25));
  });


  it("owns audio resume events when a cached source arrives after the preview opens", async () => {
    const account = buildAccount("alpha", { displayName: "Delayed cached audio workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Projects/a-photo.png", name: "a-photo.png", isFolder: false, size: 12, mimeType: "image/png" },
        { path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 18, mimeType: "audio/mpeg" }
      ]
    });
    mockedApi.getFile.mockImplementation(async (path: string) => ({
      file: {
        ...textPreview,
        path,
        name: path.split("/").pop() ?? path,
        mimeType: path.endsWith(".png") ? "image/png" : "audio/mpeg",
        viewer: path.endsWith(".png") ? "image" : "audio",
        content: "",
        encoding: "none",
        requiresOriginalBlob: true,
        size: path.endsWith(".png") ? 12 : 18
      }
    }));
    const cachedAudio = retainedFileFixture("Projects/song.mp3", {
      cachedAt: new Date().toISOString(),
      preview: buildFilePreview("Projects/song.mp3", {
        mimeType: "audio/mpeg",
        viewer: "audio",
        content: "",
        encoding: "none",
        requiresOriginalBlob: true,
        size: 18
      })
    });
    const cachedResult: Awaited<ReturnType<OpenedFileRepository["readPreview"]>> = {
      kind: "success",
      value: { file: cachedAudio, blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }) }
    };
    const deferredCachedAudio = createDeferred<Awaited<ReturnType<OpenedFileRepository["readPreview"]>>>();
    let cachedAudioAvailable = false;
    mockedRetentionRepository.readPreview.mockImplementation(async (_account, path) => {
      if (path !== "Projects/song.mp3") {
        return { kind: "success", value: undefined };
      }
      return cachedAudioAvailable ? cachedResult : deferredCachedAudio.promise;
    });

    render(<App services={testServices} />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file a-photo.png/i }));
    const photoPreview = await screen.findByRole("dialog", { name: /Preview a-photo.png/i });
    fireEvent.click(within(photoPreview).getByRole("button", { name: /Next media item/i }));
    await waitFor(() => expect(mockedRetentionRepository.readPreview).toHaveBeenCalledWith(retentionAccountFor(account), "Projects/song.mp3"));
    expect(screen.queryByRole("dialog", { name: /Preview song.mp3/i })?.querySelector("audio")).toBeFalsy();

    cachedAudioAvailable = true;
    deferredCachedAudio.resolve(cachedResult);

    const previewDialog = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
    const audio = previewDialog.querySelector("audio");
    if (!(audio instanceof HTMLAudioElement)) {
      throw new Error("Expected the delayed cached audio preview to render an audio element");
    }
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 37.25 });
    Object.defineProperty(audio, "duration", { configurable: true, writable: true, value: 180 });
    fireEvent.timeUpdate(audio);
    fireEvent.pause(audio);
    expect(localStorage.getItem("davora-audio-preview-position:alpha:Projects/song.mp3")).toBe("37.25");

    fireEvent.click(within(previewDialog).getByRole("button", { name: /Back to files/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Preview song.mp3/i })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Open file a-photo.png/i }));
    const reopenedPhotoPreview = await screen.findByRole("dialog", { name: /Preview a-photo.png/i });
    fireEvent.click(within(reopenedPhotoPreview).getByRole("button", { name: /Next media item/i }));

    const reopenedPreview = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
    const reopenedAudio = reopenedPreview.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(reopenedAudio, "currentTime", { configurable: true, writable: true, value: 0 });
    Object.defineProperty(reopenedAudio, "duration", { configurable: true, writable: true, value: 180 });
    fireEvent(reopenedAudio, new Event("loadedmetadata"));

    await waitFor(() => expect(reopenedAudio.currentTime).toBeCloseTo(37.25));
  });


  it("clears an unusable near-end audio resume position instead of pretending resume is available", async () => {
    const account = buildAccount("alpha", { displayName: "Audio resume workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    localStorage.setItem("davora-audio-preview-position:alpha:Projects/song.mp3", "179.5");
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Projects/a-photo.png", name: "a-photo.png", isFolder: false, size: 12, mimeType: "image/png" },
        { path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 18, mimeType: "audio/mpeg" }
      ]
    });
    mockedApi.getFile.mockImplementation(async (path: string) => ({
      file: {
        ...textPreview,
        path,
        name: path.split("/").pop() ?? path,
        mimeType: path.endsWith(".png") ? "image/png" : "audio/mpeg",
        viewer: path.endsWith(".png") ? "image" : "audio",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true,
        size: path.endsWith(".png") ? 12 : 18
      }
    }));
    mockedApi.fetchOriginalFile.mockResolvedValue({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
      mimeType: "audio/mpeg",
      filename: "song.mp3"
    });

    render(<App services={testServices} />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file a-photo.png/i }));
    const imagePreview = await screen.findByRole("dialog", { name: /Preview a-photo.png/i });
    fireEvent.click(within(imagePreview).getByRole("button", { name: /Next media item/i }));
    const previewDialog = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
    const audio = previewDialog.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, writable: true, value: 180 });

    fireEvent(audio, new Event("loadedmetadata"));

    expect(audio.currentTime).toBe(0);
    expect(localStorage.getItem("davora-audio-preview-position:alpha:Projects/song.mp3")).toBeNull();
  });

});
