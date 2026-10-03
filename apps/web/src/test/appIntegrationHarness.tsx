import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";

import type { AppSession, ConnectedAccount, FileEntry, FilePreview } from "@davora/shared";
import type { AccountTransport } from "../features/accounts";

import AppComponent from "../App";
import type { AppShellProps } from "../app/AppShell";
import type { PreviewModalStageProps } from "../features/preview/shell/PreviewModalStage";
import { createBrowserAppServices as createBrowserAppServicesFixture } from "../app/createBrowserAppServices";
import { createAccountRemovalRuntime } from "../app/createAccountRemovalRuntime";
import { createPreviewComposition } from "../app/createPreviewComposition";
import { createBrowserFolderPorts } from "../platform/api/browserFolderPorts";
import { createBrowserSearchPorts } from "../platform/api/browserSearchPorts";
import { createBrowserFavouriteResolveRuntime } from "../platform/api/browserFavouriteResolveRuntime";
import { createBrowserOperationRuntime } from "../platform/api/browserOperationRuntime";
import { createBrowserOfflineSyncRuntime } from "../platform/offline/browserOfflineSyncRuntime";
import { createBrowserPreviewModalRuntime } from "../platform/preview/browserPreviewModalRuntime";
import {
  retainedRootId,
  type RetainedFile,
  type RetainedRoot,
  type RetainedSnapshot,
  type RetentionAccount,
  type RetentionResult
} from "../features/offline/retention";
import {
  NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT as narrowViewportFixture,
  WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT as wideViewportFixture,
  type ResponsiveViewportListener,
  type ResponsiveViewportPort,
  type ResponsiveViewportSnapshot
} from "../features/navigation/viewport";
import type { BrowsingCacheRepository } from "../features/browsing";
import { ApiRequestError as ApiRequestErrorFixture } from "../lib/api";
import * as heicPreview from "../lib/heicPreview";
import { setBackendNetworkBlocked } from "../lib/networkPolicy";
import type { OpenedFileRepository } from "../platform/storage/openedFileRepository";
import { buildAccount as buildAccountFixture, buildSession as buildSessionFixture } from "./accounts";
import { buildHealthResponse as buildHealthResponseFixture } from "./api";
import { buildFilePreview as buildFilePreviewFixture } from "./files";
import { createDeferred as createDeferredFixture } from "./primitives";

const App = (props: React.ComponentProps<typeof AppComponent> = {}) => (
  <AppComponent {...props} services={props.services ?? createBrowserAppServices()} />
);
const buildAccount = buildAccountFixture;
const buildSession = buildSessionFixture;
const buildHealthResponse = buildHealthResponseFixture;
const buildFilePreview = buildFilePreviewFixture;
const createDeferred = createDeferredFixture;
const ApiRequestError = ApiRequestErrorFixture;
const NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT = narrowViewportFixture;
const WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT = wideViewportFixture;

const { registerSwMock, accountGetHealthMock, accountConnectMock, accountCreateSessionMock, accountDeleteMock } = vi.hoisted(() => ({
  registerSwMock: vi.fn(() => ({
    offlineReady: [false, vi.fn()] as [boolean, (value: boolean) => void],
    needRefresh: [false, vi.fn()] as [boolean, (value: boolean) => void],
    updateServiceWorker: vi.fn(async () => undefined)
  })),
  accountGetHealthMock: vi.fn<AccountTransport["getHealth"]>(),
  accountConnectMock: vi.fn<AccountTransport["connectAccount"]>(),
  accountCreateSessionMock: vi.fn<AccountTransport["createSession"]>(),
  accountDeleteMock: vi.fn<AccountTransport["deleteConnectedAccount"]>()
}));

const appShellCapture = vi.hoisted(() => ({
  latest: undefined as AppShellProps | undefined,
  history: [] as AppShellProps[]
}));

vi.mock("../app/AppShell", async () => {
  const actual = await vi.importActual<typeof import("../app/AppShell")>("../app/AppShell");
  return {
    ...actual,
    AppShell: (props: AppShellProps) => {
      appShellCapture.latest = props;
      appShellCapture.history.push(props);
      const RealAppShell = actual.AppShell;
      return <RealAppShell {...props} />;
    }
  };
});

const browsingCacheFixture = vi.hoisted(() => ({
  repository: {
    readFolder: vi.fn<BrowsingCacheRepository["readFolder"]>(() => ({ kind: "miss" })),
    writeFolder: vi.fn<BrowsingCacheRepository["writeFolder"]>(() => ({ kind: "written" })),
    readSearch: vi.fn<BrowsingCacheRepository["readSearch"]>(() => ({ kind: "miss" })),
    writeSearch: vi.fn<BrowsingCacheRepository["writeSearch"]>(() => ({ kind: "written" })),
    clearNamespace: vi.fn<BrowsingCacheRepository["clearNamespace"]>(() => ({ kind: "cleared" })),
    clearFolderPath: vi.fn<BrowsingCacheRepository["clearFolderPath"]>(() => ({ kind: "cleared" })),
    clearNamespaceOrThrow: vi.fn<BrowsingCacheRepository["clearNamespaceOrThrow"]>(),
    clearFolderPathOrThrow: vi.fn<BrowsingCacheRepository["clearFolderPathOrThrow"]>()
  }
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: registerSwMock
}));
vi.mock("../components/MarkdownPreview", () => ({ MarkdownPreview: ({ content }: { content: string }) => <div data-testid="markdown-preview">{content}</div> }));
vi.mock("../lib/heicPreview", async () => {
  const actual = await vi.importActual<typeof import("../lib/heicPreview")>("../lib/heicPreview");
  return {
    ...actual,
    decodeHeicPreview: vi.fn()
  };
});

const retentionFixture = vi.hoisted(() => {
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
    readSnapshot: vi.fn<OpenedFileRepository["readSnapshot"]>(),
    readPreview: vi.fn<OpenedFileRepository["readPreview"]>(),
    writePreview: vi.fn<OpenedFileRepository["writePreview"]>(),
    beginRoot: vi.fn<OpenedFileRepository["beginRoot"]>(),
    persistRetainedFile: vi.fn<OpenedFileRepository["persistRetainedFile"]>(),
    completeRoot: vi.fn<OpenedFileRepository["completeRoot"]>(),
    removeRoot: vi.fn<OpenedFileRepository["removeRoot"]>(),
    clearNormalCache: vi.fn<OpenedFileRepository["clearNormalCache"]>(),
    purgeAccountNamespace: vi.fn<OpenedFileRepository["purgeAccountNamespace"]>(),
    configureNormalCacheLimit: vi.fn<OpenedFileRepository["configureNormalCacheLimit"]>()
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
      const retained = input.retainedOriginal !== undefined && normalizedPath(input.retainedOriginal.file.path) === path && (store.memberships.get(path)?.size ?? 0) > 0 ? input.retainedOriginal : undefined;
      const file = retained?.file ?? input.file;
      const blob = retained?.blob ?? input.blob;
      const existing = store.files.get(path);
      store.files.set(path, { ...existing, ...file, path, normalCacheOwnership: "owned", readable: Boolean(file.readable) || Boolean(blob) || Boolean(existing?.readable) });
      if (blob) store.blobs.set(path, blob);
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
});

function createBrowserAppServices() {
  const services = createBrowserAppServicesFixture();
  const accountTransport = {
    ...services.accountTransport,
    getHealth: accountGetHealthMock,
    connectAccount: accountConnectMock,
    createSession: accountCreateSessionMock,
    deleteConnectedAccount: accountDeleteMock
  } satisfies AccountTransport;
  const previewRuntime = createPreviewComposition({
    retentionRepository: retentionFixture.repository,
    modalRuntime: createBrowserPreviewModalRuntime({ fetchOriginalFile: mockedApi.fetchOriginalFile }),
    folderAudioRuntime: {
      ...services.previewRuntime.folderAudio,
      createStreamingFileUrl: mockedApi.createStreamingFileUrl
    },
    previewTransport: {
      getFile: (path, token, signal) => mockedApi.getFile(path, token, signal),
      fetchOriginalFile: (path, token, signal) => mockedApi.fetchOriginalFile(path, token, signal),
      createStreamingFileUrl: (path, token, signal) => mockedApi.createStreamingFileUrl(path, token, signal)
    }
  });
  return {
    ...services,
    accountTransport,
    accountRemovalRuntime: createAccountRemovalRuntime({
      accountTransport,
      retentionRepository: retentionFixture.repository,
      browsingCache: browsingCacheFixture.repository,
      favourites: services.favourites,
      folderSorts: services.folderSorts,
      explicitOfflineMode: { commit: () => ({ kind: "committed" }) },
      playbackCleanup: { purgeAccount: () => undefined }
    }),
    accountSession: {
      ...services.accountSession,
      getHealth: accountTransport.getHealth,
      createSession: accountTransport.createSession
    },
    browsingCache: browsingCacheFixture.repository,
    favouriteResolveRuntime: createBrowserFavouriteResolveRuntime(browsingCacheFixture.repository, { listFiles: mockedApi.listFiles }),
    folder: createBrowserFolderPorts(browsingCacheFixture.repository, { listFiles: mockedApi.listFiles }),
    search: createBrowserSearchPorts(browsingCacheFixture.repository, { searchFiles: mockedApi.searchFiles }),
    operationRuntime: createBrowserOperationRuntime({
      createFolder: mockedApi.createFolder,
      deleteFile: mockedApi.deleteFile,
      uploadFileWithProgress: mockedApi.uploadFileWithProgress,
      moveFile: mockedApi.moveFile,
      copyFile: mockedApi.copyFile,
      listFiles: mockedApi.listFiles,
      prepareDownloadFile: mockedApi.prepareDownloadFile,
      fetchDownloadBlob: mockedApi.fetchDownloadBlob,
      triggerBrowserDownload: mockedApi.triggerBrowserDownload
    }),
    offlineSyncRuntime: createBrowserOfflineSyncRuntime({
      listFiles: mockedApi.listFiles,
      fetchDownloadBlob: mockedApi.fetchDownloadBlob
    }),
    retentionRepository: retentionFixture.repository,
    previewRuntime
  } satisfies ReturnType<typeof createBrowserAppServicesFixture>;
}


const mockedApi = {
  getHealth: accountGetHealthMock,
  connectAccount: accountConnectMock,
  createSession: accountCreateSessionMock,
  deleteConnectedAccount: accountDeleteMock,
  listFiles: vi.fn<typeof import("../lib/api").listFiles>(),
  getFile: vi.fn<typeof import("../lib/api").getFile>(),
  searchFiles: vi.fn<typeof import("../lib/api").searchFiles>(),
  downloadFile: vi.fn<typeof import("../lib/api").downloadFile>(),
  prepareDownloadFile: vi.fn<typeof import("../lib/api").prepareDownloadFile>(),
  fetchDownloadBlob: vi.fn<typeof import("../lib/api").fetchDownloadBlob>(),
  fetchOriginalFile: vi.fn<typeof import("../lib/api").fetchOriginalFile>(),
  createStreamingFileUrl: vi.fn<typeof import("../lib/api").createStreamingFileUrl>(async (path) => `/api/file/stream?path=${encodeURIComponent(path)}&streamToken=stream-token-alpha`),
  triggerBrowserDownload: vi.fn<typeof import("../lib/api").triggerBrowserDownload>(),
  createFolder: vi.fn<typeof import("../lib/api").createFolder>(),
  uploadFile: vi.fn<typeof import("../lib/api").uploadFile>(),
  uploadFileWithProgress: vi.fn<typeof import("../lib/api").uploadFileWithProgress>(),
  moveFile: vi.fn<typeof import("../lib/api").moveFile>(),
  copyFile: vi.fn<typeof import("../lib/api").copyFile>(),
  deleteFile: vi.fn<typeof import("../lib/api").deleteFile>()
};
const mockedCache = browsingCacheFixture.repository;
const mockedHeicPreview = vi.mocked(heicPreview);
const mockedRetentionRepository = retentionFixture.repository;

const createObjectUrlMock = vi.fn((_blob: Blob) => "blob:preview");
const revokeObjectUrlMock = vi.fn();
const windowOpenMock = vi.fn<Window["open"]>(() => window);
const addMediaListenerMock = vi.fn();
const removeMediaListenerMock = vi.fn();
const mediaPlayMock = vi.fn<() => Promise<void>>(async () => undefined);
const mediaPauseMock = vi.fn<() => void>(() => undefined);
let matchMediaMatches = false;
let prefersDarkMatches = false;
export function setMatchMediaMatches(value: boolean): void {
  matchMediaMatches = value;
}
const matchMediaMock = vi.fn((query?: string) => ({
  matches: query === "(display-mode: standalone)" ? false : query === "(prefers-color-scheme: dark)" ? prefersDarkMatches : matchMediaMatches,
  media: query ?? "(max-width: 900px)",
  onchange: null,
  addEventListener: addMediaListenerMock,
  removeEventListener: removeMediaListenerMock,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn()
}));

function createResponsiveViewportFixture(initial: ResponsiveViewportSnapshot) {
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
    emit(next: ResponsiveViewportSnapshot) {
      snapshot = next;
      for (const listener of [...listeners]) listener();
    }
  };
}

function installWakeLockMock() {
  const sentinel = Object.assign(new EventTarget(), {
    released: false,
    release: vi.fn(async () => {
      if (sentinel.released) {
        return;
      }
      sentinel.released = true;
      sentinel.dispatchEvent(new Event("release"));
    })
  });
  const request = vi.fn(async () => sentinel);
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
  return { request, sentinel };
}

const healthResponse = buildHealthResponse();
let lastConnectedAccount: ConnectedAccount | undefined;

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

const textPreview = buildFilePreview("Projects/roadmap.txt", {
  size: 70,
  content: "normalized API preview",
  bytesRead: 22
});

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

beforeEach(() => {
  cleanup();
  appShellCapture.latest = undefined;
  appShellCapture.history.length = 0;
  setBackendNetworkBlocked(false);
  localStorage.clear();
  lastConnectedAccount = undefined;
  vi.resetAllMocks();
  retentionFixture.reset();
  registerSwMock.mockReturnValue({
    offlineReady: [false, vi.fn()],
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(async () => undefined)
  });
  matchMediaMatches = false;
  prefersDarkMatches = false;
  createObjectUrlMock.mockReturnValue("blob:preview");
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  Reflect.deleteProperty(navigator, "wakeLock");
  Object.defineProperty(window, "matchMedia", { value: matchMediaMock, configurable: true, writable: true });
  Object.defineProperty(URL, "createObjectURL", { value: createObjectUrlMock, configurable: true, writable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectUrlMock, configurable: true, writable: true });
  Object.defineProperty(window, "open", { value: windowOpenMock, configurable: true, writable: true });
  Object.defineProperty(HTMLMediaElement.prototype, "play", { value: mediaPlayMock, configurable: true, writable: true });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { value: mediaPauseMock, configurable: true, writable: true });
  window.history.replaceState(null, "", "/");

  mockedApi.getHealth.mockResolvedValue(healthResponse);
  mockedApi.connectAccount.mockImplementation(async (request) => {
    const account = buildAccount(request.accountId ?? "connected", {
      displayName: request.label?.trim() || `${request.username}@${new URL(request.baseUrl).hostname}`,
      label: request.label,
      baseUrl: request.baseUrl,
      username: request.username,
      rootPath: request.rootPath ?? "",
      cacheNamespace: request.cacheNamespace ?? `ns-${request.accountId ?? "connected"}`
    });
    lastConnectedAccount = account;
    return { kind: "http-success", data: { account } };
  });
  mockedApi.createSession.mockImplementation(async ({ accountId }) => {
    const account = lastConnectedAccount?.id === accountId
      ? lastConnectedAccount
      : buildAccount(accountId, { displayName: `Account ${accountId}` });
    const session = buildSession(account);
    return session;
  });
  mockedApi.listFiles.mockImplementation(async (path: string) => {
    if (path === "Projects") {
      return { completeness: "complete" as const,
        path,
        items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }]
      };
    }
    return { completeness: "complete" as const,
      path,
      items: [
        { path: "Projects", name: "Projects", isFolder: true },
        { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }
      ]
    };
  });
  mockedApi.getFile.mockResolvedValue({ file: textPreview });
  mockedApi.searchFiles.mockResolvedValue({ completeness: "complete",
    query: "roadmap",
    path: "",
    items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain", score: 75 }]
  });
  mockedApi.fetchDownloadBlob.mockResolvedValue({ blob: new Blob(["download"], { type: "application/octet-stream" }), filename: undefined });
  mockedApi.prepareDownloadFile.mockResolvedValue({ blob: new Blob(["download"], { type: "application/octet-stream" }), filename: "download.bin" });
  mockedApi.fetchOriginalFile.mockResolvedValue({ blob: new Blob(["binary"], { type: "image/png" }), mimeType: "image/png", filename: "photo.png" });
  mockedHeicPreview.decodeHeicPreview.mockResolvedValue({
    blob: new Blob(["jpeg"], { type: "image/jpeg" }),
    width: 1200,
    height: 900,
    mimeType: "image/jpeg"
  });
  mockedApi.triggerBrowserDownload.mockImplementation(() => undefined);
  mockedApi.createFolder.mockResolvedValue({ result: { action: "createFolder", parentPath: "", path: "Plans", item: { path: "Plans", name: "Plans", isFolder: true } } });
  mockedApi.uploadFileWithProgress.mockResolvedValue({ result: { action: "upload", parentPath: "", path: "Projects/roadmap.txt", item: { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false } } });
  mockedApi.moveFile.mockResolvedValue({ result: { action: "move", parentPath: "", path: "Projects/roadmap.txt", destinationPath: "Projects/renamed.txt" } });
  mockedApi.copyFile.mockResolvedValue({ result: { action: "copy", parentPath: "", path: "Projects/roadmap.txt", destinationPath: "Projects/roadmap-copy.txt" } });
  mockedApi.deleteFile.mockResolvedValue({ result: { action: "delete", parentPath: "", path: "Projects/roadmap.txt" } });
  mockedCache.readFolder.mockReturnValue({ kind: "miss" });
  mockedCache.writeFolder.mockReturnValue({ kind: "written" });
  mockedCache.readSearch.mockReturnValue({ kind: "miss" });
  mockedCache.writeSearch.mockReturnValue({ kind: "written" });
  mockedCache.clearNamespace.mockReturnValue({ kind: "cleared" });
  mockedCache.clearFolderPath.mockReturnValue({ kind: "cleared" });
  mockedCache.clearNamespaceOrThrow.mockImplementation(() => undefined);
  mockedCache.clearFolderPathOrThrow.mockImplementation(() => undefined);
});

function dispatchAppBack(path = ""): void {
  window.dispatchEvent(new PopStateEvent("popstate", { state: { davora: true, path } }));
}

afterEach(() => {
  cleanup();
  appShellCapture.latest = undefined;
  appShellCapture.history.length = 0;
});


export {
  act, cleanup, fireEvent, render, screen, waitFor, within, App, createBrowserAppServices,
  registerSwMock, accountGetHealthMock, accountConnectMock, accountCreateSessionMock, accountDeleteMock,
  appShellCapture, mockedApi, mockedCache, mockedHeicPreview, mockedRetentionRepository,
  createObjectUrlMock, revokeObjectUrlMock, windowOpenMock, addMediaListenerMock, removeMediaListenerMock,
  mediaPlayMock, mediaPauseMock, matchMediaMock, createResponsiveViewportFixture, installWakeLockMock,
  healthResponse, seedAccounts, expectCompleteCapturedPreviewStage, capturedStageExpectation, textPreview,
  retentionAccountFor, retainedFileFixture, retainedRootFixture, seedRetentionSnapshot, expectRetainedFilePersisted,
  dispatchAppBack, retainedRootId, NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT, WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT,
  ApiRequestError, heicPreview, setBackendNetworkBlocked, buildAccount, buildSession, buildHealthResponse,
  buildFilePreview, createDeferred
};

export type { AppSession, ConnectedAccount, FileEntry, FilePreview, AppShellProps, PreviewModalStageProps, BrowsingCacheRepository, ResponsiveViewportListener, ResponsiveViewportPort, ResponsiveViewportSnapshot, CapturedPreviewStage, PreviewStageExpectation, RetainedFile, RetainedRoot, RetainedSnapshot, RetentionAccount, RetentionResult, OpenedFileRepository, AccountTransport };
