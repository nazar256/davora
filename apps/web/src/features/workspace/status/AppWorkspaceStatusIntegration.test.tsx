import { act, cleanup, fireEvent, render as testingRender, screen, waitFor, within } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../../diagnostics/testing/fakes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../../App";
import type { AppServices } from "../../../app/AppServices";
import { createMemoryFolderSortService } from "../../browsing/folderSort/testing/fakeStorage";
import { buildAccount, buildSession } from "../../../test/accounts";

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

type AccountSnapshot = ReturnType<AppServices["accountRegistry"]["getSnapshot"]>;
type AccountState = ReturnType<AppServices["accountRegistry"]["getState"]>;
type PreviewMaterial = { readonly id: string; readonly kind: "blob" | "stream" };
type PreviewResource = { readonly id: string; readonly kind: "blob" | "stream" };

function createStatusFixture(): AppServices {
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
    loadFolder: async ({ path }) => ({ completeness: "complete" as const, kind: "success", items: path ? [] : [{ path: "Projects", name: "Projects", isFolder: true }] }),
    readCachedFolder: () => undefined,
    writeCachedFolder: () => undefined
  };
  const search: AppServices["search"] = {
    createAbortHandle: abortHandle,
    loadSearch: async () => ({ completeness: "complete" as const, kind: "success", items: [] }),
    readCachedSearch: () => undefined,
    writeCachedSearch: () => undefined
  };
  const snapshotFor = (account: Parameters<AppServices["retentionRepository"]["readSnapshot"]>[0]) => ({ account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 1 }, roots: [], files: [], memberships: [] });
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
    configureNormalCacheLimit: async (account) => ({ kind: "success", value: snapshotFor(account) })
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
      pdf: { loadPdfJs: async () => { throw new Error("PDF is not used by this fixture."); }, fetch: async () => new Response(), requestAnimationFrame: (callback) => requestAnimationFrame(callback), getDevicePixelRatio: () => 1, createResizeObserver: () => undefined },
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
  const wideViewport = { kind: "wide" } as const;
  return {
    accountRegistry,
    accountTransport,
    accountSession,
    browsingCache: { readFolder: () => ({ kind: "miss" }), writeFolder: () => ({ kind: "written" }), readSearch: () => ({ kind: "miss" }), writeSearch: () => ({ kind: "written" }), clearNamespace: () => ({ kind: "cleared" }), clearFolderPath: () => ({ kind: "cleared" }), clearNamespaceOrThrow: () => undefined, clearFolderPathOrThrow: () => undefined },
    favouriteResolveRuntime: { listFiles: async () => ({ completeness: "complete" as const, items: [] }), cacheFolder: () => undefined },
    connectivity: { read: () => online, subscribe: () => () => undefined },
    explicitOfflineRuntime: { storage: { read: () => ({ kind: "ready", enabled: false }), commit: () => ({ kind: "committed" }), reset: () => ({ kind: "committed" }), repair: () => ({ kind: "repaired" }) }, network: { setBlocked: () => undefined } },
    clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
    favourites: { load: () => ({ kind: "loaded", entries: [] }), save: () => ({ kind: "saved", entries: [] }), clear: () => ({ kind: "cleared" }), create: (entry) => ({ ...entry, accountId: "alpha", accountBackend: "mock", accountRootPath: "", cacheNamespace: "ns-alpha", addedAt: "2026-01-01T00:00:00.000Z" }) },
    favouritesPointerEnvironment: { elementFromPoint: () => null, addWindowListener: () => () => undefined },
    folder,
    folderSorts: createMemoryFolderSortService(),
    history: { pushState: (state, url) => window.history.pushState(state, "", url), replaceState: (state, url) => window.history.replaceState(state, "", url), getState: () => window.history.state as unknown, getLocation: () => ({ href: window.location.href, search: window.location.search }), subscribe: () => () => undefined },
    pullToRefreshEnvironment: { getWindowScrollY: () => window.scrollY },
    responsiveViewport: { getSnapshot: () => wideViewport, subscribe: () => () => undefined },
    search,
    settings: { load: () => ({ themeMode: "system", fileSizeDisplayMode: "human", maxCacheableFileSizeBytes: 1000000, imagePreviewFitMode: "fill", previewFreshnessIntervalSeconds: 60, imagePreviewPrefetchCount: 1 as const, keepAwakeEnabled: true, showHiddenFiles: false, experimentalHeicPreviewEnabled: false, experimentalFolderAppShortcutsEnabled: false, diagnosticsEnabled: false, sortMode: "name-asc", videoMuted: false }), save: (value) => value },
    operationRuntime: { request: { createAbortHandle: abortHandle, createTransferId: () => "status-transfer" }, mutation: { createFolder: async () => ({ action: "createFolder", parentPath: "", path: "" }), deleteFile: async () => ({ action: "delete", parentPath: "", path: "" }), uploadFile: async () => ({ action: "upload", parentPath: "", path: "" }), copyOrMove: async () => ({ action: "copy", parentPath: "", path: "" }), listDestination: async () => ({ completeness: "complete" as const, items: [] }) }, download: { prepareDownloadFile: async () => ({ blob: new Blob(), filename: "" }), fetchDownloadBlob: async () => ({ blob: new Blob() }), listFiles: async () => ({ completeness: "complete" as const, items: [] }), triggerBrowserDownload: () => undefined, saveDownload: () => undefined }, batch: { downloadSelectionAsZip: async () => { throw new Error("Batch download is not used by this fixture."); } }, preview: { createFileStreamUrl: async () => "" }, time: { wait: async () => {} }, uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) }, isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback },
    offlineSyncRuntime: { createAbortHandle: abortHandle, createTransferId: () => "status-sync", listFiles: async () => ({ completeness: "complete" as const, path: "", items: [] }), fetchDownloadBlob: async () => ({ blob: new Blob() }), readBlobText: async () => "", isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback },
    retentionRepository,
    previewRuntime,
    accountRemovalRuntime: { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined }, diagnostics: createFakeDiagnosticsRuntimePorts()
  };
}

function seedAccounts(records: Array<{ account: ReturnType<typeof buildAccount>; session?: ReturnType<typeof buildSession> }>, activeAccountId?: string): void {
  localStorage.setItem("davora-account-state", JSON.stringify({ activeAccountId: activeAccountId ?? records[0]?.account.id, accounts: records }));
}

function render(_ui: Parameters<typeof testingRender>[0]) {
  const services = createStatusFixture();
  const view = testingRender(<App services={services} />);
  return { ...view, rerender: (_next: Parameters<typeof view.rerender>[0]) => view.rerender(<App services={services} />) };
}

function browseStatusText(): string {
  return document.querySelector(".browse-status-note")?.textContent ?? "";
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) });
  accountGetHealthMock.mockReset();
  accountCreateSessionMock.mockReset();
  accountGetHealthMock.mockResolvedValue({ app: "davora", configLoaded: true, backend: "mock", rootPath: ".davora-agent-test", unlockRequired: false, connectionMode: "in_app", supportedAccountTypes: ["nextcloud"] });
  accountCreateSessionMock.mockImplementation(async ({ accountId }) => buildSession(buildAccount(accountId)));
  registerSwMock.mockReset();
  registerSwMock.mockReturnValue({ offlineReady: [false, vi.fn()], needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn(async () => undefined) });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Workspace status App integration", () => {
  it("keeps an announced status across an App input rerender", async () => {
    const account = buildAccount("alpha", { displayName: "Rerender status workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    const view = render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(within(within(settings).getByRole("group", { name: /Theme/i })).getByRole("button", { name: "Light" }));
    await waitFor(() => expect(browseStatusText()).toBe("Light theme selected."));

    view.rerender(<App />);
    expect(browseStatusText()).toBe("Light theme selected.");
  });

  it("keeps same-turn status announcements in synchronous last-writer order", async () => {
    const account = buildAccount("alpha", { displayName: "Last writer workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    });

    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    const theme = within(settings).getByRole("group", { name: /Theme/i });
    act(() => {
      fireEvent.click(within(theme).getByRole("button", { name: "Dark" }));
      fireEvent.click(within(settings).getByLabelText(/Keep screen awake during active work/i));
    });

    await waitFor(() => expect(browseStatusText()).toBe("Keep awake is disabled on this device."));
  });
});
