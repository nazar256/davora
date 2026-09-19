
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppSession, ConnectedAccount, FileEntry, FilePreview, HealthResponse, MutationResult, SessionRequest } from "@davora/shared";
import App from "../../../App";
import type { AppServices } from "../../../app/AppServices";
import { createPreviewComposition } from "../../../app/createPreviewComposition";
import type { AppShellProps } from "../../../app/AppShell";
import type { PreviewModalStageProps } from "../../../features/preview/shell/PreviewModalStage";
import { createAccountRegistryService, type AccountRegistryService, type AccountRegistryStorage } from "../../../features/accounts/registry";
import type { AccountTransport } from "../../../features/accounts/transport/ports";
import type { AccountSessionPorts } from "../../../features/accounts/session/ports";
import type { BrowsingCacheRepository, FavouriteEntry, FavouritesService } from "../../../features/browsing";
import type { FolderLoadOutcome } from "../../../features/browsing/folder/ports";
import type { SearchLoadOutcome } from "../../../features/browsing/search/ports";
import type { FavouritesPointerEnvironment } from "../../../features/browsing/favourites/ports";
import type { HistoryPort } from "../../../features/navigation/ports";
import { WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT, type ResponsiveViewportPort } from "../../../features/navigation/viewport/ports";
import type { PullToRefreshEnvironmentPort } from "../../../features/navigation/pullToRefresh/ports";
import { ONLINE_CONNECTIVITY_SNAPSHOT } from "../../../features/offline/connectivity/ports";
import type { ConnectivityPort } from "../../../features/offline/connectivity/ports";
import type { ExplicitOfflineModeRuntimePort } from "../../../features/offline/mode/ports";
import type { RetainedSnapshot, RetentionAccount, RetentionRepository, RetentionResult } from "../../../features/offline/retention";
import { retainedRootId } from "../../../features/offline/retention";
import { DEFAULT_UI_SETTINGS, type SettingsService } from "../../../features/settings";
import type { TransferClock } from "../../../features/transfers/ports";
import type { OperationRuntimePort } from "../../../features/operations/workspace/ports";
import type { BrowserOfflineSyncRuntime } from "../../../platform/offline/browserOfflineSyncRuntime";
import type { AccountRemovalRuntimePort } from "../../../app/createAccountRemovalRuntime";
import { ApiRequestError } from "../../../lib/api";
import { buildAccount, buildSession } from "../../../test/accounts";
import { buildHealthResponse } from "../../../test/api";
import { buildFileEntry, buildFilePreview } from "../../../test/files";
import { createDeferred } from "../../../test/primitives";

const appShellCapture = vi.hoisted(() => ({ latest: undefined as AppShellProps | undefined, history: [] as AppShellProps[] }));
vi.mock("../../../app/AppShell", async () => {
  const actualAppShell = await vi.importActual<typeof import("../../../app/AppShell")>("../../../app/AppShell");
  return { ...actualAppShell, AppShell: (props: AppShellProps) => { appShellCapture.latest = props; appShellCapture.history.push(props); return <actualAppShell.AppShell {...props} />; } };
});
vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: vi.fn(() => ({ offlineReady: [false, vi.fn()], needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn(async () => undefined) })) }));
const matchMediaMock = vi.fn((query?: string) => ({ matches: false, media: query ?? "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }));

type GetFile = (path: string, token: string, signal?: AbortSignal) => Promise<{ file: FilePreview }>;
type FetchOriginalFile = (path: string, token: string, signal?: AbortSignal) => Promise<{ blob: Blob; mimeType: string; filename: string }>;
type CreateStreamingFileUrl = (path: string, token: string, signal?: AbortSignal) => Promise<string>;
type ListFiles = (path: string, token: string, signal?: AbortSignal) => Promise<{ path: string; items: FileEntry[] }>;
type CreateSession = (request: SessionRequest) => Promise<AppSession>;
type PreviewApiSpies = { getFile: ReturnType<typeof vi.fn<GetFile>>; fetchOriginalFile: ReturnType<typeof vi.fn<FetchOriginalFile>>; createStreamingFileUrl: ReturnType<typeof vi.fn<CreateStreamingFileUrl>>; listFiles: ReturnType<typeof vi.fn<ListFiles>>; createSession: ReturnType<typeof vi.fn<CreateSession>>; };
const mockedApi: PreviewApiSpies = {
  getFile: vi.fn(), fetchOriginalFile: vi.fn(), createStreamingFileUrl: vi.fn(), listFiles: vi.fn(), createSession: vi.fn()
};
const createObjectUrlMock = vi.fn(() => "blob:preview");
const revokeObjectUrlMock = vi.fn();
const originalCreateObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

type RetentionStore = { snapshot: RetainedSnapshot; blobs: Map<string, Blob> };
const retentionStores = new Map<string, RetentionStore>();
const emptyRetentionSnapshot = (account: RetentionAccount): RetainedSnapshot => ({ account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [], memberships: [] });
const retentionStore = (account: RetentionAccount): RetentionStore => {
  const existing = retentionStores.get(account.cacheNamespace);
  if (existing) return existing;
  const created = { snapshot: emptyRetentionSnapshot(account), blobs: new Map<string, Blob>() };
  retentionStores.set(account.cacheNamespace, created);
  return created;
};
const retentionSuccess = <T,>(value: T): RetentionResult<T> => ({ kind: "success", value });
type RetentionWritePreview = RetentionRepository["writePreview"];
type RetentionPersistFile = RetentionRepository["persistRetainedFile"];
const mockedRetentionRepository: RetentionRepository & { readonly writePreview: ReturnType<typeof vi.fn<RetentionWritePreview>>; readonly persistRetainedFile: ReturnType<typeof vi.fn<RetentionPersistFile>> } = {
  readSnapshot: async (account) => retentionSuccess(retentionStore(account).snapshot),
  readPreview: async (account, path) => { const store = retentionStore(account); const file = store.snapshot.files.find((candidate) => candidate.path === path); return retentionSuccess(file ? { file, blob: store.blobs.get(path) } : undefined); },
  writePreview: vi.fn<RetentionWritePreview>(async (account, input) => { const store = retentionStore(account); const files = store.snapshot.files.filter((file) => file.path !== input.file.path); store.snapshot = { ...store.snapshot, files: [...files, input.file] }; if (input.blob) store.blobs.set(input.file.path, input.blob); return retentionSuccess(store.snapshot); }),
  beginRoot: async (account, _input) => retentionSuccess(retentionStore(account).snapshot),
  persistRetainedFile: vi.fn<RetentionPersistFile>(async (account, _input) => retentionSuccess(retentionStore(account).snapshot)),
  completeRoot: async (account) => retentionSuccess(retentionStore(account).snapshot),
  removeRoot: async (account) => retentionSuccess(retentionStore(account).snapshot),
  clearNormalCache: async (account) => retentionSuccess(retentionStore(account).snapshot),
  purgeAccountNamespace: async (account) => { retentionStores.delete(account.cacheNamespace); return retentionSuccess(emptyRetentionSnapshot(account)); },
  configureNormalCacheLimit: async (account, limitBytes) => { const store = retentionStore(account); store.snapshot = { ...store.snapshot, normalCache: { ...store.snapshot.normalCache, limitBytes } }; return retentionSuccess(store.snapshot); }
};
const retentionFixture = {
  repository: mockedRetentionRepository,
  reset: () => { retentionStores.clear(); },
  seed: (account: RetentionAccount, snapshot: Omit<RetainedSnapshot, "account">, blobs?: Record<string, Blob | undefined>) => { const store = retentionStore(account); if (blobs && Object.keys(blobs).length > 0) { retentionFixture.addBlobs(account, blobs); return; } store.snapshot = { account, ...snapshot }; },
  addBlobs: (account: RetentionAccount, blobs: Record<string, Blob | undefined>) => { const store = retentionStore(account); for (const [path, blob] of Object.entries(blobs)) if (blob) store.blobs.set(path, blob); }
};

const previewTransport = {
  getFile: (path: string, token: string, requestSignal?: AbortSignal) => mockedApi.getFile(path, token, requestSignal),
  fetchOriginalFile: (path: string, token: string, requestSignal?: AbortSignal) => mockedApi.fetchOriginalFile(path, token, requestSignal),
  createStreamingFileUrl: (path: string, token: string, requestSignal?: AbortSignal) => mockedApi.createStreamingFileUrl(path, token, requestSignal)
};
const folderPorts = {
  createAbortHandle: () => { const controller = new AbortController(); return { signal: controller.signal, abort: () => controller.abort() }; },
  loadFolder: async ({ path, token, signal }: { path: string; token: string; signal: AbortSignal }): Promise<FolderLoadOutcome> => { try { const result = await mockedApi.listFiles(path, token, signal); return { kind: "success", items: result.items }; } catch (error) { return { kind: "failure", error: error instanceof Error ? error : new Error(String(error)) }; } },
  readCachedFolder: () => undefined,
  writeCachedFolder: () => undefined
};
const searchPorts = {
  createAbortHandle: () => { const controller = new AbortController(); return { signal: controller.signal, abort: () => controller.abort() }; },
  loadSearch: async ({ path, token, signal }: { path: string; query: string; token: string; signal: AbortSignal }): Promise<SearchLoadOutcome> => { try { const result = await mockedApi.listFiles(path, token, signal); return { kind: "success", items: result.items.map((item) => ({ ...item, score: 0, matches: [] })) }; } catch (error) { return { kind: "failure", error: error instanceof Error ? error : new Error(String(error)) }; } },
  readCachedSearch: () => undefined,
  writeCachedSearch: () => undefined
};
const accountTransportFor = (): AccountTransport => ({
  getHealth: async (): Promise<HealthResponse> => buildHealthResponse(),
  connectAccount: async () => { throw new Error("connect not used by preview contracts"); },
  createSession: (request) => mockedApi.createSession(request),
  deleteConnectedAccount: async () => undefined
});
const storageFor = (): AccountRegistryStorage => ({ readItem: (key) => ({ ok: true, value: localStorage.getItem(key) }), writeItem: (key, value) => { localStorage.setItem(key, value); return { ok: true, value: undefined }; }, deleteItem: (key) => { localStorage.removeItem(key); return { ok: true, value: undefined }; } });
const browsingCache: BrowsingCacheRepository = { readFolder: () => ({ kind: "miss" }), writeFolder: () => ({ kind: "written" }), readSearch: () => ({ kind: "miss" }), writeSearch: () => ({ kind: "written" }), clearNamespace: () => ({ kind: "cleared" }), clearFolderPath: () => ({ kind: "cleared" }), clearNamespaceOrThrow: () => undefined, clearFolderPathOrThrow: () => undefined };
const favourites: FavouritesService = { load: () => ({ kind: "loaded", entries: [] }), save: (_account, entries) => ({ kind: "saved", entries: [...entries] }), clear: () => ({ kind: "cleared" }), create: (entry, account): FavouriteEntry => ({ ...entry, accountId: account.id, accountBackend: account.backend, accountRootPath: account.rootPath, cacheNamespace: account.cacheNamespace, addedAt: new Date().toISOString() }) };
const pointerEnvironment: FavouritesPointerEnvironment = { elementFromPoint: () => null, addWindowListener: () => () => undefined };
const connectivity: ConnectivityPort = { read: () => ONLINE_CONNECTIVITY_SNAPSHOT, subscribe: () => () => undefined };
const historyPort: HistoryPort = { pushState: (_state, url) => { if (url) history.pushState(null, "", url); }, replaceState: (_state, url) => { if (url) history.replaceState(null, "", url); }, getState: () => null, getLocation: () => ({ href: location.href, search: location.search }), subscribe: () => () => undefined };
const viewport: ResponsiveViewportPort = { getSnapshot: () => WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT, subscribe: () => () => undefined };
const pullToRefresh: PullToRefreshEnvironmentPort = { getWindowScrollY: () => window.scrollY };
const explicitOfflineRuntime: ExplicitOfflineModeRuntimePort = { storage: { read: () => ({ kind: "ready", enabled: false }), commit: () => ({ kind: "committed" }), reset: () => ({ kind: "committed" }), repair: () => ({ kind: "repaired" }) }, network: { setBlocked: () => undefined } };
const clock: TransferClock = { nowIso: () => new Date().toISOString() };
const operationRuntime: OperationRuntimePort = {
  request: { createAbortHandle: () => { const controller = new AbortController(); return { signal: controller.signal, abort: () => controller.abort() }; }, createTransferId: () => "preview-transfer" },
  mutation: { createFolder: async () => ({ action: "createFolder", parentPath: "", path: "" } satisfies MutationResult), deleteFile: async () => ({ action: "delete", parentPath: "", path: "" } satisfies MutationResult), uploadFile: async () => ({ action: "upload", parentPath: "", path: "" } satisfies MutationResult), copyOrMove: async () => ({ action: "copy", parentPath: "", path: "" } satisfies MutationResult), listDestination: async () => ({ items: [] }) },
  download: { prepareDownloadFile: async () => ({ blob: new Blob(), filename: "file" }), fetchDownloadBlob: async () => ({ blob: new Blob(), filename: "file" }), listFiles: async (path, token, signal) => { const result = await mockedApi.listFiles(path, token, signal); return { items: result.items }; }, triggerBrowserDownload: () => undefined, saveDownload: () => undefined },
  batch: { downloadSelectionAsZip: async () => { throw new Error("batch download not used by preview contracts"); } },
  uploadFiles: { prepare: async () => ({ kind: "failed", message: "upload not used by preview contracts" }) },
  isUnauthorized: (error) => error instanceof ApiRequestError && error.status === 401,
  isReconnectRequired: (error) => error instanceof ApiRequestError && error.code === "account_reconnect_required",
  toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback
};
const offlineSyncRuntime: BrowserOfflineSyncRuntime = { createAbortHandle: () => ({ signal: new AbortController().signal, abort: () => undefined }), createTransferId: () => "preview-sync", listFiles: async (path, token) => mockedApi.listFiles(path, token), fetchDownloadBlob: async () => ({ blob: new Blob() }), readBlobText: async (blob) => blob.text(), isUnauthorized: operationRuntime.isUnauthorized, isReconnectRequired: operationRuntime.isReconnectRequired, toErrorMessage: operationRuntime.toErrorMessage };
const accountRemovalRuntime: AccountRemovalRuntimePort = { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined };
function createPreviewSessionFixture(): AppServices {
  const accountTransport = accountTransportFor();
  const accountRegistry: AccountRegistryService = createAccountRegistryService(storageFor());
  const accountSession: AccountSessionPorts = { getHealth: accountTransport.getHealth, createSession: accountTransport.createSession, commitSession: (accountId, session) => accountRegistry.commitSession(accountId, session), markAccountReconnectRequired: (accountId) => accountRegistry.markAccountReconnectRequired(accountId), clearAccountSession: (accountId) => accountRegistry.clearAccountSession(accountId), delay: async (ms) => { await new Promise((resolve) => setTimeout(resolve, ms)); } };
  const previewRuntime = createPreviewComposition({ retentionRepository: mockedRetentionRepository, previewTransport });
  const services = { accountRegistry, accountTransport, accountSession, browsingCache, favouriteResolveRuntime: { listFiles: async (path: string, token: string) => mockedApi.listFiles(path, token), cacheFolder: () => undefined }, connectivity, explicitOfflineRuntime, clock, favourites, favouritesPointerEnvironment: pointerEnvironment, folder: folderPorts, history: historyPort, pullToRefreshEnvironment: pullToRefresh, responsiveViewport: viewport, search: searchPorts, settings: { load: () => DEFAULT_UI_SETTINGS, save: (settings) => settings } satisfies SettingsService, operationRuntime, offlineSyncRuntime, retentionRepository: mockedRetentionRepository, previewRuntime, accountRemovalRuntime } satisfies AppServices;
  return services;
}
beforeEach(() => {
  cleanup();
  retentionFixture.reset();
  vi.clearAllMocks();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: createObjectUrlMock });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revokeObjectUrlMock });
  mockedApi.getFile.mockResolvedValue({ file: buildFilePreview("Projects/roadmap.txt", { size: 70, content: "normalized API preview", bytesRead: 22 }) });
  mockedApi.fetchOriginalFile.mockResolvedValue({ blob: new Blob(["original"], { type: "image/png" }), mimeType: "image/png", filename: "file" });
  mockedApi.createStreamingFileUrl.mockImplementation(async (path) => `/api/file/stream?path=${encodeURIComponent(path)}&streamToken=stream-token-alpha`);
  mockedApi.listFiles.mockResolvedValue({ path: "", items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] });
  mockedApi.createSession.mockImplementation(async (request) => buildSession(buildAccount(request.accountId)));
  appShellCapture.latest = undefined;
  appShellCapture.history.length = 0;
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: matchMediaMock });
});
afterEach(() => { cleanup(); localStorage.clear(); history.replaceState(null, "", "/"); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); if (originalCreateObjectURLDescriptor) Object.defineProperty(URL, "createObjectURL", originalCreateObjectURLDescriptor); else Reflect.deleteProperty(URL, "createObjectURL"); if (originalRevokeObjectURLDescriptor) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectURLDescriptor); else Reflect.deleteProperty(URL, "revokeObjectURL"); appShellCapture.latest = undefined; appShellCapture.history.length = 0; });

function seedAccounts(records: Array<{ account: ConnectedAccount; session?: { token: string; expiresAt: string; rootPath: string; capabilities: AppSession["capabilities"] }; pendingRemoval?: { phase: "revoke" | "purge" }; pendingReconnect?: { baseUrl: string; username: string; label?: string } }>, activeAccountId?: string) {
  localStorage.setItem("davora-account-state", JSON.stringify({
    activeAccountId: activeAccountId ?? records[0]?.account.id,
    accounts: records
  }));
}

type CapturedPreviewStage = Extract<AppShellProps, { kind: "workspace" }>['overlays']['preview'];
type PreviewStageExpectation = {
  readonly open: boolean;
  readonly accountId: string | undefined;
  readonly entry: FileEntry | undefined;
  readonly file: FilePreview | undefined;
  readonly blobUrl: string | undefined;
  readonly offline: boolean;
  readonly workerUnavailable: boolean;
  readonly loading: boolean;
  readonly errorMessage: string | undefined;
  readonly token: string | undefined;
  readonly cacheState: CapturedPreviewStage["cacheState"];
  readonly fileSizeDisplayMode: PreviewModalStageProps["fileSizeDisplayMode"];
  readonly imageFitMode: PreviewModalStageProps["imageFitMode"];
  readonly maxCacheableFileSizeBytes: number;
  readonly ports: "browser-modal-runtime";
  readonly onApplyRefresh: "defined" | "undefined";
  readonly onDownload: "defined" | "undefined";
  readonly onPrevious: "defined" | "undefined";
  readonly onNext: "defined" | "undefined";
  readonly onMediaPlaybackChange: "defined" | "undefined";
  readonly onImageFitModeChange: "defined" | "undefined";
  readonly onClose: "defined" | "undefined";
};

function expectCompleteCapturedPreviewStage(preview: CapturedPreviewStage, expected: PreviewStageExpectation): void {
  for (const field of [
    "open", "accountId", "entry", "file", "blobUrl", "offline", "workerUnavailable", "loading", "error", "token",
    "cacheState", "fileSizeDisplayMode", "imageFitMode", "maxCacheableFileSizeBytes", "ports", "onApplyRefresh",
    "onDownload", "onPrevious", "onNext", "onMediaPlaybackChange", "onImageFitModeChange", "onClose"
  ]) {
    expect(preview, `captured preview field ${field}`).toHaveProperty(field);
  }
  expect(preview.open).toBe(expected.open);
  expect(preview.accountId).toBe(expected.accountId);
  expect(preview.entry).toEqual(expected.entry);
  expect(preview.file).toEqual(expected.file);
  expect(preview.blobUrl).toBe(expected.blobUrl);
  expect(preview.offline).toBe(expected.offline);
  expect(preview.workerUnavailable).toBe(expected.workerUnavailable);
  expect(preview.loading).toBe(expected.loading);
  expect(preview.error?.message).toBe(expected.errorMessage);
  expect(preview.token).toBe(expected.token);
  expect(preview.cacheState).toEqual(expected.cacheState);
  expect(preview.fileSizeDisplayMode).toBe(expected.fileSizeDisplayMode);
  expect(preview.imageFitMode).toBe(expected.imageFitMode);
  expect(preview.maxCacheableFileSizeBytes).toBe(expected.maxCacheableFileSizeBytes);
  const expectFunction = (value: unknown): void => expect(typeof value).toBe("function");
  const expectedPortKeys = [
    "addWindowKeydownListener", "clearAudioPreviewPosition", "clearTimeout", "getLocationHref", "loadAudioPreviewPosition",
    "pdf", "saveAudioPreviewPosition", "setTimeout", "startOriginalFileOpen", "video"
  ];
  if (Object.prototype.hasOwnProperty.call(preview.ports, "now")) expectedPortKeys.push("now");
  expect(Object.keys(preview.ports).sort()).toEqual(expectedPortKeys.sort());
  expectFunction(preview.ports.addWindowKeydownListener);
  expectFunction(preview.ports.clearAudioPreviewPosition);
  expectFunction(preview.ports.clearTimeout);
  expectFunction(preview.ports.getLocationHref);
  expectFunction(preview.ports.loadAudioPreviewPosition);
  if (Object.prototype.hasOwnProperty.call(preview.ports, "now")) expectFunction(Reflect.get(preview.ports, "now"));
  expect(Object.keys(preview.ports.pdf).sort()).toEqual(["createResizeObserver", "fetch", "getDevicePixelRatio", "loadPdfJs", "requestAnimationFrame"].sort());
  expectFunction(preview.ports.pdf.createResizeObserver);
  expectFunction(preview.ports.pdf.fetch);
  expectFunction(preview.ports.pdf.getDevicePixelRatio);
  expectFunction(preview.ports.pdf.loadPdfJs);
  expectFunction(preview.ports.pdf.requestAnimationFrame);
  expectFunction(preview.ports.saveAudioPreviewPosition);
  expectFunction(preview.ports.setTimeout);
  expectFunction(preview.ports.startOriginalFileOpen);
  expect(Object.keys(preview.ports.video).sort()).toEqual(["clearTimeout", "getLocationHref", "setTimeout"].sort());
  expectFunction(preview.ports.video.clearTimeout);
  expectFunction(preview.ports.video.getLocationHref);
  expectFunction(preview.ports.video.setTimeout);
  const callbackExpectations = [
    ["onApplyRefresh", expected.onApplyRefresh], ["onDownload", expected.onDownload], ["onPrevious", expected.onPrevious],
    ["onNext", expected.onNext], ["onMediaPlaybackChange", expected.onMediaPlaybackChange], ["onImageFitModeChange", expected.onImageFitModeChange],
    ["onClose", expected.onClose]
  ] as const;
  for (const [name, expectation] of callbackExpectations) {
    expect(typeof preview[name] === "function" ? "defined" : "undefined", name).toBe(expectation);
  }
}

function capturedStageExpectation(overrides: Partial<PreviewStageExpectation> = {}): PreviewStageExpectation {
  return {
    open: false, accountId: "alpha", entry: undefined, file: undefined, blobUrl: undefined,
    offline: false, workerUnavailable: false, loading: false, errorMessage: undefined, token: "token-alpha",
    cacheState: { source: "none", refreshing: false, stale: false, updateReady: false }, fileSizeDisplayMode: "human", imageFitMode: "fill",
    maxCacheableFileSizeBytes: 15 * 1024 * 1024, ports: "browser-modal-runtime",
    onApplyRefresh: "undefined", onDownload: "defined", onPrevious: "undefined", onNext: "undefined", onMediaPlaybackChange: "defined", onImageFitModeChange: "defined", onClose: "defined",
    ...overrides
  };
}

function browseStatusText(): string {
  return document.querySelector(".browse-status-note")?.textContent ?? "";
}

const textPreview = buildFilePreview("Projects/roadmap.txt", {
  size: 70,
  content: "normalized API preview",
  bytesRead: 22
});

function expectedStageEntry(path: string, mimeType: string, size: number): FileEntry {
  return buildFileEntry(path, { mimeType, size });
}

function expectedStageTextFile(path: string, content: string): FilePreview {
  return buildFilePreview(path, { size: 70, content, bytesRead: 22 });
}

function expectedStageMediaFile(path: string, mimeType: string, viewer: "image" | "audio", size: number): FilePreview {
  return buildFilePreview(path, {
    mimeType,
    size,
    viewer,
    content: "",
    encoding: "none",
    requiresOriginalBlob: true
  });
}

function retentionAccountFor(account: ConnectedAccount): RetentionAccount {
  return { accountId: account.id, cacheNamespace: account.cacheNamespace };
}

function retainedFileFixture(path: string, options: Partial<RetainedSnapshot["files"][number]> = {}) {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    mimeType: "text/plain",
    size: 0,
    blobSize: 0,
    readable: true,
    normalCacheOwnership: "none" as const,
    ...options
  };
}

function retainedRootFixture(input: { rootPath: string; rootName?: string; kind?: "file" | "folder" | "batch"; folderRoots?: readonly string[]; status?: "incomplete" | "complete"; addedAt?: string }) {
  const kind = input.kind ?? "file";
  return {
    id: retainedRootId({ kind, rootPath: input.rootPath }),
    rootPath: input.rootPath,
    rootName: input.rootName ?? input.rootPath.split("/").at(-1) ?? input.rootPath,
    kind,
    folderRoots: input.folderRoots ?? [],
    status: input.status ?? "complete",
    addedAt: input.addedAt ?? "2026-07-14T08:00:00.000Z"
  };
}

function seedRetentionSnapshot(account: ConnectedAccount, input: Omit<RetainedSnapshot, "account">) {
  retentionFixture.seed(retentionAccountFor(account), input);
}

function expectRetainedFilePersisted(path?: string) {
  const call = mockedRetentionRepository.persistRetainedFile.mock.calls.find(([, input]) => path === undefined || input.file.path === path);
  expect(call).toBeDefined();
  return call;
}


void browseStatusText;
void retainedRootFixture;
void expectRetainedFilePersisted;

it("keeps cached preview visible until the user applies the refreshed version", async () => {
    const account = buildAccount("alpha", { displayName: "Preview cache workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    const previewRefresh = createDeferred<{ file: FilePreview }>();
    const cachedBlob = new Blob(["cached preview"], { type: "text/plain" });
    seedRetentionSnapshot(account, { normalCache: { itemCount: 1, totalBytes: 22, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [retainedFileFixture(textPreview.path, { preview: { ...textPreview, content: "cached preview" }, blobSize: 22, normalCacheOwnership: "owned", cachedAt: "2026-05-21T10:00:00.000Z", lastAccessedAt: "2026-05-21T10:00:00.000Z" })], memberships: [] });
    retentionFixture.seed(retentionAccountFor(account), { normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [], memberships: [] }, { [textPreview.path]: cachedBlob });
    mockedApi.getFile.mockImplementationOnce(async () => previewRefresh.promise);

    render(<App services={createPreviewSessionFixture()} />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file roadmap.txt/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview roadmap.txt/i });
    await waitFor(() => expect(within(previewDialog).getByText("cached preview")).toBeInTheDocument());
    expect(within(previewDialog).getByText(/Showing cached preview/i)).toBeInTheDocument();
    const refreshingWorkspace = [...appShellCapture.history].reverse().find((props) => props.kind === "workspace");
    if (!refreshingWorkspace || refreshingWorkspace.kind !== "workspace") throw new Error("Expected refreshing workspace capture");
    const refreshingPreview = refreshingWorkspace.overlays.preview;
    expectCompleteCapturedPreviewStage(refreshingPreview, capturedStageExpectation({ open: true, entry: expectedStageEntry("Projects/roadmap.txt", "text/plain", 70), file: expectedStageTextFile("Projects/roadmap.txt", "cached preview"), blobUrl: undefined, cacheState: { source: "cache", cachedAt: "2026-05-21T10:00:00.000Z", refreshing: true, stale: false, updateReady: false }, loading: false, onApplyRefresh: "undefined" }));
    expect(refreshingPreview.cacheState).toMatchObject({ source: "cache", refreshing: true, updateReady: false });
    expect(refreshingPreview.onApplyRefresh).toBeUndefined();

    previewRefresh.resolve({ file: { ...textPreview, content: "fresh preview" } });

    await waitFor(() => expect(within(previewDialog).getByRole("button", { name: /Apply refreshed version/i })).toBeInTheDocument());
    const refreshReadyWorkspace = [...appShellCapture.history].reverse().find((props) => props.kind === "workspace");
    if (!refreshReadyWorkspace || refreshReadyWorkspace.kind !== "workspace") throw new Error("Expected refresh-ready workspace capture");
    const refreshReadyPreview = refreshReadyWorkspace.overlays.preview;
    expectCompleteCapturedPreviewStage(refreshReadyPreview, capturedStageExpectation({ open: true, entry: expectedStageEntry("Projects/roadmap.txt", "text/plain", 70), file: expectedStageTextFile("Projects/roadmap.txt", "cached preview"), blobUrl: undefined, cacheState: { source: "cache", cachedAt: "2026-05-21T10:00:00.000Z", refreshing: false, stale: true, updateReady: true }, loading: false, onApplyRefresh: "defined" }));
    expect(refreshReadyPreview.cacheState).toMatchObject({ source: "cache", refreshing: false, stale: true, updateReady: true });
    expect(typeof refreshReadyPreview.onApplyRefresh).toBe("function");
    const capturedApplyRefresh = refreshReadyPreview.onApplyRefresh;
    await act(async () => { capturedApplyRefresh?.(); });
    await waitFor(() => expect(within(previewDialog).getByText("fresh preview")).toBeInTheDocument());
    expect(within(previewDialog).queryByText("cached preview")).not.toBeInTheDocument();
    const readyWorkspace = [...appShellCapture.history].reverse().find((props) => props.kind === "workspace");
    if (!readyWorkspace || readyWorkspace.kind !== "workspace") throw new Error("Expected ready workspace capture");
    expectCompleteCapturedPreviewStage(readyWorkspace.overlays.preview, capturedStageExpectation({ open: true, entry: expectedStageEntry("Projects/roadmap.txt", "text/plain", 70), file: expectedStageTextFile("Projects/roadmap.txt", "fresh preview"), blobUrl: undefined, cacheState: { source: "live", refreshing: false, stale: false, updateReady: false }, loading: false, onApplyRefresh: "undefined" }));
    expect(readyWorkspace.overlays.preview.cacheState).toMatchObject({ source: "live", refreshing: false, updateReady: false });
  })

it("shows a fresh cached preview without a noisy cached-preview notice or remote check", async () => {
    vi.setSystemTime(new Date("2026-05-21T10:00:30.000Z"));
    const account = buildAccount("alpha", { displayName: "Fresh preview workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    const cachedBlob = new Blob(["fresh cached preview"], { type: "text/plain" });
    seedRetentionSnapshot(account, { normalCache: { itemCount: 1, totalBytes: 22, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [retainedFileFixture(textPreview.path, { preview: { ...textPreview, content: "fresh cached preview" }, blobSize: 22, normalCacheOwnership: "owned", cachedAt: "2026-05-21T10:00:00.000Z", lastAccessedAt: "2026-05-21T10:00:00.000Z" })], memberships: [] });
    retentionFixture.seed(retentionAccountFor(account), { normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [], memberships: [] }, { [textPreview.path]: cachedBlob });

    render(<App services={createPreviewSessionFixture()} />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file roadmap.txt/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview roadmap.txt/i });
    await waitFor(() => expect(within(previewDialog).getByText("fresh cached preview")).toBeInTheDocument());
    expect(within(previewDialog).queryByText(/Showing cached preview/i)).not.toBeInTheDocument();
    const cachedWorkspace = [...appShellCapture.history].reverse().find((props) => props.kind === "workspace");
    if (!cachedWorkspace || cachedWorkspace.kind !== "workspace") throw new Error("Expected cached workspace capture");
    const cachedPreview = cachedWorkspace.overlays.preview;
    expectCompleteCapturedPreviewStage(cachedPreview, capturedStageExpectation({ open: true, entry: expectedStageEntry("Projects/roadmap.txt", "text/plain", 70), file: expectedStageTextFile("Projects/roadmap.txt", "fresh cached preview"), blobUrl: undefined, cacheState: { source: "cache", cachedAt: "2026-05-21T10:00:00.000Z", refreshing: false, stale: false, updateReady: false }, loading: false, onApplyRefresh: "undefined", onPrevious: "undefined", onNext: "undefined" }));
    expect(cachedPreview.open).toBe(true);
    expect(cachedPreview.loading).toBe(false);
    expect(cachedPreview.file?.content).toBe("fresh cached preview");
    expect(cachedPreview.cacheState).toMatchObject({ source: "cache", refreshing: false, updateReady: false });
    expect(cachedPreview.onApplyRefresh).toBeUndefined();
    expect(cachedPreview.onPrevious).toBeUndefined();
    expect(cachedPreview.onNext).toBeUndefined();
    expect(mockedApi.getFile).not.toHaveBeenCalledWith("Projects/roadmap.txt", "token-alpha");
  })

it("aborts a deferred preview when closed and keeps its late completion inert", async () => {
    const account = buildAccount("alpha", { displayName: "Deferred preview workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const preview = createDeferred<{ file: FilePreview }>();
    let signal: AbortSignal | undefined;
    mockedApi.getFile.mockImplementationOnce(async (_path: string, _token: string, requestSignal?: AbortSignal) => {
      signal = requestSignal;
      return preview.promise;
    });

    render(<App services={createPreviewSessionFixture()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open file roadmap.txt/i }));
    await screen.findByRole("dialog", { name: /Preview roadmap.txt/i });
    const loadingWorkspace = [...appShellCapture.history].reverse().find((props) => props.kind === "workspace");
    if (!loadingWorkspace || loadingWorkspace.kind !== "workspace") throw new Error("Expected loading workspace capture");
    const loadingPreview = loadingWorkspace.overlays.preview;
    expectCompleteCapturedPreviewStage(loadingPreview, capturedStageExpectation({ open: true, entry: expectedStageEntry("Projects/roadmap.txt", "text/plain", 70), file: undefined, loading: true, blobUrl: undefined, onApplyRefresh: "undefined" }));
    expect(loadingPreview.open).toBe(true);
    expect(loadingPreview.loading).toBe(true);
    expect(loadingPreview.file).toBeUndefined();
    expect(loadingPreview.onApplyRefresh).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: /Back to files/i }));

    await waitFor(() => expect(signal?.aborted).toBe(true));
    preview.resolve({ file: textPreview });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Preview roadmap.txt/i })).not.toBeInTheDocument());
    const closedWorkspace = [...appShellCapture.history].reverse().find((props) => props.kind === "workspace");
    if (!closedWorkspace || closedWorkspace.kind !== "workspace") throw new Error("Expected closed workspace capture");
    expect(closedWorkspace.overlays.preview.open).toBe(false);
    expect(closedWorkspace.overlays.preview.file).toBeUndefined();
    expect(closedWorkspace.overlays.preview.error).toBeUndefined();
    expect(closedWorkspace.overlays.preview.onPrevious).toBeUndefined();
    expect(closedWorkspace.overlays.preview.onNext).toBeUndefined();
  })

it("routes a terminal preview session failure through account reset instead of a failed preview", async () => {
    const account = buildAccount("alpha", { displayName: "Expired preview workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.getFile.mockRejectedValueOnce(new ApiRequestError("Expired", 401));

    render(<App services={createPreviewSessionFixture()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open file roadmap.txt/i }));

    await waitFor(() => expect(screen.getByText(/Session expired\. Create a fresh session/i)).toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: /Preview roadmap.txt/i })).not.toBeInTheDocument();
  })

it("captures an ordinary failed preview Stage without stale material or update controls", async () => {
    const account = buildAccount("alpha", { displayName: "Failed preview workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.getFile.mockRejectedValueOnce(new Error("ordinary preview failure"));

    render(<App services={createPreviewSessionFixture()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open file roadmap.txt/i }));
    await waitFor(() => expect(screen.getByText("ordinary preview failure")).toBeInTheDocument());
    const failedWorkspace = [...appShellCapture.history].reverse().find((props) => props.kind === "workspace");
    if (!failedWorkspace || failedWorkspace.kind !== "workspace") throw new Error("Expected failed workspace capture");
    const failedPreview = failedWorkspace.overlays.preview;
    expectCompleteCapturedPreviewStage(failedPreview, capturedStageExpectation({ open: true, entry: expectedStageEntry("Projects/roadmap.txt", "text/plain", 70), file: undefined, errorMessage: "ordinary preview failure", loading: false, blobUrl: undefined, cacheState: { source: "none", refreshing: false, stale: false, updateReady: false }, onApplyRefresh: "undefined", onPrevious: "undefined", onNext: "undefined" }));
    expect(failedPreview.open).toBe(true);
    expect(failedPreview.loading).toBe(false);
    expect(failedPreview.error).toBeInstanceOf(Error);
    expect(failedPreview.error?.message).toBe("ordinary preview failure");
    expect(failedPreview.file).toBeUndefined();
    expect(failedPreview.blobUrl).toBeUndefined();
    expect(failedPreview.onApplyRefresh).toBeUndefined();
    expect(failedPreview.onPrevious).toBeUndefined();
    expect(failedPreview.onNext).toBeUndefined();
  })

it("keeps beta preview streaming cache publication scoped to the beta composition after an alpha-created controller switches accounts", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    seedAccounts([{ account: alpha, session: buildSession(alpha) }, { account: beta, session: buildSession(beta) }], alpha.id);
    const betaOriginal = createDeferred<{ blob: Blob; mimeType: string; filename: string }>();
    mockedApi.listFiles.mockImplementation(async (_path: string, token: string) => token === "token-beta"
      ? { path: "", items: [
          { path: "Projects/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" },
          { path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 18, mimeType: "audio/mpeg" }
        ] }
      : { path: "", items: [{ path: "Alpha/only.txt", name: "only.txt", isFolder: false, size: 1, mimeType: "text/plain" }] });
    mockedApi.getFile.mockImplementation(async (path: string) => ({
      file: buildFilePreview(path, {
        name: path.split("/").at(-1) ?? path,
        size: path.endsWith("song.mp3") ? 18 : 12,
        mimeType: path.endsWith("song.mp3") ? "audio/mpeg" : "image/png",
        viewer: path.endsWith("song.mp3") ? "audio" : "image",
        content: "",
        encoding: "none",
        requiresOriginalBlob: true
      })
    }));
    mockedApi.fetchOriginalFile.mockImplementation(async (path: string, token: string) => {
      expect(token).toBe("token-beta");
      if (path === "Projects/photo.png") {
        return { blob: new Blob(["beta-photo"], { type: "image/png" }), mimeType: "image/png", filename: "photo.png" };
      }
      expect(path).toBe("Projects/song.mp3");
      return betaOriginal.promise;
    });

    render(<App services={createPreviewSessionFixture()} />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } });
    await screen.findByRole("button", { name: /Open file photo.png/i });

    fireEvent.click(screen.getByRole("button", { name: /Open file photo.png/i }));
    const photoPreview = await screen.findByRole("dialog", { name: /Preview photo.png/i });
    const photoWorkspace = [...appShellCapture.history].reverse().find((props) => props.kind === "workspace");
    if (!photoWorkspace || photoWorkspace.kind !== "workspace") throw new Error("Expected photo workspace capture");
    expectCompleteCapturedPreviewStage(photoWorkspace.overlays.preview, capturedStageExpectation({ open: true, accountId: "beta", token: "token-beta", entry: expectedStageEntry("Projects/photo.png", "image/png", 12), file: expectedStageMediaFile("Projects/photo.png", "image/png", "image", 12), blobUrl: "blob:preview", cacheState: { source: "live", refreshing: false, stale: false, updateReady: false }, onPrevious: "undefined", onNext: "defined" }));
    expect(photoWorkspace.overlays.preview.open).toBe(true);
    expect(photoWorkspace.overlays.preview.onPrevious).toBeUndefined();
    expect(typeof photoWorkspace.overlays.preview.onNext).toBe("function");
    fireEvent.click(within(photoPreview).getByRole("button", { name: /Next media item/i }));
    const songPreview = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
    expect(songPreview.querySelector("audio")).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.getFile).toHaveBeenCalledWith("Projects/song.mp3", "token-beta", expect.any(AbortSignal)));

    betaOriginal.resolve({ blob: new Blob(["beta-song"], { type: "audio/mpeg" }), mimeType: "audio/mpeg", filename: "song.mp3" });
    await waitFor(() => expect([...appShellCapture.history].some((props) => props.kind === "workspace" && props.overlays.preview.file?.path === "Projects/song.mp3")).toBe(true));
    const songWorkspace = [...appShellCapture.history].reverse().find((props) => props.kind === "workspace" && props.overlays.preview.file?.path === "Projects/song.mp3");
    if (!songWorkspace || songWorkspace.kind !== "workspace") throw new Error("Expected song workspace capture");
    expectCompleteCapturedPreviewStage(songWorkspace.overlays.preview, capturedStageExpectation({ open: true, accountId: "beta", token: "token-beta", entry: expectedStageEntry("Projects/song.mp3", "audio/mpeg", 18), file: expectedStageMediaFile("Projects/song.mp3", "audio/mpeg", "audio", 18), blobUrl: "/api/file/stream?path=Projects%2Fsong.mp3&streamToken=stream-token-alpha", cacheState: { source: "live", refreshing: false, stale: false, updateReady: false }, onPrevious: "defined", onNext: "undefined" }));
    expect(songWorkspace.overlays.preview.open).toBe(true);
    expect(songWorkspace.overlays.preview.onNext).toBeUndefined();
    expect(typeof songWorkspace.overlays.preview.onPrevious).toBe("function");
    expect(songWorkspace.overlays.preview.token).toBe("token-beta");
    await waitFor(() => expect(mockedRetentionRepository.writePreview.mock.calls.some(([account, input]) => account.cacheNamespace === beta.cacheNamespace && input.file.path === "Projects/song.mp3" && input.blob instanceof Blob)).toBe(true));
    expect(await screen.findByText("Streaming /Projects/song.mp3 in Beta workspace; offline cache copy is ready.")).toBeInTheDocument();
    expect(screen.queryByText(/Streaming \/Projects\/song\.mp3 in Alpha workspace/i)).not.toBeInTheDocument();

    fireEvent.click(within(songPreview).getByRole("button", { name: /Back to files/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Open file song.mp3/i }));
    expect(await screen.findByLabelText(/Play folder audio/i)).toBeInTheDocument();
  })

it("resets only beta after a beta preview session expiry when the controller was created for alpha", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    seedAccounts([{ account: alpha, session: buildSession(alpha) }, { account: beta, session: buildSession(beta) }], alpha.id);
    const betaPreview = createDeferred<{ file: FilePreview }>();
    mockedApi.listFiles.mockImplementation(async (_path: string, token: string) => token === "token-beta"
      ? { path: "", items: [{ path: "Beta/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" }] }
      : { path: "", items: [{ path: "Alpha/only.txt", name: "only.txt", isFolder: false, size: 1, mimeType: "text/plain" }] });
    mockedApi.getFile.mockImplementation(async (path: string, token: string) => {
      if (path === "Beta/photo.png" && token === "token-beta") {
        return betaPreview.promise;
      }
      return { file: textPreview };
    });
    mockedApi.createSession.mockImplementation(async ({ accountId }) => {
      if (accountId === beta.id) {
        throw new ApiRequestError("Expired", 401);
      }
      return buildSession(alpha);
    });

    render(<App services={createPreviewSessionFixture()} />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } });
    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.png/i }));

    await waitFor(() => expect(mockedApi.getFile).toHaveBeenCalledWith("Beta/photo.png", "token-beta", expect.any(AbortSignal)));
    await screen.findByRole("dialog", { name: /Preview photo.png/i });
    betaPreview.reject(new ApiRequestError("Expired", 401));
    expect(await screen.findByText(/Session expired\. Create a fresh session/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /Preview photo.png/i })).not.toBeInTheDocument();
    const storedAccounts = JSON.parse(localStorage.getItem("davora-account-state") ?? "{}") as { accounts?: Array<{ account: { id: string }; session?: { token: string } }> };
    expect(storedAccounts.accounts?.find((record) => record.account.id === beta.id)?.session).toBeUndefined();
    expect(storedAccounts.accounts?.find((record) => record.account.id === alpha.id)?.session).toMatchObject({ token: "token-alpha" });
  })

it("marks only beta reconnect-required after a beta preview reconnect failure from an alpha-created controller", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    seedAccounts([{ account: alpha, session: buildSession(alpha) }, { account: beta, session: buildSession(beta) }], alpha.id);
    const betaPreview = createDeferred<{ file: FilePreview }>();
    mockedApi.listFiles.mockImplementation(async (_path: string, token: string) => token === "token-beta"
      ? { path: "", items: [{ path: "Beta/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" }] }
      : { path: "", items: [{ path: "Alpha/only.txt", name: "only.txt", isFolder: false, size: 1, mimeType: "text/plain" }] });
    mockedApi.getFile.mockImplementation(async (path: string, token: string) => {
      if (path === "Beta/photo.png" && token === "token-beta") {
        return betaPreview.promise;
      }
      return { file: textPreview };
    });
    mockedApi.createSession.mockImplementation(async ({ accountId }) => {
      if (accountId === beta.id) {
        throw new ApiRequestError("Reconnect", 409, "account_reconnect_required");
      }
      return buildSession(alpha);
    });

    render(<App services={createPreviewSessionFixture()} />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } });
    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.png/i }));

    await waitFor(() => expect(mockedApi.getFile).toHaveBeenCalledWith("Beta/photo.png", "token-beta", expect.any(AbortSignal)));
    await screen.findByRole("dialog", { name: /Preview photo.png/i });
    betaPreview.reject(new ApiRequestError("Reconnect", 409, "account_reconnect_required"));
    expect(await screen.findByRole("heading", { name: /Reconnect Beta workspace/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /Preview photo.png/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Reconnect Alpha workspace/i })).not.toBeInTheDocument();
    const storedAccounts = JSON.parse(localStorage.getItem("davora-account-state") ?? "{}") as { accounts?: Array<{ account: { id: string }; session?: { token: string } }> };
    expect(storedAccounts.accounts?.find((record) => record.account.id === alpha.id)?.session).toMatchObject({ token: "token-alpha" });
  })

it("releases an applied preview Blob exactly once when App unmounts", async () => {
    const account = buildAccount("alpha", { displayName: "Preview ownership workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValueOnce({
      path: "",
      items: [{ path: "Archive/photo.png", name: "photo.png", isFolder: false, mimeType: "image/png", size: 3 }]
    });
    mockedApi.getFile.mockResolvedValueOnce({
      file: buildFilePreview("Archive/photo.png", { viewer: "image", mimeType: "image/png", requiresOriginalBlob: true, content: "", encoding: "none" })
    });
    mockedApi.fetchOriginalFile.mockResolvedValueOnce({ blob: new Blob(["png"], { type: "image/png" }), mimeType: "image/png", filename: "photo.png" });

    const app = render(<App services={createPreviewSessionFixture()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.png/i }));
    await screen.findByRole("dialog", { name: /Preview photo.png/i });
    await waitFor(() => expect(createObjectUrlMock).toHaveBeenCalled());
    app.unmount();

    expect(revokeObjectUrlMock).toHaveBeenCalledTimes(1);
  })
