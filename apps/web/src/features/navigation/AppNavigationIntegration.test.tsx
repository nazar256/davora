import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSession, ConnectedAccount } from "@davora/shared";
import type { AccountTransport } from "../accounts";

import AppComponent from "../../App";
import type { AppShellProps } from "../../app/AppShell";
import { createBrowserAppServices as createBrowserAppServicesFixture } from "../../app/createBrowserAppServices";
import { createAccountRemovalRuntime } from "../../app/createAccountRemovalRuntime";
import { createPreviewComposition } from "../../app/createPreviewComposition";
import { createBrowserFolderPorts } from "../../platform/api/browserFolderPorts";
import { createBrowserSearchPorts } from "../../platform/api/browserSearchPorts";
import { createBrowserFavouriteResolveRuntime } from "../../platform/api/browserFavouriteResolveRuntime";
import { createBrowserOperationRuntime } from "../../platform/api/browserOperationRuntime";
import { createBrowserOfflineSyncRuntime } from "../../platform/offline/browserOfflineSyncRuntime";
import { createBrowserPreviewModalRuntime } from "../../platform/preview/browserPreviewModalRuntime";
import {
  type RetainedFile,
  type RetainedRoot,
  type RetainedSnapshot,
  type RetentionAccount,
  type RetentionResult
} from "../offline/retention";
import type { BrowsingCacheRepository } from "../browsing";
import * as heicPreview from "../../lib/heicPreview";
import { setBackendNetworkBlocked } from "../../lib/networkPolicy";
import type { OpenedFileRepository } from "../../platform/storage/openedFileRepository";
import { buildAccount, buildSession } from "../../test/accounts";
import { buildHealthResponse } from "../../test/api";
import { buildFilePreview } from "../../test/files";
import { createDeferred } from "../../test/primitives";

const App = (props: React.ComponentProps<typeof AppComponent> = {}) => (
  <AppComponent {...props} services={props.services ?? createBrowserAppServices()} />
);

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

vi.mock("../../app/AppShell", async () => {
  const actual = await vi.importActual<typeof import("../../app/AppShell")>("../../app/AppShell");
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
vi.mock("../../components/MarkdownPreview", () => ({ MarkdownPreview: ({ content }: { content: string }) => <div data-testid="markdown-preview">{content}</div> }));
vi.mock("../../lib/heicPreview", async () => {
  const actual = await vi.importActual<typeof import("../../lib/heicPreview")>("../../lib/heicPreview");
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

const mockedApi = {
  getHealth: accountGetHealthMock,
  connectAccount: accountConnectMock,
  createSession: accountCreateSessionMock,
  deleteConnectedAccount: accountDeleteMock,
  listFiles: vi.fn<typeof import("../../lib/api").listFiles>(),
  getFile: vi.fn<typeof import("../../lib/api").getFile>(),
  searchFiles: vi.fn<typeof import("../../lib/api").searchFiles>(),
  downloadFile: vi.fn<typeof import("../../lib/api").downloadFile>(),
  prepareDownloadFile: vi.fn<typeof import("../../lib/api").prepareDownloadFile>(),
  fetchDownloadBlob: vi.fn<typeof import("../../lib/api").fetchDownloadBlob>(),
  fetchOriginalFile: vi.fn<typeof import("../../lib/api").fetchOriginalFile>(),
  createStreamingFileUrl: vi.fn<typeof import("../../lib/api").createStreamingFileUrl>(async (path) => `/api/file/stream?path=${encodeURIComponent(path)}&streamToken=stream-token-alpha`),
  triggerBrowserDownload: vi.fn<typeof import("../../lib/api").triggerBrowserDownload>(),
  createFolder: vi.fn<typeof import("../../lib/api").createFolder>(),
  uploadFile: vi.fn<typeof import("../../lib/api").uploadFile>(),
  uploadFileWithProgress: vi.fn<typeof import("../../lib/api").uploadFileWithProgress>(),
  moveFile: vi.fn<typeof import("../../lib/api").moveFile>(),
  copyFile: vi.fn<typeof import("../../lib/api").copyFile>(),
  deleteFile: vi.fn<typeof import("../../lib/api").deleteFile>()
};
const mockedCache = browsingCacheFixture.repository;
const mockedHeicPreview = vi.mocked(heicPreview);

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
    folderAudioRuntime: { ...services.previewRuntime.folderAudio, createStreamingFileUrl: mockedApi.createStreamingFileUrl },
    previewTransport: {
      getFile: mockedApi.getFile,
      fetchOriginalFile: mockedApi.fetchOriginalFile,
      createStreamingFileUrl: mockedApi.createStreamingFileUrl
    }
  });
  return {
    ...services,
    accountTransport,
    accountRemovalRuntime: createAccountRemovalRuntime({
      accountTransport,
      retentionRepository: retentionFixture.repository,
      browsingCache: browsingCacheFixture.repository,
      favourites: services.favourites
    }),
    accountSession: { ...services.accountSession, getHealth: accountTransport.getHealth, createSession: accountTransport.createSession },
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
    offlineSyncRuntime: createBrowserOfflineSyncRuntime({ listFiles: mockedApi.listFiles, fetchDownloadBlob: mockedApi.fetchDownloadBlob }),
    retentionRepository: retentionFixture.repository,
    previewRuntime
  } satisfies ReturnType<typeof createBrowserAppServicesFixture>;
}

const createObjectUrlMock = vi.fn(() => "blob:preview");
const revokeObjectUrlMock = vi.fn();
const windowOpenMock = vi.fn<Window["open"]>(() => window);
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





const healthResponse = buildHealthResponse();
let lastConnectedAccount: ConnectedAccount | undefined;

function seedAccounts(records: Array<{ account: ConnectedAccount; session?: { token: string; expiresAt: string; rootPath: string; capabilities: AppSession["capabilities"] }; pendingRemoval?: { phase: "revoke" | "purge" }; pendingReconnect?: { baseUrl: string; username: string; label?: string } }>, activeAccountId?: string) {
  localStorage.setItem("davora-account-state", JSON.stringify({
    activeAccountId: activeAccountId ?? records[0]?.account.id,
    accounts: records
  }));
}










const textPreview = buildFilePreview("Projects/roadmap.txt", {
  size: 70,
  content: "normalized API preview",
  bytesRead: 22
});





















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
  mockedApi.getFile.mockResolvedValue({ file: textPreview });
  mockedApi.searchFiles.mockResolvedValue({
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


describe("App navigation integration", () => {
it("maps browser back from a nested folder to the previous app folder", async () => {
    const account = buildAccount("alpha", { displayName: "Back workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    expect(await screen.findByRole("button", { name: /Open file roadmap.txt/i })).toBeInTheDocument();

    act(() => dispatchAppBack(""));

    expect(await screen.findByRole("heading", { name: /Home/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open folder Projects/i })).toBeInTheDocument();
  })

it("maps browser back to close preview before leaving the folder", async () => {
    const account = buildAccount("alpha", { displayName: "Preview back workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Open file roadmap.txt/i }));
    expect(await screen.findByRole("dialog", { name: /Preview roadmap.txt/i })).toBeInTheDocument();

    act(() => dispatchAppBack("Projects"));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Preview roadmap.txt/i })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Open file roadmap.txt/i })).toBeInTheDocument();
  })

it("maps browser back to close the destination picker before leaving the folder", async () => {
    const account = buildAccount("alpha", { displayName: "Destination back workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: /Open actions for roadmap.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /Copy or move/i }));

    expect(await screen.findByRole("dialog", { name: /Copy or move item/i })).toBeInTheDocument();
    act(() => dispatchAppBack("Projects"));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Copy or move item/i })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Close actions for roadmap.txt/i })).toBeInTheDocument();
  })

it("maps browser back to close the add-account connect dialog", async () => {
    const account = buildAccount("alpha", { displayName: "Connect back workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(within(settings).getByRole("button", { name: /Add account/i }));
    expect(await screen.findByRole("heading", { name: /Add Nextcloud account/i })).toBeInTheDocument();

    act(() => dispatchAppBack(""));

    await waitFor(() => expect(screen.queryByRole("heading", { name: /Add Nextcloud account/i })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Create folder/i })).toBeInTheDocument();
  })

it("keeps browser Back wired to the current workflow after an App rerender", async () => {
    const account = buildAccount("alpha", { displayName: "Rerender back workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    const view = render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Create folder/i }));
    expect(await screen.findByRole("dialog", { name: /Create folder/i })).toBeInTheDocument();

    view.rerender(<App />);
    act(() => dispatchAppBack(""));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Create folder/i })).not.toBeInTheDocument());
  })

it("maps browser back to close settings and mobile search surfaces first", async () => {
    const account = buildAccount("alpha", { displayName: "Surface back workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    expect(await screen.findByRole("dialog", { name: /Profile and settings/i })).toBeInTheDocument();

    act(() => dispatchAppBack(""));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Profile and settings/i })).not.toBeInTheDocument());

    cleanup();
    matchMediaMatches = true;
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    render(<App />);
    await screen.findByRole("button", { name: /Open search/i });
    fireEvent.click(screen.getByRole("button", { name: /Open search/i }));
    expect(screen.getByRole("button", { name: /Close search/i })).toBeInTheDocument();

    act(() => dispatchAppBack(""));

    await waitFor(() => expect(screen.queryByRole("button", { name: /Close search/i })).not.toBeInTheDocument());
  })

it("prioritizes a workflow surface over an open chrome surface on Back", async () => {
    const account = buildAccount("alpha", { displayName: "Back priority workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Create folder/i }));
    expect(await screen.findByRole("dialog", { name: /Create folder/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });

    act(() => dispatchAppBack(""));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Create folder/i })).not.toBeInTheDocument());
    expect(settingsDialog).toBeInTheDocument();

    act(() => dispatchAppBack(""));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Profile and settings/i })).not.toBeInTheDocument());
  })

it("applies a popstate dismiss and path change once, revoking preview resources once", async () => {
    const account = buildAccount("alpha", { displayName: "Popstate cleanup workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockImplementation(async (path: string) => path === "Projects"
      ? {
        path,
        items: [{ path: "Projects/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" }]
      }
      : { path, items: [{ path: "Projects", name: "Projects", isFolder: true }] });
    mockedApi.getFile.mockResolvedValue({
      file: buildFilePreview("Projects/photo.png", {
        name: "photo.png",
        mimeType: "image/png",
        viewer: "image",
        requiresOriginalBlob: true,
        content: "",
        encoding: "none"
      })
    });
    mockedApi.fetchOriginalFile.mockResolvedValue({
      blob: new Blob(["png"], { type: "image/png" }),
      mimeType: "image/png",
      filename: "photo.png"
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open folder Projects/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.png/i }));
    await screen.findByRole("dialog", { name: /Preview photo.png/i });
    await waitFor(() => expect(createObjectUrlMock).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { davora: true, path: "" } }));
    });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Preview photo.png/i })).not.toBeInTheDocument());
    expect(await screen.findByRole("heading", { name: /Home/i })).toBeInTheDocument();
    expect(revokeObjectUrlMock).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { davora: true, path: "" } }));
    });
    expect(revokeObjectUrlMock).toHaveBeenCalledTimes(1);
  })

it("maps browser back to close the mobile selected-file action sheet", async () => {
    matchMediaMatches = true;
    const account = buildAccount("alpha", { displayName: "Action sheet back workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Open actions for Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));
    expect(await screen.findByRole("region", { name: /Details for Projects/i })).toBeInTheDocument();

    act(() => dispatchAppBack(""));

    await waitFor(() => expect(document.querySelector(".details-panel")).toHaveAttribute("data-mobile-hidden", "true"));
    expect(document.querySelector(".details-panel")).not.toHaveClass("details-panel-sheet-open");
  })

it("syncs current folder path to URL query params", async () => {
    const account = buildAccount("alpha", { displayName: "URL sync workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: /Open file roadmap.txt/i });

    expect(window.location.search).toContain("path=Projects");
    expect(window.location.search).toContain("account=alpha");
  })

it("restores nested folder path from URL query params on mount", async () => {
    const account = buildAccount("alpha", { displayName: "URL restore workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    window.history.replaceState(null, "", "?path=Projects&account=alpha");

    render(<App />);

    await waitFor(() => {
      expect(mockedApi.listFiles).toHaveBeenCalledWith(
        "Projects",
        expect.any(String),
        expect.any(AbortSignal)
      );
    });
    expect(await screen.findByRole("button", { name: /Open file roadmap.txt/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open folder Projects/i })).not.toBeInTheDocument();
    expect(window.location.search).toContain("path=Projects");
  })

it("reloads current folder on pull-to-refresh gesture", async () => {
    const account = buildAccount("alpha", { displayName: "Pull refresh workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const refresh = createDeferred<{ path: string; items: Array<{ path: string; name: string; isFolder: boolean; size?: number; mimeType?: string }> }>();
    let projectsLoadCount = 0;
    mockedApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects") {
        projectsLoadCount += 1;
        if (projectsLoadCount === 2) {
          return refresh.promise;
        }
      }
      return path === "Projects"
        ? { path: "Projects", items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] }
        : { path: "", items: [{ path: "Projects", name: "Projects", isFolder: true }] };
    });

    render(<App />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: /Open file roadmap.txt/i });

    const main = document.querySelector<HTMLElement>(".workspace-layout");
    expect(main).not.toBeNull();
    if (!main) throw new Error("Expected the workspace layout.");
    const locationBeforeRefresh = window.location.href;
    fireEvent.touchStart(main, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(main, { touches: [{ clientY: 150 }] });
    expect(screen.getByRole("status")).toHaveTextContent("Release to refresh");
    fireEvent.touchEnd(main);

    await waitFor(() => expect(mockedApi.listFiles).toHaveBeenLastCalledWith("Projects", "token-alpha", expect.any(AbortSignal)));
    expect(window.location.href).toBe(locationBeforeRefresh);
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing...");
    refresh.resolve({ path: "Projects", items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  })
});
