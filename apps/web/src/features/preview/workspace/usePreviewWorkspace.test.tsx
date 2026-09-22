import type { FileEntry } from "@davora/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePreviewSession } from "../session";
import { usePreviewOpen } from "../open";
import { useFolderAudioMount } from "../folderAudio";
import { createBrowserPreviewModalRuntime } from "../../../platform/preview/browserPreviewModalRuntime";
import {
  usePreviewWorkspace,
  type PreviewWorkspaceBridge,
  type PreviewWorkspaceInput,
  type PreviewWorkspaceOpenOptions
} from "./index";

type PreviewOpenCaptureInput = {
  readonly ports: {
    readonly surface: {
      readonly close: () => void;
      readonly clearSelection: () => void;
      readonly setOpenedEntryPath: (path: string) => void;
      readonly setOpenedEntry: (entry: FileEntry) => void;
    };
    readonly unsupportedDownload: {
      readonly prepareForDownload: () => void;
    };
  };
};
type PreviewSessionCaptureInput = {
  readonly callbacks: {
    readonly onOpenedEntryClear: () => void;
  };
};

const mockedChildren = vi.hoisted(() => ({
  session: vi.fn<(input: PreviewSessionCaptureInput) => unknown>(),
  open: vi.fn<(input: PreviewOpenCaptureInput) => unknown>(),
  folderAudio: vi.fn()
}));

vi.mock("../session", () => ({ usePreviewSession: mockedChildren.session }));
vi.mock("../open", () => ({ usePreviewOpen: mockedChildren.open }));
vi.mock("../folderAudio", () => ({ useFolderAudioMount: mockedChildren.folderAudio }));

type SessionChild = Pick<
  ReturnType<typeof usePreviewSession>,
  "previewOpen" | "selected" | "selectedBlobUrl" | "previewError" | "loadingPreview" |
  "previewCacheState" | "pendingPreviewUpdate" | "close" | "clearOwner" |
  "setOpenedEntryPath" | "clearOpenedEntryPath"
> & {
  controller: { open: ReturnType<typeof vi.fn>; applyRefresh: ReturnType<typeof vi.fn> };
  prefetchPort: object;
  prefetchContext: object;
};

type OpenChild = Pick<
  ReturnType<typeof usePreviewOpen>,
  "openFile" | "openAdjacentMedia" | "applyPendingRefresh" | "previousMediaItem" | "nextMediaItem"
>;

type FolderChild = Pick<
  ReturnType<typeof useFolderAudioMount>,
  "playing" | "interaction" | "hasPlayer" | "previewOpenSources" |
  "pauseForExclusivePlayback" | "bindPreviewMediaPlaybackChange"
>;

function file(path: string, mimeType = "image/png"): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false, size: 1, mimeType };
}

function createContext() {
  return {
    activeAccount: { id: "alpha", cacheNamespace: "cache-alpha", displayName: "Alpha workspace" },
    token: "token-alpha",
    cacheNamespace: "cache-alpha",
    cacheOnlyMode: false,
    currentPath: "Projects",
    visibleItems: [file("Projects/photo.png"), file("Projects/other.png"), file("Projects/chapter.m4a", "audio/mp4")],
    openedEntry: file("Projects/photo.png"),
    explicitOfflineMode: false,
    offline: false
  };
}

function createSettings() {
  return {
    experimentalHeicPreviewEnabled: false,
    previewFreshnessIntervalSeconds: 60,
    maxCacheableFileSizeBytes: 1024
  };
}

function createPorts() {
  const ports = {
    session: {
      composition: { createSessionAdapters: vi.fn() },
      callbacks: {
        onResetSession: vi.fn(),
        onMarkWorkerUnavailable: vi.fn(),
        onPublishCacheSummary: vi.fn(),
        onStreamCacheReady: vi.fn(),
        onStreamCacheFailed: vi.fn(),
        onOpenedEntryClear: vi.fn()
      }
    },
    open: {
      ports: {
        navigation: { pushPreviewSurface: vi.fn(), closeMobileDetails: vi.fn() },
        surface: {
          close: vi.fn(),
          isOpen: vi.fn(() => false),
          setOpenedEntry: vi.fn(),
          setOpenedEntryPath: vi.fn(),
          clearSelection: vi.fn(),
          setPreviewError: vi.fn(),
          setStatus: vi.fn(),
          reportListError: vi.fn(),
          markWorkerAvailable: vi.fn()
        },
        unsupportedDownload: {
          isCurrentHandler: vi.fn(() => true),
          canDownloadFocused: vi.fn(() => true),
          download: vi.fn(async () => undefined),
          reportCacheOnlyBlocked: vi.fn(),
          reportStarting: vi.fn(),
          prepareForDownload: vi.fn()
        },
        explicitOffline: {
          readCachedBlob: vi.fn(async () => undefined),
          triggerLocalOpen: vi.fn(),
          isRetentionCurrent: vi.fn(() => true),
          reportLocalOpen: vi.fn(),
          reportUnreadable: vi.fn()
        }
      },
      refresh: { onApplied: vi.fn() },
      refreshCacheSummary: vi.fn(async () => undefined),
      onInvalidatePrefetch: vi.fn()
    },
    folderAudio: {
      ports: {
        storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
        createStreamingFileUrl: async () => "",
        nowIso: () => new Date(0).toISOString(),
        loadAudioPreviewPosition: () => undefined,
        saveAudioPreviewPosition: () => undefined
      }
    }
  };
  return {
    ...ports,
    application: {
      runtime: {
        session: ports.session.composition,
        modal: createBrowserPreviewModalRuntime(),
        folderAudio: ports.folderAudio.ports
      },
      session: {
        reset: ports.session.callbacks.onResetSession,
        markWorkerUnavailable: ports.session.callbacks.onMarkWorkerUnavailable,
        publishCacheSummary: ports.session.callbacks.onPublishCacheSummary,
        streamCacheReady: ports.session.callbacks.onStreamCacheReady,
        streamCacheFailed: ports.session.callbacks.onStreamCacheFailed
      },
      navigation: {
        pushPreviewSurface: ports.open.ports.navigation.pushPreviewSurface,
        closeNavigation: ports.open.ports.surface.close,
        closeMobileDetails: ports.open.ports.navigation.closeMobileDetails,
        closePreview: ports.open.ports.surface.close
      },
      operation: {
        isCurrent: ports.open.ports.unsupportedDownload.isCurrentHandler,
        canDownload: ports.open.ports.unsupportedDownload.canDownloadFocused,
        download: async (_path: string, _label: string) => ports.open.ports.unsupportedDownload.download(),
        saveLocal: (blob: Blob, filename: string) => { ports.open.ports.explicitOffline.triggerLocalOpen(blob, filename); }
      },
      retention: {
        readPreview: async () => undefined,
        isCurrent: (_account: { accountId: string; cacheNamespace: string }) => ports.open.ports.explicitOffline.isRetentionCurrent(),
        refreshSummary: ports.open.refreshCacheSummary,
        publishSummary: ports.session.callbacks.onPublishCacheSummary
      },
      presentation: {
        announce: ports.open.ports.surface.setStatus,
        reportListError: (error?: Error) => { ports.open.ports.surface.reportListError(error); },
        clearListError: () => { ports.open.ports.surface.reportListError(undefined); },
        markWorkerAvailable: ports.open.ports.surface.markWorkerAvailable,
        onImageFitModeChange: vi.fn(),
        onVideoMutedChange: vi.fn(),
        toDisplayPath: (path: string) => path
      }
    }
  };
}

function createChildren() {
  const order: string[] = [];
  const session: SessionChild = {
    previewOpen: false,
    selected: undefined,
    selectedBlobUrl: undefined,
    previewError: undefined,
    loadingPreview: false,
    previewCacheState: { source: "none", refreshing: false, stale: false, updateReady: false },
    pendingPreviewUpdate: undefined,
    close: vi.fn(() => order.push("modal-close")),
    clearOwner: vi.fn(() => order.push("modal-cleanup")),
    setOpenedEntryPath: vi.fn(),
    clearOpenedEntryPath: vi.fn(() => order.push("opened-entry-clear")),
    controller: { open: vi.fn(), applyRefresh: vi.fn() },
    prefetchPort: {},
    prefetchContext: {}
  };
  const open: OpenChild = {
    openFile: vi.fn(async () => {
      order.push("open-file");
    }),
    openAdjacentMedia: vi.fn(),
    applyPendingRefresh: vi.fn(async () => undefined),
    previousMediaItem: undefined,
    nextMediaItem: undefined
  };
  const interaction = {
    playing: false,
    pause: vi.fn(() => {
      order.push("folder-audio-pause");
    }),
    activate: vi.fn((entry: { readonly path: string }) => {
      order.push(`folder-audio-activate:${entry.path}`);
    }),
    stage: undefined
  };
  const folder: FolderChild = {
    playing: false,
    hasPlayer: false,
    interaction,
    previewOpenSources: interaction,
    pauseForExclusivePlayback: interaction.pause,
    bindPreviewMediaPlaybackChange: vi.fn((onPreviewPlayingChange: (playing: boolean) => void) => (playing: boolean) => {
      onPreviewPlayingChange(playing);
      if (playing) {
        interaction.pause();
      }
    })
  };
  mockedChildren.session.mockReturnValue(session);
  mockedChildren.open.mockReturnValue(open);
  mockedChildren.folderAudio.mockReturnValue(folder);
  return { order, session, open, folder, interaction };
}

function createInput(overrides: {
  readonly context?: PreviewWorkspaceInput["context"];
  readonly settings?: PreviewWorkspaceInput["settings"];
  readonly ports?: PreviewWorkspaceInput["ports"];
} = {}): PreviewWorkspaceInput {
  return {
    context: createContext(),
    settings: createSettings(),
    ports: createPorts(),
    ...overrides
  };
}

describe("usePreviewWorkspace", () => {
  it("publishes the exact opened entry identity through the modal projection", () => {
    createChildren();
    const openedEntry = file("Projects/photo.png");
    const { result } = renderHook(() => usePreviewWorkspace(createInput()));
    const openInput = mockedChildren.open.mock.lastCall?.[0];
    if (!openInput) {
      throw new Error("preview open input was not captured");
    }

    expect(result.current.modal.entry).toBeUndefined();
    act(() => {
      openInput.ports.surface.setOpenedEntryPath(openedEntry.path);
      openInput.ports.surface.setOpenedEntry(openedEntry);
    });
    expect(result.current.modal.entry).toBe(openedEntry);
  });

  it("dismisses a seeded entry and session exactly once without publication help", () => {
    const children = createChildren();
    const { result } = renderHook(() => usePreviewWorkspace(createInput()));
    const openInput = mockedChildren.open.mock.lastCall?.[0];
    if (!openInput) throw new Error("preview open input was not captured");
    const openedEntry = file("Projects/photo.png");

    act(() => {
      openInput.ports.surface.setOpenedEntryPath(openedEntry.path);
      openInput.ports.surface.setOpenedEntry(openedEntry);
    });
    act(() => result.current.bridge.dismiss("preview"));
    act(() => result.current.bridge.dismiss("preview"));

    expect(result.current.modal.entry).toBeUndefined();
    expect(children.session.clearOpenedEntryPath).toHaveBeenCalledTimes(1);
    expect(children.session.close).toHaveBeenCalledTimes(1);
  });

  it("clears a seeded entry on path transition and account-context replacement", () => {
    const children = createChildren();
    const { result } = renderHook(() => usePreviewWorkspace(createInput()));
    const openInput = mockedChildren.open.mock.lastCall?.[0];
    if (!openInput) throw new Error("preview open input was not captured");
    const openedEntry = file("Projects/photo.png");

    act(() => {
      openInput.ports.surface.setOpenedEntryPath(openedEntry.path);
      openInput.ports.surface.setOpenedEntry(openedEntry);
    });
    act(() => result.current.bridge.clearForPathTransition());
    expect(result.current.modal.entry).toBeUndefined();
    expect(children.session.clearOpenedEntryPath).toHaveBeenCalledTimes(1);
    expect(children.session.close).toHaveBeenCalledTimes(1);

    act(() => {
      openInput.ports.surface.setOpenedEntryPath(openedEntry.path);
      openInput.ports.surface.setOpenedEntry(openedEntry);
    });
    act(() => result.current.bridge.clearAccountContext());
    expect(result.current.modal.entry).toBeUndefined();
    expect(children.session.clearOpenedEntryPath).toHaveBeenCalledTimes(2);
    expect(children.session.close).toHaveBeenCalledTimes(1);
  });

  it("clears seeded identity for unsupported preparation and callback-driven close", () => {
    const children = createChildren();
    const { result } = renderHook(() => usePreviewWorkspace(createInput()));
    const openInput = mockedChildren.open.mock.lastCall?.[0];
    const sessionInput = mockedChildren.session.mock.lastCall?.[0];
    if (!openInput || !sessionInput) throw new Error("preview child inputs were not captured");
    const openedEntry = file("Projects/photo.png");

    act(() => {
      openInput.ports.surface.setOpenedEntryPath(openedEntry.path);
      openInput.ports.surface.setOpenedEntry(openedEntry);
    });
    act(() => openInput.ports.unsupportedDownload.prepareForDownload());
    expect(result.current.modal.entry).toBeUndefined();
    expect(children.session.clearOpenedEntryPath).toHaveBeenCalledTimes(1);
    expect(children.session.close).toHaveBeenCalledTimes(1);

    act(() => {
      openInput.ports.surface.setOpenedEntryPath(openedEntry.path);
      openInput.ports.surface.setOpenedEntry(openedEntry);
    });
    act(() => sessionInput.callbacks.onOpenedEntryClear());
    expect(result.current.modal.entry).toBeUndefined();
    expect(children.session.clearOpenedEntryPath).toHaveBeenCalledTimes(2);

    act(() => {
      openInput.ports.surface.setOpenedEntryPath(openedEntry.path);
      openInput.ports.surface.setOpenedEntry(openedEntry);
      openInput.ports.surface.close();
      openInput.ports.surface.clearSelection();
    });
    expect(result.current.modal.entry).toBeUndefined();
    expect(children.session.clearOpenedEntryPath).toHaveBeenCalledTimes(3);
    expect(children.session.close).toHaveBeenCalledTimes(1);
  });

  it("deduplicates synchronous session-close identity callbacks across semantic routes", () => {
    const routes = ["dismiss", "path", "account", "unsupported"] as const;
    for (const route of routes) {
      const children = createChildren();
      const { result } = renderHook(() => usePreviewWorkspace(createInput()));
      const openInput = mockedChildren.open.mock.lastCall?.[0];
      const sessionInput = mockedChildren.session.mock.lastCall?.[0];
      if (!openInput || !sessionInput) throw new Error("preview child inputs were not captured");
      const openedEntry = file(`Projects/${route}.png`);
      vi.mocked(children.session.close).mockImplementation(() => sessionInput.callbacks.onOpenedEntryClear());
      act(() => {
        openInput.ports.surface.setOpenedEntryPath(openedEntry.path);
        openInput.ports.surface.setOpenedEntry(openedEntry);
      });
      act(() => {
        if (route === "dismiss") result.current.bridge.dismiss("preview");
        else if (route === "path") result.current.bridge.clearForPathTransition();
        else if (route === "account") result.current.bridge.clearAccountContext();
        else result.current.bridge.prepareUnsupportedDownload();
      });

      expect(result.current.modal.entry).toBeUndefined();
      expect(children.session.clearOpenedEntryPath).toHaveBeenCalledTimes(1);
      expect(children.session.close).toHaveBeenCalledTimes(1);
    }
  });

  it("delegates ordinary modal open work to the public open owner", async () => {
    const children = createChildren();
    const input = createInput();
    const { result } = renderHook(() => usePreviewWorkspace(input));

    await act(async () => {
      await result.current.openFile(file("Projects/photo.png"));
    });

    expect(children.open.openFile).toHaveBeenCalledTimes(1);
  });

  it("delegates open-modal folder-audio routing without a second close policy", async () => {
    const children = createChildren();
    children.session.previewOpen = true;
    const input = createInput();
    const { result } = renderHook(() => usePreviewWorkspace(input));
    const audioEntry = file("Projects/chapter.m4a", "audio/mp4");

    await act(async () => {
      await result.current.openFile(audioEntry, { preferFolderAudioPlayer: true });
    });

    expect(children.session.close).not.toHaveBeenCalled();
    expect(children.interaction.activate).not.toHaveBeenCalled();
    expect(children.open.openFile).toHaveBeenCalledWith(audioEntry, { preferFolderAudioPlayer: true });
  });

  it("delegates folder-audio routing to the public open owner", async () => {
    const children = createChildren();
    const { result } = renderHook(() => usePreviewWorkspace(createInput()));
    const audioEntry = file("Projects/chapter.m4a", "audio/mp4");

    await act(async () => {
      await result.current.openFile(audioEntry, { preferFolderAudioPlayer: true });
    });

    expect(children.open.openFile).toHaveBeenCalledWith(audioEntry, { preferFolderAudioPlayer: true });
    expect(children.interaction.activate).not.toHaveBeenCalled();
  });

  it("clears seeded identity exactly once when switching to folder audio", async () => {
    const children = createChildren();
    const { result } = renderHook(() => usePreviewWorkspace(createInput()));
    const openInput = mockedChildren.open.mock.lastCall?.[0];
    if (!openInput) throw new Error("preview open input was not captured");
    const openedEntry = file("Projects/photo.png");
    act(() => {
      openInput.ports.surface.setOpenedEntryPath(openedEntry.path);
      openInput.ports.surface.setOpenedEntry(openedEntry);
    });
    vi.mocked(children.open.openFile).mockImplementation(async (_entry: FileEntry, options?: PreviewWorkspaceOpenOptions) => {
      if (options?.preferFolderAudioPlayer) {
        openInput.ports.surface.close();
        openInput.ports.surface.clearSelection();
      }
    });

    await act(async () => {
      await result.current.openFile(file("Projects/chapter.m4a", "audio/mp4"), { preferFolderAudioPlayer: true });
    });

    expect(result.current.modal.entry).toBeUndefined();
    expect(children.session.clearOpenedEntryPath).toHaveBeenCalledTimes(1);
    expect(children.session.close).toHaveBeenCalledTimes(1);
  });

  it("does not pause folder audio before an unsupported open is classified", async () => {
    const children = createChildren();
    children.folder.playing = true;
    const { result } = renderHook(() => usePreviewWorkspace(createInput()));

    await act(async () => {
      await result.current.openFile(file("Projects/archive.zip", "application/zip"));
    });

    expect(children.interaction.pause).not.toHaveBeenCalled();
    expect(children.open.openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "Projects/archive.zip" }), undefined);
  });

  it("delegates adjacent navigation, pending refresh, and unsupported opens to the existing public owner", async () => {
    const children = createChildren();
    const { result } = renderHook(() => usePreviewWorkspace(createInput()));

    act(() => result.current.openAdjacentMedia(1));
    await act(async () => {
      await result.current.applyPendingRefresh();
      await result.current.openFile(file("Projects/archive.zip", "application/zip"));
    });

    expect(children.open.openAdjacentMedia).toHaveBeenCalledWith(1);
    expect(children.open.applyPendingRefresh).toHaveBeenCalledTimes(1);
    expect(children.open.openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "Projects/archive.zip" }), undefined);
  });

  it("re-composes normalized account/token/path/cache context without projecting prior child activity", () => {
    const children = createChildren();
    children.session.previewOpen = true;
    children.folder.playing = true;
    const first = createInput();
    const second = createInput({
      context: {
        ...createContext(),
        activeAccount: { id: "beta", cacheNamespace: "cache-beta", displayName: "Beta workspace" },
        accountName: "Beta workspace",
        token: "token-beta",
        cacheNamespace: "cache-beta",
        cacheOnlyMode: true,
        currentPath: "Archive"
      }
    });
    const { result, rerender } = renderHook((input: PreviewWorkspaceInput) => usePreviewWorkspace(input), { initialProps: first });

    expect(result.current.mediaActivity).toEqual({ previewPlaying: false, folderAudioPlaying: true });
    const secondChildren = createChildren();
    mockedChildren.session.mockReturnValue(secondChildren.session);
    mockedChildren.open.mockReturnValue(secondChildren.open);
    mockedChildren.folderAudio.mockReturnValue(secondChildren.folder);
    rerender(second);

    expect(result.current.mediaActivity).toEqual({ previewPlaying: false, folderAudioPlaying: false });
    expect(result.current.state).not.toHaveProperty("context");
    expect(mockedChildren.session).toHaveBeenLastCalledWith(expect.objectContaining({
      accountId: "beta",
      cacheNamespace: "cache-beta",
      token: "token-beta",
      cacheOnlyMode: true,
      openedEntryPath: undefined
    }));
    expect(mockedChildren.open).toHaveBeenLastCalledWith(expect.objectContaining({
      activeAccount: { id: "beta", cacheNamespace: "cache-beta", displayName: "Beta workspace" },
      token: "token-beta",
      cacheNamespace: "cache-beta",
      cacheOnlyMode: true,
      openedEntry: undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      visibleItems: expect.arrayContaining([expect.objectContaining({ path: "Projects/photo.png" })])
    }));
    expect(mockedChildren.folderAudio).toHaveBeenLastCalledWith(expect.objectContaining({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      context: expect.objectContaining({
        accountId: "beta",
        folderPath: "Archive",
        token: "token-beta",
        cacheOnlyMode: true
      })
    }));
  });

  it("projects modal playback activity and pauses folder audio exactly once", () => {
    const children = createChildren();
    const input = createInput();
    const { result } = renderHook(() => usePreviewWorkspace(input));

    act(() => result.current.modal.onMediaPlaybackChange(true));
    expect(result.current.mediaActivity).toEqual({ previewPlaying: true, folderAudioPlaying: false });
    expect(children.interaction.pause).toHaveBeenCalledTimes(1);

    act(() => result.current.modal.onMediaPlaybackChange(false));
    expect(result.current.mediaActivity).toEqual({ previewPlaying: false, folderAudioPlaying: false });
    expect(children.interaction.pause).toHaveBeenCalledTimes(1);
  });

  it("keeps resource/token fields inside opaque child projections rather than copying them into summary or bridge state", () => {
    const children = createChildren();
    children.session.selectedBlobUrl = "blob:child-resource";
    const input = createInput();
    const { result } = renderHook(() => usePreviewWorkspace(input));

    expect(result.current.state).not.toHaveProperty("token");
    expect(result.current.state).not.toHaveProperty("selectedBlobUrl");
    expect(result.current.state).not.toHaveProperty("streamUrl");
    expect(result.current.bridge.snapshot()).not.toHaveProperty("token");
    expect(result.current.bridge.snapshot()).not.toHaveProperty("selectedBlobUrl");
    expect(result.current.bridge.snapshot()).not.toHaveProperty("streamUrl");
  });

  it("clears workspace entry identity and session path through the public bridge", () => {
    const children = createChildren();
    const input = createInput();
    const { result } = renderHook(() => usePreviewWorkspace(input));
    const openInput = mockedChildren.open.mock.lastCall?.[0];
    if (!openInput) {
      throw new Error("preview open input was not captured");
    }

    const openedEntry = file("Projects/photo.png");
    act(() => {
      openInput.ports.surface.setOpenedEntryPath(openedEntry.path);
      openInput.ports.surface.setOpenedEntry(openedEntry);
    });
    expect(result.current.modal.entry).toBe(openedEntry);

    act(() => result.current.bridge.clearOpenedEntry());

    expect(result.current.modal.entry).toBeUndefined();
    expect(children.session.clearOpenedEntryPath).toHaveBeenCalledTimes(1);
    expect(children.session.close).not.toHaveBeenCalled();
  });

  it("exposes one stable bridge for navigation/offline callers without creating another owner", async () => {
    const children = createChildren();
    const input = createInput();
    const { result, rerender } = renderHook((nextInput: PreviewWorkspaceInput) => usePreviewWorkspace(nextInput), { initialProps: input });
    const bridge: PreviewWorkspaceBridge = result.current.bridge;
    rerender({ ...input, context: { ...input.context, currentPath: "Archive" } });

    expect(result.current.bridge).toBe(bridge);
    expect(bridge.snapshot()).toEqual(result.current.state);
    act(() => bridge.dismiss("preview"));
    act(() => bridge.clearForPathTransition());
    act(() => bridge.pauseForExclusivePlayback());
    await act(async () => {
      await bridge.openFile(file("Archive/photo.png"));
    });

    expect(children.session.close).toHaveBeenCalledTimes(1);
    expect(children.session.clearOpenedEntryPath).toHaveBeenCalledTimes(0);
    expect(children.interaction.pause).toHaveBeenCalledTimes(1);
    expect(children.open.openFile).toHaveBeenCalledTimes(1);
  });
});
