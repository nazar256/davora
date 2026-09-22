import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VideoPreviewRuntimePorts } from "./ports";
import { VideoPreviewStage } from "./VideoPreviewStage";
import { useVideoPreviewInteraction } from "./useVideoPreviewInteraction";

function requireVideoElement(element: HTMLElement): HTMLVideoElement {
  if (!(element instanceof HTMLVideoElement)) {
    throw new Error("Expected an HTMLVideoElement");
  }
  return element;
}

function createTestPorts(): VideoPreviewRuntimePorts & {
  timeoutCallbacks: Array<() => void>;
  clearTimeoutMock: ReturnType<typeof vi.fn>;
  setTimeoutMock: ReturnType<typeof vi.fn>;
} {
  const timeoutCallbacks: Array<() => void> = [];
  const clearTimeoutMock = vi.fn();
  const setTimeoutMock = vi.fn((callback: () => void, _delayMs: number) => {
    timeoutCallbacks.push(callback);
    return timeoutCallbacks.length;
  });

  return {
    timeoutCallbacks,
    clearTimeoutMock,
    setTimeoutMock,
    setTimeout: setTimeoutMock,
    clearTimeout: clearTimeoutMock,
    getLocationHref: () => "https://davora.test/"
  };
}

function Harness({
  blobUrl,
  enabled = true,
  filePath = "Projects/clip.mp4",
  muted = false,
  onMediaPlaybackChange = vi.fn(),
  onMutedChange,
  ports
}: {
  blobUrl: string;
  enabled?: boolean;
  filePath?: string;
  muted?: boolean;
  onMediaPlaybackChange?: (playing: boolean) => void;
  onMutedChange?: (muted: boolean) => void;
  ports: ReturnType<typeof createTestPorts>;
}) {
  const interaction = useVideoPreviewInteraction({
    source: { enabled, blobUrl, filePath },
    muted,
    onMediaPlaybackChange,
    onMutedChange,
    ports
  });

  return (
    <>
      <output data-testid="stream-state">{interaction.stage.streamState}</output>
      <output data-testid="retry-attempt">{String(interaction.stage.retryAttempt)}</output>
      <output data-testid="autoplay-blocked">{String(interaction.stage.autoplayBlocked)}</output>
      <output data-testid="effective-source">{interaction.stage.effectiveSource ?? ""}</output>
      <output data-testid="overlay-visible">{String(interaction.overlay.visible)}</output>
      <output data-testid="overlay-playing">{String(interaction.overlay.playing)}</output>
      <VideoPreviewStage fileName="clip.mp4" interaction={interaction} />
    </>
  );
}

describe("useVideoPreviewInteraction", () => {
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
    vi.useRealTimers();
  });

  it("clears scheduled retry timers on unmount", async () => {
    const ports = createTestPorts();
    const { getByLabelText, unmount } = render(
      <Harness blobUrl="/api/file/stream?path=Projects%2Fclip.mp4&streamToken=token" ports={ports} />
    );
    const video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    fireEvent.error(video);
    expect(ports.setTimeoutMock).toHaveBeenCalledTimes(1);
    unmount();
    expect(ports.clearTimeoutMock).toHaveBeenCalled();
  });

  it("clears scheduled retry timers when switching to a new source", async () => {
    const ports = createTestPorts();
    const { getByLabelText, getByTestId, rerender } = render(
      <Harness blobUrl="/api/file/stream?path=Projects%2Fclip.mp4&streamToken=token" ports={ports} />
    );
    const video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    fireEvent.error(video);
    expect(ports.setTimeoutMock).toHaveBeenCalledTimes(1);

    rerender(
      <Harness blobUrl="/api/file/stream?path=Projects%2Fother.mp4&streamToken=token" filePath="Projects/other.mp4" ports={ports} />
    );
    expect(ports.clearTimeoutMock).toHaveBeenCalled();
    expect(getByTestId("stream-state")).toHaveTextContent("idle");
    expect(getByTestId("retry-attempt")).toHaveTextContent("0");
  });

  it("applies the muted binding and reports user volume changes", () => {
    const onMutedChange = vi.fn();
    const ports = createTestPorts();
    const { getByLabelText, rerender } = render(
      <Harness
        blobUrl="/api/file/stream?path=Projects%2Fclip.mp4&streamToken=token"
        muted
        onMutedChange={onMutedChange}
        ports={ports}
      />
    );
    const video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    expect(video.muted).toBe(true);

    video.muted = false;
    fireEvent(video, new Event("volumechange"));
    expect(onMutedChange).toHaveBeenCalledWith(false);

    rerender(
      <Harness
        blobUrl="/api/file/stream?path=Projects%2Fother.mp4&streamToken=token"
        filePath="Projects/other.mp4"
        onMutedChange={onMutedChange}
        ports={ports}
      />
    );
    const next = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    expect(next.muted).toBe(false);
  });

  it("pauses playback and reports stop on teardown", async () => {
    const onMediaPlaybackChange = vi.fn();
    const ports = createTestPorts();
    const { rerender } = render(
      <Harness
        blobUrl="/api/file/stream?path=Projects%2Fclip.mp4&streamToken=token"
        onMediaPlaybackChange={onMediaPlaybackChange}
        ports={ports}
      />
    );
    await waitFor(() => expect(mediaPlayMock).toHaveBeenCalled());
    mediaPauseMock.mockClear();
    onMediaPlaybackChange.mockClear();

    rerender(
      <Harness
        blobUrl="/api/file/stream?path=Projects%2Fother.mp4&streamToken=token"
        enabled={false}
        filePath="Projects/other.mp4"
        onMediaPlaybackChange={onMediaPlaybackChange}
        ports={ports}
      />
    );

    expect(mediaPauseMock).toHaveBeenCalled();
    expect(onMediaPlaybackChange).toHaveBeenCalledWith(false);
  });

  it("retries stream playback with bounded backoff and manual retry reset", async () => {
    const ports = createTestPorts();
    vi.useFakeTimers();
    const { getByLabelText, getByRole, getByTestId, getByText } = render(
      <Harness blobUrl="/api/file/stream?path=Projects%2Fclip.mp4&streamToken=token" ports={ports} />
    );

    let video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    expect(getByTestId("effective-source")).toHaveTextContent("/api/file/stream?path=Projects%2Fclip.mp4&streamToken=token");

    fireEvent.error(video);
    expect(getByText(/Stream interrupted\. Retrying playback shortly \(1\/3\)/i)).toBeInTheDocument();
    await act(async () => {
      ports.timeoutCallbacks[0]?.();
    });
    video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    expect(video).toHaveAttribute("src", expect.stringContaining("streamRetry=1"));

    fireEvent.error(video);
    expect(getByText(/Stream interrupted\. Retrying playback shortly \(2\/3\)/i)).toBeInTheDocument();
    await act(async () => {
      ports.timeoutCallbacks[1]?.();
    });
    video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    expect(video).toHaveAttribute("src", expect.stringContaining("streamRetry=2"));

    fireEvent.error(video);
    expect(getByText(/Stream interrupted\. Retrying playback shortly \(3\/3\)/i)).toBeInTheDocument();
    await act(async () => {
      ports.timeoutCallbacks[2]?.();
    });
    video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    expect(video).toHaveAttribute("src", expect.stringContaining("streamRetry=3"));

    fireEvent.error(video);
    expect(getByText(/Media playback could not continue after several retries/i)).toBeInTheDocument();
    fireEvent.click(getByRole("button", { name: /Retry playback/i }));
    video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    expect(video).toHaveAttribute("src", expect.stringContaining("streamRetry=4"));
    expect(getByTestId("stream-state")).toHaveTextContent("buffering");
  });

  it("hides overlay controls once playback starts and keeps them visible while paused", async () => {
    const ports = createTestPorts();
    const { getByLabelText, getByTestId } = render(
      <Harness blobUrl="/api/file/stream?path=Projects%2Fclip.mp4&streamToken=token" ports={ports} />
    );
    const video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));

    expect(getByTestId("overlay-visible")).toHaveTextContent("true");
    expect(getByTestId("overlay-playing")).toHaveTextContent("false");
    expect(ports.setTimeoutMock).not.toHaveBeenCalled();

    fireEvent(video, new Event("playing"));
    expect(getByTestId("overlay-playing")).toHaveTextContent("true");
    expect(getByTestId("overlay-visible")).toHaveTextContent("false");
    expect(ports.setTimeoutMock).not.toHaveBeenCalled();
  });

  it("reveals overlay controls on stage activity and reschedules the hide during playback", async () => {
    const ports = createTestPorts();
    const { container, getByLabelText, getByTestId } = render(
      <Harness blobUrl="/api/file/stream?path=Projects%2Fclip.mp4&streamToken=token" ports={ports} />
    );
    const video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    const stage = container.querySelector(".preview-media-stage");
    if (!(stage instanceof HTMLElement)) {
      throw new Error("Expected the media stage element.");
    }

    fireEvent(video, new Event("playing"));
    expect(getByTestId("overlay-visible")).toHaveTextContent("false");

    fireEvent.pointerDown(video);
    expect(getByTestId("overlay-visible")).toHaveTextContent("true");
    expect(ports.setTimeoutMock).toHaveBeenCalledTimes(1);
    expect(ports.setTimeoutMock).toHaveBeenLastCalledWith(expect.any(Function), 3000);

    await act(async () => {
      ports.timeoutCallbacks[0]?.();
    });
    expect(getByTestId("overlay-visible")).toHaveTextContent("false");

    fireEvent.pointerMove(stage);
    expect(getByTestId("overlay-visible")).toHaveTextContent("true");
    expect(ports.setTimeoutMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a rescheduled overlay hide callback inert for the superseded timer", async () => {
    const ports = createTestPorts();
    const { container, getByLabelText, getByTestId } = render(
      <Harness blobUrl="/api/file/stream?path=Projects%2Fclip.mp4&streamToken=token" ports={ports} />
    );
    const video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    const stage = container.querySelector(".preview-media-stage");
    if (!(stage instanceof HTMLElement)) {
      throw new Error("Expected the media stage element.");
    }

    fireEvent(video, new Event("playing"));
    fireEvent.pointerDown(video);
    fireEvent.pointerMove(stage);
    expect(ports.setTimeoutMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      ports.timeoutCallbacks[0]?.();
    });
    expect(getByTestId("overlay-visible")).toHaveTextContent("true");

    await act(async () => {
      ports.timeoutCallbacks[1]?.();
    });
    expect(getByTestId("overlay-visible")).toHaveTextContent("false");
  });

  it("pins overlay controls visible on pause and stops scheduling hides", async () => {
    const ports = createTestPorts();
    const { getByLabelText, getByTestId } = render(
      <Harness blobUrl="/api/file/stream?path=Projects%2Fclip.mp4&streamToken=token" ports={ports} />
    );
    const video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));

    fireEvent(video, new Event("playing"));
    fireEvent.pointerDown(video);
    expect(ports.setTimeoutMock).toHaveBeenCalledTimes(1);

    fireEvent(video, new Event("pause"));
    expect(getByTestId("overlay-playing")).toHaveTextContent("false");
    expect(getByTestId("overlay-visible")).toHaveTextContent("true");
    expect(ports.clearTimeoutMock).toHaveBeenCalled();

    fireEvent.pointerDown(video);
    expect(getByTestId("overlay-visible")).toHaveTextContent("true");
    expect(ports.setTimeoutMock).toHaveBeenCalledTimes(1);
  });

  it("keeps overlay controls visible after playback ends", async () => {
    const ports = createTestPorts();
    const { getByLabelText, getByTestId } = render(
      <Harness blobUrl="/api/file/stream?path=Projects%2Fclip.mp4&streamToken=token" ports={ports} />
    );
    const video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));

    fireEvent(video, new Event("playing"));
    fireEvent.pointerDown(video);
    expect(ports.setTimeoutMock).toHaveBeenCalledTimes(1);

    fireEvent(video, new Event("ended"));
    expect(getByTestId("overlay-playing")).toHaveTextContent("false");
    expect(getByTestId("overlay-visible")).toHaveTextContent("true");
    expect(ports.clearTimeoutMock).toHaveBeenCalled();
  });

  it("clears the overlay hide timer on unmount", async () => {
    const ports = createTestPorts();
    const { getByLabelText, unmount } = render(
      <Harness blobUrl="/api/file/stream?path=Projects%2Fclip.mp4&streamToken=token" ports={ports} />
    );
    const video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    fireEvent(video, new Event("playing"));
    fireEvent.pointerDown(video);
    expect(ports.setTimeoutMock).toHaveBeenCalledTimes(1);
    ports.clearTimeoutMock.mockClear();

    unmount();
    expect(ports.clearTimeoutMock).toHaveBeenCalled();
  });

  it("resets overlay visibility when the source changes", async () => {
    const ports = createTestPorts();
    const { getByLabelText, getByTestId, rerender } = render(
      <Harness blobUrl="/api/file/stream?path=Projects%2Fclip.mp4&streamToken=token" ports={ports} />
    );
    const video = requireVideoElement(getByLabelText(/Video preview clip.mp4/i));
    fireEvent(video, new Event("playing"));
    fireEvent.pointerDown(video);
    expect(getByTestId("overlay-visible")).toHaveTextContent("true");
    await act(async () => {
      ports.timeoutCallbacks[0]?.();
    });
    expect(getByTestId("overlay-visible")).toHaveTextContent("false");

    rerender(
      <Harness blobUrl="/api/file/stream?path=Projects%2Fother.mp4&streamToken=token" filePath="Projects/other.mp4" ports={ports} />
    );
    expect(getByTestId("overlay-playing")).toHaveTextContent("false");
    expect(getByTestId("overlay-visible")).toHaveTextContent("true");
  });

  it("surfaces autoplay-blocked fallback and clears it after manual play", async () => {
    mediaPlayMock.mockRejectedValueOnce(new DOMException("Autoplay blocked", "NotAllowedError"));
    const ports = createTestPorts();
    const { findByText, getByRole, getByTestId, queryByText } = render(
      <Harness blobUrl="/api/file/stream?path=Projects%2Fclip.mp4&streamToken=token" ports={ports} />
    );

    expect(await findByText(/Autoplay was blocked by the browser/i)).toBeInTheDocument();
    expect(getByTestId("autoplay-blocked")).toHaveTextContent("true");

    mediaPlayMock.mockResolvedValueOnce(undefined);
    fireEvent.click(getByRole("button", { name: /Play media/i }));
    await waitFor(() => expect(queryByText(/Autoplay was blocked by the browser/i)).not.toBeInTheDocument());
    expect(getByTestId("autoplay-blocked")).toHaveTextContent("false");
  });
});
