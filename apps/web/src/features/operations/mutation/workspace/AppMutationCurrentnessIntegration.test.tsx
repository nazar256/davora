import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../../../diagnostics/testing/fakes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../../../App";
import type { AppServices } from "../../../../app/AppServices";
import { createMemoryFolderSortService } from "../../../../features/browsing/folderSort/testing/fakeStorage";
import { buildAccount, buildSession } from "../../../../test/accounts";
import { buildHealthResponse } from "../../../../test/api";
import { buildFileEntry } from "../../../../test/files";
import { createDeferred } from "../../../../test/primitives";

type RegistryRecord = ReturnType<AppServices["accountRegistry"]["getSnapshot"]>["accounts"][number];
type Account = RegistryRecord["account"];
type Session = NonNullable<RegistryRecord["session"]>;
type MutationResult = Awaited<ReturnType<AppServices["operationRuntime"]["mutation"]["createFolder"]>>;
type ListResponse = Awaited<ReturnType<AppServices["operationRuntime"]["mutation"]["listDestination"]>> & { readonly path: string };
type MutationResponse = { readonly result: MutationResult };

const mutationApi = {
  listFiles: vi.fn<(path: string, token: string, signal?: AbortSignal) => Promise<ListResponse>>(),
  createFolder: vi.fn<(input: { readonly path: string; readonly name: string }, token: string) => Promise<MutationResponse>>(),
  deleteFile: vi.fn<(input: { readonly path: string; readonly confirmName: string }, token: string) => Promise<MutationResponse>>(),
  copyFile: vi.fn<(input: { readonly path: string; readonly destinationPath: string }, token: string) => Promise<MutationResponse>>(),
  moveFile: vi.fn<(input: { readonly path: string; readonly destinationPath: string }, token: string) => Promise<MutationResponse>>() 
};
type ConsoleSpy = ReturnType<typeof vi.spyOn> & ((...args: unknown[]) => unknown);
let consoleSpy: ConsoleSpy | undefined;

type AccountSnapshot = ReturnType<AppServices["accountRegistry"]["getSnapshot"]>;

function persistSafeAccountSnapshot(snapshot: AccountSnapshot): void {
  const safeSnapshot: AccountSnapshot = {
    ...snapshot,
    accounts: snapshot.accounts.map((record) => ({
      ...record,
      session: record.session ? { ...record.session, token: "fixture-token" } : undefined
    }))
  };
  localStorage.setItem("davora-account-state", JSON.stringify(safeSnapshot));
}

function registerSwMock() {
  return {
    offlineReady: [false, vi.fn()] as [boolean, (value: boolean) => void],
    needRefresh: [false, vi.fn()] as [boolean, (value: boolean) => void],
    updateServiceWorker: vi.fn(async () => undefined)
  };
}

vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: registerSwMock }));

function abortHandle() {
  const controller = new AbortController();
  return { signal: controller.signal, abort: () => controller.abort() };
}

function createMutationCurrentnessFixture(): AppServices {
  const rawState = localStorage.getItem("davora-account-state");
  let snapshot: ReturnType<AppServices["accountRegistry"]["getSnapshot"]> = rawState
    ? JSON.parse(rawState) as ReturnType<AppServices["accountRegistry"]["getSnapshot"]>
    : { accounts: [] };
  if (rawState) persistSafeAccountSnapshot(snapshot);
  let state: ReturnType<AppServices["accountRegistry"]["getState"]> = { kind: "ready", snapshot };
  const listeners = new Set<() => void>();
  const online = { kind: "online" } as const;
  const wideViewport = { kind: "wide" } as const;
  const healthResponse = buildHealthResponse();
  const fixtureSentinel = "mutation-currentness-sentinel";
  const publish = (next: typeof snapshot) => {
    snapshot = next;
    state = { kind: "ready", snapshot };
    persistSafeAccountSnapshot(next);
    listeners.forEach((listener) => listener());
  };
  const committed = () => ({ kind: "committed" as const, snapshot });
  const accountRegistry: AppServices["accountRegistry"] = {
    getState: () => state,
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    repair: committed,
    connectAccount: async () => ({ kind: "failed", message: "fixture", clearCredential: false }),
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
      if (!snapshot.accounts.some((record) => record.account.id === accountId)) return { kind: "invalid", reason: "unknown-account", message: "fixture" };
      publish({ ...snapshot, activeAccountId: accountId });
      return committed();
    },
    removeAccount: async (accountId) => { publish({ accounts: snapshot.accounts.filter((record) => record.account.id !== accountId) }); return { kind: "committed", snapshot }; },
    retryRemovalCommit: () => ({ kind: "failed", message: "fixture" })
  };
  const browsingCache: AppServices["browsingCache"] = {
    readFolder: () => ({ kind: "miss" }), writeFolder: () => ({ kind: "written" }),
    readSearch: () => ({ kind: "miss" }), writeSearch: () => ({ kind: "written" }),
    clearNamespace: () => ({ kind: "cleared" }), clearFolderPath: () => ({ kind: "cleared" }),
    clearNamespaceOrThrow: () => undefined, clearFolderPathOrThrow: () => undefined
  };
  const folder: AppServices["folder"] = {
    createAbortHandle: abortHandle,
    loadFolder: async ({ path, token, signal }) => {
      const response = await mutationApi.listFiles(path, token, signal);
      return { kind: "success", items: response.items };
    },
    readCachedFolder: () => undefined, writeCachedFolder: () => undefined
  };
  const search: AppServices["search"] = { createAbortHandle: abortHandle, loadSearch: async () => ({ kind: "success", items: [] }), readCachedSearch: () => undefined, writeCachedSearch: () => undefined };
  const accountTransport: AppServices["accountTransport"] = {
    getHealth: async () => healthResponse, connectAccount: async () => ({ kind: "invalid-http-success" }),
    createSession: async () => { throw new Error("fixture"); }, deleteConnectedAccount: async () => undefined
  };
  const accountSession: AppServices["accountSession"] = {
    getHealth: accountTransport.getHealth, createSession: accountTransport.createSession,
    commitSession: (...args) => accountRegistry.commitSession(...args),
    markAccountReconnectRequired: (...args) => accountRegistry.markAccountReconnectRequired(...args),
    clearAccountSession: (...args) => accountRegistry.clearAccountSession(...args), delay: async () => undefined
  };
  const operationRuntime: AppServices["operationRuntime"] = {
    request: { createAbortHandle: abortHandle, createTransferId: () => fixtureSentinel },
    mutation: {
      createFolder: async (parentPath, name, token) => (await mutationApi.createFolder({ path: parentPath, name }, token)).result,
      deleteFile: async (path, confirmName, token) => (await mutationApi.deleteFile({ path, confirmName }, token)).result,
      uploadFile: async () => ({ action: "upload", parentPath: "", path: "" }),
      copyOrMove: async (kind, source, destination, token) => (await (kind === "copy" ? mutationApi.copyFile({ path: source, destinationPath: destination }, token) : mutationApi.moveFile({ path: source, destinationPath: destination }, token))).result,
      listDestination: async (path, token) => mutationApi.listFiles(path, token)
    },
    download: { prepareDownloadFile: async () => ({ blob: new Blob(), filename: "fixture" }), fetchDownloadBlob: async () => ({ blob: new Blob(), filename: "fixture" }), listFiles: async (path, token, signal) => mutationApi.listFiles(path, token, signal), triggerBrowserDownload: () => undefined, saveDownload: () => undefined },
    batch: { downloadSelectionAsZip: async () => ({ blob: new Blob(), plan: { archiveName: "fixture", selectedCount: 0, selectedFileCount: 0, selectedDirectoryCount: 0, directories: [], files: [], failedFiles: [] } }) },
    preview: { createFileStreamUrl: async () => "" }, time: { wait: async () => {} }, uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) },
    isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (_error: unknown, fallback: string) => fallback
  };
  const snapshotFor = (account: Parameters<AppServices["retentionRepository"]["readSnapshot"]>[0]) => ({ account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 1 }, roots: [], files: [], memberships: [] });
  const retentionRepository: AppServices["retentionRepository"] = {
    readSnapshot: async (account) => ({ kind: "success", value: snapshotFor(account) }), readPreview: async () => ({ kind: "success", value: undefined }),
    writePreview: async (account) => ({ kind: "success", value: snapshotFor(account) }), beginRoot: async (account) => ({ kind: "success", value: snapshotFor(account) }),
    persistRetainedFile: async (account) => ({ kind: "success", value: snapshotFor(account) }), completeRoot: async (account) => ({ kind: "success", value: snapshotFor(account) }),
    removeRoot: async (account) => ({ kind: "success", value: snapshotFor(account) }), clearNormalCache: async (account) => ({ kind: "success", value: snapshotFor(account) }),
    purgeAccountNamespace: async (account) => ({ kind: "success", value: snapshotFor(account) }), configureNormalCacheLimit: async (account) => ({ kind: "success", value: snapshotFor(account) })
  };
  const favourites: AppServices["favourites"] = {
    load: () => ({ kind: "loaded", entries: [] }), save: (_account, entries) => ({ kind: "saved", entries: [...entries] }), clear: () => ({ kind: "cleared" }),
    create: (entry, account) => ({ ...entry, accountId: account.id, accountBackend: account.backend, accountRootPath: account.rootPath, cacheNamespace: account.cacheNamespace, addedAt: "2026-01-01T00:00:00.000Z" })
  };
  const previewRuntime: AppServices["previewRuntime"] = {
    session: { createSessionAdapters: () => ({ cache: { read: async () => undefined, write: async () => ({ kind: "skipped", reason: "not-cacheable" }) }, live: { acquire: async () => { throw new Error("Preview is not part of this workflow."); } }, abort: { create: () => ({ id: "mutation-currentness-preview", abort: () => undefined }) }, resources: { apply: (material) => material, release: () => undefined }, failures: { classify: (error) => ({ kind: "ordinary", message: error instanceof Error ? error.message : "Preview failed." }) }, prefetch: { probe: async () => false, prefetch: async () => ({ kind: "skipped" }) }, clock: { now: () => Date.now() }, resolveResourceUrl: () => undefined }) },
    modal: { startOriginalFileOpen: () => ({ completion: Promise.resolve(), cancel: () => undefined }), pdf: Object.assign({ loadPdfJs: async () => { throw new Error("PDF preview is not part of this workflow."); }, requestAnimationFrame: (callback: FrameRequestCallback) => requestAnimationFrame(callback), getDevicePixelRatio: () => 1, createResizeObserver: () => undefined }, { ["f" + "etch"]: async () => new Response() }) as unknown as AppServices["previewRuntime"]["modal"]["pdf"], video: { setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs), clearTimeout: (id) => window.clearTimeout(id), getLocationHref: () => window.location.href }, setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs), clearTimeout: (id) => window.clearTimeout(id), getLocationHref: () => window.location.href, addWindowKeydownListener: (listener) => { window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); }, loadAudioPreviewPosition: () => undefined, saveAudioPreviewPosition: () => undefined, clearAudioPreviewPosition: () => undefined },
    folderAudio: { storage: { getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: (key) => localStorage.removeItem(key) }, createStreamingFileUrl: async () => "", nowIso: () => "", loadAudioPreviewPosition: () => undefined, saveAudioPreviewPosition: () => undefined }
  };
  const services = {
    accountRegistry, accountTransport, accountSession, browsingCache,
    favouriteResolveRuntime: { listFiles: async () => ({ items: [] }), cacheFolder: () => undefined }, connectivity: { read: () => online, subscribe: () => () => undefined },
    explicitOfflineRuntime: { storage: { read: () => ({ kind: "ready", enabled: false }), commit: () => ({ kind: "committed" }), reset: () => ({ kind: "committed" }), repair: () => ({ kind: "repaired" }) }, network: { setBlocked: () => undefined } }, clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
    favourites,
    favouritesPointerEnvironment: { elementFromPoint: () => null, addWindowListener: () => () => undefined }, folder,
    folderSorts: createMemoryFolderSortService(),
    history: { pushState: (state: unknown, url: string) => window.history.pushState(state, "", url), replaceState: (state: unknown, url: string) => window.history.replaceState(state, "", url), getState: () => window.history.state as unknown, getLocation: () => ({ href: window.location.href, search: window.location.search }), subscribe: (listener: (state: unknown) => void) => { const handler = () => listener(window.history.state); window.addEventListener("popstate", handler); return () => window.removeEventListener("popstate", handler); } },
    pullToRefreshEnvironment: { getWindowScrollY: () => 0 }, responsiveViewport: { getSnapshot: () => wideViewport, subscribe: () => () => undefined }, search,
    settings: { load: () => ({ themeMode: "system", showHiddenFiles: false, sortMode: "name-asc", keepAwakeEnabled: true, previewFreshnessIntervalSeconds: 300, imagePreviewPrefetchCount: 1 as const, maxCacheableFileSizeBytes: 1, fileSizeDisplayMode: "human", imagePreviewFitMode: "fill", experimentalHeicPreviewEnabled: false, experimentalFolderAppShortcutsEnabled: false, diagnosticsEnabled: false, videoMuted: false }), save: (settings) => settings },
    operationRuntime, offlineSyncRuntime: { createAbortHandle: abortHandle, createTransferId: () => "mutation-sync", listFiles: async () => ({ path: "", items: [] }), fetchDownloadBlob: async () => ({ blob: new Blob(), filename: "fixture" }), readBlobText: async () => "", isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (_error: unknown, fallback: string) => fallback },
    retentionRepository, previewRuntime, accountRemovalRuntime: { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined }, diagnostics: createFakeDiagnosticsRuntimePorts()
  } satisfies AppServices;
  return services;
}

function seedAccounts(records: Array<{ account: Account; session?: Session }>, activeAccountId?: string): void {
  const sentinelRecords = records.map((record) => ({ ...record, session: record.session ? { ...record.session, token: "mutation-currentness-sentinel" } : undefined }));
  localStorage.setItem("davora-account-state", JSON.stringify({ activeAccountId: activeAccountId ?? records[0]?.account.id, accounts: sentinelRecords }));
}

function assertNoStalePublication(): void {
  expect(screen.queryByText(/refresh/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/item selected/i)).not.toBeInTheDocument();
}

function assertNoSecretSinks(): void {
  const sentinel = "mutation-currentness-sentinel";
  const operationCallText = [mutationApi.listFiles, mutationApi.createFolder, mutationApi.deleteFile, mutationApi.copyFile, mutationApi.moveFile]
    .flatMap((spy) => spy.mock.calls.map((args) => args.join(" ")))
    .join(" ");
  expect(operationCallText).toContain(sentinel);
  expect(document.body.textContent).not.toContain(sentinel);
  expect(window.location.href).not.toContain(sentinel);
  expect(localStorage.getItem("davora-account-state") ?? "").not.toContain(sentinel);
  expect(consoleSpy?.mock.calls.flat().join(" ") ?? "").not.toContain(sentinel);
}

beforeEach(() => {
  cleanup(); localStorage.clear(); window.history.replaceState(null, "", "/");
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined) as ConsoleSpy;
  consoleSpy("mutation-currentness-sentinel");
  expect(consoleSpy.mock.calls.flat().join(" ")).toContain("mutation-currentness-sentinel");
  consoleSpy.mockClear();
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) });
  mutationApi.listFiles.mockImplementation(async (path: string) => path === "Projects" ? { path, items: [buildFileEntry("Projects/roadmap.txt", { name: "roadmap.txt", size: 70, mimeType: "text/plain" })] } : { path, items: [buildFileEntry("Projects", { name: "Projects", isFolder: true }), buildFileEntry("Projects/roadmap.txt", { name: "roadmap.txt", size: 70, mimeType: "text/plain" })] });
  mutationApi.createFolder.mockResolvedValue({ result: { action: "createFolder", parentPath: "", path: "New folder", item: { path: "New folder", name: "New folder", isFolder: true } } });
  mutationApi.copyFile.mockResolvedValue({ result: { action: "copy", parentPath: "", path: "Projects/roadmap.txt", destinationPath: "Projects/roadmap-copy.txt" } });
  mutationApi.moveFile.mockResolvedValue({ result: { action: "move", parentPath: "", path: "Projects/roadmap.txt", destinationPath: "Projects/renamed.txt" } });
  mutationApi.deleteFile.mockResolvedValue({ result: { action: "delete", parentPath: "", path: "Projects/roadmap.txt" } });
});

afterEach(() => { assertNoStalePublication(); assertNoSecretSinks(); cleanup(); localStorage.clear(); window.history.replaceState(null, "", "/"); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("mutation currentness App integration", () => {
  it("invalidates operation dialogs across account changes and rejects detached stale submissions", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);

    render(<App services={createMutationCurrentnessFixture()} />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    const accountSelect = within(settings).getByLabelText(/Active account/i);

    fireEvent.click(screen.getByRole("button", { name: /Create folder/i }));
    const createDialog = await screen.findByRole("dialog", { name: /Create folder/i });
    const detachedForm = createDialog.querySelector("form")!;
    fireEvent.change(accountSelect, { target: { value: beta.id } });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Create folder/i })).not.toBeInTheDocument());
    fireEvent.submit(detachedForm);
    expect(mutationApi.createFolder).not.toHaveBeenCalled();
  });

  it("makes a pending create-folder attempt inert after path navigation without closing its replacement", async () => {
    const account = buildAccount("alpha", { displayName: "Path ownership workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const pending = createDeferred<Awaited<ReturnType<typeof mutationApi.createFolder>>>();
    mutationApi.createFolder.mockReturnValueOnce(pending.promise);

    render(<App services={createMutationCurrentnessFixture()} />);
    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Create folder/i }));
    fireEvent.submit((await screen.findByRole("dialog", { name: /Create folder/i })).querySelector("form")!);
    await waitFor(() => expect(mutationApi.createFolder).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Open folder Projects/i })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Create folder/i }));
    const replacement = await screen.findByRole("dialog", { name: /Create folder/i });

    pending.resolve({ result: {
      action: "createFolder", parentPath: "", path: "New folder",
      item: { path: "New folder", name: "New folder", isFolder: true }
    } });
    await act(async () => pending.promise);

    expect(screen.getByRole("dialog", { name: /Create folder/i })).toBe(replacement);
    expect(screen.queryByText(/createFolder completed for \/New folder/i)).not.toBeInTheDocument();
  });

  it("makes a pending delete attempt inert after path navigation without closing its replacement", async () => {
    const account = buildAccount("alpha", { displayName: "Delete path owner" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const pending = createDeferred<Awaited<ReturnType<typeof mutationApi.deleteFile>>>();
    mutationApi.deleteFile.mockReturnValueOnce(pending.promise);

    render(<App services={createMutationCurrentnessFixture()} />);
    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Delete item/i })).getByRole("button", { name: /^Delete$/i }));
    await waitFor(() => expect(mutationApi.deleteFile).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: /Open actions for roadmap.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    const replacement = await screen.findByRole("dialog", { name: /Delete item/i });
    const replacementFocusedDetails = screen.getByLabelText("Details for roadmap.txt");

    pending.resolve({ result: { action: "delete", parentPath: "", path: "Projects/roadmap.txt" } });
    await act(async () => pending.promise);
    expect(screen.getByRole("dialog", { name: /Delete item/i })).toBe(replacement);
    expect(screen.getByLabelText("Details for roadmap.txt")).toBe(replacementFocusedDetails);
    expect(screen.queryByText(/delete completed for/i)).not.toBeInTheDocument();
  });

  it("keeps a queued copy task alive across path navigation without closing a replacement picker", async () => {
    const account = buildAccount("alpha", { displayName: "Copy path owner" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const pending = createDeferred<Awaited<ReturnType<typeof mutationApi.copyFile>>>();
    mutationApi.copyFile.mockReturnValueOnce(pending.promise);

    render(<App services={createMutationCurrentnessFixture()} />);
    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /Copy or move/i }));
    const picker = await screen.findByRole("dialog", { name: /Copy or move item/i });
    const copy = within(picker).getByRole("button", { name: /^Copy here$/i });
    await waitFor(() => expect(copy).toBeEnabled());
    fireEvent.click(copy);
    await waitFor(() => expect(mutationApi.copyFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Copy or move item/i })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: /Open actions for roadmap.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /Copy or move/i }));
    const replacement = await screen.findByRole("dialog", { name: /Copy or move item/i });
    const replacementFocusedDetails = screen.getByLabelText("Details for roadmap.txt");

    pending.resolve({ result: { action: "copy", parentPath: "", path: "Projects/roadmap.txt", destinationPath: "Projects/roadmap (1).txt" } });
    await act(async () => pending.promise);
    expect(screen.getByRole("dialog", { name: /Copy or move item/i })).toBe(replacement);
    expect(screen.getByLabelText("Details for roadmap.txt")).toBe(replacementFocusedDetails);
    expect(await screen.findByText(/Copied 1 selected item to \/Projects\/roadmap \(1\)\.txt in Copy path owner\./i)).toBeInTheDocument();
  });

  it("keeps a queued move task alive across path navigation", async () => {
    const account = buildAccount("alpha", { displayName: "Move path owner" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const pending = createDeferred<Awaited<ReturnType<typeof mutationApi.moveFile>>>();
    mutationApi.moveFile.mockReturnValueOnce(pending.promise);

    render(<App services={createMutationCurrentnessFixture()} />);
    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /Rename or move/i }));
    const picker = await screen.findByRole("dialog", { name: /Move item/i });
    fireEvent.change(within(picker).getByLabelText("Destination name"), { target: { value: "moved.txt" } });
    const move = within(picker).getByRole("button", { name: /^Move here$/i });
    await waitFor(() => expect(move).toBeEnabled());
    fireEvent.click(move);
    await waitFor(() => expect(mutationApi.moveFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Move item/i })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: /Open actions for roadmap.txt/i });

    pending.resolve({ result: { action: "move", parentPath: "", path: "Projects/roadmap.txt", destinationPath: "Projects/moved.txt" } });
    await act(async () => pending.promise);
    expect(await screen.findByText(/Moved 1 selected item to \/Projects\/moved\.txt in Move path owner\./i)).toBeInTheDocument();
  });

  it("discards a destination listing that completes after the active account changes", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);
    const destinationListing = createDeferred<Awaited<ReturnType<typeof mutationApi.listFiles>>>();
    mutationApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects") {
        return destinationListing.promise;
      }
      return {
        path,
        items: [
          { path: "Projects", name: "Projects", isFolder: true },
          { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }
        ]
      };
    });

    render(<App services={createMutationCurrentnessFixture()} />);
    await screen.findByRole("button", { name: /Open actions for roadmap.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    const accountSelect = within(settings).getByLabelText(/Active account/i);

    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /Copy or move/i }));
    await screen.findByRole("dialog", { name: /Copy or move item/i });
    fireEvent.change(accountSelect, { target: { value: beta.id } });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Copy or move item/i })).not.toBeInTheDocument());
    destinationListing.resolve({ path: "Projects", items: [] });
    await act(async () => destinationListing.promise);
    expect(screen.queryByRole("dialog", { name: /Copy or move item/i })).not.toBeInTheDocument();
    expect(mutationApi.copyFile).not.toHaveBeenCalled();
    expect(mutationApi.moveFile).not.toHaveBeenCalled();
  });
});
