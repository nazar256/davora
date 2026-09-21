import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createFakeDiagnosticsRuntimePorts } from "../diagnostics/testing/fakes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../App";
import type { AppServices } from "../../app/AppServices";
import { createMemoryFolderSortService } from "../browsing/folderSort/testing/fakeStorage";
import { buildAccount, buildSession } from "../../test/accounts";
import { buildHealthResponse } from "../../test/api";

const { registerSwMock } = vi.hoisted(() => ({
  registerSwMock: vi.fn(() => ({
    offlineReady: [false, vi.fn()] as [boolean, (value: boolean) => void],
    needRefresh: [false, vi.fn()] as [boolean, (value: boolean) => void],
    updateServiceWorker: vi.fn(async () => undefined)
  }))
}));
const accountGetHealthMock = vi.fn<AppServices["accountTransport"]["getHealth"]>();
const accountCreateSessionMock = vi.fn<AppServices["accountTransport"]["createSession"]>();

vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: registerSwMock }));

type AccountSnapshot = ReturnType<AppServices["accountRegistry"]["getSnapshot"]>;
type AccountState = ReturnType<AppServices["accountRegistry"]["getState"]>;
type PreviewMaterial = { readonly id: string; readonly kind: "blob" | "stream" };
type PreviewResource = { readonly id: string; readonly kind: "blob" | "stream" };

function createPwaFixture(): AppServices {
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
    snapshot = stored ? JSON.parse(stored) : { accounts: [] };
    state = { kind: "ready", snapshot };
    return snapshot;
  };
  const accountRegistry: AppServices["accountRegistry"] = {
    getState: () => {
      readSnapshot();
      return state;
    },
    getSnapshot: () => {
      return readSnapshot();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    repair: () => ({ kind: "committed", snapshot }),
    connectAccount: async () => ({ kind: "failed", message: "Not used by the PWA integration fixture.", clearCredential: false }),
    commitConnectedAccount: (account) => {
      publish({ activeAccountId: account.id, accounts: [{ account }] });
      return { kind: "committed", snapshot };
    },
    commitSession: (accountId, session) => {
      const current = readSnapshot();
      publish({
        activeAccountId: current.activeAccountId ?? accountId,
        accounts: current.accounts.map((record) => record.account.id === accountId ? { account: session.account, session } : record)
      });
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
    loadFolder: async () => ({ kind: "success", items: [] }),
    readCachedFolder: () => undefined,
    writeCachedFolder: () => undefined
  };
  const search: AppServices["search"] = {
    createAbortHandle: abortHandle,
    loadSearch: async () => ({ kind: "success", items: [] }),
    readCachedSearch: () => undefined,
    writeCachedSearch: () => undefined
  };
  const online: ReturnType<AppServices["connectivity"]["read"]> = { kind: "online" };
  const wide: ReturnType<AppServices["responsiveViewport"]["getSnapshot"]> = { kind: "wide" };
  const browsingCache: AppServices["browsingCache"] = {
    readFolder: () => ({ kind: "miss" }),
    writeFolder: () => ({ kind: "written" }),
    readSearch: () => ({ kind: "miss" }),
    writeSearch: () => ({ kind: "written" }),
    clearNamespace: () => ({ kind: "cleared" }),
    clearFolderPath: () => ({ kind: "cleared" }),
    clearNamespaceOrThrow: () => undefined,
    clearFolderPathOrThrow: () => undefined
  };
  const retentionRepository: AppServices["retentionRepository"] = {
    readSnapshot: async (account) => ({ kind: "success", value: { account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 1 }, roots: [], files: [], memberships: [] } }),
    readPreview: async () => ({ kind: "success", value: undefined }),
    writePreview: async (account) => ({ kind: "success", value: { account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 1 }, roots: [], files: [], memberships: [] } }),
    beginRoot: async (account) => ({ kind: "success", value: { account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 1 }, roots: [], files: [], memberships: [] } }),
    persistRetainedFile: async (account) => ({ kind: "success", value: { account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 1 }, roots: [], files: [], memberships: [] } }),
    completeRoot: async (account) => ({ kind: "success", value: { account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 1 }, roots: [], files: [], memberships: [] } }),
    removeRoot: async (account) => ({ kind: "success", value: { account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 1 }, roots: [], files: [], memberships: [] } }),
    clearNormalCache: async (account) => ({ kind: "success", value: { account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 1 }, roots: [], files: [], memberships: [] } }),
    purgeAccountNamespace: async (account) => ({ kind: "success", value: { account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 1 }, roots: [], files: [], memberships: [] } }),
    configureNormalCacheLimit: async (account) => ({ kind: "success", value: { account, normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 1 }, roots: [], files: [], memberships: [] } })
  };
  const previewRuntime: AppServices["previewRuntime"] = {
    session: {
      createSessionAdapters: () => ({
        cache: { read: async () => undefined, write: async () => ({ kind: "skipped", reason: "not-cacheable" }) },
        live: { acquire: async () => { throw new Error("Preview is not used by the PWA integration fixture."); } },
        abort: { create: () => ({ id: "pwa-preview", abort: () => undefined }) },
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
      pdf: { loadPdfJs: async () => { throw new Error("PDF is not used by the PWA integration fixture."); }, fetch: async () => new Response(), requestAnimationFrame: (callback) => requestAnimationFrame(callback), getDevicePixelRatio: () => 1, createResizeObserver: () => undefined },
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
  return {
    accountRegistry, accountTransport, accountSession, browsingCache,
    favouriteResolveRuntime: { listFiles: async () => ({ items: [] }), cacheFolder: () => undefined },
    connectivity: { read: () => online, subscribe: () => () => undefined },
    explicitOfflineRuntime: { storage: { read: () => ({ kind: "ready", enabled: false }), commit: () => ({ kind: "committed" }), reset: () => ({ kind: "committed" }), repair: () => ({ kind: "repaired" }) }, network: { setBlocked: () => undefined } },
    clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
    favourites: { load: () => ({ kind: "loaded", entries: [] }), save: () => ({ kind: "saved", entries: [] }), clear: () => ({ kind: "cleared" }), create: (entry) => ({ ...entry, accountId: "alpha", accountBackend: "mock", accountRootPath: "", cacheNamespace: "ns-alpha", addedAt: "2026-01-01T00:00:00.000Z" }) },
    favouritesPointerEnvironment: { elementFromPoint: () => null, addWindowListener: () => () => undefined },
    folder,
    folderSorts: createMemoryFolderSortService(),
    history: { pushState: (state, url) => window.history.pushState(state, "", url), replaceState: (state, url) => window.history.replaceState(state, "", url), getState: (): unknown => { const state: unknown = window.history.state; return state; }, getLocation: () => ({ href: window.location.href, search: window.location.search }), subscribe: (listener) => { const handler = () => listener(window.history.state); window.addEventListener("popstate", handler); return () => window.removeEventListener("popstate", handler); } },
    pullToRefreshEnvironment: { getWindowScrollY: () => window.scrollY },
    responsiveViewport: { getSnapshot: () => wide, subscribe: () => () => undefined },
    search,
    settings: { load: () => ({ themeMode: "system", fileSizeDisplayMode: "human", maxCacheableFileSizeBytes: 1000000, imagePreviewFitMode: "fill", previewFreshnessIntervalSeconds: 60, keepAwakeEnabled: true, showHiddenFiles: false, experimentalHeicPreviewEnabled: false, experimentalFolderAppShortcutsEnabled: false, diagnosticsEnabled: false, sortMode: "name-asc" }), save: (value) => value },
    operationRuntime: { request: { createAbortHandle: abortHandle, createTransferId: () => "pwa-transfer" }, mutation: { createFolder: async () => ({ action: "createFolder", parentPath: "", path: "" }), deleteFile: async () => ({ action: "delete", parentPath: "", path: "" }), uploadFile: async () => ({ action: "upload", parentPath: "", path: "" }), copyOrMove: async () => ({ action: "copy", parentPath: "", path: "" }), listDestination: async () => ({ items: [] }) }, download: { prepareDownloadFile: async () => ({ blob: new Blob(), filename: "" }), fetchDownloadBlob: async () => ({ blob: new Blob() }), listFiles: async () => ({ items: [] }), triggerBrowserDownload: () => undefined, saveDownload: () => undefined }, batch: { downloadSelectionAsZip: async () => { throw new Error("Batch download is not used by the PWA integration fixture."); } }, preview: { createFileStreamUrl: async () => "" }, uploadFiles: { prepare: async () => ({ kind: "prepared", contentBase64: "" }) }, isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback },
    offlineSyncRuntime: { createAbortHandle: abortHandle, createTransferId: () => "pwa-sync", listFiles: async () => ({ path: "", items: [] }), fetchDownloadBlob: async () => ({ blob: new Blob() }), readBlobText: async () => "", isUnauthorized: () => false, isReconnectRequired: () => false, toErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback },
    retentionRepository, previewRuntime,
    accountRemovalRuntime: { revokeRemoteAccount: async () => undefined, purgeLocalAccountData: async () => undefined }, diagnostics: createFakeDiagnosticsRuntimePorts()
  };
}

function seedAccounts(records: Array<{ account: ReturnType<typeof buildAccount>; session?: ReturnType<typeof buildSession> }>, activeAccountId?: string): void {
  localStorage.setItem("davora-account-state", JSON.stringify({ activeAccountId: activeAccountId ?? records[0]?.account.id, accounts: records }));
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }) });
  accountGetHealthMock.mockReset();
  accountCreateSessionMock.mockReset();
  accountGetHealthMock.mockResolvedValue(buildHealthResponse());
  accountCreateSessionMock.mockImplementation(async ({ accountId }) => buildSession(buildAccount(accountId)));
  registerSwMock.mockReset();
  registerSwMock.mockReturnValue({ offlineReady: [false, vi.fn()], needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn(async () => undefined) });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  registerSwMock.mockReset();
  registerSwMock.mockReturnValue({ offlineReady: [false, vi.fn()], needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn(async () => undefined) });
  vi.restoreAllMocks();
});

describe("PWA App integration", () => {
  it("keeps install affordance out of the first-run zero state", async () => {
    const prompt = vi.fn(async () => undefined);
    const userChoice = Promise.resolve({ outcome: "dismissed" as const });

    render(<App services={createPwaFixture()} />);
    await screen.findByRole("heading", { name: /No connected accounts yet/i });

    const installEvent = new Event("beforeinstallprompt") as Event & {
      prompt: typeof prompt;
      userChoice: typeof userChoice;
      preventDefault: () => void;
    };
    installEvent.preventDefault = vi.fn();
    installEvent.prompt = prompt;
    installEvent.userChoice = userChoice;
    window.dispatchEvent(installEvent);

    await waitFor(() => expect(screen.queryByRole("button", { name: /Install app/i })).not.toBeInTheDocument());
  });

  it("hides a dismissed install affordance until a new browser install event arrives", async () => {
    const account = buildAccount("alpha", { displayName: "Install workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const prompt = vi.fn(async () => undefined);
    const firstChoice = Promise.resolve({ outcome: "dismissed" as const });

    render(<App services={createPwaFixture()} />);
    await screen.findByRole("button", { name: /Create folder/i });

    const firstEvent = new Event("beforeinstallprompt") as Event & {
      prompt: typeof prompt;
      userChoice: typeof firstChoice;
      preventDefault: () => void;
    };
    firstEvent.preventDefault = vi.fn();
    firstEvent.prompt = prompt;
    firstEvent.userChoice = firstChoice;
    window.dispatchEvent(firstEvent);

    const firstInstallButton = await screen.findByRole("button", { name: /Install app/i });
    fireEvent.click(firstInstallButton);
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Install app/i })).not.toBeInTheDocument());

    const secondChoice = Promise.resolve({ outcome: "accepted" as const });
    const secondEvent = new Event("beforeinstallprompt") as Event & {
      prompt: typeof prompt;
      userChoice: typeof secondChoice;
      preventDefault: () => void;
    };
    secondEvent.preventDefault = vi.fn();
    secondEvent.prompt = prompt;
    secondEvent.userChoice = secondChoice;
    window.dispatchEvent(secondEvent);

    expect(await screen.findByRole("button", { name: /Install app/i })).toBeInTheDocument();
  });

  it("shows a contextual install action only after the workspace is ready", async () => {
    const account = buildAccount("alpha", { displayName: "Install workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const prompt = vi.fn(async () => undefined);
    const userChoice = Promise.resolve({ outcome: "accepted" as const });

    registerSwMock.mockReturnValue({
      offlineReady: [false, vi.fn()],
      needRefresh: [false, vi.fn()],
      updateServiceWorker: vi.fn(async () => undefined)
    });

    render(<App services={createPwaFixture()} />);
    await screen.findByRole("button", { name: /Create folder/i });

    const installEvent = new Event("beforeinstallprompt") as Event & {
      prompt: typeof prompt;
      userChoice: typeof userChoice;
      preventDefault: () => void;
    };
    installEvent.preventDefault = vi.fn();
    installEvent.prompt = prompt;
    installEvent.userChoice = userChoice;

    window.dispatchEvent(installEvent);

    const installButton = await screen.findByRole("button", { name: /Install app/i });
    fireEvent.click(installButton);

    await waitFor(() => expect(prompt).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: /Install app/i })).not.toBeInTheDocument());
    expect(screen.queryByText(/Davora installed successfully/i)).not.toBeInTheDocument();
  });

  it("uses a clearer update prompt message and reload action state", async () => {
    const account = buildAccount("alpha", { displayName: "Update workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const updateServiceWorker = vi.fn(async () => undefined);
    registerSwMock.mockReturnValue({
      offlineReady: [false, vi.fn()],
      needRefresh: [true, vi.fn()],
      updateServiceWorker
    });

    render(<App services={createPwaFixture()} />);

    await screen.findByRole("button", { name: /Create folder/i });
    expect(screen.getByText(/Updated app shell ready\. Reload to apply it now\./i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Reload$/i }));
    await waitFor(() => expect(updateServiceWorker).toHaveBeenCalled());
  });

  it("clears offline-ready state without showing a global toast", async () => {
    const account = buildAccount("alpha", { displayName: "Offline-ready workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const setOfflineReady = vi.fn();

    registerSwMock.mockReturnValue({
      offlineReady: [true, setOfflineReady],
      needRefresh: [false, vi.fn()],
      updateServiceWorker: vi.fn(async () => undefined)
    });

    render(<App services={createPwaFixture()} />);

    await screen.findByRole("button", { name: /Create folder/i });
    expect(setOfflineReady).toHaveBeenCalledWith(false);
    expect(screen.queryByText(/App ready to work offline/i)).not.toBeInTheDocument();
  });
});
