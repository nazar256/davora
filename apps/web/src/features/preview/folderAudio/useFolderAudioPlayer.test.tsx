import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { folderAudioStorageKey } from "./model";
import type { FolderAudioRuntimePorts } from "./ports";
import { FolderAudioPlayerStage } from "./FolderAudioPlayerStage";
import { useFolderAudioPlayer } from "./useFolderAudioPlayer";

function requireAudioElement(element: HTMLElement | null): HTMLAudioElement {
  if (!(element instanceof HTMLAudioElement)) {
    throw new Error("Expected an HTMLAudioElement");
  }
  return element;
}

function createTestPorts(overrides: Partial<FolderAudioRuntimePorts> = {}): FolderAudioRuntimePorts & {
  storageMap: Map<string, string>;
  savedPreviewPositions: Map<string, number>;
} {
  const storageMap = new Map<string, string>();
  const savedPreviewPositions = new Map<string, number>();

  return {
    storageMap,
    savedPreviewPositions,
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
    loadAudioPreviewPosition: ({ accountId, path }) => savedPreviewPositions.get(`${accountId}:${path}`),
    saveAudioPreviewPosition: ({ accountId, path }, positionSeconds) => {
      savedPreviewPositions.set(`${accountId}:${path}`, positionSeconds);
    },
    ...overrides
  };
}

function Harness({
  accountId = "alpha",
  folderPath = "Projects",
  folderLabel = "Projects",
  token = "token-alpha",
  cacheOnlyMode = false,
  visibleItems = [
    { path: "Projects/chapter.m4a", name: "chapter.m4a", mimeType: "audio/mp4" },
    { path: "Projects/Привіт.m4a", name: "Привіт.m4a", mimeType: "audio/mp4" }
  ],
  onPlayingChange = vi.fn(),
  ports,
  expose
}: {
  accountId?: string;
  folderPath?: string;
  folderLabel?: string;
  token?: string;
  cacheOnlyMode?: boolean;
  visibleItems?: Array<{ path: string; name: string; mimeType?: string; size?: number; isFolder?: boolean }>;
  onPlayingChange?: (playing: boolean) => void;
  ports: ReturnType<typeof createTestPorts>;
  expose?: (interaction: ReturnType<typeof useFolderAudioPlayer>) => void;
}) {
  const interaction = useFolderAudioPlayer({
    context: accountId
      ? { accountId, folderPath, folderLabel, token, cacheOnlyMode, visibleItems }
      : undefined,
    onPlayingChange,
    ports
  });
  expose?.(interaction);

  return (
    <>
      <output data-testid="playing">{String(interaction.playing)}</output>
      <button onClick={() => interaction.activate({ path: "Projects/chapter.m4a", name: "chapter.m4a", mimeType: "audio/mp4" })} type="button">Activate chapter</button>
      <button onClick={() => interaction.activate({ path: "Projects/Привіт.m4a", name: "Привіт.m4a", mimeType: "audio/mp4" })} type="button">Activate greeting</button>
      <button onClick={() => interaction.pause()} type="button">Pause folder audio</button>
      <FolderAudioPlayerStage interaction={interaction} />
    </>
  );
}

describe("useFolderAudioPlayer", () => {
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

  it("persists and restores playlist state until dismissed", async () => {
    const ports = createTestPorts();
    const { getByRole, getByTestId, unmount } = render(<Harness ports={ports} />);

    fireEvent.click(getByRole("button", { name: /Activate chapter/i }));
    const player = await waitFor(() => getByRole("region", { name: /Audio playlist for Projects/i }));
    const audio = requireAudioElement(player.querySelector("audio"));
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 42 });
    Object.defineProperty(audio, "duration", { configurable: true, writable: true, value: 180 });
    fireEvent(audio, new Event("loadedmetadata"));
    fireEvent.timeUpdate(audio);

    expect(JSON.parse(ports.storageMap.get(folderAudioStorageKey("alpha", "Projects")) ?? "{}")).toMatchObject({
      accountId: "alpha",
      folderPath: "Projects",
      currentPath: "Projects/chapter.m4a",
      positionSeconds: 42,
      durationSeconds: 180
    });

    unmount();
    render(<Harness ports={ports} />);
    const restored = await waitFor(() => getByRole("region", { name: /Audio playlist for Projects/i }));
    expect(restored).toHaveTextContent("chapter.m4a");

    fireEvent.click(getByRole("button", { name: /Close folder audio player/i }));
    await waitFor(() => expect(getByTestId("playing")).toHaveTextContent("false"));
    expect(JSON.parse(ports.storageMap.get(folderAudioStorageKey("alpha", "Projects")) ?? "{}")).toMatchObject({ dismissed: true });
  });

  it("bridges resume position through preview-position ports", async () => {
    const ports = createTestPorts();
    ports.savedPreviewPositions.set("alpha:Projects/Привіт.m4a", 33);

    render(<Harness ports={ports} />);
    fireEvent.click(screen.getByRole("button", { name: /Activate greeting/i }));

    await waitFor(() => expect(ports.createStreamingFileUrl).toHaveBeenCalledWith("Projects/Привіт.m4a", "token-alpha"));
    const player = await screen.findByRole("region", { name: /Audio playlist for Projects/i });
    const audio = requireAudioElement(player.querySelector("audio"));
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 0 });
    Object.defineProperty(audio, "duration", { configurable: true, writable: true, value: 120 });
    fireEvent(audio, new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(33);
    fireEvent.timeUpdate(audio);
    expect(ports.savedPreviewPositions.get("alpha:Projects/Привіт.m4a")).toBe(33);
  });

  it("does not let a stale folder-audio callback resurrect removed account state", async () => {
    const ports = createTestPorts();
    let staleTimeUpdate: ((audio: HTMLAudioElement) => void) | undefined;
    const { rerender } = render(<Harness ports={ports} expose={(interaction) => {
      if (interaction.stage?.onTimeUpdate) {
        staleTimeUpdate = interaction.stage.onTimeUpdate;
      }
    }} />);
    fireEvent.click(screen.getByRole("button", { name: /Activate chapter/i }));
    const player = await screen.findByRole("region", { name: /Audio playlist for Projects/i });
    const audio = requireAudioElement(player.querySelector("audio"));
    await waitFor(() => expect(staleTimeUpdate).toBeTypeOf("function"));

    ports.storageMap.delete(folderAudioStorageKey("alpha", "Projects"));
    ports.savedPreviewPositions.delete("alpha:Projects/chapter.m4a");
    rerender(<Harness accountId="" ports={ports} />);
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 48 });
    act(() => staleTimeUpdate?.(audio));

    expect(ports.storageMap.has(folderAudioStorageKey("alpha", "Projects"))).toBe(false);
    expect(ports.savedPreviewPositions.has("alpha:Projects/chapter.m4a")).toBe(false);
  });

  it("exposes playing state and pause for exclusive playback coordination", async () => {
    const onPlayingChange = vi.fn();
    const ports = createTestPorts();
    let interaction: ReturnType<typeof useFolderAudioPlayer> | undefined;
    render(<Harness expose={(value) => { interaction = value; }} onPlayingChange={onPlayingChange} ports={ports} />);

    fireEvent.click(screen.getByRole("button", { name: /Activate chapter/i }));
    const player = await screen.findByRole("region", { name: /Audio playlist for Projects/i });
    const audio = requireAudioElement(player.querySelector("audio"));
    fireEvent.play(audio);
    await waitFor(() => expect(onPlayingChange).toHaveBeenCalledWith(true));

    act(() => {
      interaction?.pause();
    });
    expect(mediaPauseMock).toHaveBeenCalled();
    await waitFor(() => expect(onPlayingChange).toHaveBeenCalledWith(false));
  });

  it("reports stream unavailability without retrying playback", async () => {
    const ports = createTestPorts({
      createStreamingFileUrl: vi.fn(async () => {
        throw new Error("stream unavailable");
      })
    });

    render(<Harness ports={ports} />);
    fireEvent.click(screen.getByRole("button", { name: /Activate chapter/i }));
    const player = await screen.findByRole("region", { name: /Audio playlist for Projects/i });

    await waitFor(() => expect(player).toHaveTextContent(/Audio stream is unavailable right now/i));
    expect(within(player).getByRole("button", { name: /Play folder audio/i })).toBeDisabled();
    expect(mediaPlayMock).not.toHaveBeenCalled();
    expect(ports.createStreamingFileUrl).toHaveBeenCalledTimes(1);
  });

  it("shows autoplay-blocked fallback and allows manual play", async () => {
    const ports = createTestPorts();
    mediaPlayMock.mockRejectedValueOnce(new DOMException("Autoplay blocked", "NotAllowedError"));

    render(<Harness ports={ports} />);
    fireEvent.click(screen.getByRole("button", { name: /Activate chapter/i }));
    const player = await screen.findByRole("region", { name: /Audio playlist for Projects/i });

    await waitFor(() => expect(player).toHaveTextContent(/Playback was blocked by the browser/i));
    mediaPlayMock.mockClear();
    fireEvent.click(within(player).getByRole("button", { name: /Play folder audio/i }));
    await waitFor(() => expect(mediaPlayMock).toHaveBeenCalledTimes(1));
  });

  it("reuses the same stream when reactivating the current track", async () => {
    const ports = createTestPorts();
    render(<Harness ports={ports} />);

    fireEvent.click(screen.getByRole("button", { name: /Activate chapter/i }));
    await waitFor(() => expect(ports.createStreamingFileUrl).toHaveBeenCalledTimes(1));
    mediaPlayMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Activate chapter/i }));
    await waitFor(() => expect(mediaPlayMock).toHaveBeenCalledTimes(1));
    expect(ports.createStreamingFileUrl).toHaveBeenCalledTimes(1);
  });

  it("cancels stream requests when the folder path or account changes", async () => {
    const ports = createTestPorts();
    let resolveStream: ((url: string) => void) | undefined;
    ports.createStreamingFileUrl = vi.fn(() => new Promise<string>((resolve) => {
      resolveStream = resolve;
    }));

    const { rerender } = render(<Harness folderPath="Projects" ports={ports} />);
    fireEvent.click(screen.getByRole("button", { name: /Activate chapter/i }));
    expect(ports.createStreamingFileUrl).toHaveBeenCalledTimes(1);

    rerender(<Harness folderPath="Archive" ports={ports} />);
    resolveStream?.("/api/file/stream?path=Projects%2Fchapter.m4a&streamToken=token-alpha");
    await act(async () => Promise.resolve());
    expect(screen.queryByRole("region", { name: /Audio playlist for Archive/i })).not.toBeInTheDocument();

    rerender(<Harness accountId="beta" folderPath="Projects" ports={ports} token="token-beta" />);
    await act(async () => Promise.resolve());
    expect(ports.createStreamingFileUrl).toHaveBeenCalledTimes(1);
  });
});
