import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FolderAudioBrowseMount } from "./FolderAudioBrowseMount";
import { folderAudioBrowsePanelClassName } from "./presentation";
import type { FolderAudioRuntimePorts } from "./ports";
import { useFolderAudioMount } from "./useFolderAudioMount";

function createTestPorts(): FolderAudioRuntimePorts & { storageMap: Map<string, string> } {
  const storageMap = new Map<string, string>();
  return {
    storageMap,
    storage: {
      getItem: (key) => storageMap.get(key) ?? null,
      setItem: (key, value) => {
        storageMap.set(key, value);
      },
      removeItem: (key) => {
        storageMap.delete(key);
      }
    },
    createStreamingFileUrl: vi.fn(async (path: string) => `/api/file/stream?path=${encodeURIComponent(path)}&streamToken=token`),
    nowIso: () => "2026-07-21T12:00:00.000Z",
    loadAudioPreviewPosition: () => undefined,
    saveAudioPreviewPosition: () => undefined
  };
}

function MountHarness({
  ports,
  expose
}: {
  ports: ReturnType<typeof createTestPorts>;
  expose?: (value: ReturnType<typeof useFolderAudioMount>) => void;
}) {
  const mount = useFolderAudioMount({
    context: {
      accountId: "alpha",
      folderPath: "Projects",
      folderLabel: "Projects",
      token: "token-alpha",
      cacheOnlyMode: false,
      visibleItems: [{ path: "Projects/chapter.m4a", name: "chapter.m4a", mimeType: "audio/mp4" }]
    },
    ports
  });
  expose?.(mount);

  return (
    <section className={folderAudioBrowsePanelClassName(mount.hasPlayer)}>
      <FolderAudioBrowseMount interaction={mount.interaction} />
      <output data-testid="playing">{String(mount.playing)}</output>
      <button onClick={() => mount.interaction.activate({ path: "Projects/chapter.m4a", name: "chapter.m4a", mimeType: "audio/mp4" })} type="button">Activate chapter</button>
    </section>
  );
}

describe("useFolderAudioMount", () => {
  let mediaPlayMock: ReturnType<typeof vi.fn>;
  let mediaPauseMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mediaPlayMock = vi.fn(async () => undefined);
    mediaPauseMock = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(mediaPlayMock);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(mediaPauseMock);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("mounts the browse player and panel class when stage is active", async () => {
    const ports = createTestPorts();
    const { container } = render(<MountHarness ports={ports} />);
    const panel = container.querySelector("section");
    expect(panel).toHaveClass("file-browser-panel");
    expect(panel).not.toHaveClass("has-folder-audio-player");

    fireEvent.click(screen.getByRole("button", { name: /Activate chapter/i }));
    await waitFor(() => expect(screen.getByRole("region", { name: /Audio playlist for Projects/i })).toBeInTheDocument());
    expect(panel).toHaveClass("file-browser-panel", "has-folder-audio-player");
  });

  it("feeds playing state for wake-lock composition", async () => {
    const ports = createTestPorts();
    let mount: ReturnType<typeof useFolderAudioMount> | undefined;
    render(<MountHarness expose={(value) => { mount = value; }} ports={ports} />);

    fireEvent.click(screen.getByRole("button", { name: /Activate chapter/i }));
    const player = await screen.findByRole("region", { name: /Audio playlist for Projects/i });
    const audio = player.querySelector("audio");
    if (!(audio instanceof HTMLAudioElement)) {
      throw new Error("Expected audio element");
    }
    fireEvent.play(audio);
    await waitFor(() => expect(mount?.playing).toBe(true));
  });

  it("exposes preview-open sources that pause and activate folder audio", async () => {
    const ports = createTestPorts();
    let mount: ReturnType<typeof useFolderAudioMount> | undefined;
    render(<MountHarness expose={(value) => { mount = value; }} ports={ports} />);

    fireEvent.click(screen.getByRole("button", { name: /Activate chapter/i }));
    await screen.findByRole("region", { name: /Audio playlist for Projects/i });

    mount?.previewOpenSources.pause();
    expect(mediaPauseMock).toHaveBeenCalled();

    mediaPauseMock.mockClear();
    mount?.previewOpenSources.activate({ path: "Projects/chapter.m4a", name: "chapter.m4a", mimeType: "audio/mp4", isFolder: false });
    await waitFor(() => expect(mediaPlayMock).toHaveBeenCalled());
  });

  it("pauses folder audio when preview media starts playing", async () => {
    const ports = createTestPorts();
    let mount: ReturnType<typeof useFolderAudioMount> | undefined;
    const onPreviewPlayingChange = vi.fn();
    render(<MountHarness expose={(value) => { mount = value; }} ports={ports} />);

    fireEvent.click(screen.getByRole("button", { name: /Activate chapter/i }));
    await screen.findByRole("region", { name: /Audio playlist for Projects/i });

    const handlePreviewMediaPlaybackChange = mount?.bindPreviewMediaPlaybackChange(onPreviewPlayingChange);
    act(() => {
      handlePreviewMediaPlaybackChange?.(true);
    });

    expect(onPreviewPlayingChange).toHaveBeenCalledWith(true);
    expect(mediaPauseMock).toHaveBeenCalled();
  });

  it("does not pause folder audio when preview media stops", async () => {
    const ports = createTestPorts();
    let mount: ReturnType<typeof useFolderAudioMount> | undefined;
    const onPreviewPlayingChange = vi.fn();
    render(<MountHarness expose={(value) => { mount = value; }} ports={ports} />);

    fireEvent.click(screen.getByRole("button", { name: /Activate chapter/i }));
    await screen.findByRole("region", { name: /Audio playlist for Projects/i });
    mediaPauseMock.mockClear();

    const handlePreviewMediaPlaybackChange = mount?.bindPreviewMediaPlaybackChange(onPreviewPlayingChange);
    act(() => {
      handlePreviewMediaPlaybackChange?.(false);
    });

    expect(onPreviewPlayingChange).toHaveBeenCalledWith(false);
    expect(mediaPauseMock).not.toHaveBeenCalled();
  });

  it("supports explicit-offline exclusive pause via pauseForExclusivePlayback", async () => {
    const ports = createTestPorts();
    let mount: ReturnType<typeof useFolderAudioMount> | undefined;
    render(<MountHarness expose={(value) => { mount = value; }} ports={ports} />);

    fireEvent.click(screen.getByRole("button", { name: /Activate chapter/i }));
    await screen.findByRole("region", { name: /Audio playlist for Projects/i });
    mediaPauseMock.mockClear();

    act(() => {
      mount?.pauseForExclusivePlayback();
    });
    expect(mediaPauseMock).toHaveBeenCalled();
  });
});
