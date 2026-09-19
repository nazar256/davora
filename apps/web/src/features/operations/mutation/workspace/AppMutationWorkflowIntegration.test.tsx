import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../../../diagnostics/testing/fakes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../../../App";
import type { AppServices } from "../../../../app/AppServices";
import { createMemoryFolderSortService } from "../../../../features/browsing/folderSort/testing/fakeStorage";
import { ApiRequestError } from "../../../../lib/api";
import { buildAccount, buildSession } from "../../../../test/accounts";
import { buildHealthResponse } from "../../../../test/api";
import { buildFileEntry } from "../../../../test/files";
import { createDeferred } from "../../../../test/primitives";

type FileEntry = Parameters<AppServices["favourites"]["create"]>[0];
type Account = ReturnType<AppServices["accountRegistry"]["getState"]>["snapshot"]["accounts"][number]["account"];
type Session = NonNullable<ReturnType<AppServices["accountRegistry"]["getState"]>["snapshot"]["accounts"][number]["session"]>;
type MutationResult = Awaited<ReturnType<AppServices["operationRuntime"]["mutation"]["copyOrMove"]>>;
type ListResponse = { path: string; items: FileEntry[] };

const mutationApi = {
  listFiles: vi.fn<(path: string, token: string, signal?: AbortSignal) => Promise<ListResponse>>(),
  copyFile: vi.fn<(input: { path: string; destinationPath: string }, token: string) => Promise<{ result: MutationResult }>>(),
  moveFile: vi.fn<(input: { path: string; destinationPath: string }, token: string) => Promise<{ result: MutationResult }>>(),
  deleteFile: vi.fn<(input: { path: string; confirmName: string }, token: string) => Promise<{ result: MutationResult }>>()
};

const healthResponse = buildHealthResponse();
const ONLINE = { kind: "online" } as const;
const WIDE_VIEWPORT = { kind: "wide" } as const;
const dirname = (path: string) => path.slice(0, path.lastIndexOf("/"));
const api = mutationApi;
void api;
const { registerSwMock } = vi.hoisted(() => ({ registerSwMock: vi.fn(() => ({
  offlineReady: [false, vi.fn()] as [boolean, (value: boolean) => void],
  needRefresh: [false, vi.fn()] as [boolean, (value: boolean) => void],
  updateServiceWorker: vi.fn(async () => undefined)
})) }));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: registerSwMock
}));

function abortHandle() {
  const controller = new AbortController();
  return { signal: controller.signal, abort: () => controller.abort() };
}

function createRetentionRepository(): AppServices["retentionRepository"] {
  const snapshot = (account: Parameters<AppServices["retentionRepository"]["readSnapshot"]>[0]) => ({
    account,
    normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 },
    roots: [], files: [], memberships: []
  });
  return {
    readSnapshot: async (account) => ({ kind: "success", value: snapshot(account) }),
    readPreview: async () => ({ kind: "success", value: undefined }),
    writePreview: async (account) => ({ kind: "success", value: snapshot(account) }),
    beginRoot: async (account) => ({ kind: "success", value: snapshot(account) }),
    persistRetainedFile: async (account) => ({ kind: "success", value: snapshot(account) }),
    completeRoot: async (account) => ({ kind: "success", value: snapshot(account) }),
    removeRoot: async (account) => ({ kind: "success", value: snapshot(account) }),
    clearNormalCache: async (account) => ({ kind: "success", value: snapshot(account) }),
    purgeAccountNamespace: async (account) => ({ kind: "success", value: snapshot(account) }),
    configureNormalCacheLimit: async (account) => ({ kind: "success", value: snapshot(account) })
  };
}

function createMutationServices(): AppServices {
  const rawState = localStorage.getItem("davora-account-state");
  let snapshot: ReturnType<AppServices["accountRegistry"]["getSnapshot"]> = rawState
    ? JSON.parse(rawState)
    : { accounts: [] };
  let state = { kind: "ready" as const, snapshot };
  const listeners = new Set<() => void>();
  const publish = (next: typeof snapshot) => {
    snapshot = next;
    state = { kind: "ready", snapshot };
    localStorage.setItem("davora-account-state", JSON.stringify(next));
    listeners.forEach((listener) => listener());
  };
  const committed = () => ({ kind: "committed" as const, snapshot });
  const accountRegistry: AppServices["accountRegistry"] = {
    getState: () => state,
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    repair: committed,
    connectAccount: async () => ({ kind: "failed", message: "Account connection is not part of this workflow.", clearCredential: false }),
    commitConnectedAccount: (account) => { publish({ activeAccountId: account.id, accounts: [...snapshot.accounts, { account }] }); return committed(); },
    commitSession: (accountId: string, session: Session) => {
      publish({ ...snapshot, accounts: snapshot.accounts.map((record) => record.account.id === accountId ? { ...record, session } : record) });
      return committed();
    },
    clearAccountSession: (accountId) => {
      publish({ ...snapshot, accounts: snapshot.accounts.map((record) => record.account.id === accountId ? { account: record.account } : record) });
      return committed();
    },
    markAccountReconnectRequired: (accountId) => {
      publish({ ...snapshot, accounts: snapshot.accounts.map((record) => record.account.id === accountId ? { ...record, account: { ...record.account, connectionState: "reconnect_required" }, session: undefined } : record) });
      return committed();
    },
    switchAccount: (accountId) => {
      if (!snapshot.accounts.some((record) => record.account.id === accountId)) return { kind: "invalid", reason: "unknown-account", message: "That account is no longer available." };
      publish({ ...snapshot, activeAccountId: accountId });
      return committed();
    },
    removeAccount: async (accountId) => { publish({ accounts: snapshot.accounts.filter((record) => record.account.id !== accountId) }); return { kind: "committed", snapshot }; },
    retryRemovalCommit: () => ({ kind: "failed", message: "No removal is pending." })
  };
  const cache: AppServices["browsingCache"] = {
    readFolder: () => ({ kind: "miss" }), writeFolder: () => ({ kind: "written" }),
    readSearch: () => ({ kind: "miss" }), writeSearch: () => ({ kind: "written" }),
    clearNamespace: () => ({ kind: "cleared" }), clearFolderPath: () => ({ kind: "cleared" }),
    clearNamespaceOrThrow: () => undefined, clearFolderPathOrThrow: () => undefined
  };
  const listFiles = async (path: string, token: string, signal?: AbortSignal) => mutationApi.listFiles(path, token, signal);
  const folder: AppServices["folder"] = {
    createAbortHandle: abortHandle,
    loadFolder: async ({ path, token, signal }) => {
      try { return { kind: "success", items: (await listFiles(path, token, signal)).items }; }
      catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return { kind: "cancelled" };
        if (error instanceof ApiRequestError && error.status === 401) return { kind: "unauthorized", error };
        if (error instanceof ApiRequestError && error.code === "account_reconnect_required") return { kind: "reconnect-required", error };
        return { kind: "failure", error: error instanceof Error ? error : new Error("Unable to load folder.") };
      }
    },
    readCachedFolder: () => undefined, writeCachedFolder: () => undefined
  };
  const search: AppServices["search"] = { createAbortHandle: abortHandle, loadSearch: async () => ({ kind: "success", items: [] }), readCachedSearch: () => undefined, writeCachedSearch: () => undefined };
  const accountTransport: AppServices["accountTransport"] = {
    getHealth: async () => healthResponse,
    connectAccount: async () => ({ kind: "invalid-http-success" }),
    createSession: async ({ accountId }) => buildSession(buildAccount(accountId)),
    deleteConnectedAccount: async () => undefined
  };
  const accountSession: AppServices["accountSession"] = {
    getHealth: accountTransport.getHealth, createSession: accountTransport.createSession,
    commitSession: (...args) => accountRegistry.commitSession(...args),
    markAccountReconnectRequired: (...args) => accountRegistry.markAccountReconnectRequired(...args),
    clearAccountSession: (...args) => accountRegistry.clearAccountSession(...args), delay: async () => undefined
  };
  const operationRuntime: AppServices["operationRuntime"] = {
    request: { createAbortHandle: abortHandle, createTransferId: (() => { let next = 0; return () => `mutation-transfer-${++next}`; })() },
    mutation: {
      createFolder: async () => ({ action: "createFolder", parentPath: "", path: "" }),
      deleteFile: async (path, confirmName, token) => (await mutationApi.deleteFile({ path, confirmName }, token)).result,
      uploadFile: async () => ({ action: "upload", parentPath: "", path: "" }),
      copyOrMove: async (kind, source, destination, token) => (await (kind === "copy" ? mutationApi.copyFile({ path: source, destinationPath: destination }, token) : mutationApi.moveFile({ path: source, destinationPath: destination }, token))).result,
      listDestination: async (path, token) => mutationApi.listFiles(path, token)
    },
    download: { prepareDownloadFile: async () => ({ blob: new Blob(), filename: "download.bin" }), fetchDownloadBlob: async () => ({ blob: new Blob(), filename: "download.bin" }), listFiles, triggerBrowserDownload: () => undefined, saveDownload: () => undefined },
    batch: { downloadSelectionAsZip: async () => ({ blob: new Blob(), plan: { archiveName: "download.zip", selectedCount: 0, selectedFileCount: 0, selectedDirectoryCount: 0, directories: [], files: [], failedFiles: [] } }) },
    uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) },
    isUnauthorized: (error) => error instanceof ApiRequestError && error.status === 401,
    isReconnectRequired: (error) => error instanceof ApiRequestError && error.code === "account_reconnect_required",
    toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback
  };
  const retentionRepository = createRetentionRepository();
  const previewRuntime: AppServices["previewRuntime"] = {
    session: { createSessionAdapters: () => ({ cache: { read: async () => undefined, write: async () => ({ kind: "skipped", reason: "not-cacheable" }) }, live: { acquire: async () => { throw new Error("Preview is not part of this workflow."); } }, abort: { create: () => ({ id: "mutation-preview", abort: () => undefined }) }, resources: { apply: (material) => material, release: () => undefined }, failures: { classify: (error) => ({ kind: "ordinary", message: error instanceof Error ? error.message : "Preview failed." }) }, prefetch: { probe: async () => false, prefetch: async () => ({ kind: "skipped" }) }, clock: { now: () => Date.now() }, resolveResourceUrl: () => undefined }) },
    modal: { startOriginalFileOpen: () => ({ completion: Promise.resolve(), cancel: () => undefined }), pdf: { loadPdfJs: async () => { throw new Error("PDF preview is not part of this workflow."); }, fetch: async () => new Response(), requestAnimationFrame: (callback) => requestAnimationFrame(callback), getDevicePixelRatio: () => 1, createResizeObserver: () => undefined }, video: { setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs), clearTimeout: (id) => window.clearTimeout(id), getLocationHref: () => window.location.href }, setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs), clearTimeout: (id) => window.clearTimeout(id), getLocationHref: () => window.location.href, addWindowKeydownListener: (listener) => { window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); }, loadAudioPreviewPosition: () => undefined, saveAudioPreviewPosition: () => undefined, clearAudioPreviewPosition: () => undefined },
    folderAudio: { storage: { getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: (key) => localStorage.removeItem(key) }, createStreamingFileUrl: async () => "", nowIso: () => "2026-01-01T00:00:00.000Z", loadAudioPreviewPosition: () => undefined, saveAudioPreviewPosition: () => undefined }
  };
  const services: AppServices = {
    accountRegistry, accountTransport, accountSession, browsingCache: cache,
    favouriteResolveRuntime: { listFiles: async () => ({ items: [] }), cacheFolder: () => undefined },
    connectivity: { read: () => ONLINE, subscribe: () => () => undefined },
    explicitOfflineRuntime: { storage: { read: () => ({ kind: "ready", enabled: false }), commit: () => ({ kind: "committed" }), reset: () => ({ kind: "committed" }), repair: () => ({ kind: "repaired" }) }, network: { setBlocked: () => undefined } },
    clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
    favourites: { load: () => ({ kind: "loaded", entries: [] }), save: (_account, entries) => ({ kind: "saved", entries: [...entries] }), clear: () => ({ kind: "cleared" }), create: (entry, account) => ({ ...entry, accountId: account.id, accountBackend: account.backend, accountRootPath: account.rootPath, cacheNamespace: account.cacheNamespace, addedAt: "2026-01-01T00:00:00.000Z" }) },
    favouritesPointerEnvironment: { elementFromPoint: () => null, addWindowListener: () => () => undefined }, folder,
    folderSorts: createMemoryFolderSortService(),
    history: { pushState: (state, url) => { window.history.pushState(state, "", url); }, replaceState: (state, url) => { window.history.replaceState(state, "", url); }, getState: () => window.history.state as unknown, getLocation: () => ({ href: window.location.href, search: window.location.search }), subscribe: (listener) => { const handler = () => listener(window.history.state); window.addEventListener("popstate", handler); return () => window.removeEventListener("popstate", handler); } },
    pullToRefreshEnvironment: { getWindowScrollY: () => window.scrollY }, responsiveViewport: { getSnapshot: () => WIDE_VIEWPORT, subscribe: () => () => undefined }, search,
    settings: { load: () => ({ themeMode: "system", showHiddenFiles: false, sortMode: "name-asc", keepAwakeEnabled: true, previewFreshnessIntervalSeconds: 300, maxCacheableFileSizeBytes: 24 * 1024 * 1024, fileSizeDisplayMode: "human", imagePreviewFitMode: "fill", experimentalHeicPreviewEnabled: false, experimentalFolderAppShortcutsEnabled: false, diagnosticsEnabled: false }), save: (settings) => settings },
    operationRuntime, offlineSyncRuntime: { createAbortHandle: abortHandle, createTransferId: () => "mutation-sync", listFiles: async (path) => ({ path, items: [] }), fetchDownloadBlob: async () => ({ blob: new Blob(), filename: "download.bin" }), readBlobText: async () => "", isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback },
    retentionRepository, previewRuntime, accountRemovalRuntime: { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined }, diagnostics: createFakeDiagnosticsRuntimePorts()
  };
  return services;
}

function createMutationFixture(): AppServices {
  const services = {
    ...createMutationServices(),
    operationRuntime: {
      ...createMutationServices().operationRuntime,
      mutation: {
        ...createMutationServices().operationRuntime.mutation,
        listDestination: (path: string, token: string) => mutationApi.listFiles(path, token)
      }
    }
  } satisfies AppServices;
  return services;
}

function seedAccounts(records: Array<{ account: Account; session?: Session }>, activeAccountId?: string): void {
  localStorage.setItem("davora-account-state", JSON.stringify({ activeAccountId: activeAccountId ?? records[0]?.account.id, accounts: records }));
}

beforeEach(() => {
  cleanup(); localStorage.clear(); window.history.replaceState(null, "", "/");
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) });
  mutationApi.listFiles.mockImplementation(async (path) => path === "Projects" ? { path, items: [buildFileEntry("Projects/roadmap.txt", { name: "roadmap.txt", size: 70, mimeType: "text/plain" })] } : { path, items: [buildFileEntry("Projects", { name: "Projects", isFolder: true }), buildFileEntry("Projects/roadmap.txt", { name: "roadmap.txt", size: 70, mimeType: "text/plain" })] });
  mutationApi.copyFile.mockResolvedValue({ result: { action: "copy", parentPath: "", path: "Projects/roadmap.txt", destinationPath: "Projects/roadmap-copy.txt" } });
  mutationApi.moveFile.mockResolvedValue({ result: { action: "move", parentPath: "", path: "Projects/roadmap.txt", destinationPath: "Projects/renamed.txt" } });
  mutationApi.deleteFile.mockResolvedValue({ result: { action: "delete", parentPath: "", path: "Projects/roadmap.txt" } });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("mutation workflow App integration", () => {
  it("copies a file through the folder destination picker without typing a full path", async () => {
    const account = buildAccount("alpha", { displayName: "Picker copy workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mutationApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects") {
        return {
          path,
          items: [
            { path: "Projects/Документи 100%", name: "Документи 100%", isFolder: true },
            { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }
          ]
        };
      }
      if (path === "Projects/Документи 100%") {
        return { path, items: [] };
      }
      return {
        path,
        items: [{ path: "Projects", name: "Projects", isFolder: true }]
      };
    });

    render(<App services={createMutationFixture()} />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: "Open actions for roadmap.txt" });
    fireEvent.click(screen.getByRole("button", { name: "Open actions for roadmap.txt" }));
    fireEvent.click(screen.getByRole("button", { name: /Copy or move/i }));

    const dialog = await screen.findByRole("dialog", { name: /Copy or move item/i });
    const destinationForm = dialog.querySelector("form")!;
    expect(within(dialog).getByText("Projects/roadmap.txt")).toBeInTheDocument();
    expect(dialog.querySelector(".destination-resolved")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Choose a destination folder, keep or edit/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Copy destination path/i)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Open destination folder Документи 100%/i }));
    await within(dialog).findByText("/Projects/Документи 100%");
    const destinationBreadcrumbs = within(dialog).getByRole("navigation", { name: /Destination folder path/i });
    expect(within(destinationBreadcrumbs).getByRole("button", { name: /Go to home folder/i })).not.toBeDisabled();
    expect(within(destinationBreadcrumbs).getByRole("button", { name: "Go to /Projects" })).not.toBeDisabled();
    const currentDestination = within(destinationBreadcrumbs).getByRole("button", { name: "Go to /Projects/Документи 100%" });
    expect(currentDestination).toHaveAttribute("aria-current", "page");
    expect(currentDestination).toBeDisabled();
    await waitFor(() => expect(within(dialog).getByLabelText("Destination name")).toHaveValue("roadmap.txt"));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Copy here/i })).not.toBeDisabled());
    fireEvent.submit(destinationForm);

    await waitFor(() => expect(mutationApi.copyFile).toHaveBeenCalledWith({
      path: "Projects/roadmap.txt",
      destinationPath: "Projects/Документи 100%/roadmap.txt"
    }, "token-alpha"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Copy or move item/i })).not.toBeInTheDocument());
  });

  it("moves a file through the folder destination picker with a separate destination name", async () => {
    const account = buildAccount("alpha", { displayName: "Picker move workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mutationApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects") {
        return {
          path,
          items: [
            { path: "Projects/Archive 100%", name: "Archive 100%", isFolder: true },
            { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }
          ]
        };
      }
      if (path === "Projects/Archive 100%") {
        return { path, items: [] };
      }
      return {
        path,
        items: [{ path: "Projects", name: "Projects", isFolder: true }]
      };
    });

    render(<App services={createMutationFixture()} />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: "Open actions for roadmap.txt" });
    fireEvent.click(screen.getByRole("button", { name: "Open actions for roadmap.txt" }));
    fireEvent.click(screen.getByRole("button", { name: /Rename or move/i }));

    const dialog = await screen.findByRole("dialog", { name: /Move item/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Open destination folder Archive 100%/i }));
    await within(dialog).findByText("/Projects/Archive 100%");
    fireEvent.change(within(dialog).getByLabelText("Destination name"), { target: { value: "roadmap final.txt" } });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Move here/i })).not.toBeDisabled());
    fireEvent.click(within(dialog).getByRole("button", { name: /Move here/i }));

    await waitFor(() => expect(mutationApi.moveFile).toHaveBeenCalledWith({
      path: "Projects/roadmap.txt",
      destinationPath: "Projects/Archive 100%/roadmap final.txt"
    }, "token-alpha"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Move item/i })).not.toBeInTheDocument());
  });

  it("blocks destination conflicts and folder self-descendant destinations in the picker", async () => {
    const account = buildAccount("alpha", { displayName: "Picker guard workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mutationApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects") {
        return {
          path,
          items: [
            { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" },
            { path: "Projects/roadmap.txt-copy", name: "roadmap.txt-copy", isFolder: false, size: 70, mimeType: "text/plain" }
          ]
        };
      }
      return {
        path,
        items: [{ path: "Projects", name: "Projects", isFolder: true }]
      };
    });

    render(<App services={createMutationFixture()} />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: "Open actions for roadmap.txt" });
    fireEvent.click(screen.getByRole("button", { name: "Open actions for roadmap.txt" }));
    fireEvent.click(screen.getByRole("button", { name: /Copy or move/i }));

    const copyDialog = await screen.findByRole("dialog", { name: /Copy or move item/i });
    await waitFor(() => expect(within(copyDialog).getByLabelText("Destination name")).toHaveValue("roadmap (1).txt"));
    expect(within(copyDialog).queryByText(/already contains roadmap\.txt-copy/i)).not.toBeInTheDocument();
    expect(within(copyDialog).getByRole("button", { name: /Copy here/i })).not.toBeDisabled();
    fireEvent.change(within(copyDialog).getByLabelText("Destination name"), { target: { value: "roadmap.txt" } });
    expect(await within(copyDialog).findByText(/Destination already contains roadmap\.txt\. Use roadmap \(1\)\.txt/i)).toBeInTheDocument();
    expect(within(copyDialog).getByRole("button", { name: /Copy here/i })).toBeDisabled();
    fireEvent.change(within(copyDialog).getByLabelText("Destination name"), { target: { value: "bad\\name.txt" } });
    expect(await within(copyDialog).findByText(/Enter a valid destination name/i)).toBeInTheDocument();
    expect(within(copyDialog).getByRole("button", { name: /Copy here/i })).toBeDisabled();
    fireEvent.change(within(copyDialog).getByLabelText("Destination name"), { target: { value: "folder/name.txt" } });
    expect(await within(copyDialog).findByText(/Destination name cannot contain slashes/i)).toBeInTheDocument();
    expect(within(copyDialog).getByRole("button", { name: /Copy here/i })).toBeDisabled();
    fireEvent.click(within(copyDialog).getByRole("button", { name: /Manual path/i }));
    fireEvent.change(within(copyDialog).getByLabelText("Full destination path"), { target: { value: "Projects/foo%2Fbar.txt" } });
    expect(await within(copyDialog).findByText(/Enter a valid destination path/i)).toBeInTheDocument();
    expect(within(copyDialog).getByRole("button", { name: /Copy here/i })).toBeDisabled();
    fireEvent.click(within(copyDialog).getByRole("button", { name: /Manual path/i }));
    fireEvent.change(within(copyDialog).getByLabelText("Destination name"), { target: { value: "roadmap copied.txt" } });
    await waitFor(() => expect(within(copyDialog).queryByText(/already contains|valid destination|cannot contain/i)).not.toBeInTheDocument());
    fireEvent.click(within(copyDialog).getByRole("button", { name: /Cancel/i }));

    fireEvent.click(screen.getByRole("button", { name: /Go to home folder/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Open actions for Projects/i }));
    fireEvent.click(screen.getByRole("button", { name: /Rename or move/i }));

    const moveDialog = await screen.findByRole("dialog", { name: /Move item/i });
    fireEvent.click(within(moveDialog).getByRole("button", { name: /Open destination folder Projects/i }));
    expect(await within(moveDialog).findByText(/Folders cannot be moved or copied into themselves or their descendants/i)).toBeInTheDocument();
    expect(within(moveDialog).getByRole("button", { name: /Move here/i })).toBeDisabled();
    expect(mutationApi.moveFile).not.toHaveBeenCalled();
  });

  it("blocks empty names and canonicalizes manual paths before loading, validating, and submitting", async () => {
    const account = buildAccount("alpha", { displayName: "Canonical picker workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mutationApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects") {
        return {
          path,
          items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }]
        };
      }
      if (path === "Archive") {
        return {
          path,
          items: [{ path: "Archive/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }]
        };
      }
      return {
        path,
        items: [
          { path: "Projects", name: "Projects", isFolder: true },
          { path: "Archive", name: "Archive", isFolder: true }
        ]
      };
    });

    render(<App services={createMutationFixture()} />);
    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Open actions for roadmap.txt" }));
    fireEvent.click(screen.getByRole("button", { name: /Copy or move/i }));

    const dialog = await screen.findByRole("dialog", { name: /Copy or move item/i });
    const copyButton = within(dialog).getByRole("button", { name: /^Copy here$/i });
    fireEvent.change(within(dialog).getByLabelText("Destination name"), { target: { value: "   " } });
    expect(await within(dialog).findByText("Choose a destination name before continuing.")).toBeInTheDocument();
    expect(copyButton).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("button", { name: /Manual path/i }));
    const manualPath = within(dialog).getByLabelText("Full destination path");
    fireEvent.change(manualPath, { target: { value: " /Projects//roadmap.txt/ " } });
    expect(await within(dialog).findByText(/Destination already contains roadmap\.txt\. Use roadmap \(1\)\.txt/i)).toBeInTheDocument();
    expect(copyButton).toBeDisabled();

    fireEvent.change(manualPath, { target: { value: " /Archive//roadmap.txt/ " } });
    await waitFor(() => expect(mutationApi.listFiles).toHaveBeenCalledWith("Archive", "token-alpha"));
    expect(await within(dialog).findByText(/Destination already contains roadmap\.txt\. Use roadmap \(1\)\.txt/i)).toBeInTheDocument();
    expect(copyButton).toBeDisabled();

    fireEvent.change(manualPath, { target: { value: " /Archive//new.txt/ " } });
    await waitFor(() => expect(copyButton).toBeEnabled());
    fireEvent.click(copyButton);

    await waitFor(() => expect(mutationApi.copyFile).toHaveBeenCalledWith({
      path: "Projects/roadmap.txt",
      destinationPath: "Archive/new.txt"
    }, "token-alpha"));
  });

  it("uses one selection action surface for multi-item delete", async () => {
    const account = buildAccount("alpha", { displayName: "Selection workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mutationApi.deleteFile.mockImplementation(async ({ path }) => ({ result: { action: "delete", parentPath: "", path } }));

    render(<App services={createMutationFixture()} />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Projects folder/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select roadmap.txt file/i }));

    expect(await screen.findByText(/2 items selected \(1 file and 1 folder\)/i)).toBeInTheDocument();
    expect(screen.getByText(/70 B known; 1 item unknown or folder-sized/i)).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /Add batch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove batch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download batch/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /^Delete selected$/i })[0]!);

    const dialog = await screen.findByRole("dialog", { name: /Delete 2 items/i });
    expect(within(dialog).getByText(/Projects/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Projects\/roadmap\.txt/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Delete$/i }));

    await waitFor(() => expect(mutationApi.deleteFile).toHaveBeenCalledTimes(2));
    expect(mutationApi.deleteFile).toHaveBeenNthCalledWith(1, { path: "Projects/roadmap.txt", confirmName: "roadmap.txt" }, "token-alpha");
    expect(mutationApi.deleteFile).toHaveBeenNthCalledWith(2, { path: "Projects", confirmName: "Projects" }, "token-alpha");
    expect(await screen.findByText(/Deleted 2 selected items from Selection workspace\./i)).toBeInTheDocument();
  });

  it("retries only unresolved entries after a partial batch delete", async () => {
    const account = buildAccount("alpha", { displayName: "Delete retry workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mutationApi.deleteFile
      .mockResolvedValueOnce({ result: { action: "delete", parentPath: "Projects", path: "Projects/roadmap.txt" } })
      .mockRejectedValueOnce(new Error("Folder delete failed"))
      .mockResolvedValueOnce({ result: { action: "delete", parentPath: "", path: "Projects" } });

    render(<App services={createMutationFixture()} />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Projects folder/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select roadmap.txt file/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Delete selected$/i })[0]);
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Delete 2 items/i })).getByRole("button", { name: /^Delete$/i }));

    expect(await screen.findByText("Folder delete failed")).toBeInTheDocument();
    const retryDialog = screen.getByRole("dialog", { name: /Delete item/i });
    expect(within(retryDialog).getByText("Projects")).toBeInTheDocument();
    expect(within(retryDialog).queryByText("Projects/roadmap.txt")).not.toBeInTheDocument();
    fireEvent.click(within(retryDialog).getByRole("button", { name: /^Delete$/i }));

    await waitFor(() => expect(mutationApi.deleteFile).toHaveBeenCalledTimes(3));
    expect(mutationApi.deleteFile).toHaveBeenNthCalledWith(3, { path: "Projects", confirmName: "Projects" }, "token-alpha");
    expect(await screen.findByText("delete completed for /Projects in Delete retry workspace")).toBeInTheDocument();
  });

  it("makes an in-flight batch delete inert after account change without closing a replacement delete dialog", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha delete workspace" });
    const beta = buildAccount("beta", { displayName: "Beta delete workspace" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);
    mutationApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Projects", name: "Projects", isFolder: true },
        { path: "notes.txt", name: "notes.txt", isFolder: false, size: 20, mimeType: "text/plain" }
      ]
    });
    const firstDelete = createDeferred<Awaited<ReturnType<typeof api.deleteFile>>>();
    mutationApi.deleteFile.mockReturnValueOnce(firstDelete.promise);

    render(<App services={createMutationFixture()} />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Projects folder/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select notes.txt file/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Delete selected$/i })[0]);
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Delete 2 items/i })).getByRole("button", { name: /^Delete$/i }));
    await waitFor(() => expect(mutationApi.deleteFile).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } });
    fireEvent.click(within(settings).getByRole("button", { name: /^Close$/i }));
    await screen.findByRole("button", { name: /Open actions for notes.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for notes.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    const betaDialog = await screen.findByRole("dialog", { name: /Delete item/i });

    firstDelete.resolve({ result: { action: "delete", parentPath: "", path: "notes.txt" } });
    await act(async () => firstDelete.promise);

    expect(screen.getByRole("dialog", { name: /Delete item/i })).toBe(betaDialog);
    expect(mutationApi.deleteFile).toHaveBeenCalledTimes(1);
  });

  it("stops a batch delete on session expiry before issuing another request", async () => {
    const account = buildAccount("alpha", { displayName: "Expired delete workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mutationApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Projects", name: "Projects", isFolder: true },
        { path: "notes.txt", name: "notes.txt", isFolder: false }
      ]
    });
    mutationApi.deleteFile.mockRejectedValueOnce(new ApiRequestError("Session expired", 401, "session_invalid"));

    render(<App services={createMutationFixture()} />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Projects folder/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select notes.txt file/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Delete selected$/i })[0]);
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Delete 2 items/i })).getByRole("button", { name: /^Delete$/i }));

    await waitFor(() => expect(mutationApi.deleteFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Delete/i })).not.toBeInTheDocument());
    expect(screen.queryByText(/Deleted .* selected items from Expired delete workspace/i)).not.toBeInTheDocument();
  });

  it("does not publish batch-delete success when its refresh terminates the session", async () => {
    const account = buildAccount("alpha", { displayName: "Refresh terminal delete workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mutationApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Projects", name: "Projects", isFolder: true },
        { path: "notes.txt", name: "notes.txt", isFolder: false }
      ]
    });
    mutationApi.deleteFile.mockImplementation(async ({ path }) => ({ result: { action: "delete", parentPath: "", path } }));

    render(<App services={createMutationFixture()} />);
    await screen.findByRole("button", { name: /Create folder/i });
    mutationApi.listFiles.mockRejectedValueOnce(new ApiRequestError("Session expired", 401, "session_invalid"));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Projects folder/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select notes.txt file/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Delete selected$/i })[0]);
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Delete 2 items/i })).getByRole("button", { name: /^Delete$/i }));

    await waitFor(() => expect(mutationApi.deleteFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Delete/i })).not.toBeInTheDocument());
    expect(screen.queryByText(/Deleted 2 selected items from Refresh terminal delete workspace/i)).not.toBeInTheDocument();
  });

  it("copies a mixed multi-item selection through the existing destination picker", async () => {
    const account = buildAccount("alpha", { displayName: "Batch copy workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mutationApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Archive") {
        return {
          path,
          items: [{ path: "Archive/notes.txt", name: "notes.txt", isFolder: false, size: 10, mimeType: "text/plain" }]
        };
      }
      return {
        path,
        items: [
          { path: "Archive", name: "Archive", isFolder: true },
          { path: "Projects", name: "Projects", isFolder: true },
          { path: "notes.txt", name: "notes.txt", isFolder: false, size: 20, mimeType: "text/plain" }
        ]
      };
    });
    mutationApi.copyFile.mockImplementation(async ({ path, destinationPath }) => ({
      result: { action: "copy", parentPath: dirname(destinationPath), path, destinationPath }
    }));

    render(<App services={createMutationFixture()} />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Projects folder/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select notes.txt file/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Copy or move selected$/i })[0]!);

    const dialog = await screen.findByRole("dialog", { name: /Copy or move 2 items/i });
    expect(within(dialog).getByText(/2 selected items/i)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Destination name/i)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Open destination folder Archive/i }));
    const copyButton = within(dialog).getByRole("button", { name: /^Copy here$/i });
    await waitFor(() => expect(copyButton).toBeEnabled());
    fireEvent.click(copyButton);

    await waitFor(() => expect(mutationApi.copyFile).toHaveBeenCalledTimes(2));
    expect(mutationApi.copyFile).toHaveBeenNthCalledWith(1, { path: "Projects", destinationPath: "Archive/Projects" }, "token-alpha");
    expect(mutationApi.copyFile).toHaveBeenNthCalledWith(2, { path: "notes.txt", destinationPath: "Archive/notes (1).txt" }, "token-alpha");
    await waitFor(() => expect(screen.queryByText(/item selected/i)).not.toBeInTheDocument());
    expect(await screen.findByText(/Copied 2 selected items to \/Archive in Batch copy workspace\./i)).toBeInTheDocument();
  });

  it("blocks batch moves into a selected folder and keeps failed items selected after partial copy", async () => {
    const account = buildAccount("alpha", { displayName: "Batch partial workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mutationApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects") {
        return { path, items: [] };
      }
      if (path === "Archive") {
        return { path, items: [] };
      }
      return {
        path,
        items: [
          { path: "Archive", name: "Archive", isFolder: true },
          { path: "Projects", name: "Projects", isFolder: true },
          { path: "notes.txt", name: "notes.txt", isFolder: false, size: 20, mimeType: "text/plain" }
        ]
      };
    });
    mutationApi.copyFile.mockImplementation(async ({ path, destinationPath }) => {
      if (path === "notes.txt") {
        throw new Error("Destination rejected notes.txt");
      }
      return { result: { action: "copy", parentPath: dirname(destinationPath), path, destinationPath } };
    });

    render(<App services={createMutationFixture()} />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Projects folder/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select notes.txt file/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Copy or move selected$/i })[0]!);

    let dialog = await screen.findByRole("dialog", { name: /Copy or move 2 items/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Open destination folder Projects/i }));
    expect(await within(dialog).findByText(/selected folders cannot be moved or copied into themselves or their descendants/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Move here$/i })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("button", { name: /Home/i }));
    fireEvent.click(await within(dialog).findByRole("button", { name: /Open destination folder Archive/i }));
    const copyButton = within(dialog).getByRole("button", { name: /^Copy here$/i });
    await waitFor(() => expect(copyButton).toBeEnabled());
    fireEvent.click(copyButton);

    dialog = await screen.findByRole("dialog", { name: /Copy or move 1 item/i });
    expect(within(dialog).getByText(/Copied 1 of 2 selected items; 1 failed/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/notes\.txt: Destination rejected notes\.txt/i)).toBeInTheDocument();
    expect(await screen.findByText(/1 item selected \(1 file\)/i)).toBeInTheDocument();
    expect(mutationApi.copyFile).toHaveBeenCalledTimes(2);
  });

  it("moves every item in a valid mixed selection and clears selection after success", async () => {
    const account = buildAccount("alpha", { displayName: "Batch move workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mutationApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Archive") {
        return { path, items: [] };
      }
      return {
        path,
        items: [
          { path: "Archive", name: "Archive", isFolder: true },
          { path: "Projects", name: "Projects", isFolder: true },
          { path: "notes.txt", name: "notes.txt", isFolder: false, size: 20, mimeType: "text/plain" }
        ]
      };
    });
    mutationApi.moveFile.mockImplementation(async ({ path, destinationPath }) => ({
      result: { action: "move", parentPath: dirname(destinationPath), path, destinationPath }
    }));

    render(<App services={createMutationFixture()} />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Projects folder/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select notes.txt file/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Copy or move selected$/i })[0]!);

    const dialog = await screen.findByRole("dialog", { name: /Copy or move 2 items/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Open destination folder Archive/i }));
    const moveButton = within(dialog).getByRole("button", { name: /^Move here$/i });
    await waitFor(() => expect(moveButton).toBeEnabled());
    fireEvent.click(moveButton);

    await waitFor(() => expect(mutationApi.moveFile).toHaveBeenCalledTimes(2));
    expect(mutationApi.moveFile).toHaveBeenNthCalledWith(1, { path: "Projects", destinationPath: "Archive/Projects" }, "token-alpha");
    expect(mutationApi.moveFile).toHaveBeenNthCalledWith(2, { path: "notes.txt", destinationPath: "Archive/notes.txt" }, "token-alpha");
    await waitFor(() => expect(screen.queryByText(/item selected/i)).not.toBeInTheDocument());
    expect(await screen.findByText(/Moved 2 selected items to \/Archive in Batch move workspace\./i)).toBeInTheDocument();
  });

  it("stops a batch copy when the session expires without restoring stale selection state", async () => {
    const account = buildAccount("alpha", { displayName: "Expired batch workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mutationApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Archive") {
        return { path, items: [] };
      }
      return {
        path,
        items: [
          { path: "Archive", name: "Archive", isFolder: true },
          { path: "Projects", name: "Projects", isFolder: true },
          { path: "notes.txt", name: "notes.txt", isFolder: false, size: 20, mimeType: "text/plain" }
        ]
      };
    });
    mutationApi.copyFile.mockRejectedValueOnce(new ApiRequestError("Session expired", 401, "session_invalid"));

    render(<App services={createMutationFixture()} />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Projects folder/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select notes.txt file/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Copy or move selected$/i })[0]!);

    const dialog = await screen.findByRole("dialog", { name: /Copy or move 2 items/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Open destination folder Archive/i }));
    const copyButton = within(dialog).getByRole("button", { name: /^Copy here$/i });
    await waitFor(() => expect(copyButton).toBeEnabled());
    fireEvent.click(copyButton);

    await waitFor(() => expect(mutationApi.copyFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Copy or move/i })).not.toBeInTheDocument());
    expect(screen.queryByText(/item selected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Copied 0 of 2 selected items/i)).not.toBeInTheDocument();
  });

  it("stops an in-flight batch copy on account change without closing the replacement picker", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);
    mutationApi.listFiles.mockImplementation(async (path: string) => path === "Archive"
      ? { path, items: [] }
      : { path, items: [
        { path: "Archive", name: "Archive", isFolder: true },
        { path: "Projects", name: "Projects", isFolder: true },
        { path: "notes.txt", name: "notes.txt", isFolder: false, size: 20, mimeType: "text/plain" }
      ] });
    const firstCopy = createDeferred<Awaited<ReturnType<typeof api.copyFile>>>();
    mutationApi.copyFile.mockReturnValueOnce(firstCopy.promise);

    render(<App services={createMutationFixture()} />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Projects folder/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select notes.txt file/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Copy or move selected$/i })[0]);
    const alphaPicker = await screen.findByRole("dialog", { name: /Copy or move 2 items/i });
    fireEvent.click(within(alphaPicker).getByRole("button", { name: /Open destination folder Archive/i }));
    const copyButton = within(alphaPicker).getByRole("button", { name: /^Copy here$/i });
    await waitFor(() => expect(copyButton).toBeEnabled());
    fireEvent.click(copyButton);
    await waitFor(() => expect(mutationApi.copyFile).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.change(within(settings).getByLabelText(/Active account/i), { target: { value: beta.id } });
    fireEvent.click(within(settings).getByRole("button", { name: /^Close$/i }));
    await screen.findByRole("button", { name: /Open actions for notes.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for notes.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /Copy or move/i }));
    const betaPicker = await screen.findByRole("dialog", { name: /Copy or move item/i });

    firstCopy.resolve({ result: { action: "copy", parentPath: "Archive", path: "Projects", destinationPath: "Archive/Projects" } });
    await act(async () => firstCopy.promise);
    expect(betaPicker).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /Copy or move item/i })).toBe(betaPicker);
    expect(mutationApi.copyFile).toHaveBeenCalledTimes(1);
  });

  it("normalizes and loads a manual batch destination before checking descendants and conflicts", async () => {
    const account = buildAccount("alpha", { displayName: "Manual batch workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mutationApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects/Sub") {
        return { path, items: [] };
      }
      if (path === "Archive") {
        return {
          path,
          items: [{ path: "Archive/notes.txt", name: "notes.txt", isFolder: false, size: 10, mimeType: "text/plain" }]
        };
      }
      return {
        path,
        items: [
          { path: "Archive", name: "Archive", isFolder: true },
          { path: "Projects", name: "Projects", isFolder: true },
          { path: "notes.txt", name: "notes.txt", isFolder: false, size: 20, mimeType: "text/plain" }
        ]
      };
    });
    mutationApi.copyFile.mockImplementation(async ({ path, destinationPath }) => ({
      result: { action: "copy", parentPath: dirname(destinationPath), path, destinationPath }
    }));

    render(<App services={createMutationFixture()} />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Projects folder/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select notes.txt file/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Copy or move selected$/i })[0]!);

    const dialog = await screen.findByRole("dialog", { name: /Copy or move 2 items/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Manual path/i }));
    const manualPath = within(dialog).getByLabelText(/Full destination folder path/i);
    fireEvent.change(manualPath, { target: { value: "/Projects/Sub" } });

    await waitFor(() => expect(mutationApi.listFiles).toHaveBeenCalledWith("Projects/Sub", "token-alpha"));
    expect(await within(dialog).findByText(/selected folders cannot be moved or copied into themselves or their descendants/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Copy here$/i })).toBeDisabled();

    fireEvent.change(manualPath, { target: { value: "/Archive" } });
    await waitFor(() => expect(mutationApi.listFiles).toHaveBeenCalledWith("Archive", "token-alpha"));
    const copyButton = within(dialog).getByRole("button", { name: /^Copy here$/i });
    await waitFor(() => expect(copyButton).toBeEnabled());
    fireEvent.click(copyButton);

    await waitFor(() => expect(mutationApi.copyFile).toHaveBeenCalledTimes(2));
    expect(mutationApi.copyFile).toHaveBeenNthCalledWith(1, { path: "Projects", destinationPath: "Archive/Projects" }, "token-alpha");
    expect(mutationApi.copyFile).toHaveBeenNthCalledWith(2, { path: "notes.txt", destinationPath: "Archive/notes (1).txt" }, "token-alpha");
  });

  it("does not restore batch state when the required post-mutation refresh terminates the session", async () => {
    const account = buildAccount("alpha", { displayName: "Refresh expiry workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    let rootLoadCount = 0;
    mutationApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Archive") {
        return { path, items: [] };
      }
      rootLoadCount += 1;
      if (rootLoadCount === 3) {
        throw new ApiRequestError("Session expired", 401, "session_invalid");
      }
      return {
        path,
        items: [
          { path: "Archive", name: "Archive", isFolder: true },
          { path: "Projects", name: "Projects", isFolder: true },
          { path: "notes.txt", name: "notes.txt", isFolder: false, size: 20, mimeType: "text/plain" }
        ]
      };
    });
    mutationApi.copyFile.mockImplementation(async ({ path, destinationPath }) => ({
      result: { action: "copy", parentPath: dirname(destinationPath), path, destinationPath }
    }));

    render(<App services={createMutationFixture()} />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Projects folder/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select notes.txt file/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Copy or move selected$/i })[0]!);

    const dialog = await screen.findByRole("dialog", { name: /Copy or move 2 items/i });
    fireEvent.click(await within(dialog).findByRole("button", { name: /Open destination folder Archive/i }));
    const copyButton = within(dialog).getByRole("button", { name: /^Copy here$/i });
    await waitFor(() => expect(copyButton).toBeEnabled());
    fireEvent.click(copyButton);

    await waitFor(() => expect(mutationApi.copyFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Copy or move/i })).not.toBeInTheDocument());
    expect(screen.queryByText(/item selected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Copied 2 selected items to/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Copied \d+ of 2 selected items/i)).not.toBeInTheDocument();
  });
});
