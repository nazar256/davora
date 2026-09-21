import { act, cleanup, fireEvent, render as testingRender, screen, waitFor, within } from "@testing-library/react";
import { cloneElement, isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSession, ConnectedAccount } from "@davora/shared";
import type { AccountTransport } from "../../../../features/accounts";

import App from "../../../../App";
import type { AppShellProps } from "../../../../app/AppShell";
import type { AppServices } from "../../../../app/AppServices";
import { createBrowserAppServices } from "../../../../app/createBrowserAppServices";
import { createAccountRemovalRuntime } from "../../../../app/createAccountRemovalRuntime";
import {
  type RetainedFile,
  type RetainedRoot,
  type RetainedSnapshot,
  type RetentionAccount,
  type RetentionResult
} from "../../../../features/offline/retention";
import {
  NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT,
  WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT,
  type ResponsiveViewportListener,
  type ResponsiveViewportPort,
  type ResponsiveViewportSnapshot
} from "../../../../features/navigation/viewport";
import type { BrowsingCacheRepository } from "../../../../features/browsing";
import { createBrowserFolderPorts } from "../../../../platform/api/browserFolderPorts";
import { createBrowserSearchPorts } from "../../../../platform/api/browserSearchPorts";
import type { OperationRuntimePort } from "../../../../features/operations/workspace";
import type { BrowserOfflineSyncRuntime } from "../../../../platform/offline/browserOfflineSyncRuntime";
import type { TransferTask } from "../../../../features/transfers/model";
import type { TransferTrayStageProps } from "../../../../features/transfers";
import * as transferOwnerModule from "../../../../features/transfers/useTransfers";
import * as offlineSyncOwnerModule from "../../../../features/offline/sync/workspace";
import { setBackendNetworkBlocked } from "../../../../lib/networkPolicy";
import type { OpenedFileRepository } from "../../../../platform/storage/openedFileRepository";
import { buildAccount, buildSession } from "../../../../test/accounts";
import { buildHealthResponse } from "../../../../test/api";

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

vi.mock("../../../../app/AppShell", async () => {
  const actual = await vi.importActual<typeof import("../../../../app/AppShell")>("../../../../app/AppShell");
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
const mockedApi = vi.hoisted(() => ({
  listFiles: vi.fn<BrowserOfflineSyncRuntime["listFiles"]>(),
  searchFiles: vi.fn<(path: string, query: string, token: string, signal: AbortSignal) => Promise<{ path: string; query: string; items: unknown }>>(),
  fetchDownloadBlob: vi.fn<BrowserOfflineSyncRuntime["fetchDownloadBlob"]>(),
  deleteFile: vi.fn<OperationRuntimePort["mutation"]["deleteFile"]>()
}));

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
});

const mockedCache = browsingCacheFixture.repository;
const mockedRetentionRepository = retentionFixture.repository;

const createObjectUrlMock = vi.fn(() => "blob:preview");
const revokeObjectUrlMock = vi.fn();
const windowOpenMock = vi.fn(() => ({ closed: false } as Window));
const addMediaListenerMock = vi.fn();
const removeMediaListenerMock = vi.fn();
const mediaPlayMock = vi.fn<() => Promise<void>>(async () => undefined);
const mediaPauseMock = vi.fn<() => void>(() => undefined);
let matchMediaMatches = false;
let prefersDarkMatches = false;
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

function createAppBarFixture(): AppServices {
  const services = createBrowserAppServices();
  const accountTransport = {
    ...services.accountTransport,
    getHealth: accountGetHealthMock,
    connectAccount: accountConnectMock,
    createSession: accountCreateSessionMock,
    deleteConnectedAccount: accountDeleteMock
  };
  const operationRuntime: OperationRuntimePort = {
    ...services.operationRuntime,
    mutation: { ...services.operationRuntime.mutation, deleteFile: mockedApi.deleteFile },
    download: {
      ...services.operationRuntime.download,
      listFiles: mockedApi.listFiles,
      fetchDownloadBlob: mockedApi.fetchDownloadBlob
    }
  };
  const offlineSyncRuntime: BrowserOfflineSyncRuntime = {
    ...services.offlineSyncRuntime,
    listFiles: mockedApi.listFiles,
    fetchDownloadBlob: mockedApi.fetchDownloadBlob
  };
  return {
    ...services,
    accountTransport,
    accountRemovalRuntime: createAccountRemovalRuntime({
      accountTransport,
      retentionRepository: mockedRetentionRepository,
      browsingCache: mockedCache,
      favourites: services.favourites,
      folderSorts: services.folderSorts
    }),
    accountSession: {
      ...services.accountSession,
      getHealth: accountTransport.getHealth,
      createSession: accountTransport.createSession
    },
    browsingCache: mockedCache,
    retentionRepository: mockedRetentionRepository,
    folder: createBrowserFolderPorts(mockedCache, { listFiles: mockedApi.listFiles }),
    search: createBrowserSearchPorts(mockedCache, { searchFiles: mockedApi.searchFiles }),
    operationRuntime,
    offlineSyncRuntime
  };
}

function render(ui: ReactElement): ReturnType<typeof testingRender> {
  if (!isValidElement(ui) || ui.type !== App) return testingRender(ui);
  const appElement = ui as ReactElement<{ readonly services?: AppServices }>;
  const suppliedServices = appElement.props.services;
  const overrides = suppliedServices
    ? { history: suppliedServices.history, responsiveViewport: suppliedServices.responsiveViewport }
    : {};
  return testingRender(cloneElement(appElement, { services: { ...createAppBarFixture(), ...overrides } }));
}
let lastConnectedAccount: ConnectedAccount | undefined;

function seedAccounts(records: Array<{ account: ConnectedAccount; session?: { token: string; expiresAt: string; rootPath: string; capabilities: AppSession["capabilities"] }; pendingRemoval?: { phase: "revoke" | "purge" }; pendingReconnect?: { baseUrl: string; username: string; label?: string } }>, activeAccountId?: string) {
  localStorage.setItem("davora-account-state", JSON.stringify({
    activeAccountId: activeAccountId ?? records[0]?.account.id,
    accounts: records
  }));
}

function primaryKeepOfflineButton() {
  const button = screen.getAllByRole("button", { name: /^Keep offline$/i })[0];
  if (!button) {
    throw new Error("Expected a primary Keep offline button.");
  }
  return button;
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

  accountGetHealthMock.mockResolvedValue(buildHealthResponse());
  accountConnectMock.mockImplementation(async (request) => {
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
  accountCreateSessionMock.mockImplementation(async ({ accountId }) => {
    const account = lastConnectedAccount?.id === accountId
      ? lastConnectedAccount!
      : buildAccount(accountId, { displayName: `Account ${accountId}` });
    const session = buildSession(account);
    return session;
  });
  mockedApi.listFiles.mockImplementation(async (path: string) => {
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
  mockedApi.searchFiles.mockImplementation(async (path, query) => ({ path, query, items: [] }));
  mockedApi.fetchDownloadBlob.mockResolvedValue({ blob: new Blob(["download"], { type: "application/octet-stream" }), filename: undefined });
  mockedApi.deleteFile.mockResolvedValue({ action: "delete", parentPath: "", path: "Projects/roadmap.txt" });
  mockedCache.readFolder.mockReturnValue({ kind: "miss" });
  mockedCache.writeFolder.mockReturnValue({ kind: "written" });
  mockedCache.readSearch.mockReturnValue({ kind: "miss" });
  mockedCache.writeSearch.mockReturnValue({ kind: "written" });
  mockedCache.clearNamespace.mockReturnValue({ kind: "cleared" });
  mockedCache.clearFolderPath.mockReturnValue({ kind: "cleared" });
  mockedCache.clearNamespaceOrThrow.mockImplementation(() => undefined);
  mockedCache.clearFolderPathOrThrow.mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  appShellCapture.latest = undefined;
  appShellCapture.history.length = 0;
  vi.restoreAllMocks();
});


describe("AppBar App integration", () => {
  it("characterizes the complete AppBar binding for bootstrap and workspace shells", async () => {
    render(<App />);
    await screen.findByRole("button", { name: /Connect account/i });
    const bootstrap = appShellCapture.latest;
    expect(bootstrap?.kind).toBe("bootstrap");
    if (!bootstrap || bootstrap.kind !== "bootstrap") throw new Error("Expected bootstrap shell");

    const rawErrorSentinel = "appbar-raw-error-sentinel";
    const cacheNamespaceSentinel = "appbar-cache-namespace-sentinel";
    const transferPayloadSentinel = "appbar-transfer-payload-sentinel";
    const credentialSentinel = "appbar-credential-sentinel";
    const requestHeaderSentinel = "appbar-request-header-sentinel";
    const blobContentSentinel = "appbar-blob-content-sentinel";
    const apiObjectSentinel = "appbar-api-object-sentinel";
    const account = buildAccount("alpha", { displayName: "AppBar Alpha", cacheNamespace: cacheNamespaceSentinel });
    cleanup();
    seedAccounts([{ account, session: buildSession(account, { token: "appbar-secret-token" }) }], account.id);
    mockedApi.listFiles.mockRejectedValueOnce(new Error([
      rawErrorSentinel, transferPayloadSentinel, credentialSentinel, requestHeaderSentinel,
      blobContentSentinel, apiObjectSentinel
    ].join(":")));
    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });
    const workspace = appShellCapture.latest;
    expect(workspace?.kind).toBe("workspace");
    if (!workspace || workspace.kind !== "workspace") throw new Error("Expected workspace shell");

    expect(Object.keys(workspace.common.appBar).sort()).toEqual(Object.keys(bootstrap.common.appBar).sort());
    expect(workspace.common.appBar).toMatchObject({
      hasAccounts: true,
      hasSession: true,
      currentPath: "",
      currentFolderLabel: "Home",
      searchQuery: "",
      explicitOfflineMode: false,
      offline: false,
      cacheOnlyMode: false,
      workerUnavailable: false,
      showRoutineCachedRefresh: false,
      compactMobileHeader: false,
      screenWakeLockActive: false
    });
    const { transferTray: _transferTray, ...appBarFacts } = workspace.common.appBar;
    const serialized = JSON.stringify(appBarFacts);
    const serializedComplete = JSON.stringify(workspace.common.appBar, (key, value: unknown) => {
      if (key === "_owner") return undefined;
      if (typeof value === "function") return "[function]";
      return value;
    });
    expect(serialized).not.toContain("appbar-secret-token");
    expect(serialized).not.toContain(account.cacheNamespace);
    expect(serialized).not.toContain(rawErrorSentinel);
    expect(serialized).not.toContain(transferPayloadSentinel);
    expect(serialized).not.toContain(credentialSentinel);
    expect(serialized).not.toContain(requestHeaderSentinel);
    expect(serialized).not.toContain(blobContentSentinel);
    expect(serialized).not.toContain(apiObjectSentinel);
    expect(serializedComplete).not.toContain("appbar-secret-token");
    expect(serializedComplete).not.toContain(rawErrorSentinel);
    expect(serializedComplete).not.toContain(transferPayloadSentinel);
    expect(serializedComplete).not.toContain(credentialSentinel);
    expect(serializedComplete).not.toContain(requestHeaderSentinel);
    expect(serializedComplete).not.toContain(blobContentSentinel);
    expect(serializedComplete).not.toContain(apiObjectSentinel);
    expect(serialized).not.toContain("transfer");
    expect(document.body.textContent).not.toContain("appbar-secret-token");
    expect(document.querySelector(".app-bar")?.textContent ?? "").not.toContain(rawErrorSentinel);
    expect(document.querySelector(".app-bar")?.textContent ?? "").not.toContain(transferPayloadSentinel);
    expect(document.querySelector(".app-bar")?.textContent ?? "").not.toContain(credentialSentinel);
    expect(document.querySelector(".app-bar")?.textContent ?? "").not.toContain(requestHeaderSentinel);
    expect(document.querySelector(".app-bar")?.textContent ?? "").not.toContain(blobContentSentinel);
    expect(document.querySelector(".app-bar")?.textContent ?? "").not.toContain(apiObjectSentinel);
    expect(window.location.href).not.toContain("appbar-secret-token");
    expect(window.location.href).not.toContain(cacheNamespaceSentinel);
    expect(JSON.stringify(localStorage)).not.toContain(rawErrorSentinel);
    expect(JSON.stringify(sessionStorage)).not.toContain(rawErrorSentinel);
    expect(JSON.stringify(sessionStorage)).not.toContain(transferPayloadSentinel);
    expect(JSON.stringify(localStorage)).not.toContain(credentialSentinel);
    expect(JSON.stringify(sessionStorage)).not.toContain(credentialSentinel);
    expect(JSON.stringify(localStorage)).not.toContain(requestHeaderSentinel);
    expect(JSON.stringify(sessionStorage)).not.toContain(requestHeaderSentinel);
    expect(JSON.stringify(localStorage)).not.toContain(blobContentSentinel);
    expect(JSON.stringify(sessionStorage)).not.toContain(blobContentSentinel);
    expect(JSON.stringify(localStorage)).not.toContain(apiObjectSentinel);
    expect(JSON.stringify(sessionStorage)).not.toContain(apiObjectSentinel);
    if (isValidElement<TransferTrayStageProps>(workspace.common.appBar.transferTray)) {
      const trayProps = workspace.common.appBar.transferTray.props;
      expect(trayProps.tasks).toEqual([]);
      const serializedTrayProps = JSON.stringify(trayProps, (_key, value: unknown) => typeof value === "function" ? "[function]" : value);
      expect(serializedTrayProps).not.toContain("appbar-secret-token");
      expect(serializedTrayProps).not.toContain(rawErrorSentinel);
      expect(serializedTrayProps).not.toContain(transferPayloadSentinel);
      expect(serializedTrayProps).not.toContain(credentialSentinel);
      expect(serializedTrayProps).not.toContain(requestHeaderSentinel);
      expect(serializedTrayProps).not.toContain(blobContentSentinel);
      expect(serializedTrayProps).not.toContain(apiObjectSentinel);
      expect(Object.keys(trayProps).sort()).toEqual(["onCancelTransfer", "onClearFinished", "onRetryFailedSync", "onRetryTransfer", "onToggleOpen", "open", "tasks"].sort());
      const trayCallableKeys = Object.entries(trayProps).filter(([, value]) => typeof value === "function").map(([key]) => key).sort();
      expect(trayCallableKeys).toEqual(["onCancelTransfer", "onClearFinished", "onRetryFailedSync", "onRetryTransfer", "onToggleOpen"]);
      expect(trayCallableKeys.some((key) => /delete|webdav|nextcloud/i.test(key))).toBe(false);
    }
    const appBarCallableKeys = Object.keys(workspace.common.appBar).filter((key) => typeof workspace.common.appBar[key as keyof typeof workspace.common.appBar] === "function").sort();
    expect(appBarCallableKeys).toEqual(["onCloseMobileSearch", "onNavigateUp", "onOpenMobileSearch", "onOpenNavigationDrawer", "onOpenSettings", "onSearchQueryChange"]);
    expect(Object.keys(workspace.common.appBar.sortPanel).filter((key) => typeof workspace.common.appBar.sortPanel[key as keyof typeof workspace.common.appBar.sortPanel] === "function").sort()).toEqual(["select", "toggle"]);
    expect(Object.keys(workspace.common.appBar.install).filter((key) => typeof workspace.common.appBar.install[key as keyof typeof workspace.common.appBar.install] === "function")).toEqual(["onInstall"]);
    expect([...appBarCallableKeys, "select", "toggle", "onInstall", "onClearFinished", "onRetryFailedSync", "onToggleOpen"].some((key) => /delete|webdav|nextcloud/i.test(key))).toBe(false);
    const safeRetryTask: TransferTask = {
      id: "safe-retry",
      accountId: account.id,
      kind: "sync",
      dedupeKey: "safe-retry",
      syncRootEntries: [],
      label: "Safe retry",
      loadedBytes: 0,
      startedAt: "2026-08-05T00:00:00Z",
      phase: "error",
      finishedAt: "2026-08-05T00:01:00Z",
      errorMessage: "safe retry",
      failedFiles: [{ sourcePath: "safe.txt", error: "safe retry" }]
    };
    act(() => {
      workspace.common.appBar.onOpenNavigationDrawer();
      workspace.common.appBar.onOpenMobileSearch();
      workspace.common.appBar.onCloseMobileSearch();
      workspace.common.appBar.onOpenSettings();
      workspace.common.appBar.onNavigateUp();
      workspace.common.appBar.onSearchQueryChange("safe-query");
      workspace.common.appBar.sortPanel.toggle();
      workspace.common.appBar.sortPanel.select("name-desc");
      workspace.common.appBar.install.onInstall();
      if (isValidElement<TransferTrayStageProps>(workspace.common.appBar.transferTray)) {
        const trayProps = workspace.common.appBar.transferTray.props;
        trayProps.onToggleOpen();
        trayProps.onClearFinished();
        trayProps.onRetryFailedSync?.(safeRetryTask);
      }
    });
    expect(mockedApi.deleteFile).not.toHaveBeenCalled();
    expect(Object.keys(workspace.common.appBar).filter((key) => /delete|webdav|nextcloud/i.test(key))).toEqual([]);
    expect(workspace.common.appBar.install.onInstall).toEqual(expect.any(Function));
    expect(workspace.common.appBar.screenWakeLockReasonLabel).toBe("");
  });

  it("keeps the newest AppBar viewport/query binding current while old callbacks route through current owners", async () => {
    const viewport = createResponsiveViewportFixture(WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT);
    const account = buildAccount("alpha", { displayName: "AppBar replacement workspace" });
    seedAccounts([{ account, session: buildSession(account, { token: "replacement-token" }) }], account.id);
    const services = createBrowserAppServices();
    const view = render(<App services={{ ...services, responsiveViewport: viewport.port }} />);
    await screen.findByRole("button", { name: /Create folder/i });
    const first = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (!first || first.kind !== "workspace") throw new Error("Expected initial AppBar capture");
    const oldAppBar = first.common.appBar;
    viewport.emit(NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT);
    await waitFor(() => {
      const current = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
      expect(current?.kind).toBe("workspace");
      if (current?.kind === "workspace") expect(current.common.appBar.compactMobileHeader).toBe(true);
    });
    const replacement = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (!replacement || replacement.kind !== "workspace") throw new Error("Expected replacement AppBar capture");
    expect(replacement.common.appBar.install.onInstall).toEqual(expect.any(Function));
    oldAppBar.onSearchQueryChange("old-owner-query");
    await waitFor(() => expect((([...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace") as Extract<AppShellProps, { kind: "workspace" }>).common.appBar.searchQuery)).toBe("old-owner-query"));
    replacement.common.appBar.onSearchQueryChange("current-owner-query");
    await waitFor(() => expect((([...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace") as Extract<AppShellProps, { kind: "workspace" }>).common.appBar.searchQuery)).toBe("current-owner-query"));
    const historyLength = appShellCapture.history.length;
    view.unmount();
    oldAppBar.onSearchQueryChange("after-unmount");
    await act(async () => undefined);
    expect(appShellCapture.history.length).toBe(historyLength);
  });

  it("captures and exercises the actual AppShell AppBar capability surface without mutation capabilities", async () => {
    const account = buildAccount("alpha", { displayName: "Actual AppBar capability workspace" });
    seedAccounts([{ account, session: buildSession(account, { token: "actual-appbar-token" }) }], account.id);
    const clearAccountHistorySpy = vi.fn();
    const offlineSyncRetrySpy = vi.fn();
    const actualUseTransfers = transferOwnerModule.useTransfers;
    const actualUseOfflineSyncWorkspace = offlineSyncOwnerModule.useOfflineSyncWorkspace;
    const transferOwnerSpy = vi.spyOn(transferOwnerModule, "useTransfers").mockImplementation((clock) => {
      const owner = actualUseTransfers(clock);
      return {
        ...owner,
        clearAccountHistory: (accountId) => {
          clearAccountHistorySpy(accountId);
          owner.clearAccountHistory(accountId);
        }
      };
    });
    const offlineSyncOwnerSpy = vi.spyOn(offlineSyncOwnerModule, "useOfflineSyncWorkspace").mockImplementation((input) => {
      const owner = actualUseOfflineSyncWorkspace(input);
      return {
        ...owner,
        commands: {
          ...owner.commands,
          retry: async (task) => {
            offlineSyncRetrySpy(task);
            await owner.commands.retry(task);
          }
        }
      };
    });
    mockedApi.fetchDownloadBlob.mockRejectedValueOnce(new Error("authoritative retry failure"));
    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(await screen.findByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(primaryKeepOfflineButton());
    const syncDialog = await screen.findByRole("dialog", { name: /Keep offline confirmation/i });
    fireEvent.click(within(syncDialog).getByRole("button", { name: /Start sync/i }));
    await waitFor(() => expect(mockedApi.fetchDownloadBlob).toHaveBeenCalled());
    const workspace = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (!workspace || workspace.kind !== "workspace") throw new Error("Expected actual workspace capture");
    const appBar = workspace.common.appBar;
    const collectCallablePaths = (value: unknown, prefix: string, seen = new Set<object>()): string[] => {
      if (typeof value === "function") return [prefix];
      if (!value || typeof value !== "object") return [];
      if (Array.isArray(value)) return [];
      if (isValidElement(value)) return collectCallablePaths(value.props, `${prefix}.props`, seen);
      if (seen.has(value)) return [];
      seen.add(value);
      return Object.entries(value).flatMap(([key, child]) => {
        if (key === "_owner" || key === "tasks") return [];
        return collectCallablePaths(child, prefix ? `${prefix}.${key}` : key, seen);
      });
    };
    const discoveredCallablePaths = collectCallablePaths(appBar, "").sort();
    expect(discoveredCallablePaths).toEqual([
      "install.onInstall", "sortPanel.select", "sortPanel.toggle",
      "sortPanel.reset.cancel", "sortPanel.reset.confirm", "sortPanel.reset.request",
      "onOpenNavigationDrawer",
      "onSearchQueryChange", "onCloseMobileSearch", "onNavigateUp", "onOpenMobileSearch", "onOpenSettings",
      "transferTray.props.onCancelTransfer", "transferTray.props.onClearFinished",
      "transferTray.props.onRetryFailedSync", "transferTray.props.onRetryTransfer", "transferTray.props.onToggleOpen"
    ].sort());
    expect(typeof appBar.hasSession).toBe("boolean");
    expect(appBar.hasSession).toBe(true);
    const forbidden = [
      mockedApi.deleteFile, accountDeleteMock, mockedCache.clearNamespaceOrThrow,
      mockedCache.clearFolderPathOrThrow, mockedRetentionRepository.removeRoot,
      mockedRetentionRepository.clearNormalCache, mockedRetentionRepository.purgeAccountNamespace
    ];
    const transferTray = appBar.transferTray;
    if (!isValidElement(transferTray)) throw new Error("Expected actual transfer tray element");
    const trayProps = transferTray.props as Record<string, unknown>;
    expect(Object.keys(trayProps).sort()).toEqual(["onCancelTransfer", "onClearFinished", "onRetryFailedSync", "onRetryTransfer", "onToggleOpen", "open", "tasks"].sort());
    const capturedTasks = trayProps.tasks as readonly TransferTask[];
    const taskContainsCallable = (value: unknown, seen = new Set<object>()): boolean => {
      if (typeof value === "function") return true;
      if (!value || typeof value !== "object") return false;
      if (seen.has(value)) return false;
      seen.add(value);
      if (Array.isArray(value)) return value.some((entry) => taskContainsCallable(entry, seen));
      return Object.entries(value).some(([key, child]) => key !== "_owner" && taskContainsCallable(child, seen));
    };
    expect(capturedTasks.every((task) => !taskContainsCallable(task))).toBe(true);
    const retryTask = capturedTasks.find((task) => task.kind === "sync");
    if (!retryTask) throw new Error("Expected an authoritative failed-sync task in the actual transfer tray");
    expect(retryTask.accountId).toBe(account.id);
    const retryDialogCount = () => appShellCapture.history.filter((entry) => entry.kind === "workspace" && entry.overlays.offlineSync.open).length;
    const beforeRetryDialogs = retryDialogCount();
    act(() => {
      appBar.install.onInstall();
      appBar.sortPanel.toggle();
      appBar.sortPanel.select("name-desc");
      appBar.onOpenNavigationDrawer();
      appBar.onSearchQueryChange("actual-safe-query");
      appBar.onCloseMobileSearch();
      appBar.onNavigateUp();
      appBar.onOpenMobileSearch();
      appBar.onOpenSettings();
      (trayProps.onToggleOpen as () => void)();
      (trayProps.onRetryFailedSync as (task: TransferTask) => void)(retryTask);
    });
    await waitFor(() => expect(retryDialogCount()).toBeGreaterThan(beforeRetryDialogs));
    const retryDialog = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace" && entry.overlays.offlineSync.open);
    if (retryDialog?.kind === "workspace") expect(retryDialog.overlays.offlineSync.selectionLabel).toContain(retryTask.failedFiles?.[0]?.sourcePath.split("/").pop() ?? "");
    if (screen.queryByRole("dialog", { name: /Keep offline confirmation/i })) {
      fireEvent.click(within(screen.getByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Cancel/i }));
    }
    const beforeClearTaskCount = (([...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace") as Extract<AppShellProps, { kind: "workspace" }>).common.appBar.transferTray);
    expect(isValidElement(beforeClearTaskCount)).toBe(true);
    if (isValidElement(beforeClearTaskCount)) {
      const currentTrayProps = beforeClearTaskCount.props as Record<string, unknown>;
      (currentTrayProps.onClearFinished as () => void)();
    }
    await waitFor(() => {
      const current = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
      if (current?.kind === "workspace" && isValidElement(current.common.appBar.transferTray)) {
        expect((current.common.appBar.transferTray.props as { tasks: readonly TransferTask[] }).tasks).toEqual([]);
      }
    });
    expect(clearAccountHistorySpy).toHaveBeenCalledTimes(1);
    expect(clearAccountHistorySpy).toHaveBeenCalledWith(account.id);
    expect(offlineSyncRetrySpy).toHaveBeenCalledTimes(1);
    expect(offlineSyncRetrySpy).toHaveBeenCalledWith(retryTask);
    for (const forbiddenCall of forbidden) expect(forbiddenCall).not.toHaveBeenCalled();
    expect(mockedApi.deleteFile).not.toHaveBeenCalled();
    transferOwnerSpy.mockRestore();
    offlineSyncOwnerSpy.mockRestore();
  });

  it("forwards the current install binding and does not let AppBar projection own wake-lock lifecycle", async () => {
    const wakeLock = installWakeLockMock();
    const account = buildAccount("alpha", { displayName: "AppBar lifecycle workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const prompt = vi.fn(async () => undefined);
    const userChoice = Promise.resolve({ outcome: "dismissed" as const });
    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });
    const initial = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (!initial || initial.kind !== "workspace") throw new Error("Expected lifecycle AppBar capture");
    expect(initial.common.appBar.install.available).toBe(false);
    expect(initial.common.appBar.install.busy).toBe(false);
    expect(initial.common.appBar.screenWakeLockActive).toBe(false);
    expect(initial.common.appBar.screenWakeLockReasonLabel).toBe("");
    expect(wakeLock.request).not.toHaveBeenCalled();
    expect(wakeLock.sentinel.release).not.toHaveBeenCalled();

    const installEvent = new Event("beforeinstallprompt") as Event & {
      prompt: typeof prompt;
      userChoice: typeof userChoice;
      preventDefault: () => void;
    };
    installEvent.preventDefault = vi.fn();
    installEvent.prompt = prompt;
    installEvent.userChoice = userChoice;
    window.dispatchEvent(installEvent);
    await waitFor(() => {
      const current = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
      expect(current?.kind).toBe("workspace");
      if (current?.kind === "workspace") expect(current.common.appBar.install.available).toBe(true);
    });
    const current = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (!current || current.kind !== "workspace") throw new Error("Expected current lifecycle AppBar capture");
    current.common.appBar.install.onInstall();
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(wakeLock.request).not.toHaveBeenCalled();
    expect(wakeLock.sentinel.release).not.toHaveBeenCalled();
  });

  it("routes captured current AppBar commands and canonical root/nested navigate-up", async () => {
    const account = buildAccount("alpha", { displayName: "AppBar command workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const services = createBrowserAppServices();
    const historyPushes: Array<{ readonly surface?: string; readonly path?: string }> = [];
    const history = {
      ...services.history,
      pushState(state: unknown, url?: string) {
        if (state && typeof state === "object") {
          const candidate = state as { readonly surface?: string; readonly path?: string };
          historyPushes.push({ surface: candidate.surface, path: candidate.path });
        }
        services.history.pushState(state as Parameters<typeof services.history.pushState>[0], url);
      }
    };
    render(<App services={{ ...services, history }} />);
    await screen.findByRole("button", { name: /Create folder/i });
    const initial = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    expect(initial?.kind).toBe("workspace");
    if (!initial || initial.kind !== "workspace") throw new Error("Expected workspace AppBar");
    const appBar = initial.common.appBar;
    historyPushes.length = 0;
    appBar.onOpenNavigationDrawer();
    appBar.onOpenMobileSearch();
    expect(historyPushes.map((entry) => entry.surface)).toEqual(["navigation", "search"]);
    expect(historyPushes).toHaveLength(2);
    expect(window.history.state?.surface).toBe("search");
    appBar.onSearchQueryChange("roadmap");
    await waitFor(() => {
      const current = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
      expect(current?.kind).toBe("workspace");
      if (current?.kind === "workspace") {
        expect(current.common.appBar.navigationDrawerOpen).toBe(true);
        expect(current.common.appBar.mobileSearchOpen).toBe(true);
        expect(current.common.appBar.searchQuery).toBe("roadmap");
      }
    });
    const current = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (!current || current.kind !== "workspace") throw new Error("Expected current AppBar");
    current.common.appBar.onCloseMobileSearch();
    current.common.appBar.onOpenSettings();
    expect(historyPushes.map((entry) => entry.surface)).toEqual(["navigation", "search", "settings"]);
    expect(historyPushes).toHaveLength(3);
    expect(window.history.state?.surface).toBe("settings");
    await screen.findByRole("dialog", { name: /Profile and settings/i });

    current.common.appBar.onNavigateUp();
    await waitFor(() => {
      const updated = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
      expect(updated?.kind).toBe("workspace");
      if (updated?.kind === "workspace") expect(updated.common.appBar.currentPath).toBe("");
    });
    const nested = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (nested?.kind === "workspace") {
      nested.workspace.browseHeader.onNavigateToPath("Projects/Plans");
      await waitFor(() => expect([...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace")?.kind).toBe("workspace"));
      const nestedCurrent = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
      if (nestedCurrent?.kind === "workspace") {
        nestedCurrent.common.appBar.onNavigateUp();
        await waitFor(() => {
          const parent = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
          if (parent?.kind === "workspace") expect(parent.common.appBar.currentPath).toBe("Projects");
        });
      }
    }
  });

  it("omits transfer tray without accounts and exposes a current account-scoped tray slot", async () => {
    render(<App />);
    await screen.findByRole("button", { name: /Connect account/i });
    if (appShellCapture.latest?.kind === "bootstrap") expect(appShellCapture.latest.common.appBar.transferTray).toBeUndefined();

    const account = buildAccount("alpha", { displayName: "Transfer AppBar workspace" });
    cleanup();
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });
    const workspace = appShellCapture.latest;
    expect(workspace?.kind).toBe("workspace");
    if (workspace?.kind === "workspace") expect(workspace.common.appBar.transferTray).toBeDefined();
  });

});
