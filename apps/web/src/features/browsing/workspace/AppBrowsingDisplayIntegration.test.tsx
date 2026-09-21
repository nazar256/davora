import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../../diagnostics/testing/fakes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSession, ConnectedAccount, FileEntry, SearchResult } from "@davora/shared";

import App from "../../../App";
import type { AppServices } from "../../../app/AppServices";
import type { AccountRegistrySnapshot, AccountRegistryState } from "../../accounts/registry";
import type { BrowsingCacheRepository } from "..";
import { createMemoryFolderSortService } from "../folderSort/testing/fakeStorage";
import type { UiSettings } from "../../settings/model";
import { buildAccount, buildSession } from "../../../test/accounts";
import { buildHealthResponse } from "../../../test/api";
import { createDeferred } from "../../../test/primitives";

type FolderResponse = { readonly path: string; readonly items: FileEntry[] };
type SearchResponse = { readonly query: string; readonly path: string; readonly items: SearchResult[] };

const mockedApi = {
  listFiles: vi.fn<(path: string) => Promise<FolderResponse>>(),
  searchFiles: vi.fn<(path: string, query: string, token: string, signal: AbortSignal) => Promise<SearchResponse>>()
};
const mockedCache = {
  readFolder: vi.fn<BrowsingCacheRepository["readFolder"]>(),
  writeFolder: vi.fn<BrowsingCacheRepository["writeFolder"]>(),
  readSearch: vi.fn<BrowsingCacheRepository["readSearch"]>(),
  writeSearch: vi.fn<BrowsingCacheRepository["writeSearch"]>(),
  clearNamespace: vi.fn<BrowsingCacheRepository["clearNamespace"]>(),
  clearFolderPath: vi.fn<BrowsingCacheRepository["clearFolderPath"]>(),
  clearNamespaceOrThrow: vi.fn<BrowsingCacheRepository["clearNamespaceOrThrow"]>(),
  clearFolderPathOrThrow: vi.fn<BrowsingCacheRepository["clearFolderPathOrThrow"]>()
};

type AccountSnapshot = AccountRegistrySnapshot;
type AccountState = AccountRegistryState;
type SeedRecord = AccountSnapshot["accounts"][number];

let accountSnapshot: AccountSnapshot = { accounts: [] };
let accountState: AccountState = { kind: "ready", snapshot: accountSnapshot };
const accountListeners = new Set<() => void>();
const onlineSnapshot = { kind: "online" } as const;
const wideViewportSnapshot = { kind: "wide" } as const;
let settings: UiSettings = {
  themeMode: "system" as const,
  fileSizeDisplayMode: "human" as const,
  maxCacheableFileSizeBytes: 15 * 1024 * 1024,
  imagePreviewFitMode: "fill" as const,
  previewFreshnessIntervalSeconds: 60,
  keepAwakeEnabled: true,
  showHiddenFiles: false,
  experimentalHeicPreviewEnabled: false, experimentalFolderAppShortcutsEnabled: false, diagnosticsEnabled: false,
  sortMode: "name-asc" as const
};

function publishAccounts(next: AccountSnapshot): void {
  accountSnapshot = next;
  accountState = { kind: "ready", snapshot: next };
  for (const listener of accountListeners) listener();
}

function updateAccount(accountId: string, update: (record: SeedRecord) => SeedRecord): void {
  publishAccounts({
    activeAccountId: accountSnapshot.activeAccountId,
    accounts: accountSnapshot.accounts.map((record) => record.account.id === accountId ? update(record) : record)
  });
}

function createBrowsingFixture(): AppServices {
  const accountRegistry: AppServices["accountRegistry"] = {
    getState: () => accountState,
    getSnapshot: () => accountSnapshot,
    subscribe: (listener) => {
      accountListeners.add(listener);
      return () => accountListeners.delete(listener);
    },
    repair: () => ({ kind: "committed", snapshot: accountSnapshot }),
    connectAccount: async () => ({ kind: "failed", message: "Not used by the browsing integration fixture.", clearCredential: false }),
    commitConnectedAccount: (account) => {
      const record = { account };
      publishAccounts({ activeAccountId: account.id, accounts: [...accountSnapshot.accounts, record] });
      return { kind: "committed", snapshot: accountSnapshot };
    },
    commitSession: (accountId, session) => {
      updateAccount(accountId, (record) => ({ ...record, account: session.account, session }));
      return { kind: "committed", snapshot: accountSnapshot };
    },
    clearAccountSession: (accountId) => {
      updateAccount(accountId, (record) => ({ account: record.account }));
      return { kind: "committed", snapshot: accountSnapshot };
    },
    markAccountReconnectRequired: (accountId) => {
      updateAccount(accountId, (record) => ({ ...record, session: undefined }));
      return { kind: "committed", snapshot: accountSnapshot };
    },
    switchAccount: (accountId) => {
      publishAccounts({ activeAccountId: accountId, accounts: accountSnapshot.accounts });
      return { kind: "committed", snapshot: accountSnapshot };
    },
    removeAccount: async (accountId) => {
      const accounts = accountSnapshot.accounts.filter((record) => record.account.id !== accountId);
      publishAccounts({ activeAccountId: accounts[0]?.account.id, accounts });
      return { kind: "committed", snapshot: accountSnapshot };
    },
    retryRemovalCommit: () => ({ kind: "committed", snapshot: accountSnapshot })
  };

  const abortHandle = () => {
    const controller = new AbortController();
    return { signal: controller.signal, abort: () => controller.abort() };
  };
  const folder: AppServices["folder"] = {
    createAbortHandle: abortHandle,
    loadFolder: async ({ path }) => {
      try {
        const response = await mockedApi.listFiles(path);
        return { kind: "success", items: response.items };
      } catch (error) {
        return { kind: "failure", error: error instanceof Error ? error : new Error("Folder listing failed") };
      }
    },
    readCachedFolder: (namespace, path) => {
      const cached = mockedCache.readFolder(namespace, path);
      return cached.kind === "hit" ? { items: cached.items, cachedAt: cached.cachedAt } : undefined;
    },
    writeCachedFolder: (namespace, path, items) => {
      mockedCache.writeFolder(namespace, path, items);
    }
  };
  const search: AppServices["search"] = {
    createAbortHandle: abortHandle,
    loadSearch: async ({ path, query, token, signal }) => {
      try {
        const response = await mockedApi.searchFiles(path, query, token, signal);
        return { kind: "success", items: response.items };
      } catch (error) {
        return { kind: "failure", error: error instanceof Error ? error : new Error("Search failed") };
      }
    },
    readCachedSearch: (namespace, path, query) => {
      const cached = mockedCache.readSearch(namespace, path, query);
      return cached.kind === "hit" ? cached.items : undefined;
    },
    writeCachedSearch: (namespace, path, query, items) => {
      mockedCache.writeSearch(namespace, path, query, items);
    }
  };
  const connectivity: AppServices["connectivity"] = { read: () => onlineSnapshot, subscribe: () => () => undefined };
  const browsingCache: AppServices["browsingCache"] = mockedCache;
  const accountTransport: AppServices["accountTransport"] = {
    getHealth: async () => buildHealthResponse(),
    connectAccount: async () => ({ kind: "invalid-http-success" }),
    createSession: async ({ accountId }) => buildSession(buildAccount(accountId)),
    deleteConnectedAccount: async () => undefined
  };
  const accountSession: AppServices["accountSession"] = {
    getHealth: async () => buildHealthResponse(),
    createSession: async ({ accountId }) => buildSession(buildAccount(accountId)),
    commitSession: accountRegistry.commitSession,
    markAccountReconnectRequired: accountRegistry.markAccountReconnectRequired,
    clearAccountSession: accountRegistry.clearAccountSession,
    delay: async () => undefined
  };
  const retentionSnapshot = (account: { readonly accountId: string; readonly cacheNamespace: string }) => ({
    account,
    normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 },
    roots: [], files: [], memberships: []
  });
  const retentionRepository: AppServices["retentionRepository"] = {
    readSnapshot: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    readPreview: async () => ({ kind: "success", value: undefined }),
    writePreview: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    beginRoot: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    persistRetainedFile: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    completeRoot: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    removeRoot: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    clearNormalCache: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    purgeAccountNamespace: async (account) => ({ kind: "success", value: retentionSnapshot(account) }),
    configureNormalCacheLimit: async (account) => ({ kind: "success", value: retentionSnapshot(account) })
  };
  const previewRuntime: AppServices["previewRuntime"] = {
    session: {
      createSessionAdapters: () => ({
        cache: { read: async () => undefined, write: async () => ({ kind: "skipped", reason: "not-cacheable" }) },
        live: { acquire: async () => { throw new Error("Preview is not used by the browsing integration fixture."); } },
        abort: { create: () => ({ id: "browsing-preview", abort: () => undefined }) },
        resources: { apply: (material: { readonly id: string; readonly kind: "blob" | "stream" }) => material, release: () => undefined },
        failures: { classify: () => ({ kind: "ordinary", message: "Preview failed." }) },
        failurePublication: { publishFailure: () => true }, publication: { publish: () => true },
        cachePublication: { publishSnapshot: () => true, publishEvent: () => true },
        prefetch: { probe: async () => false, prefetch: async () => ({ kind: "skipped" }) },
        clock: { now: () => Date.now() }, resolveResourceUrl: () => undefined
      })
    },
    modal: {
      startOriginalFileOpen: () => ({ completion: Promise.resolve(), cancel: () => undefined }),
      pdf: { loadPdfJs: async () => { throw new Error("PDF is not used by the browsing integration fixture."); }, fetch: async () => new Response(), requestAnimationFrame: (callback) => requestAnimationFrame(callback), getDevicePixelRatio: () => 1, createResizeObserver: () => undefined },
      video: { setTimeout, clearTimeout, getLocationHref: () => window.location.href },
      setTimeout, clearTimeout, getLocationHref: () => window.location.href,
      addWindowKeydownListener: () => () => undefined, loadAudioPreviewPosition: () => undefined,
      saveAudioPreviewPosition: () => undefined, clearAudioPreviewPosition: () => undefined
    },
    folderAudio: {
      storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      createStreamingFileUrl: async () => "", nowIso: () => "2026-01-01T00:00:00.000Z",
      loadAudioPreviewPosition: () => undefined, saveAudioPreviewPosition: () => undefined
    }
  };
  return {
    accountRegistry, accountTransport, accountSession, browsingCache,
    favouriteResolveRuntime: { listFiles: async () => ({ items: [] }), cacheFolder: () => undefined },
    connectivity,
    explicitOfflineRuntime: { storage: { read: () => ({ kind: "ready", enabled: false }), commit: () => ({ kind: "committed" }), reset: () => ({ kind: "committed" }), repair: () => ({ kind: "repaired" }) }, network: { setBlocked: () => undefined } },
    clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
    favourites: { load: () => ({ kind: "loaded", entries: [] }), save: (_account, entries) => ({ kind: "saved", entries: [...entries] }), clear: () => ({ kind: "cleared" }), create: (entry, account) => ({ ...entry, accountId: account.id, accountBackend: account.backend, accountRootPath: account.rootPath, cacheNamespace: account.cacheNamespace, addedAt: "2026-01-01T00:00:00.000Z" }) },
    favouritesPointerEnvironment: { elementFromPoint: () => null, addWindowListener: () => () => undefined },
    folder,
    folderSorts: createMemoryFolderSortService(),
    history: { pushState: (state, url) => window.history.pushState(state, "", url), replaceState: (state, url) => window.history.replaceState(state, "", url), getState: (): unknown => window.history.state, getLocation: () => ({ href: window.location.href, search: window.location.search }), subscribe: (listener) => { const handler = () => listener(window.history.state); window.addEventListener("popstate", handler); return () => window.removeEventListener("popstate", handler); } },
    pullToRefreshEnvironment: { getWindowScrollY: () => window.scrollY },
    responsiveViewport: { getSnapshot: () => wideViewportSnapshot, subscribe: () => () => undefined },
    search,
    settings: { load: () => settings, save: (next) => { settings = next; return next; } },
    operationRuntime: { request: { createAbortHandle: abortHandle, createTransferId: () => "browsing-transfer" }, mutation: { createFolder: async () => ({ action: "createFolder", parentPath: "", path: "" }), deleteFile: async () => ({ action: "delete", parentPath: "", path: "" }), uploadFile: async () => ({ action: "upload", parentPath: "", path: "" }), copyOrMove: async () => ({ action: "copy", parentPath: "", path: "" }), listDestination: async () => ({ items: [] }) }, download: { prepareDownloadFile: async () => ({ blob: new Blob(), filename: "" }), fetchDownloadBlob: async () => ({ blob: new Blob() }), listFiles: async () => ({ items: [] }), triggerBrowserDownload: () => undefined, saveDownload: () => undefined }, batch: { downloadSelectionAsZip: async () => { throw new Error("Batch download is not used by the browsing integration fixture."); } }, preview: { createFileStreamUrl: async () => "" }, uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) }, isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback },
    offlineSyncRuntime: { createAbortHandle: abortHandle, createTransferId: () => "browsing-sync", listFiles: async () => ({ path: "", items: [] }), fetchDownloadBlob: async () => ({ blob: new Blob() }), readBlobText: async () => "", isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback },
    retentionRepository, previewRuntime,
    accountRemovalRuntime: { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined }, diagnostics: createFakeDiagnosticsRuntimePorts()
  };
}

const services = createBrowsingFixture();

function seedAccounts(records: Array<{ account: ConnectedAccount; session?: AppSession }>, activeAccountId?: string): void {
  publishAccounts({ activeAccountId: activeAccountId ?? records[0]?.account.id, accounts: records });
}

beforeEach(() => {
  cleanup();
  accountSnapshot = { accounts: [] };
  accountState = { kind: "ready", snapshot: accountSnapshot };
  settings = { ...settings, themeMode: "system", showHiddenFiles: false, sortMode: "name-asc" };
  mockedApi.listFiles.mockReset();
  mockedApi.searchFiles.mockReset();
  mockedCache.readFolder.mockReset();
  mockedCache.writeFolder.mockReset();
  mockedCache.readSearch.mockReset();
  mockedCache.writeSearch.mockReset();
  mockedCache.clearNamespace.mockReset();
  mockedCache.clearFolderPath.mockReset();
  mockedCache.clearNamespaceOrThrow.mockReset();
  mockedCache.clearFolderPathOrThrow.mockReset();
  mockedApi.listFiles.mockResolvedValue({ path: "", items: [{ path: "Projects", name: "Projects", isFolder: true }] });
  mockedApi.searchFiles.mockResolvedValue({ query: "", path: "", items: [] });
  mockedCache.readFolder.mockReturnValue({ kind: "miss" });
  mockedCache.writeFolder.mockReturnValue({ kind: "written" });
  mockedCache.readSearch.mockReturnValue({ kind: "miss" });
  mockedCache.writeSearch.mockReturnValue({ kind: "written" });
  mockedCache.clearNamespace.mockReturnValue({ kind: "cleared" });
  mockedCache.clearFolderPath.mockReturnValue({ kind: "cleared" });
  mockedCache.clearNamespaceOrThrow.mockImplementation(() => undefined);
  mockedCache.clearFolderPathOrThrow.mockImplementation(() => undefined);
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) });
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    offlineReady: [false, () => undefined] as [boolean, (value: boolean) => void],
    needRefresh: [false, () => undefined] as [boolean, (value: boolean) => void],
    updateServiceWorker: async () => undefined
  })
}));

describe("browsing display integration", () => {
  it("keeps reconnect local to search when a transient search request fails", async () => {
    const account = buildAccount("alpha", { displayName: "Search workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.searchFiles.mockRejectedValueOnce(new TypeError("fetch failed"));
    mockedCache.readSearch.mockReturnValue({
      kind: "hit",
      items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain", score: 75 }]
    });

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.change(screen.getByLabelText(/Search files/i), { target: { value: "roadmap" } });

    await waitFor(() => expect(mockedApi.searchFiles).toHaveBeenCalledWith("", "roadmap", "token-alpha", expect.any(AbortSignal)));
    expect(await screen.findByRole("button", { name: /Open file roadmap.txt/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Reconnect Search workspace/i })).not.toBeInTheDocument();
  });

  it("preserves backend relevance order for active search results", async () => {
    const account = buildAccount("alpha", { displayName: "Search workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.searchFiles.mockResolvedValueOnce({
      query: "plan",
      path: "",
      items: [
        { path: "Projects/zeta.txt", name: "zeta.txt", isFolder: false, size: 90, mimeType: "text/plain", score: 99 },
        { path: "Projects/Archive", name: "Archive", isFolder: true, score: 80 },
        { path: "Projects/alpha.txt", name: "alpha.txt", isFolder: false, size: 70, mimeType: "text/plain", score: 70 }
      ]
    });

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.change(screen.getByLabelText(/Search files/i), { target: { value: "plan" } });

    await screen.findByRole("button", { name: /Open file zeta.txt/i });
    const resultButtons = screen.getAllByRole("button", { name: /Open (file|folder)/i }).map((button) => button.getAttribute("aria-label"));
    expect(resultButtons).toEqual([
      "Open file zeta.txt",
      "Open folder Archive",
      "Open file alpha.txt"
    ]);
  });

  it("keeps the raw search query for transport while presenting its trimmed case-preserving value", async () => {
    const account = buildAccount("alpha", { displayName: "Search presentation workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.searchFiles.mockResolvedValueOnce({
      query: "  Plan  Q3  ",
      path: "",
      items: [{ path: "Projects/plan.txt", name: "plan.txt", isFolder: false, score: 1 }]
    });

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.change(screen.getByLabelText(/Search files/i), { target: { value: "  Plan  Q3  " } });

    await waitFor(() => expect(document.querySelector(".browse-title-count")?.textContent).toBe("1 result for “Plan  Q3” in /"));
    expect(mockedApi.searchFiles).toHaveBeenCalledWith("", "  Plan  Q3  ", "token-alpha", expect.any(AbortSignal));
  });

  it("masks prior-query results while a replacement search is pending", async () => {
    const account = buildAccount("alpha", { displayName: "Search isolation workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const replacement = createDeferred<{ query: string; path: string; items: Array<{ path: string; name: string; isFolder: boolean; score: number }> }>();
    mockedApi.searchFiles
      .mockResolvedValueOnce({ query: "old", path: "", items: [{ path: "old.txt", name: "old.txt", isFolder: false, score: 1 }] })
      .mockReturnValueOnce(replacement.promise);

    render(<App services={services} />);
    await screen.findByRole("button", { name: /Create folder/i });
    const input = screen.getByLabelText(/Search files/i);
    fireEvent.change(input, { target: { value: "old" } });
    expect(await screen.findByRole("button", { name: /Open file old.txt/i })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "new" } });
    expect(screen.queryByRole("button", { name: /Open file old.txt/i })).not.toBeInTheDocument();

    replacement.resolve({ query: "new", path: "", items: [{ path: "new.txt", name: "new.txt", isFolder: false, score: 1 }] });
    expect(await screen.findByRole("button", { name: /Open file new.txt/i })).toBeInTheDocument();
  });

  it("groups folders above files and sorts within each group by the active sort mode", async () => {
    const account = buildAccount("alpha", { displayName: "Folder first workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "z-file.txt", name: "z-file.txt", isFolder: false, size: 2, mimeType: "text/plain" },
        { path: "Archive", name: "Archive", isFolder: true },
        { path: "a-file.txt", name: "a-file.txt", isFolder: false, size: 1, mimeType: "text/plain" },
        { path: "Projects", name: "Projects", isFolder: true }
      ]
    });

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Open folder Archive/i });
    const rowNames = Array.from(document.querySelectorAll(".item-name")).map((node) => node.textContent);
    // Default sort is name-asc, so folders and files are each sorted alphabetically
    expect(rowNames).toEqual(["Archive", "Projects", "a-file.txt", "z-file.txt"]);
  });

  it("uses breadcrumb home navigation without redundant all-files or up-level buttons", async () => {
    const account = buildAccount("alpha", { displayName: "Navigation workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App services={services} />);

    fireEvent.click(await screen.findByRole("button", { name: /Open folder Projects/i }));

    const breadcrumbs = await screen.findByRole("navigation", { name: /Breadcrumbs/i });
    expect(within(breadcrumbs).getByRole("button", { name: /Go to home folder/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Go to all files/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Go up one folder level/i })).not.toBeInTheDocument();
    expect(within(breadcrumbs).getAllByText("/").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    const drawerBreadcrumbs = await screen.findByRole("navigation", { name: /Folder navigation/i });
    expect(within(drawerBreadcrumbs).getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(within(drawerBreadcrumbs).getByRole("button", { name: "Projects" })).toHaveAttribute("aria-current", "page");
  });

  it("shows loading state for a never-cached folder instead of empty", async () => {
    const account = buildAccount("alpha", { displayName: "Unknown folder workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedCache.readFolder.mockReturnValue({ kind: "miss" });

    const deferred = createDeferred<{ path: string; items: Array<{ path: string; name: string; isFolder: boolean; size?: number; mimeType?: string }> }>();
    mockedApi.listFiles.mockImplementation(() => deferred.promise);

    render(<App services={services} />);

    expect(screen.getByText(/Loading folder/i)).toBeInTheDocument();
    expect(document.querySelector(".empty-state")).toBeNull();
    expect(screen.queryByText(/This folder is empty/i)).not.toBeInTheDocument();

    deferred.resolve({ path: "", items: [{ path: "Projects", name: "Projects", isFolder: true }] });
    expect(await screen.findByRole("button", { name: /Open folder Projects/i })).toBeInTheDocument();
  });

  it("shows unknown state when first load of a never-cached folder fails", async () => {
    const account = buildAccount("alpha", { displayName: "Unknown folder workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedCache.readFolder.mockReturnValue({ kind: "miss" });
    // Non-transient failure: "Network error" matches folder transient classification and hides Retry via cache-only mode.
    mockedApi.listFiles.mockRejectedValue(new Error("Folder listing failed"));

    render(<App services={services} />);

    expect(await screen.findByText(/Couldn't load this folder. Its contents are unknown/i)).toBeInTheDocument();
    expect(screen.queryByText(/This folder is empty/i)).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Retry folder/i })).toBeInTheDocument();
  });

  it("shows normal empty state for a confirmed empty folder after successful load", async () => {
    const account = buildAccount("alpha", { displayName: "Empty folder workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValueOnce({ path: "", items: [] });

    render(<App services={services} />);

    const emptyMessage = await screen.findByText(/This folder is empty/i);
    const emptyState = emptyMessage.closest<HTMLElement>(".empty-state");
    expect(emptyState).not.toBeNull();
    expect(within(emptyState!).getByText(/This folder is empty/i)).toBeInTheDocument();
    expect(within(emptyState!).queryByText(/Loading folder/i)).not.toBeInTheDocument();
    expect(within(emptyState!).queryByText(/Couldn't load this folder/i)).not.toBeInTheDocument();
  });

  it("shows cached empty folder as empty while refreshing in the background", async () => {
    const account = buildAccount("alpha", { displayName: "Cached empty workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedCache.readFolder.mockReturnValue({
      kind: "hit",
      cachedAt: "2026-06-07T10:00:00.000Z",
      items: []
    });

    const deferred = createDeferred<{ path: string; items: Array<{ path: string; name: string; isFolder: boolean; size?: number; mimeType?: string }> }>();
    mockedApi.listFiles.mockImplementation(() => deferred.promise);

    render(<App services={services} />);

    const emptyState = await waitFor(() => {
      const candidate = document.querySelector(".empty-state");
      if (!(candidate instanceof HTMLElement)) {
        throw new Error("Expected the empty state to render");
      }
      return candidate;
    });
    expect(within(emptyState).getByText(/This folder is empty/i)).toBeInTheDocument();
    expect(within(emptyState).queryByText(/Loading folder/i)).not.toBeInTheDocument();
    expect(document.querySelector(".folder-cache-toast")).toBeNull();
    expect(screen.getByText("Refreshing")).toBeInTheDocument();
    expect(screen.queryByText(/Showing cached data while checking for changes in the background/i)).not.toBeInTheDocument();

    deferred.resolve({ path: "", items: [] });
    await waitFor(() => expect(screen.queryByText(/Showing cached data while checking for changes in the background/i)).not.toBeInTheDocument());
  });

  it("hides dot-prefixed files and folders by default", async () => {
    const account = buildAccount("alpha", { displayName: "Hidden files workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "visible.txt", name: "visible.txt", isFolder: false, size: 10, mimeType: "text/plain" },
        { path: ".hidden", name: ".hidden", isFolder: false, size: 5, mimeType: "text/plain" },
        { path: "._.DS_Store", name: "._.DS_Store", isFolder: false, size: 3, mimeType: "application/octet-stream" }
      ]
    });

    render(<App services={services} />);

    expect(await screen.findByRole("button", { name: /Open file visible.txt/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open file .hidden/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open file ._\.DS_Store/i })).not.toBeInTheDocument();
  });

  it("reveals hidden files when the settings toggle is enabled", async () => {
    const account = buildAccount("alpha", { displayName: "Hidden files workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "visible.txt", name: "visible.txt", isFolder: false, size: 10, mimeType: "text/plain" },
        { path: ".hidden", name: ".hidden", isFolder: false, size: 5, mimeType: "text/plain" }
      ]
    });

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Open file visible.txt/i });
    expect(screen.queryByRole("button", { name: /Open file .hidden/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    const checkbox = within(settingsDialog).getByLabelText(/Show hidden files and folders/i);
    fireEvent.click(checkbox);

    expect(await screen.findByRole("button", { name: /Open file .hidden/i })).toBeInTheDocument();
  });

  it("sorts files by name descending when the sort mode is changed", async () => {
    const account = buildAccount("alpha", { displayName: "Sort workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "alpha.txt", name: "alpha.txt", isFolder: false, size: 1, mimeType: "text/plain" },
        { path: "omega.txt", name: "omega.txt", isFolder: false, size: 2, mimeType: "text/plain" },
        { path: "beta.txt", name: "beta.txt", isFolder: false, size: 3, mimeType: "text/plain" }
      ]
    });

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Open file alpha.txt/i });
    let rowNames = Array.from(document.querySelectorAll(".item-name")).map((node) => node.textContent);
    expect(rowNames).toEqual(["alpha.txt", "beta.txt", "omega.txt"]);

    const sortSelect = screen.getByLabelText(/Sort files and folders/i);
    fireEvent.change(sortSelect, { target: { value: "name-desc" } });

    await waitFor(() => {
      rowNames = Array.from(document.querySelectorAll(".item-name")).map((node) => node.textContent);
      expect(rowNames).toEqual(["omega.txt", "beta.txt", "alpha.txt"]);
    });
  });

  it("sorts files by size when the sort mode is changed", async () => {
    const account = buildAccount("alpha", { displayName: "Sort workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "small.txt", name: "small.txt", isFolder: false, size: 1, mimeType: "text/plain" },
        { path: "large.txt", name: "large.txt", isFolder: false, size: 100, mimeType: "text/plain" },
        { path: "medium.txt", name: "medium.txt", isFolder: false, size: 50, mimeType: "text/plain" }
      ]
    });

    render(<App services={services} />);

    await screen.findByRole("button", { name: /Open file small.txt/i });
    const sortSelect = screen.getByLabelText(/Sort files and folders/i);
    fireEvent.change(sortSelect, { target: { value: "size-desc" } });

    await waitFor(() => {
      const rowNames = Array.from(document.querySelectorAll(".item-name")).map((node) => node.textContent);
      expect(rowNames).toEqual(["large.txt", "medium.txt", "small.txt"]);
    });
  });
});
