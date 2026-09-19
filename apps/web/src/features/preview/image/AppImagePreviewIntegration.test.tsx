import { cleanup, fireEvent, render as renderTestingLibrary, screen, waitFor, within } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../../diagnostics/testing/fakes";
import { cloneElement, type ReactElement } from "react";
const { afterEach, beforeEach, describe, expect, it, vi } = await import("vitest");

import App from "../../../App";
import type { AppServices } from "../../../app/AppServices";
import { createPreviewComposition } from "../../../app/createPreviewComposition";
import { createAccountRegistryService, type AccountRegistryService } from "../../accounts/registry";
import type { AccountTransport } from "../../accounts";
import type { BrowsingCacheRepository, FolderPorts, SearchPorts } from "../../browsing";
import { createMemoryFolderSortService } from "../../browsing/folderSort/testing/fakeStorage";
import { DEFAULT_UI_SETTINGS, normalizeUiSettings } from "../../settings";
import type { ConnectivityPort } from "../../offline/connectivity";
import type { ExplicitOfflineModeRuntimePort } from "../../offline/mode";
import type { RetainedFile, RetainedRoot, RetainedSnapshot, RetentionAccount, RetentionRepository, RetentionResult } from "../../offline/retention";
import type { OperationRuntimePort } from "../../operations/workspace";
import { WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT, type ResponsiveViewportPort } from "../../navigation/viewport";
import * as heicPreview from "../../../lib/heicPreview";
import type { PreviewTransport } from "../../../platform/preview/browserPreviewAdapters";
type ConnectedAccount = ReturnType<AccountRegistryService["getState"]>["snapshot"]["accounts"][number]["account"];

type FileEntry = Parameters<AppServices["favourites"]["create"]>[0];
type FilePreview = Awaited<ReturnType<PreviewTransport["getFile"]>>["file"];
type AppSession = Awaited<ReturnType<AccountTransport["createSession"]>>;
const buildAccount = (id: string, overrides: Partial<ConnectedAccount> = {}): ConnectedAccount => ({ id, type: "nextcloud", displayName: `Account ${id}`, label: `Account ${id}`, baseUrl: `https://${id}.example.com`, username: `${id}-user`, rootPath: ".davora-agent-test", backend: "mock", connectionState: "connected", lastValidatedAt: "2026-05-21T10:00:00.000Z", cacheNamespace: `ns-${id}`, ...overrides });
const buildSession = (account: ConnectedAccount, overrides: Partial<AppSession> = {}): AppSession => ({ token: `token-${account.id}`, expiresAt: "2099-01-01T00:00:00.000Z", rootPath: account.rootPath, capabilities: { backend: account.backend, readOnly: false, search: true, preview: true, download: true, offlineCache: true, createFolder: true, upload: true, move: true, copy: true, delete: true, mediaPreview: true, markdownPreview: true, openedFileCache: true }, account, ...overrides });
const buildHealthResponse = (): Awaited<ReturnType<AccountTransport["getHealth"]>> => ({ app: "davora", configLoaded: true, backend: "mock", rootPath: ".davora-agent-test", unlockRequired: false, connectionMode: "in_app", supportedAccountTypes: ["nextcloud"] });

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({ offlineReady: [false, vi.fn()], needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn(async () => undefined) })
}));
vi.mock("../../../lib/heicPreview", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/heicPreview")>("../../../lib/heicPreview");
  return { ...actual, decodeHeicPreview: vi.fn() };
});

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
const mockedHeicPreview = vi.mocked(heicPreview);
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

function createStorage() {
  return {
    readItem: (key: string) => ({ ok: true as const, value: localStorage.getItem(key) }),
    writeItem: (key: string, value: string) => { localStorage.setItem(key, value); return { ok: true as const }; },
    deleteItem: (key: string) => { localStorage.removeItem(key); return { ok: true as const }; }
  };
}
function retentionAccountFor(account: ConnectedAccount): RetentionAccount { return { accountId: account.id, cacheNamespace: account.cacheNamespace }; }
function retainedFileFixture(path: string, options: Partial<RetainedFile> = {}): RetainedFile { return { path, name: path.split("/").at(-1) ?? path, mimeType: "text/plain", size: 0, blobSize: 0, readable: true, normalCacheOwnership: "none", ...options }; }
function seedRetentionSnapshot(account: ConnectedAccount, input: Omit<RetainedSnapshot, "account">) { retentionFixture.seed(retentionAccountFor(account), input); }
function expectPreviewWritten(path?: string): Parameters<RetentionRepository["writePreview"]> {
  const calls = mockedRetentionRepository.writePreview.mock.calls;
  const call = calls.find(([, input]) => path === undefined || input.file.path === path);
  expect(call).toBeDefined();
  if (!call) throw new Error(`Expected a preview write${path === undefined ? "" : ` for ${path}`}.`);
  return call;
}

function createImageFixture(): AppServices {
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
  cleanup(); localStorage.clear(); window.history.replaceState(null, "", "/"); Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) });
  Object.defineProperty(URL, "createObjectURL", { value: createObjectUrlMock, configurable: true, writable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectUrlMock, configurable: true, writable: true });
  testServices = createImageFixture(); retentionFixture.reset(); vi.clearAllMocks();
  mockedApi.getHealth.mockResolvedValue(healthResponse);
  mockedApi.connectAccount.mockImplementation(async (request) => ({ kind: "http-success", data: { account: buildAccount(request.accountId ?? "connected", { displayName: request.label?.trim() || `${request.username}@${new URL(request.baseUrl).hostname}`, label: request.label, baseUrl: request.baseUrl, username: request.username, rootPath: request.rootPath ?? "", cacheNamespace: request.cacheNamespace ?? `ns-${request.accountId ?? "connected"}` }) } }));
  mockedApi.createSession.mockImplementation(async ({ accountId }) => buildSession(buildAccount(accountId)));
  mockedApi.deleteConnectedAccount.mockResolvedValue(undefined);
  mockedApi.listFiles.mockResolvedValue({ path: "", items: [] });
  mockedApi.getFile.mockResolvedValue({ file: textPreview });
  mockedApi.fetchOriginalFile.mockResolvedValue({ blob: new Blob(["binary"], { type: "image/png" }), mimeType: "image/png", filename: "photo.png" });
  mockedApi.createStreamingFileUrl.mockResolvedValue("blob:stream");
  mockedApi.triggerBrowserDownload.mockImplementation(() => undefined);
  mockedHeicPreview.decodeHeicPreview.mockResolvedValue({ blob: new Blob(["jpeg"], { type: "image/jpeg" }), width: 1200, height: 900, mimeType: "image/jpeg" });
});
afterEach(() => cleanup());

describe("image preview App integration", () => {
  it("shows an image preview fallback instead of a broken browser image affordance", async () => {
    const account = buildAccount("alpha", { displayName: "Image preview workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Archive/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Archive/photo.png",
        name: "photo.png",
        mimeType: "image/png",
        viewer: "image",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true
      }
    });
    mockedApi.fetchOriginalFile.mockResolvedValue({
      blob: new Blob(["not-a-real-png"], { type: "image/png" }),
      mimeType: "image/png",
      filename: "photo.png"
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.png/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview photo.png/i });
    const image = await within(previewDialog).findByAltText("photo.png");
    fireEvent.error(image);

    await waitFor(() => expect(within(previewDialog).getByText(/Image preview is unavailable right now/i)).toBeInTheDocument());
    expect(within(previewDialog).queryByAltText("photo.png")).not.toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Open or download original file/i })).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Download file/i })).toBeInTheDocument();
  });

  it("lets image previews switch between immersive fill and whole-image fit", async () => {
    const account = buildAccount("alpha", { displayName: "Image fit workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Archive/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Archive/photo.png",
        name: "photo.png",
        mimeType: "image/png",
        viewer: "image",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true
      }
    });
    mockedApi.fetchOriginalFile.mockResolvedValue({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      mimeType: "image/png",
      filename: "photo.png"
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.png/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview photo.png/i });
    expect(within(previewDialog).getByRole("button", { name: /Back to files/i })).toHaveTextContent("Back to Archive");
    const image = await within(previewDialog).findByAltText("photo.png");
    expect(image).toHaveClass("media-preview-image-fill");

    const fitButton = within(previewDialog).getByRole("button", { name: /Fit entire image/i });
    expect(fitButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(fitButton);

    expect(image).toHaveClass("media-preview-image-fit");
    expect(within(previewDialog).getByRole("button", { name: /Fill preview area/i })).toHaveAttribute("aria-pressed", "false");
    expect(JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}")).toMatchObject({ imagePreviewFitMode: "fit" });

    const originalSizeButton = within(previewDialog).getByRole("button", { name: /Show image at original size/i });
    fireEvent.click(originalSizeButton);

    expect(image).toHaveClass("media-preview-image-zoomed");
    expect(originalSizeButton).toHaveAttribute("aria-pressed", "true");
    expect(within(previewDialog).getByRole("button", { name: /Fill preview area/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps experimental HEIC preview disabled by default and persists enabling it", async () => {
    const account = buildAccount("alpha", { displayName: "Settings workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));

    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    const heicToggle = within(settingsDialog).getByLabelText(/Enable experimental HEIC preview/i);
    expect(heicToggle).not.toBeChecked();

    fireEvent.click(heicToggle);

    expect(heicToggle).toBeChecked();
    expect(JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}")).toMatchObject({ experimentalHeicPreviewEnabled: true });
    expect(screen.getByText(/Experimental HEIC preview is enabled for this browser/i)).toBeInTheDocument();
  });

  it("shows HEIC fallback without downloading or decoding when the experiment is disabled", async () => {
    const account = buildAccount("alpha", { displayName: "HEIC fallback workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Archive/photo.heic", name: "photo.heic", isFolder: false, size: 12, mimeType: "image/heic" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Archive/photo.heic",
        name: "photo.heic",
        mimeType: "image/heic",
        viewer: "image",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true
      }
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.heic/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview photo.heic/i });
    expect(within(previewDialog).getByText(/HEIC preview is experimental and disabled/i)).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Open or download original file/i })).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Download file/i })).toBeInTheDocument();
    expect(mockedApi.fetchOriginalFile).not.toHaveBeenCalled();
    expect(mockedHeicPreview.decodeHeicPreview).not.toHaveBeenCalled();
    expect(mockedApi.triggerBrowserDownload).not.toHaveBeenCalled();
  });

  it("decodes HEIC locally when the experiment is enabled and preserves original-file actions", async () => {
    localStorage.setItem("davora-ui-settings", JSON.stringify({ experimentalHeicPreviewEnabled: true }));
    const account = buildAccount("alpha", { displayName: "HEIC preview workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const heicBlob = new Blob(["heic"], { type: "image/heic" });
    const jpegBlob = new Blob(["jpeg"], { type: "image/jpeg" });
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Archive/photo.heic", name: "photo.heic", isFolder: false, size: 12, mimeType: "image/heic" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Archive/photo.heic",
        name: "photo.heic",
        mimeType: "image/heic",
        viewer: "image",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true
      }
    });
    mockedApi.fetchOriginalFile.mockResolvedValue({ blob: heicBlob, mimeType: "image/heic", filename: "photo.heic" });
    mockedHeicPreview.decodeHeicPreview.mockResolvedValue({
      blob: jpegBlob,
      width: 1200,
      height: 900,
      mimeType: "image/jpeg"
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.heic/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview photo.heic/i });
    const image = await within(previewDialog).findByAltText("photo.heic");
    expect(image).toHaveAttribute("src", "blob:preview");
    expect(mockedApi.fetchOriginalFile).toHaveBeenCalledWith("Archive/photo.heic", "token-alpha", expect.any(AbortSignal));
    expect(mockedHeicPreview.decodeHeicPreview).toHaveBeenCalledWith(heicBlob);
    const [previewAccount, previewWrite] = expectPreviewWritten("Archive/photo.heic");
    expect(previewAccount).toEqual(retentionAccountFor(account));
    expect(previewWrite.blob).toBe(jpegBlob);
    expect(previewWrite.file).toMatchObject({ path: "Archive/photo.heic", mimeType: "image/jpeg" });
    expect(within(previewDialog).getByRole("button", { name: /Open or download original file/i })).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /^Download$/i })).toBeInTheDocument();
  });

  it("ignores cached HEIC image previews after the experiment is disabled", async () => {
    const account = buildAccount("alpha", { displayName: "HEIC cache workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const cachedJpeg = new Blob(["cached-jpeg"], { type: "image/jpeg" });
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Archive/photo.heic", name: "photo.heic", isFolder: false, size: 12, mimeType: "image/heic" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Archive/photo.heic",
        name: "photo.heic",
        mimeType: "image/heic",
        viewer: "image",
        content: "",
        encoding: "none",
        bytesRead: 0,
        size: 12,
        requiresOriginalBlob: true
      }
    });
    seedRetentionSnapshot(account, { normalCache: { itemCount: 1, totalBytes: cachedJpeg.size, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [retainedFileFixture("Archive/photo.heic", { preview: { ...textPreview, path: "Archive/photo.heic", name: "photo.heic", mimeType: "image/heic", viewer: "image", content: "", encoding: "none", bytesRead: 0, size: 12, requiresOriginalBlob: true }, mimeType: "image/jpeg", blobSize: cachedJpeg.size, normalCacheOwnership: "owned", cachedAt: new Date().toISOString(), lastAccessedAt: new Date().toISOString() })], memberships: [] });
    retentionFixture.seed(retentionAccountFor(account), { normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [], memberships: [] }, { "Archive/photo.heic": cachedJpeg });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.heic/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview photo.heic/i });
    expect(await within(previewDialog).findByText(/HEIC preview is experimental and disabled/i)).toBeInTheDocument();
    expect(within(previewDialog).queryByAltText("photo.heic")).not.toBeInTheDocument();
    expect(mockedApi.fetchOriginalFile).not.toHaveBeenCalled();
    expect(mockedHeicPreview.decodeHeicPreview).not.toHaveBeenCalled();
  });

  it("falls back cleanly when experimental HEIC decode fails a guard or decoder error", async () => {
    localStorage.setItem("davora-ui-settings", JSON.stringify({ experimentalHeicPreviewEnabled: true }));
    const account = buildAccount("alpha", { displayName: "HEIC failure workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Archive/huge.heic", name: "huge.heic", isFolder: false, size: 64 * 1024 * 1024, mimeType: "image/heic" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Archive/huge.heic",
        name: "huge.heic",
        mimeType: "image/heic",
        viewer: "image",
        content: "",
        encoding: "none",
        bytesRead: 0,
        size: 64 * 1024 * 1024,
        requiresOriginalBlob: true
      }
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file huge.heic/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview huge.heic/i });
    expect(await within(previewDialog).findByText(/HEIC preview is limited to files up to 25 MB/i)).toBeInTheDocument();
    expect(within(previewDialog).queryByAltText("huge.heic")).not.toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Open or download original file/i })).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Download file/i })).toBeInTheDocument();
    expect(mockedApi.fetchOriginalFile).not.toHaveBeenCalled();
    expect(mockedHeicPreview.decodeHeicPreview).not.toHaveBeenCalled();
    expect(mockedRetentionRepository.writePreview.mock.calls.some(([, input]) => input.file.path === "Archive/huge.heic")).toBe(false);
  });

  it("falls back cleanly when experimental HEIC decoding fails after fetching the original", async () => {
    localStorage.setItem("davora-ui-settings", JSON.stringify({ experimentalHeicPreviewEnabled: true }));
    const account = buildAccount("alpha", { displayName: "HEIC decode error workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const heicBlob = new Blob(["bad-heic"], { type: "image/heic" });
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Archive/bad.heic", name: "bad.heic", isFolder: false, size: 12, mimeType: "image/heic" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Archive/bad.heic",
        name: "bad.heic",
        mimeType: "image/heic",
        viewer: "image",
        content: "",
        encoding: "none",
        bytesRead: 0,
        size: 12,
        requiresOriginalBlob: true
      }
    });
    mockedApi.fetchOriginalFile.mockResolvedValue({ blob: heicBlob, mimeType: "image/heic", filename: "bad.heic" });
    mockedHeicPreview.decodeHeicPreview.mockRejectedValue(new Error("Decoder rejected this image."));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file bad.heic/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview bad.heic/i });
    expect(await within(previewDialog).findByText(/HEIC preview could not be decoded locally: Decoder rejected this image/i)).toBeInTheDocument();
    expect(within(previewDialog).queryByAltText("bad.heic")).not.toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Open or download original file/i })).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Download file/i })).toBeInTheDocument();
    expect(mockedApi.fetchOriginalFile).toHaveBeenCalledWith("Archive/bad.heic", "token-alpha", expect.any(AbortSignal));
    expect(mockedHeicPreview.decodeHeicPreview).toHaveBeenCalledWith(heicBlob);
    expect(mockedRetentionRepository.writePreview.mock.calls.some(([, input]) => input.file.path === "Archive/bad.heic")).toBe(false);
  });
});
