import { describe, expect, it, vi } from "vitest";

import type { FileEntry, ViewerKind } from "@davora/shared";

import { createPreviewRequestKey, createPreviewSnapshot, type PreviewOpenRequest } from "../session/model";
import type { PreviewAcquisition } from "../session";
import {
  applyPendingPreviewRefresh,
  downloadUnsupportedPreviewFile,
  openPreviewFile
} from "./controller";
import {
  createPreviewOpenPorts,
  type CreatePreviewOpenPortsInput
} from "./createPreviewOpenPorts";

function entry(path: string, mimeType: string): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false, size: 1, mimeType };
}

function acquisition(viewer: ViewerKind): PreviewAcquisition {
  return {
    snapshot: createPreviewSnapshot({
      preview: {
        path: "Archive/file.bin",
        name: "file.bin",
        isFolder: false,
        mimeType: "application/octet-stream",
        size: 1,
        viewer,
        content: "",
        encoding: "none",
        truncated: false,
        bytesRead: 0
      },
      fingerprint: "fingerprint",
      source: "inline"
    })
  };
}

function createInput(overrides: Partial<CreatePreviewOpenPortsInput> = {}): CreatePreviewOpenPortsInput {
  return {
    session: {
      open: vi.fn(async () => ({
        kind: "opened" as const,
        key: createPreviewRequestKey({
          requestSequence: 1,
          accountId: "alpha",
          cacheNamespace: "ns-alpha",
          path: "Archive/photo.png",
          contextGeneration: "1",
          connectionMode: "online",
          heicPreviewEnabled: false,
          freshnessIntervalMs: 1000,
          cacheLimitBytes: 1024
        })
      })),
      applyRefresh: vi.fn(async () => ({ kind: "not-ready" as const })),
      clearOwner: vi.fn()
    },
    navigation: {
      pushPreviewSurface: vi.fn(),
      closeMobileDetails: vi.fn()
    },
    folderAudio: {
      pause: vi.fn(),
      activate: vi.fn()
    },
    surface: {
      closePreview: vi.fn(),
      isPreviewOpen: vi.fn(() => false),
      setOpenedEntry: vi.fn(),
      setOpenedEntryPath: vi.fn(),
      clearSelectedBlob: vi.fn(),
      clearSelectedEntry: vi.fn(),
      setPreviewError: vi.fn(),
      setStatus: vi.fn(),
      reportListError: vi.fn(),
      markWorkerAvailable: vi.fn()
    },
    unsupportedDownload: {
      isCurrentHandler: vi.fn(() => true),
      canDownloadFocused: vi.fn(() => true),
      downloadFocused: vi.fn(async () => undefined)
    },
    explicitOffline: {
      getActiveAccount: vi.fn(() => ({ id: "alpha", cacheNamespace: "ns-alpha" })),
      toRetentionAccount: (account) => ({ accountId: account.id, cacheNamespace: account.cacheNamespace }),
      readPreview: vi.fn(async () => ({ kind: "success" as const, value: undefined })),
      triggerBrowserDownload: vi.fn(),
      isRetentionCurrent: vi.fn(() => true)
    },
    prefetch: {
      runtime: {
        probe: vi.fn(async () => false),
        prefetch: vi.fn(async () => ({ kind: "cached" as const }))
      },
      context: {
        getContextGeneration: vi.fn(() => "1"),
        getAccountId: vi.fn(() => "alpha"),
        getCacheNamespace: vi.fn(() => "ns-alpha"),
        isStillCurrent: vi.fn(() => true),
        nextPrefetchSequence: vi.fn(() => 1),
        trackPrefetchAbort: vi.fn(),
        untrackPrefetchAbort: vi.fn(),
        createAbort: vi.fn(() => ({ id: "abort", abort: vi.fn() }))
      },
      refreshCacheSummary: vi.fn(async () => undefined)
    },
    presentation: {
      toDisplayPath: vi.fn((path: string) => path)
    },
    ...overrides
  };
}

describe("createPreviewOpenPorts", () => {
  it("preserves session open, applyRefresh, and clearOwner delegation", async () => {
    const input = createInput();
    const ports = createPreviewOpenPorts(input);
    const request: PreviewOpenRequest = {
      accountId: "alpha",
      cacheNamespace: "ns-alpha",
      path: "notes.txt",
      contextGeneration: "1",
      connectionMode: "online",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 1000,
      cacheLimitBytes: 1024,
      target: "previewable"
    };

    await ports.session.open(request);
    await ports.session.applyRefresh();
    ports.session.clearOwner();

    expect(input.session.open).toHaveBeenCalledWith(request);
    expect(input.session.applyRefresh).toHaveBeenCalled();
    expect(input.session.clearOwner).toHaveBeenCalled();
  });

  it("reports cache-only unsupported download messaging and clears preview selection", async () => {
    const input = createInput();
    const ports = createPreviewOpenPorts(input);

    await downloadUnsupportedPreviewFile("archive.bin", "archive.bin", "Workspace", ports, {
      cacheOnlyMode: true,
      offline: true
    });

    expect(input.surface.closePreview).toHaveBeenCalled();
    expect(input.surface.clearSelectedBlob).toHaveBeenCalled();
    expect(input.surface.clearSelectedEntry).toHaveBeenCalled();
    expect(input.surface.reportListError).toHaveBeenCalledWith(new Error(
      "This file type downloads instead of previewing. Reconnect to download it."
    ));
    expect(input.surface.setStatus).toHaveBeenCalledWith(
      "Reconnect to download archive.bin in Workspace. Unsupported files open by download instead of preview."
    );
    expect(input.unsupportedDownload.downloadFocused).not.toHaveBeenCalled();
  });

  it("reports local-server blocked messaging when cache-only without browser offline", async () => {
    const input = createInput();
    const ports = createPreviewOpenPorts(input);

    await downloadUnsupportedPreviewFile("archive.bin", "archive.bin", "Workspace", ports, {
      cacheOnlyMode: true,
      offline: false
    });

    expect(input.surface.reportListError).toHaveBeenCalledWith(new Error(
      "This file type downloads instead of previewing. Restore the local server to download it."
    ));
    expect(input.surface.setStatus).toHaveBeenCalledWith(
      "Restore the local server to download archive.bin in Workspace. Unsupported files open by download instead of preview."
    );
  });

  it("prepares unsupported focused download by closing preview and clearing selection", async () => {
    const input = createInput();
    const presentationEvents: string[] = [];
    vi.mocked(input.surface.reportListError).mockImplementation(() => { presentationEvents.push("clear"); });
    vi.mocked(input.surface.setStatus).mockImplementation(() => { presentationEvents.push("status"); });
    const ports = createPreviewOpenPorts(input);

    await downloadUnsupportedPreviewFile("archive.bin", "archive.bin", "Workspace", ports, {
      cacheOnlyMode: false,
      offline: false
    });

    expect(input.surface.closePreview).toHaveBeenCalled();
    expect(input.surface.clearSelectedBlob).toHaveBeenCalled();
    expect(input.surface.clearSelectedEntry).toHaveBeenCalled();
    expect(input.surface.reportListError).toHaveBeenCalledWith(undefined);
    expect(input.unsupportedDownload.downloadFocused).toHaveBeenCalledWith("archive.bin", "archive.bin");
    expect(input.surface.setStatus).toHaveBeenCalledWith(
      "Starting browser download for archive.bin from Workspace because this file type opens outside preview."
    );
    expect(presentationEvents).toEqual(["clear", "status"]);
  });

  it("opens explicit-offline retained blobs with success status when retention is current", async () => {
    const blob = new Blob(["zip"]);
    const input = createInput({
      explicitOffline: {
        ...createInput().explicitOffline,
        readPreview: vi.fn(async () => ({
          kind: "success" as const,
          value: {
            file: {
              path: "Archive/report.zip",
              name: "report.zip",
              mimeType: "application/zip",
              size: 3,
              blobSize: 3,
              readable: true,
              normalCacheOwnership: "owned" as const
            },
            blob
          }
        }))
      }
    });
    const ports = createPreviewOpenPorts(input);

    await openPreviewFile({
      entry: entry("Archive/report.zip", "application/zip"),
      hasToken: false,
      cacheOnlyMode: true,
      cacheNamespace: "ns-alpha",
      hasActiveAccount: true,
      explicitOfflineMode: true,
      offline: true,
      accountId: "alpha",
      cacheNamespaceValue: "ns-alpha",
      accountName: "Alpha workspace",
      contextGeneration: "1",
      connectionMode: "cache-only",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 1000,
      cacheLimitBytes: 1024,
      mediaItems: []
    }, ports);

    expect(input.explicitOffline.isRetentionCurrent).toHaveBeenCalledWith("alpha", "ns-alpha");
    expect(input.explicitOffline.triggerBrowserDownload).toHaveBeenCalledWith(blob, "report.zip");
    expect(input.surface.setStatus).toHaveBeenCalledWith("Opened the local offline copy of /Archive/report.zip.");
  });

  it("does not open explicit-offline blobs when retention is no longer current", async () => {
    const input = createInput({
      explicitOffline: {
        ...createInput().explicitOffline,
        readPreview: vi.fn(async () => ({
          kind: "success" as const,
          value: {
            file: {
              path: "Archive/report.zip",
              name: "report.zip",
              mimeType: "application/zip",
              size: 3,
              blobSize: 3,
              readable: true,
              normalCacheOwnership: "owned" as const
            },
            blob: new Blob(["zip"])
          }
        })),
        isRetentionCurrent: vi.fn(() => false)
      }
    });
    const ports = createPreviewOpenPorts(input);

    await openPreviewFile({
      entry: entry("Archive/report.zip", "application/zip"),
      hasToken: false,
      cacheOnlyMode: true,
      cacheNamespace: "ns-alpha",
      hasActiveAccount: true,
      explicitOfflineMode: true,
      offline: true,
      accountId: "alpha",
      cacheNamespaceValue: "ns-alpha",
      accountName: "Alpha workspace",
      contextGeneration: "1",
      connectionMode: "cache-only",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 1000,
      cacheLimitBytes: 1024,
      mediaItems: []
    }, ports);

    expect(input.explicitOffline.triggerBrowserDownload).not.toHaveBeenCalled();
    expect(input.surface.setStatus).not.toHaveBeenCalled();
  });

  it("reports unreadable explicit-offline blobs", async () => {
    const input = createInput();
    const ports = createPreviewOpenPorts(input);

    await openPreviewFile({
      entry: entry("Archive/report.zip", "application/zip"),
      hasToken: false,
      cacheOnlyMode: true,
      cacheNamespace: "ns-alpha",
      hasActiveAccount: true,
      explicitOfflineMode: true,
      offline: true,
      accountId: "alpha",
      cacheNamespaceValue: "ns-alpha",
      accountName: "Alpha workspace",
      contextGeneration: "1",
      connectionMode: "cache-only",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 1000,
      cacheLimitBytes: 1024,
      mediaItems: []
    }, ports);

    expect(input.surface.setPreviewError).toHaveBeenCalledWith(
      new Error("This file is no longer readable from local device storage.")
    );
  });

  it("routes folder-audio opens through pause and activate ports", async () => {
    const input = createInput({
      surface: {
        ...createInput().surface,
        isPreviewOpen: vi.fn(() => true)
      }
    });
    const ports = createPreviewOpenPorts(input);

    await openPreviewFile({
      entry: entry("Archive/song.mp3", "audio/mpeg"),
      options: { preferFolderAudioPlayer: true },
      hasToken: true,
      cacheOnlyMode: false,
      cacheNamespace: "ns",
      hasActiveAccount: true,
      explicitOfflineMode: false,
      offline: false,
      accountId: "alpha",
      cacheNamespaceValue: "ns",
      accountName: "Workspace",
      contextGeneration: "1",
      connectionMode: "online",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 1000,
      cacheLimitBytes: 1024,
      mediaItems: []
    }, ports);

    expect(input.surface.closePreview).toHaveBeenCalled();
    expect(input.folderAudio.activate).toHaveBeenCalledWith(entry("Archive/song.mp3", "audio/mpeg"));
    expect(input.navigation.closeMobileDetails).toHaveBeenCalled();
    expect(input.session.open).not.toHaveBeenCalled();
  });

  it("pushes preview surface and closes mobile details for ordinary opens", async () => {
    const input = createInput();
    const ports = createPreviewOpenPorts(input);

    await openPreviewFile({
      entry: entry("Archive/photo.png", "image/png"),
      hasToken: true,
      cacheOnlyMode: false,
      cacheNamespace: "ns",
      hasActiveAccount: true,
      explicitOfflineMode: false,
      offline: false,
      accountId: "alpha",
      cacheNamespaceValue: "ns",
      accountName: "Workspace",
      contextGeneration: "1",
      connectionMode: "online",
      heicPreviewEnabled: false,
      freshnessIntervalMs: 1000,
      cacheLimitBytes: 1024,
      mediaItems: []
    }, ports);

    expect(input.folderAudio.pause).toHaveBeenCalled();
    expect(input.navigation.pushPreviewSurface).toHaveBeenCalled();
    expect(input.navigation.closeMobileDetails).toHaveBeenCalled();
    expect(input.surface.markWorkerAvailable).toHaveBeenCalled();
  });

  it("accepts only media-gallery viewers for prefetch policy", () => {
    const ports = createPreviewOpenPorts(createInput());

    expect(ports.prefetch.acceptPolicy.accept(acquisition("image"))).toBe(true);
    expect(ports.prefetch.acceptPolicy.accept(acquisition("video"))).toBe(true);
    expect(ports.prefetch.acceptPolicy.accept(acquisition("audio"))).toBe(true);
    expect(ports.prefetch.acceptPolicy.accept(acquisition("pdf"))).toBe(false);
    expect(ports.prefetch.acceptPolicy.accept(acquisition("markdown"))).toBe(false);
    expect(ports.prefetch.acceptPolicy.accept(acquisition("unsupported"))).toBe(false);
  });

  it("reports applied refresh status with display path wording", async () => {
    const input = createInput({
      session: {
        ...createInput().session,
        applyRefresh: vi.fn(async () => ({
          kind: "applied" as const,
          key: createPreviewRequestKey({
            requestSequence: 3,
            accountId: "alpha",
            cacheNamespace: "ns-alpha",
            path: "Archive/photo.png",
            contextGeneration: "1",
            connectionMode: "online",
            heicPreviewEnabled: false,
            freshnessIntervalMs: 1000,
            cacheLimitBytes: 1024
          })
        }))
      },
      presentation: {
        toDisplayPath: vi.fn((path: string) => `display:${path}`)
      }
    });
    const ports = createPreviewOpenPorts(input);

    await applyPendingPreviewRefresh("Workspace", "Archive/photo.png", ports, true);

    expect(input.presentation.toDisplayPath).toHaveBeenCalledWith("Archive/photo.png");
    expect(input.surface.setStatus).toHaveBeenCalledWith(
      "Applied refreshed preview for display:Archive/photo.png in Workspace"
    );
  });
});
