import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../../diagnostics/testing/fakes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSession, ConnectedAccount, FileEntry, MutationResult } from "@davora/shared";
import { ApiRequestError } from "../../../lib/api";
import App from "../../../App";
import type { AppServices } from "../../../app/AppServices";
import { createAccountRegistryService } from "../../accounts/registry";
import type { AccountTransport } from "../../accounts";
import type { BrowsingCacheRepository, FolderPorts, SearchPorts } from "../../browsing";
import { createMemoryFolderSortService } from "../../browsing/folderSort/testing/fakeStorage";
import type { ConnectivityPort } from "../../offline/connectivity";
import type { ExplicitOfflineModeRuntimePort } from "../../offline/mode";
import { WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT, type ResponsiveViewportPort } from "../../navigation/viewport";
import type { OperationRuntimePort } from "../workspace";
import type { UploadFileContentPort } from ".";
import { DEFAULT_UI_SETTINGS } from "../../settings";
import { createBrowserUploadFileContent } from "../../../platform/upload/browserUploadFileContent";
import { createPreviewComposition } from "../../../app/createPreviewComposition";
import type { RetentionRepository, RetentionResult } from "../../offline/retention";
import { buildAccount, buildSession } from "../../../test/accounts";
import { buildHealthResponse } from "../../../test/api";
import { buildFileEntry } from "../../../test/files";
import { createDeferred } from "../../../test/primitives";

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    offlineReady: [false, vi.fn()],
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(async () => undefined)
  })
}));

const healthResponse = buildHealthResponse();
const ONLINE = { kind: "online" } as const;

type UploadApi = {
  readonly listFiles: ReturnType<typeof vi.fn>;
  readonly createFolder: ReturnType<typeof vi.fn>;
  readonly uploadFileWithProgress: ReturnType<typeof vi.fn>;
};

type ListResponse = { readonly path: string; readonly items: FileEntry[] };

function isListResponse(value: unknown): value is ListResponse {
  return typeof value === "object"
    && value !== null
    && "path" in value
    && typeof value.path === "string"
    && "items" in value
    && Array.isArray(value.items);
}

const success = <T,>(value: T): RetentionResult<T> => ({ kind: "success", value });

function createRetentionRepository(): RetentionRepository {
  const snapshot = (account: { accountId: string; cacheNamespace: string }) => success({
    account,
    normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 },
    roots: [], files: [], memberships: []
  });
  return {
    readSnapshot: vi.fn(async (account) => snapshot(account)),
    readPreview: vi.fn(async () => success(undefined)),
    writePreview: vi.fn(async (account) => snapshot(account)),
    beginRoot: vi.fn(async (account) => snapshot(account)),
    persistRetainedFile: vi.fn(async (account) => snapshot(account)),
    completeRoot: vi.fn(async (account) => snapshot(account)),
    removeRoot: vi.fn(async (account) => snapshot(account)),
    clearNormalCache: vi.fn(async (account) => snapshot(account)),
    purgeAccountNamespace: vi.fn(async (account) => snapshot(account)),
    configureNormalCacheLimit: vi.fn(async (account) => snapshot(account))
  };
}

function createUploadFixture() {
  const api: UploadApi = {
    listFiles: vi.fn(async (path: string) => ({
      path,
      items: path
        ? [buildFileEntry("Projects/roadmap.txt", { name: "roadmap.txt", size: 70, mimeType: "text/plain" })]
        : [buildFileEntry("Projects", { name: "Projects", isFolder: true }), buildFileEntry("Projects/roadmap.txt", { name: "roadmap.txt", size: 70, mimeType: "text/plain" })]
    })),
    createFolder: vi.fn(async () => ({ result: { action: "createFolder", parentPath: "", path: "Plans", item: { path: "Plans", name: "Plans", isFolder: true } } })),
    uploadFileWithProgress: vi.fn(async () => ({ result: { action: "upload", parentPath: "", path: "Projects/roadmap.txt", item: { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false } } }))
  };
  const cache: BrowsingCacheRepository = {
    readFolder: vi.fn(() => ({ kind: "miss" } as const)),
    writeFolder: vi.fn(() => ({ kind: "written" } as const)),
    readSearch: vi.fn(() => ({ kind: "miss" } as const)),
    writeSearch: vi.fn(() => ({ kind: "written" } as const)),
    clearNamespace: vi.fn(() => ({ kind: "cleared" } as const)),
    clearFolderPath: vi.fn(() => ({ kind: "cleared" } as const)),
    clearNamespaceOrThrow: vi.fn(),
    clearFolderPathOrThrow: vi.fn()
  };
  const accountTransport: AccountTransport = {
    getHealth: vi.fn(async () => healthResponse),
    connectAccount: vi.fn(),
    createSession: vi.fn(async ({ accountId }) => buildSession(buildAccount(accountId))),
    deleteConnectedAccount: vi.fn(async () => undefined)
  };
  const storage = {
    readItem: (key: string) => ({ ok: true as const, value: localStorage.getItem(key) }),
    writeItem: (key: string, value: string) => { localStorage.setItem(key, value); return { ok: true as const }; },
    deleteItem: (key: string) => { localStorage.removeItem(key); return { ok: true as const }; }
  };
  let accountRegistry: ReturnType<typeof createAccountRegistryService> | undefined;
  const getAccountRegistry = () => accountRegistry ??= createAccountRegistryService(storage, { isExpired: () => false });
  const folder: FolderPorts = {
    createAbortHandle: () => { const controller = new AbortController(); return { signal: controller.signal, abort: () => controller.abort() }; },
    loadFolder: vi.fn(async ({ path, token, signal }) => {
      try {
        const response = await api.listFiles(path, token, signal);
        return { kind: "success", items: response.path === path ? response.items as FileEntry[] : [] } as const;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return { kind: "cancelled" } as const;
        if (error instanceof ApiRequestError && error.status === 401) return { kind: "unauthorized", error } as const;
        if (error instanceof ApiRequestError && error.code === "account_reconnect_required") return { kind: "reconnect-required", error } as const;
        return { kind: "failure", error: error instanceof Error ? error : new Error("Unable to load folder.") } as const;
      }
    }),
    readCachedFolder: vi.fn(() => undefined),
    writeCachedFolder: vi.fn()
  };
  const search: SearchPorts = {
    createAbortHandle: () => { const controller = new AbortController(); return { signal: controller.signal, abort: () => controller.abort() }; },
    loadSearch: vi.fn(async () => ({ kind: "success" as const, items: [] })),
    readCachedSearch: vi.fn(() => undefined),
    writeCachedSearch: vi.fn()
  };
  const clock = { nowIso: () => "2026-01-01T00:00:00.000Z" };
  const uploadFiles: UploadFileContentPort = createBrowserUploadFileContent();
  const operationRuntime: OperationRuntimePort = {
    request: {
      createAbortHandle: () => { const controller = new AbortController(); return { signal: controller.signal, abort: () => controller.abort() }; },
      createTransferId: (() => { let next = 0; return () => `upload-transfer-${++next}`; })()
    },
    mutation: {
      createFolder: async (parentPath, name, token) => (await api.createFolder({ path: parentPath, name }, token)).result as MutationResult,
      deleteFile: async () => ({ action: "delete", parentPath: "", path: "" }),
      uploadFile: async (input, token, onProgress, signal) => (await api.uploadFileWithProgress(input, token, onProgress, signal)).result as MutationResult,
      copyOrMove: async () => ({ action: "copy", parentPath: "", path: "" }),
      listDestination: async (path, token) => {
        const response: unknown = await api.listFiles(path, token);
        if (!isListResponse(response)) throw new Error("Upload fixture returned an invalid list response.");
        return { items: response.items };
      }
    },
    download: {
      prepareDownloadFile: vi.fn(), fetchDownloadBlob: vi.fn(), listFiles: api.listFiles,
      triggerBrowserDownload: vi.fn(), saveDownload: vi.fn()
    },
    batch: { downloadSelectionAsZip: vi.fn() },
    preview: { createFileStreamUrl: vi.fn(async () => "") },
    time: { wait: async () => {} },
    uploadFiles,
    isUnauthorized: (error) => error instanceof ApiRequestError && error.status === 401,
    isReconnectRequired: (error) => error instanceof ApiRequestError && error.code === "account_reconnect_required",
    toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback
  };
  const accountSession = {
    getHealth: accountTransport.getHealth,
    createSession: accountTransport.createSession,
    commitSession: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["commitSession"]>) => getAccountRegistry().commitSession(...args),
    markAccountReconnectRequired: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["markAccountReconnectRequired"]>) => getAccountRegistry().markAccountReconnectRequired(...args),
    clearAccountSession: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["clearAccountSession"]>) => getAccountRegistry().clearAccountSession(...args),
    delay: async () => undefined
  };
  const responsiveViewport: ResponsiveViewportPort = { getSnapshot: () => WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT, subscribe: () => () => undefined };
  const connectivity: ConnectivityPort = { read: () => ONLINE, subscribe: () => () => undefined };
  const explicitOfflineRuntime: ExplicitOfflineModeRuntimePort = {
    storage: {
      read: () => ({ kind: "ready", enabled: false }),
      commit: () => ({ kind: "committed" }), reset: () => ({ kind: "committed" }), repair: () => ({ kind: "repaired" })
    },
    network: { setBlocked: () => undefined }
  };
  const retentionRepository = createRetentionRepository();
  const services = {
    accountRegistry: {
      getState: () => getAccountRegistry().getState(), getSnapshot: () => getAccountRegistry().getSnapshot(), subscribe: (listener: () => void) => getAccountRegistry().subscribe(listener), repair: () => getAccountRegistry().repair(),
      connectAccount: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["connectAccount"]>) => getAccountRegistry().connectAccount(...args), commitConnectedAccount: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["commitConnectedAccount"]>) => getAccountRegistry().commitConnectedAccount(...args), commitSession: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["commitSession"]>) => getAccountRegistry().commitSession(...args), clearAccountSession: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["clearAccountSession"]>) => getAccountRegistry().clearAccountSession(...args), markAccountReconnectRequired: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["markAccountReconnectRequired"]>) => getAccountRegistry().markAccountReconnectRequired(...args), switchAccount: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["switchAccount"]>) => getAccountRegistry().switchAccount(...args), removeAccount: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["removeAccount"]>) => getAccountRegistry().removeAccount(...args), retryRemovalCommit: (...args: Parameters<ReturnType<typeof createAccountRegistryService>["retryRemovalCommit"]>) => getAccountRegistry().retryRemovalCommit(...args)
    },
    accountTransport,
    accountSession,
    browsingCache: cache,
    favouriteResolveRuntime: { listFiles: async () => ({ items: [] }), cacheFolder: () => undefined },
    connectivity,
    explicitOfflineRuntime,
    clock,
    favourites: { load: () => ({ kind: "loaded", entries: [] }), save: () => ({ kind: "saved", entries: [] }), clear: () => ({ kind: "cleared" }), create: (entry: FileEntry) => ({ ...entry, accountId: "alpha", accountBackend: "mock", accountRootPath: "", cacheNamespace: "ns-alpha", addedAt: clock.nowIso() }) },
    favouritesPointerEnvironment: { elementFromPoint: () => null, addWindowListener: () => () => undefined },
    folder,
    folderSorts: createMemoryFolderSortService(),
    history: { pushState: (state: unknown, url?: string) => window.history.pushState(state, "", url), replaceState: (state: unknown, url?: string) => window.history.replaceState(state, "", url), getState: (): unknown => window.history.state, getLocation: () => ({ href: window.location.href, search: window.location.search }), subscribe: (listener: (state: unknown) => void) => { const handler = () => listener(window.history.state); window.addEventListener("popstate", handler); return () => window.removeEventListener("popstate", handler); } },
    pullToRefreshEnvironment: { getWindowScrollY: () => window.scrollY },
    responsiveViewport,
    search,
    settings: { load: () => DEFAULT_UI_SETTINGS, save: (settings) => settings },
    operationRuntime,
    offlineSyncRuntime: { createAbortHandle: () => { const controller = new AbortController(); return { signal: controller.signal, abort: () => controller.abort() }; }, createTransferId: () => "sync-transfer", listFiles: async (path: string) => ({ path, items: [] }), fetchDownloadBlob: vi.fn(), readBlobText: async () => "", isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback },
    retentionRepository,
    previewRuntime: createPreviewComposition({ retentionRepository }),
    accountRemovalRuntime: { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined }, diagnostics: createFakeDiagnosticsRuntimePorts()
  } satisfies AppServices;
  return { api, services };
}

function seedAccounts(records: Array<{ account: ConnectedAccount; session?: { token: string; expiresAt: string; rootPath: string; capabilities: AppSession["capabilities"] } }>, activeAccountId?: string): void {
  localStorage.setItem("davora-account-state", JSON.stringify({ activeAccountId: activeAccountId ?? records[0]?.account.id, accounts: records }));
}

function installWakeLockMock() {
  const sentinel = Object.assign(new EventTarget(), { released: false, release: vi.fn(async () => { if (!sentinel.released) { sentinel.released = true; sentinel.dispatchEvent(new Event("release")); } }) });
  const request = vi.fn(async () => sentinel);
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
  return { request, sentinel };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  Reflect.deleteProperty(navigator, "wakeLock");
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) });
});

afterEach(() => { cleanup(); Reflect.deleteProperty(navigator, "wakeLock"); });

describe("upload App integration", () => {
  it("keeps reconnect local to upload when a transient upload request fails", async () => {
    const { services, api } = createUploadFixture();
    const account = buildAccount("alpha", { displayName: "Upload workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    api.uploadFileWithProgress.mockRejectedValueOnce(new TypeError("fetch failed"));

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Create folder/i });
    const toolbar = document.querySelector<HTMLElement>(".folder-actions-inline");
    if (!toolbar) {
      throw new Error("Upload toolbar is unavailable.");
    }
    const input = within(toolbar).getByLabelText(/^Upload files$/i) as HTMLInputElement;
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(api.uploadFileWithProgress).toHaveBeenCalledWith(expect.objectContaining({ name: "hello.txt", path: "" }), "token-alpha", expect.any(Function), expect.any(AbortSignal)));
    expect(await screen.findByText(/fetch failed/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Reconnect Upload workspace/i })).not.toBeInTheDocument();
  });

  it("uploads multiple files from the normal picker flow", async () => {
    const { services, api } = createUploadFixture();
    const account = buildAccount("alpha", { displayName: "Multi upload workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Create folder/i });
    const toolbar = document.querySelector<HTMLElement>(".folder-actions-inline");
    if (!toolbar) {
      throw new Error("Upload toolbar is unavailable.");
    }
    const input = within(toolbar).getByLabelText(/^Upload files$/i) as HTMLInputElement;
    const first = new File(["alpha"], "alpha.txt", { type: "text/plain" });
    const second = new File(["beta"], "beta.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [first, second] } });

    await waitFor(() => expect(api.uploadFileWithProgress).toHaveBeenCalledTimes(2));
    expect(api.uploadFileWithProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ path: "", name: "alpha.txt" }), "token-alpha", expect.any(Function), expect.any(AbortSignal));
    expect(api.uploadFileWithProgress).toHaveBeenNthCalledWith(2, expect.objectContaining({ path: "", name: "beta.txt" }), "token-alpha", expect.any(Function), expect.any(AbortSignal));
    expect(await screen.findByText(/Uploaded 2 files into \//i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Details for (alpha|beta)\.txt/i)).not.toBeInTheDocument();
  });

  it("synchronizes focused selection only for a single uploaded file", async () => {
    const { services, api } = createUploadFixture();
    const account = buildAccount("alpha", { displayName: "Single upload workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    api.uploadFileWithProgress.mockResolvedValueOnce({
      result: {
        action: "upload",
        parentPath: "",
        path: "new.txt",
        item: { path: "new.txt", name: "new.txt", isFolder: false, size: 3, mimeType: "text/plain" }
      }
    });

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Create folder/i });
    const toolbar = document.querySelector<HTMLElement>(".folder-actions-inline");
    if (!toolbar) {
      throw new Error("Upload toolbar is unavailable.");
    }
    fireEvent.change(within(toolbar).getByLabelText(/^Upload files$/i), {
      target: { files: [new File(["new"], "new.txt", { type: "text/plain" })] }
    });

    expect(await screen.findByLabelText("Details for new.txt")).toBeInTheDocument();
  });

  it("ignores a deferred upload focus completion after navigation selects a newer item", async () => {
    const { services, api } = createUploadFixture();
    const account = buildAccount("alpha", { displayName: "Deferred upload selection workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const pending = createDeferred<Awaited<ReturnType<typeof api.uploadFileWithProgress>>>();
    api.uploadFileWithProgress.mockReturnValueOnce(pending.promise);

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Create folder/i });
    const toolbar = document.querySelector<HTMLElement>(".folder-actions-inline");
    if (!toolbar) {
      throw new Error("Upload toolbar is unavailable.");
    }
    fireEvent.change(within(toolbar).getByLabelText(/^Upload files$/i), {
      target: { files: [new File(["new"], "new.txt", { type: "text/plain" })] }
    });
    await waitFor(() => expect(api.uploadFileWithProgress).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: /Open actions for roadmap\.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap\.txt/i }));
    const currentDetails = await screen.findByLabelText("Details for roadmap.txt");

    pending.resolve({ result: {
      action: "upload",
      parentPath: "",
      path: "new.txt",
      item: { path: "new.txt", name: "new.txt", isFolder: false }
    } });
    await act(async () => { await pending.promise; });

    expect(screen.getByLabelText("Details for roadmap.txt")).toBe(currentDetails);
    expect(screen.queryByLabelText("Details for new.txt")).not.toBeInTheDocument();
  });

  it("keeps duplicate upload destinations as distinct terminal transfer records", async () => {
    const { services, api } = createUploadFixture();
    const account = buildAccount("alpha", { displayName: "Duplicate upload workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    let uploadIndex = 0;
    api.uploadFileWithProgress.mockImplementation(async () => {
      uploadIndex += 1;
      if (uploadIndex === 2) {
        throw new Error("Second duplicate failed");
      }
      return {
        result: {
          action: "upload" as const,
          parentPath: "",
          path: "same.txt",
          item: { path: "same.txt", name: "same.txt", isFolder: false as const }
        }
      };
    });

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Create folder/i });
    const toolbar = document.querySelector<HTMLElement>(".folder-actions-inline");
    if (!toolbar) {
      throw new Error("Upload toolbar is unavailable.");
    }
    fireEvent.change(within(toolbar).getByLabelText(/^Upload files$/i), {
      target: { files: [new File(["first"], "same.txt"), new File(["second"], "same.txt")] }
    });

    expect(await screen.findByText("Second duplicate failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Transfers$/i }));
    const transferStatus = await screen.findByRole("dialog", { name: /Transfer status/i });
    expect(transferStatus.querySelectorAll("li.transfer-tray-item-done")).toHaveLength(1);
    expect(transferStatus.querySelectorAll("li.transfer-tray-item-error")).toHaveLength(1);
  });

  it("aborts an in-flight upload when its account, token, and capability owner is replaced", async () => {
    const { services, api } = createUploadFixture();
    const alpha = buildAccount("alpha", { displayName: "Alpha upload workspace" });
    const beta = buildAccount("beta", { displayName: "Beta upload workspace" });
    const betaSession = buildSession(beta);
    betaSession.capabilities = { ...betaSession.capabilities, upload: false };
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: betaSession }
    ], alpha.id);
    let uploadSignal: AbortSignal | undefined;
    api.uploadFileWithProgress.mockImplementationOnce((_body, _token, _progress, signal) => new Promise((_resolve, reject) => {
      uploadSignal = signal;
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Create folder/i });
    const toolbar = document.querySelector<HTMLElement>(".folder-actions-inline");
    if (!toolbar) {
      throw new Error("Upload toolbar is unavailable.");
    }
    fireEvent.change(within(toolbar).getByLabelText(/^Upload files$/i), {
      target: { files: [new File(["alpha"], "alpha.txt", { type: "text/plain" })] }
    });
    await waitFor(() => expect(api.uploadFileWithProgress).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } });

    await waitFor(() => expect(uploadSignal?.aborted).toBe(true));
    expect(screen.queryByText(/Uploaded 1 file into/i)).not.toBeInTheDocument();
  });

  it("tolerates only typed folder conflicts during directory upload", async () => {
    const { services, api } = createUploadFixture();
    const account = buildAccount("alpha", { displayName: "Conflict upload workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    api.createFolder.mockRejectedValueOnce(new ApiRequestError("Destination already exists", 409, "conflict"));

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Create folder/i });
    const toolbar = document.querySelector<HTMLElement>(".folder-actions-inline");
    if (!toolbar) {
      throw new Error("Upload toolbar is unavailable.");
    }
    const file = new File(["nested"], "nested.txt", { type: "text/plain" });
    Object.defineProperty(file, "webkitRelativePath", { configurable: true, value: "Folder/nested.txt" });
    fireEvent.change(within(toolbar).getByLabelText(/^Upload folder$/i), { target: { files: [file] } });

    await waitFor(() => expect(api.uploadFileWithProgress).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Uploaded 1 file from 1 folder into \//i)).toBeInTheDocument();
  });

  it("does not tolerate an ordinary upload-folder failure with already-exists wording", async () => {
    const { services, api } = createUploadFixture();
    const account = buildAccount("alpha", { displayName: "Ordinary folder failure workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    api.createFolder.mockRejectedValueOnce(new Error("Folder already exists but this is not a typed conflict"));

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Create folder/i });
    const toolbar = document.querySelector<HTMLElement>(".folder-actions-inline");
    if (!toolbar) {
      throw new Error("Upload toolbar is unavailable.");
    }
    const file = new File(["nested"], "nested.txt", { type: "text/plain" });
    Object.defineProperty(file, "webkitRelativePath", { configurable: true, value: "Folder/nested.txt" });
    fireEvent.change(within(toolbar).getByLabelText(/^Upload folder$/i), { target: { files: [file] } });

    expect(await screen.findByText(/not a typed conflict/i)).toBeInTheDocument();
    expect(api.uploadFileWithProgress).not.toHaveBeenCalled();
  });

  it("aborts an in-flight upload when navigation changes its owning folder", async () => {
    const { services, api } = createUploadFixture();
    const account = buildAccount("alpha", { displayName: "Navigation upload workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    let uploadSignal: AbortSignal | undefined;
    api.uploadFileWithProgress.mockImplementationOnce((_body, _token, _progress, signal) => new Promise((_resolve, reject) => {
      uploadSignal = signal;
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    const toolbar = document.querySelector(".folder-actions-inline") as HTMLElement;
    fireEvent.change(within(toolbar).getByLabelText(/^Upload files$/i), {
      target: { files: [new File(["alpha"], "alpha.txt", { type: "text/plain" })] }
    });
    await waitFor(() => expect(api.uploadFileWithProgress).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));

    await waitFor(() => expect(uploadSignal?.aborted).toBe(true));
    expect(screen.queryByText(/Uploaded 1 file into/i)).not.toBeInTheDocument();
  });

  it("does not publish upload success when its required refresh terminates the session", async () => {
    const { services, api } = createUploadFixture();
    const account = buildAccount("alpha", { displayName: "Refresh upload workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    let terminateRefresh = false;
    api.listFiles.mockImplementation(async (path: string) => {
      if (terminateRefresh) {
        terminateRefresh = false;
        throw new ApiRequestError("Session expired", 401);
      }
      return {
        path,
        items: path === "" ? [{ path: "Projects", name: "Projects", isFolder: true }] : []
      };
    });

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Create folder/i });
    terminateRefresh = true;
    const toolbar = document.querySelector(".folder-actions-inline") as HTMLElement;
    fireEvent.change(within(toolbar).getByLabelText(/^Upload files$/i), {
      target: { files: [new File(["alpha"], "alpha.txt", { type: "text/plain" })] }
    });

    await waitFor(() => expect(api.listFiles.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText(/Uploaded 1 file into/i)).not.toBeInTheDocument();
  });

  it("terminalizes every queued upload and releases the wake lock when a multi-file upload aborts", async () => {
    const { services, api } = createUploadFixture();
    const account = buildAccount("alpha", { displayName: "Failed multi upload workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    api.uploadFileWithProgress.mockRejectedValueOnce(new Error("First upload failed"));
    const wakeLock = installWakeLockMock();

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Create folder/i });
    const toolbar = document.querySelector(".folder-actions-inline") as HTMLElement;
    const input = within(toolbar).getByLabelText(/^Upload files$/i) as HTMLInputElement;
    const first = new File(["alpha"], "alpha.txt", { type: "text/plain" });
    const second = new File(["beta"], "beta.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [first, second] } });

    await waitFor(() => expect(wakeLock.request).toHaveBeenCalledWith("screen"));
    expect(await screen.findByText(/First upload failed/i)).toBeInTheDocument();
    expect(api.uploadFileWithProgress).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(wakeLock.sentinel.release).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /^Transfers$/i }));
    const transferStatus = await screen.findByRole("dialog", { name: /Transfer status/i });
    await waitFor(() => expect(transferStatus.querySelectorAll("li.transfer-tray-item-error")).toHaveLength(2));
    expect(within(transferStatus).queryByText("Queued")).not.toBeInTheDocument();
  });

  it("uploads a directory while preserving relative paths under the current folder", async () => {
    const { services, api } = createUploadFixture();
    const account = buildAccount("alpha", { displayName: "Folder upload workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Create folder/i });
    const toolbar = document.querySelector(".folder-actions-inline") as HTMLElement;
    const input = within(toolbar).getByLabelText(/^Upload folder$/i) as HTMLInputElement;
    const first = new File(["cover"], "cover.png", { type: "image/png" });
    const second = new File(["track"], "track.mp3", { type: "audio/mpeg" });
    Object.defineProperty(first, "webkitRelativePath", { configurable: true, value: "Mixtape/assets/cover.png" });
    Object.defineProperty(second, "webkitRelativePath", { configurable: true, value: "Mixtape/track.mp3" });
    fireEvent.change(input, { target: { files: [first, second] } });

    await waitFor(() => expect(api.createFolder).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.uploadFileWithProgress).toHaveBeenCalledTimes(2));
    expect(api.createFolder).toHaveBeenNthCalledWith(1, { path: "", name: "Mixtape" }, "token-alpha");
    expect(api.createFolder).toHaveBeenNthCalledWith(2, { path: "Mixtape", name: "assets" }, "token-alpha");
    expect(api.uploadFileWithProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ path: "Mixtape/assets", name: "cover.png" }), "token-alpha", expect.any(Function), expect.any(AbortSignal));
    expect(api.uploadFileWithProgress).toHaveBeenNthCalledWith(2, expect.objectContaining({ path: "Mixtape", name: "track.mp3" }), "token-alpha", expect.any(Function), expect.any(AbortSignal));
    expect(await screen.findByText(/Uploaded 2 files from 1 folder into \//i)).toBeInTheDocument();
  });

  it("requires create-folder capability for directory uploads but not flat-file uploads", async () => {
    const { services, api } = createUploadFixture();
    const account = buildAccount("alpha", { displayName: "Upload-only workspace" });
    const session = buildSession(account);
    session.capabilities = { ...session.capabilities, createFolder: false, upload: true };
    seedAccounts([{ account, session }], account.id);

    render(<App services={services} />);
    await screen.findByRole("button", { name: /Create folder/i });
    const toolbar = document.querySelector<HTMLElement>(".folder-actions-inline");
    expect(toolbar).not.toBeNull();
    if (!toolbar) {
      throw new Error("Upload toolbar is unavailable.");
    }
    const folderInput = within(toolbar).getByLabelText(/^Upload folder$/i);
    expect(folderInput).toBeDisabled();
    expect(within(toolbar).getByLabelText(/^Upload files$/i)).toBeEnabled();
    const nested = new File(["nested"], "nested.txt", { type: "text/plain" });
    Object.defineProperty(nested, "webkitRelativePath", { configurable: true, value: "Folder/nested.txt" });
    fireEvent.change(folderInput, { target: { files: [nested] } });

    await act(async () => Promise.resolve());
    expect(api.createFolder).not.toHaveBeenCalled();
    expect(api.uploadFileWithProgress).not.toHaveBeenCalled();

    const fileInput = within(toolbar).getByLabelText(/^Upload files$/i);
    fireEvent.change(fileInput, { target: { files: [new File(["flat"], "flat.txt", { type: "text/plain" })] } });
    await waitFor(() => expect(api.uploadFileWithProgress).toHaveBeenCalledTimes(1));
  });

  it("accepts drag-and-drop upload in the folder view", async () => {
    const { services, api } = createUploadFixture();
    const account = buildAccount("alpha", { displayName: "Drop workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Create folder/i });
    const dropZone = document.querySelector(".file-list-panel") as HTMLElement;
    const file = new File(["dropped"], "dropped.txt", { type: "text/plain" });

    fireEvent.dragEnter(dropZone, { dataTransfer: { files: [file], types: ["Files"] } });
    expect(dropZone.className).toContain("file-list-panel-drop-active");
    fireEvent.drop(dropZone, { dataTransfer: { files: [file], types: ["Files"] } });

    await waitFor(() => expect(api.uploadFileWithProgress).toHaveBeenCalledWith(expect.objectContaining({ name: "dropped.txt", path: "" }), "token-alpha", expect.any(Function), expect.any(AbortSignal)));
    expect(await screen.findByText(/Uploaded 1 file into \/ via drag and drop/i)).toBeInTheDocument();
  });

  it("does not activate, prevent, or upload a file drop when upload capability is unavailable", async () => {
    const { services, api } = createUploadFixture();
    const account = buildAccount("alpha", { displayName: "Read-only drop workspace" });
    const session = buildSession(account);
    session.capabilities = { ...session.capabilities, upload: false };
    seedAccounts([{ account, session }], account.id);

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    const dropZone = document.querySelector<HTMLElement>(".file-list-panel");
    if (!dropZone) throw new Error("File drop zone is unavailable.");
    const file = new File(["dropped"], "dropped.txt", { type: "text/plain" });
    const dragEnter = new Event("dragenter", { bubbles: true, cancelable: true });
    Object.defineProperty(dragEnter, "dataTransfer", { value: { files: [file], types: ["Files"] } });
    fireEvent(dropZone, dragEnter);

    expect(dragEnter.defaultPrevented).toBe(false);
    expect(dropZone.className).not.toContain("file-list-panel-drop-active");

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [file], types: ["Files"] } });
    fireEvent(dropZone, drop);

    expect(drop.defaultPrevented).toBe(false);
    expect(dropZone.className).not.toContain("file-list-panel-drop-active");
    expect(api.uploadFileWithProgress).not.toHaveBeenCalled();
  });
});
