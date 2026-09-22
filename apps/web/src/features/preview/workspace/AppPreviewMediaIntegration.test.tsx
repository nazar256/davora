import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  App, buildAccount, buildSession, mockedApi, seedAccounts,
  appShellCapture, capturedStageExpectation, expectCompleteCapturedPreviewStage, mediaPauseMock, mediaPlayMock, mockedRetentionRepository, textPreview,
} from "../../../test/appIntegrationHarness";

describe("App preview integration", () => {
  it("captures the real closed preview Stage binding with complete props and callback eligibility", async () => {
    const account = buildAccount("alpha", { displayName: "Preview composition workspace", cacheNamespace: "cache-alpha" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });

    const workspaceProps = [...appShellCapture.history].reverse().find((props) => props.kind === "workspace");
    expect(workspaceProps?.kind).toBe("workspace");
    if (!workspaceProps || workspaceProps.kind !== "workspace") {
      throw new Error("Expected a workspace AppShell capture");
    }
    const preview = workspaceProps.overlays.preview;
    expectCompleteCapturedPreviewStage(preview, capturedStageExpectation({ open: false, accountId: "alpha", entry: undefined, file: undefined, blobUrl: undefined, offline: false, workerUnavailable: false, loading: false, errorMessage: undefined, token: "token-alpha", cacheState: { source: "none", refreshing: false, stale: false, updateReady: false }, fileSizeDisplayMode: "human", imageFitMode: "fill", maxCacheableFileSizeBytes: 15 * 1024 * 1024, onApplyRefresh: "undefined", onPrevious: "undefined", onNext: "undefined" }));
    expect(preview.open).toBe(false);
    expect(preview.accountId).toBe(account.id);
    expect(preview.entry).toBeUndefined();
    expect(preview.file).toBeUndefined();
    expect(preview.blobUrl).toBeUndefined();
    expect(preview.error).toBeUndefined();
    expect(preview.loading).toBe(false);
    expect(preview.onApplyRefresh).toBeUndefined();
    expect(preview.onPrevious).toBeUndefined();
    expect(preview.onNext).toBeUndefined();
    expect(preview.offline).toBe(false);
    expect(preview.token).toBe(`token-${account.id}`);
    expect(preview.workerUnavailable).toBe(false);
    expect(preview.cacheState).toEqual({ source: "none", refreshing: false, stale: false, updateReady: false });
    expect(preview.fileSizeDisplayMode).toBe("human");
    expect(preview.imageFitMode).toBe("fill");
    expect(preview.maxCacheableFileSizeBytes).toBe(15 * 1024 * 1024);
    expect(typeof preview.onImageFitModeChange).toBe("function");
    expect(typeof preview.onMediaPlaybackChange).toBe("function");
    expect(typeof preview.onClose).toBe("function");
  });

  it("does not prefetch adjacent videos while keeping them available for explicit navigation", async () => {
    const account = buildAccount("alpha", { displayName: "Media navigation workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Archive/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" },
        { path: "Archive/z-clip.mp4", name: "z-clip.mp4", isFolder: false, size: 16, mimeType: "video/mp4" }
      ]
    });
    mockedApi.getFile.mockImplementation(async (path: string) => ({
      file: {
        ...textPreview,
        path,
        name: path.split("/").pop() ?? path,
        mimeType: path.endsWith(".mp4") ? "video/mp4" : "image/png",
        viewer: path.endsWith(".mp4") ? "video" : "image",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true,
        size: path.endsWith(".mp4") ? 16 : 12
      }
    }));
    mockedApi.fetchOriginalFile.mockResolvedValue({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      mimeType: "image/png",
      filename: "photo.png"
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.png/i }));
    const imagePreview = await screen.findByRole("dialog", { name: /Preview photo.png/i });
    await within(imagePreview).findByAltText("photo.png");
    await waitFor(() => expect(mockedApi.getFile).toHaveBeenCalledWith("Archive/photo.png", "token-alpha", expect.any(AbortSignal)));
    expect(mockedApi.getFile).not.toHaveBeenCalledWith("Archive/z-clip.mp4", "token-alpha", expect.any(AbortSignal));

    within(imagePreview).getByRole("button", { name: /Next media item/i }).click();
    expect(await screen.findByRole("dialog", { name: /Preview z-clip.mp4/i })).toBeInTheDocument();
    expect(mockedApi.getFile).toHaveBeenCalledWith("Archive/z-clip.mp4", "token-alpha", expect.any(AbortSignal));
  });

  it("adds gallery next controls for photos and ignores oversized blobs for browser cache storage", async () => {
    const account = buildAccount("alpha", { displayName: "Gallery workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Archive/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" },
        { path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 18, mimeType: "audio/mpeg" }
      ]
    });
    mockedApi.getFile.mockImplementation(async (path: string) => ({
      file: {
        ...textPreview,
        path,
        name: path.split("/").pop() ?? path,
        mimeType: path.endsWith(".png") ? "image/png" : "audio/mpeg",
        viewer: path.endsWith(".png") ? "image" : "audio",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true,
        size: path.endsWith(".png") ? 12 : 20 * 1024 * 1024
      }
    }));
    mockedApi.fetchOriginalFile.mockImplementation(async (path: string) => ({
      blob: path.endsWith(".png")
        ? new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
        : new Blob([new Uint8Array(20 * 1024 * 1024)], { type: "audio/mpeg" }),
      mimeType: path.endsWith(".png") ? "image/png" : "audio/mpeg",
      filename: path.split("/").pop() ?? path
    }));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.png/i }));
    const previewDialog = await screen.findByRole("dialog", { name: /Preview photo.png/i });
    expect(within(previewDialog).getByRole("button", { name: /Next media item/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: " ", code: "Space" });
    const audioPreview = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
    await waitFor(() => expect(audioPreview.querySelector("audio")).toBeInTheDocument());
    expect(screen.queryByText(/offline cache copy is ready/i)).not.toBeInTheDocument();
    expect(mockedRetentionRepository.writePreview.mock.calls.some(([, input]) => input.file.path === "Projects/song.mp3" && input.blob instanceof Blob)).toBe(false);
    fireEvent.click(within(audioPreview).getByRole("button", { name: /Previous media item/i }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: /Preview photo.png/i })).toBeInTheDocument());
  });

  it("opens audio with a streaming URL before the full file is retained in the background", async () => {
    const account = buildAccount("alpha", { displayName: "Streaming workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Projects/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" },
        { path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 18, mimeType: "audio/mpeg" }
      ]
    });
    mockedApi.getFile.mockImplementation(async (path: string) => ({
      file: {
        ...textPreview,
        path,
        name: path.split("/").pop() ?? path,
        mimeType: path.endsWith(".png") ? "image/png" : "audio/mpeg",
        viewer: path.endsWith(".png") ? "image" : "audio",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true,
        size: path.endsWith(".png") ? 12 : 18
      }
    }));
    let releaseOriginalFetch!: () => void;
    const originalFetchStarted = vi.fn();
    mockedApi.fetchOriginalFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".png")) {
        return {
          blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
          mimeType: "image/png",
          filename: "photo.png"
        };
      }
      originalFetchStarted();
      await new Promise<void>((resolve) => {
        releaseOriginalFetch = resolve;
      });
      return {
        blob: new Blob([new Uint8Array([0, 1, 2, 3])], { type: "audio/mpeg" }),
        mimeType: "audio/mpeg",
        filename: "song.mp3"
      };
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.png/i }));
    const imagePreview = await screen.findByRole("dialog", { name: /Preview photo.png/i });
    within(imagePreview).getByRole("button", { name: /Next media item/i }).click();
    const previewDialog = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
    const audio = previewDialog.querySelector("audio");
    expect(audio).toHaveAttribute("src", "/api/file/stream?path=Projects%2Fsong.mp3&streamToken=stream-token-alpha");
    expect(within(previewDialog).getByText(/Streaming now\. An offline cache copy continues saving/i)).toBeInTheDocument();
    expect(originalFetchStarted).toHaveBeenCalledTimes(1);
    expect(mockedRetentionRepository.writePreview.mock.calls.some(([, input]) => input.file.path === "Projects/song.mp3" && input.blob instanceof Blob)).toBe(false);

    releaseOriginalFetch();
    await waitFor(() => expect(mockedRetentionRepository.writePreview.mock.calls.some(([, input]) => input.file.path === "Projects/song.mp3" && input.blob instanceof Blob)).toBe(true));
  });

  it("autoplays audio and video previews and pauses the previous media when switching", async () => {
    const account = buildAccount("alpha", { displayName: "Autoplay workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Projects/a-photo.png", name: "a-photo.png", isFolder: false, size: 12, mimeType: "image/png" },
        { path: "Projects/chapter.m4a", name: "chapter.m4a", isFolder: false, size: 18, mimeType: "audio/mp4" },
        { path: "Projects/clip.mp4", name: "clip.mp4", isFolder: false, size: 16, mimeType: "video/mp4" }
      ]
    });
    mockedApi.getFile.mockImplementation(async (path: string) => ({
      file: {
        ...textPreview,
        path,
        name: path.split("/").pop() ?? path,
        mimeType: path.endsWith(".png") ? "image/png" : path.endsWith(".m4a") ? "audio/mp4" : "video/mp4",
        viewer: path.endsWith(".png") ? "image" : path.endsWith(".m4a") ? "audio" : "video",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true,
        size: path.endsWith(".png") ? 12 : path.endsWith(".m4a") ? 18 : 16
      }
    }));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file clip.mp4/i }));
    const initialVideoPreview = await screen.findByRole("dialog", { name: /Preview clip.mp4/i });
    const initialVideo = within(initialVideoPreview).getByLabelText<HTMLVideoElement>(/Video preview clip.mp4/i);
    expect(initialVideo.autoplay).toBe(true);
    expect(initialVideo.muted).toBe(false);
    expect(initialVideo.playsInline).toBe(true);
    fireEvent.click(within(initialVideoPreview).getByRole("button", { name: /Back to files/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Preview clip.mp4/i })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Open file a-photo.png/i }));
    const imagePreview = await screen.findByRole("dialog", { name: /Preview a-photo.png/i });
    mediaPlayMock.mockClear();
    mediaPauseMock.mockClear();
    fireEvent.click(within(imagePreview).getByRole("button", { name: /Next media item/i }));
    const audioPreview = await screen.findByRole("dialog", { name: /Preview chapter.m4a/i });
    const audio = audioPreview.querySelector<HTMLAudioElement>("audio");
    expect(audio).not.toBeNull();
    if (!audio) throw new Error("Audio preview element is missing.");
    expect(audio.autoplay).toBe(true);
    await waitFor(() => expect(mediaPlayMock).toHaveBeenCalledTimes(1));

    fireEvent.click(within(audioPreview).getByRole("button", { name: /Next media item/i }));
    const videoPreview = await screen.findByRole("dialog", { name: /Preview clip.mp4/i });
    const video = within(videoPreview).getByLabelText<HTMLVideoElement>(/Video preview clip.mp4/i);
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(false);
    expect(video.playsInline).toBe(true);
    await waitFor(() => expect(mediaPauseMock).toHaveBeenCalled());
    await waitFor(() => expect(mediaPlayMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    mediaPauseMock.mockClear();
    fireEvent.click(within(videoPreview).getByRole("button", { name: /Back to files/i }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Preview clip.mp4/i })).not.toBeInTheDocument());
    await waitFor(() => expect(mediaPauseMock).toHaveBeenCalledTimes(1));
  });

  it("navigates from audio preview back to the previous media item", async () => {
    const account = buildAccount("alpha", { displayName: "Gallery workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Projects/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" },
        { path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 18, mimeType: "audio/mpeg" }
      ]
    });
    mockedApi.getFile.mockImplementation(async (path: string) => ({
      file: {
        ...textPreview,
        path,
        name: path.split("/").pop() ?? path,
        mimeType: path.endsWith(".png") ? "image/png" : "audio/mpeg",
        viewer: path.endsWith(".png") ? "image" : "audio",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true,
        size: path.endsWith(".png") ? 12 : 18
      }
    }));
    mockedApi.fetchOriginalFile.mockImplementation(async (path: string) => ({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: path.endsWith(".png") ? "image/png" : "audio/mpeg" }),
      mimeType: path.endsWith(".png") ? "image/png" : "audio/mpeg",
      filename: path.split("/").pop() ?? path
    }));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.png/i }));
    const photoPreview = await screen.findByRole("dialog", { name: /Preview photo.png/i });
    fireEvent.click(within(photoPreview).getByRole("button", { name: /Next media item/i }));
    const audioPreview = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
    fireEvent.click(within(audioPreview).getByRole("button", { name: /Previous media item/i }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: /Preview photo.png/i })).toBeInTheDocument());
  });

});
