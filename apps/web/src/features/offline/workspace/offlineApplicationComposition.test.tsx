// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import "fake-indexeddb/auto";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserAppServices } from "../../../app/createBrowserAppServices";
import { createPreviewComposition } from "../../../app/createPreviewComposition";
import App from "../../../App";
import type { AppServices } from "../../../app/AppServices";
import { createAccountRegistryService } from "../../accounts/registry";
import { ONLINE_CONNECTIVITY_SNAPSHOT, type ConnectivityPort } from "../connectivity";
import { createBrowserExplicitOfflineModeStorage } from "../../../platform/storage/browserExplicitOfflineModeStorage";
import { buildHealthResponse } from "../../../test/api";
import { createOfflineSyncRetentionPort } from "../../offline/sync/retentionAdapters";
import { createFavouriteEntry, isFavouriteAvailableOffline } from "../../browsing/favourites/model";
import { buildAccount, buildSession } from "../../../test/accounts";
import { createDeferred } from "../../../test/primitives";
import {
  EXPLICIT_OFFLINE_ENABLED_STATUS,
  EXPLICIT_OFFLINE_DISABLED_STATUS,
  EXPLICIT_OFFLINE_STORAGE_UNAVAILABLE_STATUS,
  EXPLICIT_OFFLINE_TRANSITION_FAILED_STATUS,
  EXPLICIT_OFFLINE_TRANSFER_TERMINAL_MESSAGE
} from "../mode/controller";
import { useExplicitOfflineMode } from "../mode/useExplicitOfflineMode";
import type { ExplicitOfflineModePorts } from "../mode/ports";
import {
  buildOfflineFolderItems,
  buildOfflineSearchResults,
  createRetainedSnapshot,
  retainedRootId,
  selectRequiredOfflineAncestors,
  selectRetainedRootSummaries,
  type RetainedFile,
  type RetentionRepository,
  type UseRetentionPorts
} from "../retention";
import { useRetention } from "../retention/useRetention";
import type { FolderAudioRuntimePorts } from "../../preview/folderAudio";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function appServicesFor(account?: ReturnType<typeof buildAccount>, options: {
  readonly folderItems?: Array<{ readonly path: string; readonly name: string; readonly isFolder: boolean; readonly size?: number; readonly mimeType?: string }>;
  readonly connectivity?: ConnectivityPort;
  readonly folderAudioRuntime?: FolderAudioRuntimePorts;
  readonly seedSession?: boolean;
  readonly operationRuntime?: AppServices["operationRuntime"];
  readonly offlineSyncRuntime?: AppServices["offlineSyncRuntime"];
} = {}): AppServices & {
  readonly startup: { readonly health: ReturnType<typeof vi.fn>; readonly session: ReturnType<typeof vi.fn>; readonly folder: ReturnType<typeof vi.fn>; readonly search: ReturnType<typeof vi.fn> };
} {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: false, media: "(max-width: 900px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }))
  });
  const base = createBrowserAppServices();
  const storage = { value: null as string | null };
  const registry = createAccountRegistryService({
    readItem: () => ({ ok: true as const, value: storage.value }),
    writeItem: (_key, value) => { storage.value = value; return { ok: true as const, value: undefined }; },
    deleteItem: () => { storage.value = null; return { ok: true as const, value: undefined }; }
  });
  if (account) registry.commitConnectedAccount(account);
  if (account && options.seedSession !== false) registry.commitSession(account.id, buildSession(account));
  const health = vi.fn(async () => buildHealthResponse());
  const session = vi.fn(async () => buildSession(account ?? buildAccount("alpha")));
  const folder = vi.fn(async () => ({ kind: "success" as const, items: options.folderItems ?? [] }));
  const search = vi.fn(async () => ({ kind: "success" as const, items: [] }));
  const accountTransport = { ...base.accountTransport, getHealth: health, createSession: session };
  const accountSession = {
    ...base.accountSession,
    getHealth: health,
    createSession: session,
    commitSession: registry.commitSession,
    markAccountReconnectRequired: registry.markAccountReconnectRequired,
    clearAccountSession: registry.clearAccountSession,
    delay: async () => undefined
  };
  const services: AppServices = {
    ...base,
    accountRegistry: registry,
    accountTransport,
    accountSession,
    connectivity: options.connectivity ?? { read: () => ONLINE_CONNECTIVITY_SNAPSHOT, subscribe: () => () => undefined } satisfies ConnectivityPort,
    folder: { ...base.folder, loadFolder: folder },
    search: { ...base.search, loadSearch: search },
    operationRuntime: options.operationRuntime ?? base.operationRuntime,
    offlineSyncRuntime: options.offlineSyncRuntime ?? base.offlineSyncRuntime,
    previewRuntime: options.folderAudioRuntime === undefined
      ? base.previewRuntime
      : createPreviewComposition({ retentionRepository: base.retentionRepository, folderAudioRuntime: options.folderAudioRuntime })
  };
  return Object.assign(services, { startup: { health, session, folder, search } });
}

function modePorts(overrides: Partial<ExplicitOfflineModePorts> = {}): ExplicitOfflineModePorts {
  return {
    storage: {
      read: () => ({ kind: "ready", enabled: false } as const),
      commit: () => ({ kind: "committed" } as const),
      reset: () => ({ kind: "committed" } as const),
      repair: () => ({ kind: "repaired" } as const)
    },
    network: { setBlocked: vi.fn() },
    entry: {
      pauseFolderAudio: vi.fn(),
      closeDestinationPicker: vi.fn(),
      clearActionDialog: vi.fn(),
      closePreview: vi.fn(),
      setWorkerUnavailable: vi.fn(),
      failActiveTransfers: vi.fn(),
      setStatus: vi.fn()
    },
    ...overrides
  };
}

const file = (path: string, overrides: Partial<RetainedFile> = {}): RetainedFile => ({
  path,
  name: path.split("/").at(-1) ?? path,
  mimeType: "text/plain",
  size: 10,
  blobSize: 10,
  readable: true,
  normalCacheOwnership: "none",
  ...overrides
});

function retentionPorts(
  repository: RetentionRepository,
  overrides: Partial<UseRetentionPorts> = {}
): UseRetentionPorts {
  return {
    repository,
    ui: {
      clearFolderCacheForPath: vi.fn(),
      clearFolderAndSearchCache: vi.fn(),
      clearSelectionChrome: vi.fn(),
      setStatus: vi.fn()
    },
    presentation: {
      formatCacheLimitStatus: (limit, name) => `limit:${limit}:${name}`,
      formatRemoveOfflineCopyStatus: (name) => `removed:${name}`,
      formatClearCacheStatus: (name) => `cleared:${name}`
    },
    toRetentionAccount: (account) => ({ accountId: account.id, cacheNamespace: account.cacheNamespace }),
    defaultCacheLimitBytes: 1024,
    ...overrides
  };
}

function repository(snapshot: ReturnType<typeof createRetainedSnapshot>): RetentionRepository {
  const success = async () => ({ kind: "success" as const, value: snapshot });
  return {
    readSnapshot: success,
    readPreview: async () => ({ kind: "success" as const, value: undefined }),
    writePreview: success,
    beginRoot: success,
    persistRetainedFile: success,
    completeRoot: success,
    removeRoot: success,
    clearNormalCache: success,
    purgeAccountNamespace: success,
    configureNormalCacheLimit: success
  };
}

describe("Phase 4E offline application-composition current behavior", () => {
  it("real App composition blocks startup probes and browsing I/O on persisted explicit offline restore", async () => {
    localStorage.clear();
    const account = buildAccount("alpha", { displayName: "Alpha startup workspace" });
    const services = appServicesFor(account);
    createBrowserExplicitOfflineModeStorage().commit(account.id, true);

    render(<App services={services} />);
    expect(await screen.findByRole("button", { name: /Go online/i })).toBeInTheDocument();
    expect(services.startup.health).not.toHaveBeenCalled();
    expect(services.startup.session).not.toHaveBeenCalled();
    expect(services.startup.folder).not.toHaveBeenCalled();
    expect(services.startup.search).not.toHaveBeenCalled();
    expect(screen.getByText(/Explicit offline mode is active/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(settings.textContent).toMatch(/Offline cache/i);
    expect(settings.textContent).toMatch(/0 cached/i);
    expect(within(settings).getByRole("button", { name: /Add account/i })).toBeDisabled();
    fireEvent.click(within(settings).getByRole("button", { name: /Close|Done/i }));
    fireEvent.click(screen.getByRole("button", { name: /Go online/i }));
    await waitFor(() => expect(services.startup.health).toHaveBeenCalled());
    await waitFor(() => expect(services.startup.folder).toHaveBeenCalled());
  });

  it("real App entry wiring closes active surfaces, clears unavailable state, terminalizes work, and leaves cleanly", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha entry workspace" });
    const services = appServicesFor(account, {
      folderItems: [
        { path: "Projects", name: "Projects", isFolder: true },
        { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 12, mimeType: "text/plain" }
      ]
    });
    render(<App services={services} />);
    await screen.findByRole("button", { name: /Open file roadmap.txt/i });

    fireEvent.click(screen.getByRole("button", { name: /Open file roadmap.txt/i }));
    expect(await screen.findByRole("dialog", { name: /Preview roadmap.txt/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Go offline$/i }));
    await waitFor(() => expect(screen.getAllByText("Read-only").length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole("dialog", { name: /Preview roadmap.txt/i })).not.toBeInTheDocument();
    const drawer = screen.getByRole("complementary", { name: /Navigation menu/i });
    expect(within(drawer).getByRole("button", { name: /^Go online$/i })).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: /^Go online$/i }));
    expect(await screen.findByRole("button", { name: /^Go offline$/i })).toBeInTheDocument();
    await waitFor(() => expect(services.startup.health).toHaveBeenCalled());
  });

  it("real App entry wiring pauses an active folder-audio player before explicit offline", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha audio workspace" });
    const createStreamingFileUrl = vi.fn(async () => "/stream/audio-token");
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const services = appServicesFor(account, {
      folderItems: [
        { path: "Projects", name: "Projects", isFolder: true },
        { path: "Projects/chapter.m4a", name: "chapter.m4a", isFolder: false, size: 18, mimeType: "audio/mp4" }
      ],
      folderAudioRuntime: {
        storage: localStorage,
        createStreamingFileUrl,
        nowIso: () => "2026-08-04T00:00:00.000Z",
        loadAudioPreviewPosition: () => undefined,
        saveAudioPreviewPosition: vi.fn()
      }
    });

    try {
      render(<App services={services} />);
      fireEvent.click(await screen.findByRole("button", { name: /Open folder Projects/i }));
      fireEvent.click(await screen.findByRole("button", { name: /Open file chapter\.m4a/i }));
      const player = await screen.findByRole("region", { name: /Audio playlist for Projects/i });
      const audio = player.querySelector("audio");
      expect(audio).toBeInTheDocument();
      await waitFor(() => expect(createStreamingFileUrl).toHaveBeenCalledWith("Projects/chapter.m4a", expect.any(String)));
      fireEvent.play(audio!);
      await waitFor(() => expect(within(player).getByRole("button", { name: /Pause folder audio/i })).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
      fireEvent.click(await screen.findByRole("button", { name: /^Go offline$/i }));
      await waitFor(() => expect(within(player).getByRole("button", { name: /Play folder audio/i })).toBeInTheDocument());
      expect(pause).toHaveBeenCalled();
      expect(play).toHaveBeenCalled();
    } finally {
      pause.mockRestore();
      play.mockRestore();
    }
  });

  it("real App transition dismisses an active mutation/destination surface", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha mutation workspace" });
    const services = appServicesFor(account, { folderItems: [{ path: "roadmap.txt", name: "roadmap.txt", isFolder: false, size: 12, mimeType: "text/plain" }] });
    render(<App services={services} />);
    await screen.findByRole("button", { name: /Open actions for roadmap.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    const details = await screen.findByRole("region", { name: /Details for roadmap.txt/i });
    const copyMove = within(details).getByRole("button", { name: /Copy or move/i });
    expect(copyMove).toBeEnabled();
    fireEvent.click(copyMove);
    expect(await screen.findByRole("dialog", { name: /Copy or move/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Go offline$/i }));
    expect(screen.queryByRole("dialog", { name: /Copy or move/i })).not.toBeInTheDocument();
    const offlineDetails = screen.getByRole("region", { name: /Details for roadmap.txt/i });
    expect(within(offlineDetails).getByRole("button", { name: /Copy or move/i })).toBeDisabled();
  });

  it("real App no-account shell exposes only the connect-account entry point", async () => {
    const services = appServicesFor();
    render(<App services={services} />);
    expect(await screen.findByRole("heading", { name: /No connected accounts yet/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect account/i })).toBeEnabled();
    expect(document.querySelector(".offline-mode-toggle")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Connect account/i }));
    expect(await screen.findByRole("heading", { name: /Connect Nextcloud account/i })).toBeInTheDocument();
  });

  it("real App renders a distinct worker-unavailable cached shell with mutation controls disabled", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha worker-unavailable workspace" });
    const services = appServicesFor(account, {
      folderItems: [{ path: "Projects", name: "Projects", isFolder: true }],
      seedSession: false
    });
    services.browsingCache.writeFolder(account.cacheNamespace, "", [{ path: "Projects", name: "Projects", isFolder: true }]);
    services.startup.health.mockRejectedValue(new TypeError("fetch failed"));
    services.startup.session.mockRejectedValue(new TypeError("fetch failed"));

    render(<App services={services} />);
    expect(await screen.findByText(/Cached shell only for Alpha worker-unavailable workspace/i, undefined, { timeout: 5_000 })).toBeInTheDocument();
    expect(screen.getByText(/Showing cached data while the local server is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText("Server unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create folder/i })).toBeDisabled();
    expect(document.querySelector<HTMLButtonElement>(".offline-mode-toggle")).toHaveTextContent("Go offline");

    const probesBeforeExplicitOffline = {
      health: services.startup.health.mock.calls.length,
      session: services.startup.session.mock.calls.length,
      folder: services.startup.folder.mock.calls.length,
      search: services.startup.search.mock.calls.length
    };
    fireEvent.click(screen.getByRole("button", { name: /^Go offline$/i }));
    expect(await screen.findByRole("button", { name: /^Go online$/i })).toBeInTheDocument();
    expect(screen.queryByText("Server unavailable")).not.toBeInTheDocument();
    expect(screen.getByText(/Explicit offline mode is active/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create folder/i })).toBeDisabled();
    expect(services.startup.health).toHaveBeenCalledTimes(probesBeforeExplicitOffline.health);
    expect(services.startup.session).toHaveBeenCalledTimes(probesBeforeExplicitOffline.session);
    expect(services.startup.folder).toHaveBeenCalledTimes(probesBeforeExplicitOffline.folder);
    expect(services.startup.search).toHaveBeenCalledTimes(probesBeforeExplicitOffline.search);
  });

  it("real App terminalizes an active upload with the explicit-offline copy", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha upload workspace" });
    const pending = createDeferred<Awaited<ReturnType<AppServices["operationRuntime"]["mutation"]["uploadFile"]>>>();
    const baseOperationRuntime = createBrowserAppServices().operationRuntime;
    const uploadFile = vi.fn(() => pending.promise);
    const operationRuntime: AppServices["operationRuntime"] = {
      ...baseOperationRuntime,
      mutation: { ...baseOperationRuntime.mutation, uploadFile }
    };
    const services = appServicesFor(account, {
      folderItems: [{ path: "roadmap.txt", name: "roadmap.txt", isFolder: false, size: 12, mimeType: "text/plain" }],
      operationRuntime
    });

    render(<App services={services} />);
    await screen.findByRole("button", { name: /Create folder/i });
    const toolbar = document.querySelector<HTMLElement>(".folder-actions-inline");
    if (!toolbar) {
      throw new Error("Upload toolbar is unavailable.");
    }
    fireEvent.change(within(toolbar).getByLabelText(/^Upload files$/i), {
      target: { files: [new File(["upload"], "upload.txt", { type: "text/plain" })] }
    });
    await waitFor(() => expect(uploadFile).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Go offline$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Transfers/i }));
    const transferStatus = await screen.findByRole("dialog", { name: /Transfer status/i });
    expect(within(transferStatus).getByText(EXPLICIT_OFFLINE_TRANSFER_TERMINAL_MESSAGE.upload)).toBeInTheDocument();
    await act(async () => {
      pending.resolve({ action: "upload", parentPath: "", path: "upload.txt", item: { path: "upload.txt", name: "upload.txt", isFolder: false } });
    });
  });

  it("real App terminalizes a confirmed offline-sync transfer with the explicit-offline copy", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha sync workspace" });
    const pending = createDeferred<Awaited<ReturnType<AppServices["offlineSyncRuntime"]["fetchDownloadBlob"]>>>();
    const baseOfflineSyncRuntime = createBrowserAppServices().offlineSyncRuntime;
    const fetchDownloadBlob = vi.fn(() => pending.promise);
    const offlineSyncRuntime: AppServices["offlineSyncRuntime"] = {
      ...baseOfflineSyncRuntime,
      fetchDownloadBlob
    };
    const services = appServicesFor(account, {
      folderItems: [{ path: "roadmap.txt", name: "roadmap.txt", isFolder: false, size: 12, mimeType: "text/plain" }],
      offlineSyncRuntime
    });

    render(<App services={services} />);
    await screen.findByRole("button", { name: /Open actions for roadmap\.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap\.txt/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Keep offline$/i }));
    const confirmation = await screen.findByRole("dialog", { name: /Keep offline confirmation/i });
    fireEvent.click(within(confirmation).getByRole("button", { name: /Start sync/i }));
    await waitFor(() => expect(fetchDownloadBlob).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Go offline$/i }));
    let transferStatus = screen.queryByRole("dialog", { name: /Transfer status/i });
    if (!transferStatus) {
      fireEvent.click(screen.getByRole("button", { name: /Transfers/i }));
      transferStatus = await screen.findByRole("dialog", { name: /Transfer status/i });
    }
    expect(within(transferStatus).getByText(EXPLICIT_OFFLINE_TRANSFER_TERMINAL_MESSAGE.sync)).toBeInTheDocument();
    await act(async () => {
      pending.resolve({ blob: new Blob(["offline"], { type: "text/plain" }), filename: "roadmap.txt" });
    });
  });

  it("keeps App recovery copy redacted across DOM, console, URL, and storage sinks", async () => {
    localStorage.clear();
    const account = buildAccount("alpha", { displayName: "Alpha redaction workspace" });
    const services = appServicesFor(account);
    const sentinel = "credential-ownership-token-blob-private-path-sentinel";
    localStorage.setItem("davora-explicit-offline-accounts", sentinel);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<App services={services} />);
    expect(await screen.findByText(/Explicit offline mode storage is corrupt/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(sentinel);
    expect(window.location.href).not.toContain(sentinel);
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining(sentinel));
    expect(localStorage.getItem("davora-explicit-offline-accounts")).toBe(sentinel);
    consoleError.mockRestore();
  });

  it("restores account-keyed mode synchronously, including Alpha to Beta to Alpha", () => {
    const enabled = new Set(["alpha"]);
    const ports = modePorts({
      storage: {
        read: (id) => ({ kind: "ready", enabled: Boolean(id && enabled.has(id)) }),
        commit: (id, value) => {
          value ? enabled.add(id) : enabled.delete(id);
          return { kind: "committed" };
        },
        reset: () => ({ kind: "committed" }),
        repair: () => ({ kind: "repaired" })
      }
    });
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const { result, rerender } = renderHook(({ account }) => useExplicitOfflineMode({ activeAccount: account, ports }), {
      initialProps: { account: alpha }
    });

    expect(result.current.enabled).toBe(true);
    rerender({ account: beta });
    expect(result.current.enabled).toBe(false);
    rerender({ account: alpha });
    expect(result.current.enabled).toBe(true);
    expect(ports.network.setBlocked).toHaveBeenLastCalledWith(true);
  });

  it("keeps startup fail-closed and reports only stable recovery copy", () => {
    const sentinel = "raw-storage-error-sentinel";
    const setStatus = vi.fn();
    const ports = modePorts({
      storage: {
        read: () => ({ kind: "failed", reason: "unavailable", error: new Error(sentinel) }),
        commit: vi.fn(() => ({ kind: "failed" as const, error: new Error(sentinel) })),
        reset: vi.fn(() => ({ kind: "failed" as const, error: new Error(sentinel) })),
        repair: vi.fn(() => ({ kind: "failed" as const, error: new Error(sentinel) }))
      },
      entry: { ...modePorts().entry, setStatus }
    });
    const { result } = renderHook(() => useExplicitOfflineMode({ activeAccount: buildAccount("alpha"), ports }));

    expect(result.current.enabled).toBe(true);
    expect(result.current.storageState).toBe("fail-closed");
    expect(setStatus).toHaveBeenCalledWith(EXPLICIT_OFFLINE_STORAGE_UNAVAILABLE_STATUS);
    expect(setStatus.mock.calls.flat().join(" ")).not.toContain(sentinel);
    expect(ports.storage.repair).not.toHaveBeenCalled();
  });

  it("preserves enter and exit transaction ordering and terminal outcomes", () => {
    const events: string[] = [];
    const ports = modePorts({
      storage: {
        read: () => { events.push("read"); return { kind: "ready", enabled: false }; },
        commit: (_id, enabled) => { events.push(`persist:${enabled}`); return { kind: "committed" }; },
        reset: () => { events.push("reset"); return { kind: "committed" }; },
        repair: () => ({ kind: "repaired" })
      },
      network: { setBlocked: (blocked) => events.push(`gate:${blocked}`) },
      entry: {
        pauseFolderAudio: () => events.push("pause-audio"),
        closeDestinationPicker: () => events.push("close-destination"),
        clearActionDialog: () => events.push("clear-action"),
        closePreview: () => events.push("close-preview"),
        setWorkerUnavailable: (value) => events.push(`worker:${value}`),
        failActiveTransfers: () => events.push("terminalize-transfers"),
        setStatus: (message) => events.push(message)
      }
    });
    const { result } = renderHook(() => useExplicitOfflineMode({ activeAccount: buildAccount("alpha", { displayName: "Alpha" }), ports }));
    events.length = 0;

    act(() => { result.current.setEnabled(true); });
    expect(events.slice(0, 10)).toEqual([
      "read", "persist:true", "gate:true", "pause-audio", "close-destination", "clear-action",
      "close-preview", "worker:false", "terminalize-transfers",
      EXPLICIT_OFFLINE_ENABLED_STATUS("Alpha")
    ]);
    expect(events.slice(10)).toEqual(["read", "gate:false"]);
    events.length = 0;
    act(() => { result.current.setEnabled(false); });
    expect(events.slice(0, 4)).toEqual(["read", "persist:false", "gate:false", EXPLICIT_OFFLINE_DISABLED_STATUS("Alpha")]);
    expect(events.slice(4)).toEqual(["read", "gate:false"]);
  });

  it("does not clean up or claim success when persistence fails", () => {
    const setBlocked = vi.fn();
    const setStatus = vi.fn();
    const ports = modePorts({
      network: { setBlocked },
      entry: { ...modePorts().entry, setStatus },
      storage: {
        read: () => ({ kind: "ready", enabled: false }),
        commit: () => ({ kind: "failed", error: new Error("quota") }),
        reset: () => ({ kind: "failed", error: new Error("quota") }),
        repair: () => ({ kind: "repaired" })
      }
    });
    const { result } = renderHook(() => useExplicitOfflineMode({ activeAccount: buildAccount("alpha"), ports }));
    setBlocked.mockClear();
    act(() => { result.current.setEnabled(true); });

    expect(result.current.enabled).toBe(false);
    expect(setBlocked).not.toHaveBeenCalledWith(true);
    expect(setStatus).toHaveBeenCalledWith(EXPLICIT_OFFLINE_TRANSITION_FAILED_STATUS);
  });

  it("projects only readable retained files and required ancestors", () => {
    const account = { accountId: "alpha", cacheNamespace: "ns-alpha" };
    const folderRoot = { rootPath: "Docs", rootName: "Docs", kind: "folder" as const, folderRoots: ["Docs"] };
    const incompleteRoot = { rootPath: "Private", rootName: "Private", kind: "folder" as const, folderRoots: ["Private"] };
    const snapshot = createRetainedSnapshot({
      account,
      normalCache: { itemCount: 1, totalBytes: 10, limitBytes: 1024 },
      roots: [
        { ...folderRoot, status: "complete", addedAt: "2026-08-01T00:00:00.000Z" },
        { ...incompleteRoot, status: "incomplete", addedAt: "2026-08-02T00:00:00.000Z" }
      ],
      files: [file("Docs/readme.txt"), file("Docs/secret.txt", { readable: false }), file("Private/hidden.txt")],
      memberships: [
        { rootId: retainedRootId(folderRoot), filePath: "Docs/readme.txt" },
        { rootId: retainedRootId(folderRoot), filePath: "Docs/secret.txt" },
        { rootId: retainedRootId(incompleteRoot), filePath: "Private/hidden.txt" }
      ]
    });

    expect(buildOfflineFolderItems(snapshot.files, "").map((entry) => entry.path)).toEqual(["Docs", "Private"]);
    expect(buildOfflineFolderItems(snapshot.files, "Docs").map((entry) => entry.path)).toEqual(["Docs/readme.txt"]);
    expect(buildOfflineSearchResults(snapshot.files, "", "read").map((entry) => entry.path)).toEqual(["Docs/readme.txt"]);
    expect(selectRequiredOfflineAncestors(snapshot)).toEqual(["Docs", "Private"]);
    expect(selectRetainedRootSummaries(snapshot)).toEqual(expect.arrayContaining([
      expect.objectContaining({ rootPath: "Docs", available: false, readableFileCount: 1 }),
      expect.objectContaining({ rootPath: "Private", status: "incomplete", available: false })
    ]));
  });

  it("filters explicit-offline favourites structurally without changing the persisted list", () => {
    const account = buildAccount("alpha");
    const favourites = [
      createFavouriteEntry({ path: "Docs/readme.txt", name: "readme.txt", isFolder: false }, account, "2026-08-01T00:00:00.000Z"),
      createFavouriteEntry({ path: "Online-only", name: "Online-only", isFolder: true }, account, "2026-08-01T00:00:00.000Z")
    ];
    const retained = [file("Docs/readme.txt")];
    expect(favourites.filter((entry) => isFavouriteAvailableOffline(entry, retained))).toEqual([favourites[0]]);
    expect(favourites).toHaveLength(2);
  });

  it("rejects late retention publication after account replacement and preserves cache-clear ancestors", async () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const alphaAccount = { accountId: alpha.id, cacheNamespace: alpha.cacheNamespace };
    const alphaRoot = { rootPath: "Docs", rootName: "Docs", kind: "folder" as const, folderRoots: ["Docs"] };
    const alphaSnapshot = createRetainedSnapshot({
      account: alphaAccount,
      normalCache: { itemCount: 1, totalBytes: 10, limitBytes: 1024 },
      roots: [{ ...alphaRoot, status: "complete", addedAt: "2026-08-01T00:00:00.000Z" }],
      files: [file("Docs/readme.txt")],
      memberships: [{ rootId: retainedRootId(alphaRoot), filePath: "Docs/readme.txt" }]
    });
    const pending = createDeferred<Awaited<ReturnType<RetentionRepository["readSnapshot"]>>>();
    const repo = repository(alphaSnapshot);
    repo.readSnapshot = vi.fn(() => pending.promise);
    const ports = retentionPorts(repo);
    const { result, rerender } = renderHook(
      (props) => useRetention(props),
      { initialProps: { activeAccount: alpha, cacheNamespace: alpha.cacheNamespace, accountName: "Alpha", ports } }
    );
    rerender({ activeAccount: beta, cacheNamespace: beta.cacheNamespace, accountName: "Beta", ports });
    pending.resolve({ kind: "success", value: alphaSnapshot });
    await act(async () => { await pending.promise; });
    expect(result.current.retentionSnapshot).toBeUndefined();

    const immediateRepo = repository(alphaSnapshot);
    const immediatePorts = retentionPorts(immediateRepo);
    const rendered = renderHook(
      (props) => useRetention(props),
      { initialProps: { activeAccount: alpha, cacheNamespace: alpha.cacheNamespace, accountName: "Alpha", ports: immediatePorts } }
    );
    await act(async () => { await rendered.result.current.clearNormalCache(); });
    expect(immediatePorts.ui.clearFolderAndSearchCache).toHaveBeenCalledWith(alpha.cacheNamespace, { preserveFolderPaths: ["Docs"] });
  });

  it("keeps an initial Alpha read inert after Alpha-Beta-Alpha", async () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const alphaSnapshot = createRetainedSnapshot({
      account: { accountId: alpha.id, cacheNamespace: alpha.cacheNamespace },
      normalCache: { itemCount: 1, totalBytes: 10, limitBytes: 1024 }, roots: [], files: [file("alpha.txt")], memberships: []
    });
    const betaSnapshot = createRetainedSnapshot({
      account: { accountId: beta.id, cacheNamespace: beta.cacheNamespace },
      normalCache: { itemCount: 2, totalBytes: 20, limitBytes: 1024 }, roots: [], files: [file("beta.txt")], memberships: []
    });
    const currentAlphaSnapshot = createRetainedSnapshot({
      account: { accountId: alpha.id, cacheNamespace: alpha.cacheNamespace },
      normalCache: { itemCount: 9, totalBytes: 90, limitBytes: 1024 }, roots: [], files: [file("current-alpha.txt")], memberships: []
    });
    const deferredRead = createDeferred<Awaited<ReturnType<RetentionRepository["readSnapshot"]>>>();
    let readCount = 0;
    const repo = repository(alphaSnapshot);
    repo.readSnapshot = vi.fn(() => {
      readCount += 1;
      if (readCount === 1) return deferredRead.promise;
      return Promise.resolve({ kind: "success", value: readCount === 2 ? betaSnapshot : currentAlphaSnapshot } as const);
    });
    const ports = retentionPorts(repo);
    const { result, rerender } = renderHook((props) => useRetention(props), {
      initialProps: { activeAccount: alpha, cacheNamespace: alpha.cacheNamespace, accountName: "Alpha", ports }
    });
    await act(async () => undefined);
    rerender({ activeAccount: beta, cacheNamespace: beta.cacheNamespace, accountName: "Beta", ports });
    rerender({ activeAccount: alpha, cacheNamespace: alpha.cacheNamespace, accountName: "Alpha", ports });
    deferredRead.resolve({ kind: "success", value: alphaSnapshot });
    await act(async () => { await deferredRead.promise; });

    expect(result.current.retentionSnapshot?.account).toEqual(currentAlphaSnapshot.account);
    expect(result.current.retentionSnapshot?.files.map((entry) => entry.path)).toEqual(["current-alpha.txt"]);
  });

  it("keeps configure/remove/clear publications inert after Alpha-Beta-Alpha", async () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const root = { rootPath: "Docs", rootName: "Docs", kind: "folder" as const, folderRoots: ["Docs"] };
    const alphaSnapshot = createRetainedSnapshot({
      account: { accountId: alpha.id, cacheNamespace: alpha.cacheNamespace },
      normalCache: { itemCount: 1, totalBytes: 10, limitBytes: 1024 },
      roots: [{ ...root, status: "complete", addedAt: "2026-08-01T00:00:00.000Z" }], files: [file("Docs/a.txt")],
      memberships: [{ rootId: retainedRootId(root), filePath: "Docs/a.txt" }]
    });
    const repo = repository(alphaSnapshot);
    const ports = retentionPorts(repo);
    const { result, rerender } = renderHook((props) => useRetention(props), {
      initialProps: { activeAccount: alpha, cacheNamespace: alpha.cacheNamespace, accountName: "Alpha", ports }
    });
    await act(async () => undefined);
    const configureDeferred = createDeferred<Awaited<ReturnType<RetentionRepository["configureNormalCacheLimit"]>>>();
    repo.configureNormalCacheLimit = vi.fn(() => configureDeferred.promise);
    const configure = result.current.configureNormalCacheLimit(2048);
    rerender({ activeAccount: beta, cacheNamespace: beta.cacheNamespace, accountName: "Beta", ports });
    rerender({ activeAccount: alpha, cacheNamespace: alpha.cacheNamespace, accountName: "Alpha", ports });
    configureDeferred.resolve({ kind: "success", value: alphaSnapshot });
    await act(async () => { await configure; });
    expect(ports.ui.setStatus).not.toHaveBeenCalledWith("limit:2048:Alpha");

    const removeDeferred = createDeferred<Awaited<ReturnType<RetentionRepository["removeRoot"]>>>();
    repo.removeRoot = vi.fn(() => removeDeferred.promise);
    const remove = result.current.removeOfflineCopy({ rootId: retainedRootId(root), ...root });
    rerender({ activeAccount: beta, cacheNamespace: beta.cacheNamespace, accountName: "Beta", ports });
    rerender({ activeAccount: alpha, cacheNamespace: alpha.cacheNamespace, accountName: "Alpha", ports });
    removeDeferred.resolve({ kind: "success", value: alphaSnapshot });
    await act(async () => { await remove; });
    expect(ports.ui.clearFolderCacheForPath).not.toHaveBeenCalledWith(alpha.cacheNamespace, "Docs");
    expect(ports.ui.setStatus).not.toHaveBeenCalledWith("removed:Docs");

    const clearDeferred = createDeferred<Awaited<ReturnType<RetentionRepository["clearNormalCache"]>>>();
    repo.clearNormalCache = vi.fn(() => clearDeferred.promise);
    const clear = result.current.clearNormalCache();
    rerender({ activeAccount: beta, cacheNamespace: beta.cacheNamespace, accountName: "Beta", ports });
    rerender({ activeAccount: alpha, cacheNamespace: alpha.cacheNamespace, accountName: "Alpha", ports });
    clearDeferred.resolve({ kind: "success", value: alphaSnapshot });
    await act(async () => { await clear; });
    expect(ports.ui.clearFolderAndSearchCache).not.toHaveBeenCalledWith(alpha.cacheNamespace, { preserveFolderPaths: ["Docs"] });
    expect(ports.ui.clearSelectionChrome).not.toHaveBeenCalled();
    expect(ports.ui.setStatus).not.toHaveBeenCalledWith("cleared:Alpha");
  });

  it("suppresses delayed retention failures and direct commands after unmount", async () => {
    const alpha = buildAccount("alpha");
    const deferredFailure = createDeferred<Awaited<ReturnType<RetentionRepository["configureNormalCacheLimit"]>>>();
    const repo = repository(createRetainedSnapshot({
      account: { accountId: alpha.id, cacheNamespace: alpha.cacheNamespace },
      normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 1024 }, roots: [], files: [], memberships: []
    }));
    repo.configureNormalCacheLimit = vi.fn(() => deferredFailure.promise);
    const ports = retentionPorts(repo);
    const rendered = renderHook((props) => useRetention(props), {
      initialProps: { activeAccount: alpha, cacheNamespace: alpha.cacheNamespace, accountName: "Alpha", ports }
    });
    await act(async () => undefined);
    const command = rendered.result.current.configureNormalCacheLimit(2048);
    rendered.unmount();
    deferredFailure.resolve({ kind: "failure", message: "raw-retention-error-sentinel" });
    await expect(command).resolves.toBeUndefined();
    expect(ports.ui.setStatus).not.toHaveBeenCalled();

    const deferredSuccess = createDeferred<Awaited<ReturnType<RetentionRepository["configureNormalCacheLimit"]>>>();
    repo.configureNormalCacheLimit = vi.fn(() => deferredSuccess.promise);
    const second = renderHook((props) => useRetention(props), {
      initialProps: { activeAccount: alpha, cacheNamespace: alpha.cacheNamespace, accountName: "Alpha", ports }
    });
    await act(async () => undefined);
    const staleSuccess = second.result.current.configureNormalCacheLimit(4096);
    second.unmount();
    deferredSuccess.resolve({ kind: "success", value: createRetainedSnapshot({
      account: { accountId: alpha.id, cacheNamespace: alpha.cacheNamespace },
      normalCache: { itemCount: 1, totalBytes: 1, limitBytes: 4096 }, roots: [], files: [], memberships: []
    }) });
    await act(async () => { await staleSuccess; });
    expect(ports.ui.setStatus).not.toHaveBeenCalledWith("limit:4096:Alpha");
  });

  it("shows StrictMode replay of direct retention reads without a second owner", async () => {
    const alpha = buildAccount("alpha");
    const repo = repository(createRetainedSnapshot({
      account: { accountId: alpha.id, cacheNamespace: alpha.cacheNamespace },
      normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 1024 }, roots: [], files: [], memberships: []
    }));
    const readSnapshot = vi.fn(repo.readSnapshot);
    repo.readSnapshot = readSnapshot;
    const ports = retentionPorts(repo);
    renderHook((props) => useRetention(props), {
      initialProps: { activeAccount: alpha, cacheNamespace: alpha.cacheNamespace, accountName: "Alpha", ports },
      wrapper: StrictMode
    });
    await act(async () => undefined);
    expect(repo.readSnapshot).toHaveBeenCalled();
    expect(readSnapshot.mock.calls.every(([account]) => account.accountId === alpha.id)).toBe(true);
  });

  it("keeps one retention repository shared by preview and account-removal runtimes", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: "(max-width: 900px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
    const services = createBrowserAppServices();
    const readPreview = vi.spyOn(services.retentionRepository, "readPreview");
    const purge = vi.spyOn(services.retentionRepository, "purgeAccountNamespace");
    const adapters = services.previewRuntime.session.createSessionAdapters({ tokenFor: () => "opaque-token" });
    await adapters.cache.read({
      accountId: "alpha", cacheNamespace: "ns-alpha", path: "Docs/a.txt", contextGeneration: "g",
      connectionMode: "online", heicPreviewEnabled: false, freshnessIntervalMs: 60_000, cacheLimitBytes: 1024,
      requestSequence: 1
    }, adapters.abort.create()).catch(() => undefined);
    expect(readPreview).toHaveBeenCalledWith({ accountId: "alpha", cacheNamespace: "ns-alpha" }, "Docs/a.txt");

    await services.accountRemovalRuntime.purgeLocalAccountData(buildAccount("alpha"), []);
    expect(purge).toHaveBeenCalledWith({ accountId: "alpha", cacheNamespace: "ns-alpha" }, []);
  });

  it("projects current App settings cache summary, root ordering, limit, remove, and clear commands", async () => {
    localStorage.clear();
    const account = buildAccount("alpha", { displayName: "Alpha settings workspace" });
    const services = appServicesFor(account);
    const oldRoot = { rootPath: "Aardvark", rootName: "Aardvark", kind: "folder" as const, folderRoots: ["Aardvark"] };
    const newRoot = { rootPath: "Zebra", rootName: "Zebra", kind: "folder" as const, folderRoots: ["Zebra"] };
    const snapshot = createRetainedSnapshot({
      account: { accountId: account.id, cacheNamespace: account.cacheNamespace },
      normalCache: { itemCount: 2, totalBytes: 2048, limitBytes: 24 * 1024 * 1024 },
      roots: [
        { ...oldRoot, status: "complete", addedAt: "2026-08-01T00:00:00.000Z" },
        { ...newRoot, status: "complete", addedAt: "2026-08-02T00:00:00.000Z" }
      ],
      files: [file("Aardvark/a.txt"), file("Zebra/b.txt")],
      memberships: [
        { rootId: retainedRootId(oldRoot), filePath: "Aardvark/a.txt" },
        { rootId: retainedRootId(newRoot), filePath: "Zebra/b.txt" }
      ]
    });
    const repository = services.retentionRepository;
    repository.readSnapshot = vi.fn(async () => ({ kind: "success" as const, value: snapshot }));
    const removeRoot = vi.spyOn(repository, "removeRoot").mockResolvedValue({ kind: "success", value: snapshot });
    const clearNormalCache = vi.spyOn(repository, "clearNormalCache").mockResolvedValue({ kind: "success", value: snapshot });
    const configure = vi.spyOn(repository, "configureNormalCacheLimit").mockResolvedValue({ kind: "success", value: snapshot });
    render(<App services={services} />);
    fireEvent.click(await screen.findByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(settings).toHaveTextContent(/2 cached files/);
    const kept = within(settings).getByRole("list");
    expect(kept.textContent).toMatch(/Zebra[\s\S]*Aardvark/);
    expect(within(kept).getAllByText("Zebra")).toHaveLength(2);
    expect(within(kept).getAllByText("Aardvark")).toHaveLength(2);
    expect(within(kept).getAllByText(/Recursive folder/)).toHaveLength(2);
    fireEvent.change(within(settings).getByLabelText("Opened-file cache limit slider"), { target: { value: "512" } });
    await waitFor(() => expect(configure).toHaveBeenCalledWith({ accountId: account.id, cacheNamespace: account.cacheNamespace }, 512 * 1024 * 1024));
    await waitFor(() => expect(document.querySelector(".browse-status-note")?.textContent).toBe("Opened-file cache limit set to 512 MB for Alpha settings workspace."));
    expect(within(kept).getAllByText("Recursive folder • 1 file • 10 B")).toHaveLength(2);
    fireEvent.click(within(settings).getByRole("button", { name: /Remove offline copy for Zebra/i }));
    await waitFor(() => expect(removeRoot).toHaveBeenCalledWith({ accountId: account.id, cacheNamespace: account.cacheNamespace }, retainedRootId(newRoot)));
    await waitFor(() => expect(document.querySelector(".browse-status-note")?.textContent).toBe("Removed offline copy for Zebra from this device. Server files were not deleted."));
    fireEvent.click(within(settings).getByRole("button", { name: /^Clear cache$/i }));
    await waitFor(() => expect(clearNormalCache).toHaveBeenCalledWith({ accountId: account.id, cacheNamespace: account.cacheNamespace }));
    await waitFor(() => expect(document.querySelector(".browse-status-note")?.textContent).toBe("Offline cache cleared for Alpha settings workspace."));
  });

  it("locks real App settings/shell/favourites projections across explicit and browser-offline states", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha projection workspace" });
    const retained = createFavouriteEntry({ path: "Docs/readme.txt", name: "readme.txt", isFolder: false }, account, "2026-08-01T00:00:00.000Z");
    const unavailable = createFavouriteEntry({ path: "Online-only.txt", name: "Online-only.txt", isFolder: false }, account, "2026-08-01T00:00:01.000Z");
    const favourites = JSON.stringify([retained, unavailable]);
    localStorage.setItem("davora-favourites:alpha", favourites);
    const explicitServices = appServicesFor(account);
    explicitServices.retentionRepository.readSnapshot = vi.fn(async () => ({
      kind: "success" as const,
      value: createRetainedSnapshot({
        account: { accountId: account.id, cacheNamespace: account.cacheNamespace },
        normalCache: { itemCount: 1, totalBytes: 12, limitBytes: 1024 },
        roots: [{ rootPath: "Docs", rootName: "Docs", kind: "folder", status: "complete", addedAt: "2026-08-01T00:00:00.000Z", folderRoots: ["Docs"] }],
        files: [file("Docs/readme.txt")],
        memberships: [{ rootId: retainedRootId({ rootPath: "Docs", kind: "folder" }), filePath: "Docs/readme.txt" }]
      })
    }));
    createBrowserExplicitOfflineModeStorage().commit(account.id, true);
    render(<App services={explicitServices} />);
    expect(document.querySelector<HTMLButtonElement>(".offline-mode-toggle")?.textContent).toBe("Go online");
    fireEvent.click(await screen.findByRole("button", { name: /Open navigation menu/i }));
    const explicitDrawer = await screen.findByRole("region", { name: /Favourites/i });
    expect(within(explicitDrawer).getByRole("button", { name: /Open favourite file readme.txt/i })).toBeInTheDocument();
    expect(within(explicitDrawer).queryByRole("button", { name: /Open favourite file Online-only.txt/i })).not.toBeInTheDocument();
    expect(localStorage.getItem("davora-favourites:alpha")).toBe(favourites);
    expect(within(screen.getByRole("complementary", { name: /Navigation menu/i })).getByText("Offline mode")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("complementary", { name: /Navigation menu/i })).getByRole("button", { name: /Profile & settings/i }));
    const explicitSettings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(explicitSettings).getByText("Offline")).toBeInTheDocument();
    expect(within(explicitSettings).getByText(/Account changes require online mode/)).toBeInTheDocument();
    expect(within(explicitSettings).getByRole("button", { name: /Add account/i })).toBeDisabled();

    cleanup();
    localStorage.clear();
    localStorage.setItem("davora-favourites:alpha", favourites);
    const offlineSnapshot = { kind: "offline" } as const;
    const browserOfflineServices = appServicesFor(account, { connectivity: { read: () => offlineSnapshot, subscribe: () => () => undefined } });
    render(<App services={browserOfflineServices} />);
    expect(document.querySelector<HTMLButtonElement>(".offline-mode-toggle")?.textContent).toBe("Go offline");
    fireEvent.click(await screen.findByRole("button", { name: /Open navigation menu/i }));
    const browserDrawer = await screen.findByRole("region", { name: /Favourites/i });
    expect(within(browserDrawer).getByRole("button", { name: /Open favourite file readme.txt/i })).toBeInTheDocument();
    expect(within(browserDrawer).getByRole("button", { name: /Open favourite file Online-only.txt/i })).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: /Navigation menu/i })).getByText("Offline")).toBeInTheDocument();
  });

  it("omits the status-shell offline toggle while fully online", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha online shell workspace" });
    const services = appServicesFor(account);
    render(<App services={services} />);
    await screen.findByRole("button", { name: /Open navigation menu/i });
    expect(document.querySelector(".offline-mode-toggle")).toBeNull();
  });

  it("reaches the same concrete repository through retention, offline-sync, preview, and removal", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false, media: "(max-width: 900px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }))
    });
    const services = createBrowserAppServices();
    const remoteDelete = vi.spyOn(services.operationRuntime.mutation, "deleteFile");
    const account = buildAccount("alpha");
    const repositorySpies = {
      readSnapshot: vi.spyOn(services.retentionRepository, "readSnapshot"),
      beginRoot: vi.spyOn(services.retentionRepository, "beginRoot"),
      persistRetainedFile: vi.spyOn(services.retentionRepository, "persistRetainedFile"),
      completeRoot: vi.spyOn(services.retentionRepository, "completeRoot"),
      readPreview: vi.spyOn(services.retentionRepository, "readPreview"),
      purgeAccountNamespace: vi.spyOn(services.retentionRepository, "purgeAccountNamespace")
    };
    const retention = renderHook((props) => useRetention(props), {
      initialProps: { activeAccount: account, cacheNamespace: account.cacheNamespace, accountName: "Alpha", ports: retentionPorts(services.retentionRepository) }
    });
    await act(async () => undefined);
    const retentionAccount = { accountId: account.id, cacheNamespace: account.cacheNamespace };
    const root = { path: "Docs", name: "Docs", kind: "folder" as const, folderRoots: ["Docs"] };
    await act(async () => {
      await retention.result.current.executeSnapshotCommand({ kind: "beginRoot", account: retentionAccount, root: { rootPath: "Docs", rootName: "Docs", kind: "folder", folderRoots: ["Docs"] } });
      await retention.result.current.executeSnapshotCommand({ kind: "persistRetainedFile", account: retentionAccount, input: { rootId: retainedRootId({ kind: "folder", rootPath: "Docs" }), file: file("Docs/a.txt"), blob: new Blob(["a"]) } });
      await retention.result.current.executeSnapshotCommand({ kind: "completeRoot", account: retentionAccount, rootId: retainedRootId({ kind: "folder", rootPath: "Docs" }) });
    });
    const sync = createOfflineSyncRetentionPort({
      getActiveAccount: () => account,
      toRetentionAccount: (value) => ({ accountId: value.id, cacheNamespace: value.cacheNamespace }),
      executeSnapshotCommand: retention.result.current.executeSnapshotCommand,
      readBlobText: async (blob) => blob.text(),
      errors: { isUnauthorized: () => false, isReconnectRequired: () => false }
    });
    const job = {
      id: "sync-1", accountId: account.id, cacheNamespace: account.cacheNamespace, root,
      selectedEntries: [{ path: "Docs/a.txt", name: "a.txt", isFolder: false }],
      planSource: { kind: "acceptedPlan" as const, plan: { files: [{ sourcePath: "Docs/a.txt", size: 1 }], totalBytes: 1 } }
    };
    const signal = new AbortController().signal;
    await sync.beginRoot(job, () => true);
    await sync.persistRetainedFile(job, { sourcePath: "Docs/a.txt", size: 1 }, { blob: new Blob(["a"], { type: "text/plain" }), filename: "a.txt" }, signal, () => true);
    await sync.completeRoot(job, signal, () => true);
    await sync.readSummary(account.cacheNamespace, signal, () => true);

    const adapters = services.previewRuntime.session.createSessionAdapters({ tokenFor: () => "opaque-token" });
    await adapters.cache.read({ accountId: account.id, cacheNamespace: account.cacheNamespace, path: "Docs/a.txt", contextGeneration: "g", connectionMode: "online", heicPreviewEnabled: false, freshnessIntervalMs: 60_000, cacheLimitBytes: 1024, requestSequence: 1 }, adapters.abort.create()).catch(() => undefined);
    await services.accountRemovalRuntime.purgeLocalAccountData(account, []);

    await act(async () => {
      await retention.result.current.executeSnapshotCommand({
        kind: "removeRoot",
        account: retentionAccount,
        rootId: retainedRootId({ kind: "folder", rootPath: "Docs" })
      });
      await retention.result.current.executeSnapshotCommand({ kind: "clearNormalCache", account: retentionAccount });
    });

    expect(repositorySpies.readSnapshot).toHaveBeenCalled();
    expect(repositorySpies.beginRoot).toHaveBeenCalled();
    expect(repositorySpies.persistRetainedFile).toHaveBeenCalled();
    expect(repositorySpies.completeRoot).toHaveBeenCalled();
    expect(repositorySpies.readPreview).toHaveBeenCalledWith(retentionAccount, "Docs/a.txt");
    expect(repositorySpies.purgeAccountNamespace).toHaveBeenCalledWith(retentionAccount, []);
    expect(remoteDelete).not.toHaveBeenCalled();
    expect(Object.keys(services.retentionRepository)).not.toContain("deleteFile");
  });
});
