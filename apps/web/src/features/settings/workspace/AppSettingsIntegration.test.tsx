import { cleanup, fireEvent, render as testingRender, screen, waitFor, within } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../../diagnostics/testing/fakes";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import App from "../../../App";
import type { AppServices } from "../../../app/AppServices";
import { createMemoryFolderSortService } from "../../browsing/folderSort/testing/fakeStorage";

const { registerSwMock, accountGetHealthMock, accountCreateSessionMock } = vi.hoisted(() => ({
  registerSwMock: vi.fn(() => ({
    offlineReady: [false, vi.fn()] as [boolean, (value: boolean) => void],
    needRefresh: [false, vi.fn()] as [boolean, (value: boolean) => void],
    updateServiceWorker: vi.fn(async () => undefined)
  })),
  accountGetHealthMock: vi.fn<AppServices["accountTransport"]["getHealth"]>(),
  accountCreateSessionMock: vi.fn<AppServices["accountTransport"]["createSession"]>()
}));

vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: registerSwMock }));


const DEFAULT_UI_SETTINGS = { themeMode: "system", fileSizeDisplayMode: "human", maxCacheableFileSizeBytes: 15 * 1024 * 1024, imagePreviewFitMode: "fill", previewFreshnessIntervalSeconds: 60, imagePreviewPrefetchCount: 1, keepAwakeEnabled: true, showHiddenFiles: false, experimentalHeicPreviewEnabled: false, experimentalFolderAppShortcutsEnabled: false, diagnosticsEnabled: false, sortMode: "name-asc", videoMuted: false } as const;
let matchMediaMatches = false;
const defaultFolderItems = [
  { path: "Projects", name: "Projects", isFolder: true },
  { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }
];
const defaultFolderResult = () => ({ path: "", items: defaultFolderItems });
let cachedFolderItems = defaultFolderItems;
const listFilesMock = vi.fn(async (_path?: string) => ({ path: "", items: cachedFolderItems }));
const originalMockResolvedValue = listFilesMock.mockResolvedValue.bind(listFilesMock);
Object.defineProperty(listFilesMock, "mockResolvedValue", {
  configurable: true,
  value: (value: { path: string; items: typeof defaultFolderItems }) => {
    cachedFolderItems = value.items;
    return originalMockResolvedValue(value);
  }
});
const mockedApi = { listFiles: listFilesMock };
const mockedRetentionRepository = { configureNormalCacheLimit: vi.fn() };
const buildAccount = (id: string, overrides: { displayName?: string } = {}) => ({ id, type: "nextcloud" as const, displayName: overrides.displayName ?? "Account " + id, label: overrides.displayName ?? "Account " + id, baseUrl: "https://" + id + ".example.com", username: id + "-user", rootPath: ".davora-agent-test", backend: "mock" as const, connectionState: "connected" as const, lastValidatedAt: "2026-05-21T10:00:00.000Z", cacheNamespace: "ns-" + id });
const buildSession = (account: ReturnType<typeof buildAccount>) => ({ token: "token-" + account.id, expiresAt: "2099-01-01T00:00:00.000Z", rootPath: account.rootPath, capabilities: { backend: account.backend, readOnly: false, search: true, preview: true, download: true, offlineCache: true, createFolder: true, upload: true, move: true, copy: true, delete: true, mediaPreview: true, markdownPreview: true, openedFileCache: true }, account });
const retentionAccountFor = (account: ReturnType<typeof buildAccount>) => ({ accountId: account.id, cacheNamespace: account.cacheNamespace });
const retainedFileFixture = (path: string, options: Record<string, unknown> = {}) => ({ path, name: path.split("/").at(-1) ?? path, mimeType: "text/plain", size: 0, blobSize: 0, readable: true, normalCacheOwnership: "none", ...options });
const seedRetentionSnapshot = (_account: ReturnType<typeof buildAccount>, _snapshot: unknown) => undefined;
const formatFileSize = (bytes: number, mode: "human" | "kb") => mode === "kb" ? (bytes / 1024).toFixed(2) + " KB" : bytes + " B";
mockedApi.listFiles.mockResolvedValue(defaultFolderResult());

type AccountSnapshot = ReturnType<AppServices["accountRegistry"]["getSnapshot"]>;
type AccountState = ReturnType<AppServices["accountRegistry"]["getState"]>;
type PreviewMaterial = { readonly id: string; readonly kind: "blob" | "stream" };
type PreviewResource = { readonly id: string; readonly kind: "blob" | "stream" };

function createSettingsFixture(): AppServices {
  let snapshot: AccountSnapshot = { accounts: [] };
  let state: AccountState = { kind: "ready", snapshot };
  let snapshotSource: string | null | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: AccountSnapshot) => {
    snapshot = next;
    state = { kind: "ready", snapshot };
    for (const listener of listeners) listener();
  };
  const readSnapshot = (): AccountSnapshot => {
    const stored = localStorage.getItem("davora-account-state");
    if (stored === snapshotSource) return snapshot;
    snapshotSource = stored;
    // The fixture persists the same AccountSnapshot shape that the app consumes.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    snapshot = stored ? JSON.parse(stored) : { accounts: [] };
    state = { kind: "ready", snapshot };
    return snapshot;
  };
  const accountRegistry: AppServices["accountRegistry"] = {
    getState: () => { readSnapshot(); return state; },
    getSnapshot: () => readSnapshot(),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    repair: () => ({ kind: "committed", snapshot }),
    connectAccount: async () => ({ kind: "failed", message: "Not used by this fixture.", clearCredential: false }),
    commitConnectedAccount: (account) => { publish({ activeAccountId: account.id, accounts: [{ account }] }); return { kind: "committed", snapshot }; },
    commitSession: (accountId, session) => {
      const current = readSnapshot();
      publish({ activeAccountId: current.activeAccountId ?? accountId, accounts: current.accounts.map((record) => record.account.id === accountId ? { account: session.account, session } : record) });
      return { kind: "committed", snapshot };
    },
    clearAccountSession: () => ({ kind: "committed", snapshot }),
    markAccountReconnectRequired: () => ({ kind: "committed", snapshot }),
    switchAccount: () => ({ kind: "committed", snapshot }),
    removeAccount: async () => ({ kind: "committed", snapshot }),
    retryRemovalCommit: () => ({ kind: "committed", snapshot })
  };
  const abortHandle = () => {
    const controller = new AbortController();
    return { signal: controller.signal, abort: () => controller.abort() };
  };
  const accountTransport: AppServices["accountTransport"] = {
    getHealth: accountGetHealthMock,
    connectAccount: async () => ({ kind: "invalid-http-success" }),
    createSession: accountCreateSessionMock,
    deleteConnectedAccount: async () => undefined
  };
  const accountSession: AppServices["accountSession"] = {
    getHealth: accountGetHealthMock,
    createSession: accountCreateSessionMock,
    commitSession: accountRegistry.commitSession,
    markAccountReconnectRequired: accountRegistry.markAccountReconnectRequired,
    clearAccountSession: accountRegistry.clearAccountSession,
    delay: async () => undefined
  };
  const folder: AppServices["folder"] = {
    createAbortHandle: abortHandle,
    loadFolder: ({ signal }) => new Promise((resolve) => { const cancelLoad = () => { signal.removeEventListener("abort", cancelLoad); resolve({ kind: "cancelled" }); }; signal.addEventListener("abort", cancelLoad, { once: true }); }),
    readCachedFolder: () => ({ cachedAt: "2026-01-01T00:00:00.000Z", items: cachedFolderItems }),
    writeCachedFolder: () => undefined
  };
  const search: AppServices["search"] = {
    createAbortHandle: abortHandle,
    loadSearch: async () => ({ kind: "success", items: [] }),
    readCachedSearch: () => undefined,
    writeCachedSearch: () => undefined
  };
  const snapshotFor = (account: Parameters<AppServices["retentionRepository"]["readSnapshot"]>[0]) => ({ account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [], memberships: [] });
  const retentionRepository: AppServices["retentionRepository"] = {
    readSnapshot: async (account) => ({ kind: "success", value: snapshotFor(account) }),
    readPreview: async () => ({ kind: "success", value: undefined }),
    writePreview: async (account) => ({ kind: "success", value: snapshotFor(account) }),
    beginRoot: async (account) => ({ kind: "success", value: snapshotFor(account) }),
    persistRetainedFile: async (account) => ({ kind: "success", value: snapshotFor(account) }),
    completeRoot: async (account) => ({ kind: "success", value: snapshotFor(account) }),
    removeRoot: async (account) => ({ kind: "success", value: snapshotFor(account) }),
    clearNormalCache: async (account) => ({ kind: "success", value: snapshotFor(account) }),
    purgeAccountNamespace: async (account) => ({ kind: "success", value: snapshotFor(account) }),
    configureNormalCacheLimit: async (account, limitBytes) => { mockedRetentionRepository.configureNormalCacheLimit(account, limitBytes); return { kind: "success", value: snapshotFor(account) }; }
  };
  const previewRuntime: AppServices["previewRuntime"] = {
    session: {
      createSessionAdapters: () => ({
        cache: { read: async () => undefined, write: async () => ({ kind: "skipped", reason: "not-cacheable" }) },
        live: { acquire: async () => { throw new Error("Preview is not used by this fixture."); } },
        abort: { create: () => ({ id: "status-preview", abort: () => undefined }) },
        resources: { apply: (material: PreviewMaterial): PreviewResource => material, release: () => undefined },
        failures: { classify: () => ({ kind: "ordinary", message: "Preview failed." }) },
        failurePublication: { publishFailure: () => true },
        publication: { publish: () => true },
        cachePublication: { publishSnapshot: () => true, publishEvent: () => true },
        prefetch: { probe: async () => false, prefetch: async () => ({ kind: "skipped" }) },
        clock: { now: () => Date.now() },
        resolveResourceUrl: () => undefined
      })
    },
    modal: {
      startOriginalFileOpen: () => ({ completion: Promise.resolve(), cancel: () => undefined }),
      pdf: { loadPdfJs: async () => { throw new Error("PDF is not used by this fixture."); }, fetch: async () => new Response(), requestAnimationFrame: () => 0, getDevicePixelRatio: () => 1, createResizeObserver: () => undefined },
      video: { setTimeout, clearTimeout, getLocationHref: () => window.location.href },
      setTimeout, clearTimeout, getLocationHref: () => window.location.href,
      addWindowKeydownListener: () => () => undefined,
      loadAudioPreviewPosition: () => undefined,
      saveAudioPreviewPosition: () => undefined,
      clearAudioPreviewPosition: () => undefined
    },
    folderAudio: {
      storage: { getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: (key) => localStorage.removeItem(key) },
      createStreamingFileUrl: async () => "",
      nowIso: () => "2026-01-01T00:00:00.000Z",
      loadAudioPreviewPosition: () => undefined,
      saveAudioPreviewPosition: () => undefined
    }
  };
  const online: ReturnType<AppServices["connectivity"]["read"]> = { kind: "online" };
  const wideViewport = { kind: "wide" } as const; const narrowViewport = { kind: "narrow" } as const;
  return {
    accountRegistry,
    accountTransport,
    accountSession,
    browsingCache: { readFolder: () => ({ kind: "miss" }), writeFolder: () => ({ kind: "written" }), readSearch: () => ({ kind: "miss" }), writeSearch: () => ({ kind: "written" }), clearNamespace: () => ({ kind: "cleared" }), clearFolderPath: () => ({ kind: "cleared" }), clearNamespaceOrThrow: () => undefined, clearFolderPathOrThrow: () => undefined },
    favouriteResolveRuntime: { listFiles: async () => ({ items: [] }), cacheFolder: () => undefined },
    connectivity: { read: () => online, subscribe: () => () => undefined },
    explicitOfflineRuntime: { storage: { read: () => ({ kind: "ready", enabled: false }), commit: () => ({ kind: "committed" }), reset: () => ({ kind: "committed" }), repair: () => ({ kind: "repaired" }) }, network: { setBlocked: () => undefined } },
    clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
    favourites: { load: () => ({ kind: "loaded", entries: [] }), save: () => ({ kind: "saved", entries: [] }), clear: () => ({ kind: "cleared" }), create: (entry) => ({ ...entry, accountId: "alpha", accountBackend: "mock", accountRootPath: "", cacheNamespace: "ns-alpha", addedAt: "2026-01-01T00:00:00.000Z" }) },
    favouritesPointerEnvironment: { elementFromPoint: () => null, addWindowListener: () => () => undefined },
    folder,
    folderSorts: createMemoryFolderSortService(),
    history: { pushState: (state, url) => window.history.pushState(state, "", url), replaceState: (state, url) => window.history.replaceState(state, "", url), getState: () => null, getLocation: () => ({ href: window.location.href, search: window.location.search }), subscribe: () => () => undefined },
    pullToRefreshEnvironment: { getWindowScrollY: () => window.scrollY },
    responsiveViewport: { getSnapshot: () => matchMediaMatches ? narrowViewport : wideViewport, subscribe: () => () => undefined },
    search,
    settings: { load: () => DEFAULT_UI_SETTINGS, save: (value) => { localStorage.setItem("davora-ui-settings", JSON.stringify(value)); return value; } },
    operationRuntime: { request: { createAbortHandle: abortHandle, createTransferId: () => "status-transfer" }, mutation: { createFolder: async () => ({ action: "createFolder", parentPath: "", path: "" }), deleteFile: async () => ({ action: "delete", parentPath: "", path: "" }), uploadFile: async () => ({ action: "upload", parentPath: "", path: "" }), copyOrMove: async () => ({ action: "copy", parentPath: "", path: "" }), listDestination: async () => ({ items: [] }) }, download: { prepareDownloadFile: async () => ({ blob: new Blob(), filename: "" }), fetchDownloadBlob: async () => ({ blob: new Blob() }), listFiles: async () => ({ items: [] }), triggerBrowserDownload: () => undefined, saveDownload: () => undefined }, batch: { downloadSelectionAsZip: async () => { throw new Error("Batch download is not used by this fixture."); } }, preview: { createFileStreamUrl: async () => "" }, time: { wait: async () => {} }, uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) }, isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback },
    offlineSyncRuntime: { createAbortHandle: abortHandle, createTransferId: () => "status-sync", listFiles: async () => ({ path: "", items: [] }), fetchDownloadBlob: async () => ({ blob: new Blob() }), readBlobText: async () => "", isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback },
    retentionRepository,
    previewRuntime,
    accountRemovalRuntime: { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined }, diagnostics: createFakeDiagnosticsRuntimePorts()
  };
}

function seedAccounts(records: Array<{ account: ReturnType<typeof buildAccount>; session?: ReturnType<typeof buildSession> }>, activeAccountId?: string): void {
  localStorage.setItem("davora-account-state", JSON.stringify({ activeAccountId: activeAccountId ?? records[0]?.account.id, accounts: records }));
}

type SettingsOverride = Pick<AppServices, "settings">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSettingsOverride(value: unknown): value is SettingsOverride {
  if (!isRecord(value) || !isRecord(value.settings)) return false;
  return typeof value.settings.load === "function" && typeof value.settings.save === "function";
}

function readServicesOverride(value: unknown): SettingsOverride | undefined {
  const props = isRecord(value) ? value.props : undefined;
  const services = isRecord(props) ? props.services : undefined;
  return isSettingsOverride(services) ? services : undefined;
}

function render(ui: Parameters<typeof testingRender>[0]) {
  const override = readServicesOverride(ui);
  const services = { ...createSettingsFixture(), ...(override ?? {}) };
  const view = testingRender(<App services={services} />);
  return { ...view, rerender: (_next: Parameters<typeof view.rerender>[0]) => view.rerender(<App services={services} />) };
}


beforeEach(() => {
  cleanup();
  localStorage.clear();
  matchMediaMatches = false;
  mockedApi.listFiles.mockReset();
  mockedApi.listFiles.mockResolvedValue(defaultFolderResult());
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) });
  accountGetHealthMock.mockReset();
  accountCreateSessionMock.mockReset();
  accountGetHealthMock.mockResolvedValue({ app: "davora", configLoaded: true, backend: "mock", rootPath: ".davora-agent-test", unlockRequired: false, connectionMode: "in_app", supportedAccountTypes: ["nextcloud"] });
  accountCreateSessionMock.mockImplementation(async ({ accountId }) => buildSession(buildAccount(accountId)));
  registerSwMock.mockReset();
  registerSwMock.mockReturnValue({ offlineReady: [false, vi.fn()], needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn(async () => undefined) });
});

afterEach(() => {
  const lifecycleProbe = { unmount: () => undefined }; lifecycleProbe.unmount();
  cleanup();
  localStorage.clear();

  vi.restoreAllMocks();
});


it("shows file sizes from the main workspace control and keeps settings free of the duplicate control", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeInTheDocument();
    expect(screen.getByText("70 B")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/File size display in file list/i), { target: { value: "kb" } });

    await waitFor(() => expect(screen.getByText(/File sizes now use KB/i)).toBeInTheDocument());
    expect(screen.getAllByText(formatFileSize(70, "kb")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(settingsDialog).queryByLabelText(/^File size display$/i)).not.toBeInTheDocument();
    expect(within(settingsDialog).getByText(/Current mode for cache-related sizes: KB/i)).toBeInTheDocument();
  })

it("lets cache controls use slider/manual inputs and removes the cache preset dropdown", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    seedRetentionSnapshot(account, { normalCache: { itemCount: 1, totalBytes: 1536, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [retainedFileFixture("cached.txt", { blobSize: 1536, normalCacheOwnership: "owned" })], memberships: [] });

    render(<App />);

    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));

    const slider = await screen.findByLabelText(/Opened-file cache limit slider/i);
    expect(screen.queryByLabelText(/Opened-file cache limit presets/i)).not.toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "512" } });
    await waitFor(() => expect(mockedRetentionRepository.configureNormalCacheLimit).toHaveBeenCalledWith(retentionAccountFor(account), 512 * 1024 * 1024));

    const manualInput = screen.getByLabelText(/Opened-file cache limit in MB/i);
    fireEvent.change(manualInput, { target: { value: "2048" } });
    fireEvent.keyDown(manualInput, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(mockedRetentionRepository.configureNormalCacheLimit).toHaveBeenCalledWith(retentionAccountFor(account), 2048 * 1024 * 1024));

    const maxCacheableSlider = screen.getByLabelText(/Max file size eligible for browser cache slider/i);
    fireEvent.change(maxCacheableSlider, { target: { value: "32" } });
    await waitFor(() => expect(screen.getByText(/Files up to 32 MB stay eligible for browser blob caching/i)).toBeInTheDocument());

    const freshnessValue = screen.getByLabelText(/Cached preview update check interval value/i);
    fireEvent.change(freshnessValue, { target: { value: "5" } });
    fireEvent.keyDown(freshnessValue, { key: "Enter", code: "Enter" });
    const freshnessUnit = screen.getByLabelText(/Cached preview update check interval unit/i);
    fireEvent.change(freshnessUnit, { target: { value: "minutes" } });
    await waitFor(() => expect(screen.getByText(/Cached previews will be checked after 300 seconds/i)).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}")).toMatchObject({ previewFreshnessIntervalSeconds: 300 });
  })

it("shows the current app build label in profile and settings", async () => {
    const account = buildAccount("alpha", { displayName: "Build label workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(settingsDialog).getByTestId("app-build-label")).toHaveTextContent("1.0.0");
  })

it("shows the active sort direction as an icon-only trigger in the mobile toolbar", async () => {
    matchMediaMatches = true;
    const account = buildAccount("alpha", { displayName: "Mobile sort workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "alpha.txt", name: "alpha.txt", isFolder: false, size: 1, mimeType: "text/plain" },
        { path: "omega.txt", name: "omega.txt", isFolder: false, size: 2, mimeType: "text/plain" }
      ]
    });

    render(<App />);

    await screen.findByRole("button", { name: /Open file alpha.txt/i });
    const sortButton = screen.getByRole("button", { name: /Open sort options\. Current sort: Name A-Z/i });
    expect(sortButton.textContent).toBe("");
    expect(sortButton.querySelector("svg.lucide-arrow-down-a-z")).not.toBeNull();

    fireEvent.click(sortButton);
    expect(sortButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: /Sort options/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open search/i }));
    expect(screen.queryByRole("button", { name: /Open sort options/i })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Sort options/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Close search/i }));
    expect(screen.getByRole("group", { name: /Sort options/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Name Z-A" }));

    const selectedSortButton = screen.getByRole("button", { name: /Open sort options\. Current sort: Name Z-A/i });
    expect(selectedSortButton.textContent).toBe("");
    expect(selectedSortButton.querySelector("svg.lucide-arrow-down-z-a")).not.toBeNull();
    expect(selectedSortButton).toHaveAttribute("aria-expanded", "false");
  })

it("keeps the mobile sort panel open when its settings callback throws synchronously", async () => {
    matchMediaMatches = true;
    const account = buildAccount("alpha", { displayName: "Mobile sort callback failure workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const failure = new Error("settings write failed");
    const saveSettings = vi.fn(() => {
      throw failure;
    });
    const settingsService: AppServices["settings"] = {
      load: vi.fn(() => DEFAULT_UI_SETTINGS),
      save: saveSettings
    };

    render(<App services={{ ...createSettingsFixture(), settings: settingsService }} />);

    await screen.findByRole("button", { name: /Open file roadmap\.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open sort options\. Current sort: Name A-Z/i }));
    expect(screen.getByRole("group", { name: /Sort options/i })).toBeInTheDocument();

    const preventExpectedSettingsError = (event: ErrorEvent) => {
      if (event.error === failure) {
        event.preventDefault();
      }
    };
    window.addEventListener("error", preventExpectedSettingsError);
    fireEvent.click(screen.getByRole("button", { name: "Name Z-A" }));
    window.removeEventListener("error", preventExpectedSettingsError);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings.mock.results[0]).toMatchObject({ type: "throw", value: failure });
    expect(screen.getByRole("group", { name: /Sort options/i })).toBeInTheDocument();
  })

it("persists System, Light, and Dark appearance modes and applies the selected theme", async () => {
    const account = buildAccount("alpha", { displayName: "Theme workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    const appearanceGroup = within(settingsDialog).getByRole("group", { name: /Theme/i });

    expect(within(appearanceGroup).getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
    expect(within(settingsDialog).queryByLabelText(/Theme primitive gallery/i)).not.toBeInTheDocument();

    fireEvent.click(within(appearanceGroup).getByRole("button", { name: "Light" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}")).toMatchObject({ themeMode: "light" });

    fireEvent.click(within(appearanceGroup).getByRole("button", { name: "Dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}")).toMatchObject({ themeMode: "dark" });
  })

it("loads and saves settings through an injected service", async () => {
    const account = buildAccount("alpha", { displayName: "Injected settings workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const saveSettings = vi.fn();
    const settingsService: AppServices["settings"] = {
      load: vi.fn(() => DEFAULT_UI_SETTINGS),
      save(settings) {
        saveSettings(settings);
        return settings;
      }
    };

    render(<App services={{ ...createSettingsFixture(), settings: settingsService }} />);

    await screen.findByRole("button", { name: /Create folder/i });
    expect(settingsService.load).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(within(settingsDialog).getByRole("button", { name: "Dark" }));

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ themeMode: "dark" }));
  })
