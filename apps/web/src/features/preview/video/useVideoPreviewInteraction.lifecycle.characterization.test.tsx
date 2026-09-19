// @vitest-environment jsdom

import { StrictMode } from "react";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VideoPreviewStage,
  useVideoPreviewInteraction,
  type VideoPreviewStageBindings
} from "./index";
import type { VideoPreviewRuntimePorts } from "./ports";

interface ScheduledTimer {
  readonly callback: () => void;
  readonly delayMs: number;
  readonly id: number;
  active: boolean;
}

interface VideoLifecyclePorts extends VideoPreviewRuntimePorts {
  readonly clearTimeoutMock: ReturnType<typeof vi.fn>;
  readonly scheduled: ScheduledTimer[];
  readonly setTimeoutMock: ReturnType<typeof vi.fn>;
}

function createPorts(): VideoLifecyclePorts {
  const scheduled: ScheduledTimer[] = [];
  let nextId = 1;
  const setTimeoutMock = vi.fn((callback: () => void, delayMs: number) => {
    const timer: ScheduledTimer = {
      active: true,
      callback,
      delayMs,
      id: nextId
    };
    nextId += 1;
    scheduled.push(timer);
    return timer.id;
  });
  const clearTimeoutMock = vi.fn((timeoutId: number | undefined) => {
    const timer = scheduled.find((candidate) => candidate.id === timeoutId);
    if (timer) {
      timer.active = false;
    }
  });
  return {
    clearTimeout: clearTimeoutMock,
    clearTimeoutMock,
    getLocationHref: () => "https://davora.test/preview",
    scheduled,
    setTimeout: setTimeoutMock,
    setTimeoutMock
  };
}

interface VideoLifecycleHarnessProps {
  readonly blobUrl?: string;
  readonly enabled?: boolean;
  readonly filePath?: string;
  readonly mediaGeneration?: number;
  readonly ownerGeneration?: number;
  readonly onMediaPlaybackChange?: (playing: boolean) => void;
  readonly ports: VideoLifecyclePorts;
  readonly stageCapture?: { current?: VideoPreviewStageBindings };
}

function VideoLifecycleHarness({ ownerGeneration = 0, ...ownerProps }: VideoLifecycleHarnessProps) {
  return <VideoLifecycleOwner key={ownerGeneration} {...ownerProps} />;
}

function VideoLifecycleOwner({
  blobUrl,
  enabled = true,
  filePath = "Projects/clip.mp4",
  mediaGeneration = 0,
  onMediaPlaybackChange,
  ports,
  stageCapture
}: Omit<VideoLifecycleHarnessProps, "ownerGeneration">) {
  const interaction = useVideoPreviewInteraction({
    onMediaPlaybackChange,
    ports,
    source: {
      blobUrl,
      enabled,
      filePath
    }
  });
  if (stageCapture) {
    stageCapture.current = interaction.stage;
  }
  return (
    <>
      <output data-testid="stream-state">{interaction.stage.streamState}</output>
      <output data-testid="retry-attempt">{String(interaction.stage.retryAttempt)}</output>
      <output data-testid="effective-source">{interaction.stage.effectiveSource ?? ""}</output>
      <output data-testid="autoplay-blocked">{String(interaction.stage.autoplayBlocked)}</output>
      <div key={mediaGeneration}>
        <VideoPreviewStage fileName="clip.mp4" interaction={interaction} />
      </div>
    </>
  );
}

function videoElement(): HTMLVideoElement {
  const element = document.querySelector("video.media-preview-video");
  if (!(element instanceof HTMLVideoElement)) {
    throw new Error("Expected the video preview element.");
  }
  return element;
}

function streamSource(path = "Projects%2Fclip.mp4") {
  return `/api/file/stream?path=${path}&streamToken=opaque`;
}

function videoProps(
  blobUrl: string | undefined,
  ports: VideoLifecyclePorts,
  overrides: Partial<Omit<VideoLifecycleHarnessProps, "blobUrl" | "ports">> = {}
): VideoLifecycleHarnessProps {
  return {
    blobUrl,
    filePath: "Projects/clip.mp4",
    enabled: true,
    ports,
    ...overrides
  };
}

function fireTimer(timer: ScheduledTimer | undefined) {
  if (!timer) {
    return;
  }
  timer.active = false;
  timer.callback();
}

function invokeQueuedCallback(timer: ScheduledTimer | undefined) {
  timer?.callback();
}

function expectNoActiveTimers(ports: VideoLifecyclePorts) {
  expect(ports.scheduled.filter((timer) => timer.active)).toHaveLength(0);
}

async function flushMicrotasks() {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) {
      await Promise.resolve();
    }
  });
}

interface PendingPlay {
  readonly element: HTMLMediaElement;
  readonly promise: Promise<void>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: () => void;
}

function createPendingPlay(element: HTMLMediaElement): PendingPlay {
  let resolvePromise!: () => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    element,
    promise,
    reject: rejectPromise,
    resolve: resolvePromise
  };
}

describe("useVideoPreviewInteraction timer/media-currentness characterization", () => {
  let pausedElements: HTMLMediaElement[];

  beforeEach(() => {
    pausedElements = [];
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
      pausedElements.push(this);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("T01 current source/ports/media identity acquires one autoplay pipeline across harmless rerenders", async () => {
    const ports = createPorts();
    const onMediaPlaybackChange = vi.fn<(playing: boolean) => void>();
    const view = render(<VideoLifecycleHarness {...videoProps(streamSource(), ports, { onMediaPlaybackChange })} />);
    await flushMicrotasks();
    const initialVideo = videoElement();
    expect(vi.mocked(HTMLMediaElement.prototype.play)).toHaveBeenCalledTimes(1);

    view.rerender(<VideoLifecycleHarness {...videoProps(streamSource(), ports, { onMediaPlaybackChange })} />);
    await flushMicrotasks();

    expect(videoElement()).toBe(initialVideo);
    expect(vi.mocked(HTMLMediaElement.prototype.play)).toHaveBeenCalledTimes(1);
    expectNoActiveTimers(ports);
  });

  it("T02 current autoplay success, rejection, synchronous throw, and manual recovery retain the established fallback", async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const successPorts = createPorts();
    render(<VideoLifecycleHarness {...videoProps("blob:success", successPorts)} />);
    await flushMicrotasks();
    expect(screen.getByTestId("autoplay-blocked")).toHaveTextContent("false");
    cleanup();

    play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    const rejectionPorts = createPorts();
    render(<VideoLifecycleHarness {...videoProps("blob:rejected", rejectionPorts)} />);
    await flushMicrotasks();
    expect(screen.getByText(/Autoplay was blocked by the browser/i)).toBeInTheDocument();
    expect(screen.getByTestId("autoplay-blocked")).toHaveTextContent("true");
    cleanup();

    play.mockImplementationOnce(() => {
      throw new DOMException("blocked", "NotAllowedError");
    });
    const throwPorts = createPorts();
    render(<VideoLifecycleHarness {...videoProps("blob:throw", throwPorts)} />);
    await flushMicrotasks();
    expect(screen.getByText(/Autoplay was blocked by the browser/i)).toBeInTheDocument();
    play.mockResolvedValueOnce(undefined);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Play media" }));
      await Promise.resolve();
    });
    expect(screen.queryByText(/Autoplay was blocked by the browser/i)).not.toBeInTheDocument();
    expectNoActiveTimers(throwPorts);
  });

  const retiredAutoplayCases: Array<{
    readonly replacementVideo: "new" | "same" | "none";
    readonly label: string;
    readonly transition: (view: ReturnType<typeof render>, ports: VideoLifecyclePorts) => void;
  }> = [
    {
      replacementVideo: "new",
      label: "source replacement",
      transition: (view, ports) => {
        view.rerender(<VideoLifecycleHarness {...videoProps(streamSource("Projects%2Fother.mp4"), ports, { filePath: "Projects/other.mp4" })} />);
      }
    },
    {
      replacementVideo: "same",
      label: "file-path replacement",
      transition: (view, ports) => {
        view.rerender(<VideoLifecycleHarness {...videoProps(streamSource(), ports, { filePath: "Projects/other.mp4" })} />);
      }
    },
    {
      replacementVideo: "none",
      label: "disable",
      transition: (view, ports) => {
        view.rerender(<VideoLifecycleHarness {...videoProps(streamSource(), ports, { enabled: false })} />);
      }
    },
    {
      replacementVideo: "new",
      label: "runtime ports replacement",
      transition: (view) => {
        view.rerender(<VideoLifecycleHarness {...videoProps(streamSource(), createPorts(), { ownerGeneration: 1 })} />);
      }
    },
    {
      replacementVideo: "new",
      label: "media-element-only replacement",
      transition: (view, ports) => {
        view.rerender(<VideoLifecycleHarness {...videoProps(streamSource(), ports, { mediaGeneration: 1 })} />);
      }
    },
    {
      replacementVideo: "new",
      label: "unmount",
      transition: (view) => {
        view.unmount();
        render(<VideoLifecycleHarness {...videoProps(streamSource("Projects%2Freplacement.mp4"), createPorts(), { filePath: "Projects/replacement.mp4" })} />);
      }
    }
  ];

  for (const transitionCase of retiredAutoplayCases) {
    it(`T03 retired autoplay rejection is inert after ${transitionCase.label}`, async () => {
      const pending: PendingPlay[] = [];
      const play = vi.mocked(HTMLMediaElement.prototype.play);
      play.mockImplementation(function (this: HTMLMediaElement) {
        const deferred = createPendingPlay(this);
        pending.push(deferred);
        return deferred.promise;
      });
      const ports = createPorts();
      const view = render(<VideoLifecycleHarness {...videoProps(streamSource(), ports)} />);
      await flushMicrotasks();
      expect(pending).toHaveLength(1);
      const retiredVideo = videoElement();
      expect(pending[0]?.element).toBe(retiredVideo);
      expectNoActiveTimers(ports);

      transitionCase.transition(view, ports);
      await flushMicrotasks();
      if (transitionCase.replacementVideo === "new") {
        expect(videoElement()).not.toBe(retiredVideo);
      } else if (transitionCase.replacementVideo === "same") {
        expect(videoElement()).toBe(retiredVideo);
      } else {
        expect(document.querySelector("video.media-preview-video")).toBeNull();
      }

      pending[0]?.reject(new DOMException("stale", "NotAllowedError"));
      await flushMicrotasks();

      expect(screen.queryByText(/Autoplay was blocked by the browser/i)).not.toBeInTheDocument();
      expect(screen.getByTestId("autoplay-blocked")).toHaveTextContent("false");
      pending.slice(1).forEach((deferred) => deferred.resolve());
      await flushMicrotasks();
      expectNoActiveTimers(ports);
    });
  }

  it("T04 retired manual-play rejection cannot mark the replacement blocked while the current manual rejection still does", async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockRejectedValueOnce(new DOMException("autoplay", "NotAllowedError"));
    const ports = createPorts();
    let pendingManual!: PendingPlay;
    play.mockImplementationOnce(function (this: HTMLMediaElement) {
      pendingManual = createPendingPlay(this);
      return pendingManual.promise;
    });
    play.mockResolvedValue(undefined);
    const view = render(<VideoLifecycleHarness {...videoProps("blob:alpha", ports)} />);
    await flushMicrotasks();
    expect(screen.getByRole("button", { name: "Play media" })).toBeInTheDocument();

    const retiredVideo = videoElement();
    fireEvent.click(screen.getByRole("button", { name: "Play media" }));
    expect(pendingManual.element).toBe(retiredVideo);
    view.rerender(<VideoLifecycleHarness {...videoProps("blob:beta", ports)} />);
    expect(videoElement()).not.toBe(retiredVideo);
    pendingManual.reject(new DOMException("stale", "NotAllowedError"));
    await flushMicrotasks();
    expect(screen.getByTestId("autoplay-blocked")).toHaveTextContent("false");

    cleanup();
    play.mockRejectedValueOnce(new DOMException("autoplay", "NotAllowedError"));
    const currentPorts = createPorts();
    render(<VideoLifecycleHarness {...videoProps("blob:current", currentPorts)} />);
    await flushMicrotasks();
    play.mockRejectedValueOnce(new DOMException("manual", "NotAllowedError"));
    fireEvent.click(screen.getByRole("button", { name: "Play media" }));
    await flushMicrotasks();
    expect(screen.getByTestId("autoplay-blocked")).toHaveTextContent("true");
  });

  it("T05 cleanup pauses exactly the retiring media and reports one stop without touching the replacement", async () => {
    const oldPublish = vi.fn<(playing: boolean) => void>();
    const replacementPublish = vi.fn<(playing: boolean) => void>();
    const ports = createPorts();
    const stageCapture: { current?: VideoPreviewStageBindings } = {};
    const view = render(<VideoLifecycleHarness {...videoProps("blob:alpha", ports, { onMediaPlaybackChange: oldPublish, stageCapture })} />);
    await flushMicrotasks();
    const retiredVideo = videoElement();
    const retiredStage = stageCapture.current;
    expect(retiredStage).toBeDefined();
    fireEvent.playing(retiredVideo);
    expect(oldPublish).toHaveBeenCalledWith(true);
    oldPublish.mockClear();

    view.rerender(<VideoLifecycleHarness {...videoProps("blob:beta", ports, { onMediaPlaybackChange: replacementPublish, stageCapture })} />);
    await flushMicrotasks();
    const replacementVideo = videoElement();
    const replacementStage = stageCapture.current;
    expect(replacementStage).toBeDefined();
    act(() => {
      replacementStage?.onPlaying();
    });
    expect(replacementPublish).toHaveBeenCalledWith(true);
    replacementPublish.mockClear();
    expect(replacementVideo).not.toBe(retiredVideo);
    expect(pausedElements).toContain(retiredVideo);
    expect(oldPublish.mock.calls).toEqual([[false]]);
    expect(replacementPublish).not.toHaveBeenCalled();
    expect(pausedElements).not.toContain(replacementVideo);
    expectNoActiveTimers(ports);
  });

  it("T06 current media events preserve playback publication and stream waiting state", async () => {
    const publish = vi.fn<(playing: boolean) => void>();
    const ports = createPorts();
    render(<VideoLifecycleHarness {...videoProps(streamSource(), ports, { onMediaPlaybackChange: publish })} />);
    await flushMicrotasks();
    const video = videoElement();

    fireEvent.waiting(video);
    expect(screen.getByTestId("stream-state")).toHaveTextContent("buffering");
    fireEvent.canPlay(video);
    expect(screen.getByTestId("stream-state")).toHaveTextContent("idle");
    fireEvent.play(video);
    fireEvent.playing(video);
    fireEvent.pause(video);
    fireEvent.ended(video);
    fireEvent.error(video);

    expect(publish.mock.calls.map(([playing]) => playing)).toEqual([true, true, false, false, false]);
    expect(screen.getByTestId("stream-state")).toHaveTextContent("retrying");
    expect(ports.scheduled.filter((timer) => timer.active)).toHaveLength(1);
  });

  it("T07 current streaming retry uses the bounded delays, one current callback, and one retry URL per attempt", async () => {
    const ports = createPorts();
    render(<VideoLifecycleHarness {...videoProps(streamSource(), ports)} />);
    await flushMicrotasks();

    for (const [index, delayMs] of [500, 1000, 2000].entries()) {
      fireEvent.error(videoElement());
      expect(ports.scheduled[index]?.delayMs).toBe(delayMs);
      expect(screen.getByTestId("retry-attempt")).toHaveTextContent(String(index + 1));
      act(() => {
        fireTimer(ports.scheduled[index]);
      });
      await flushMicrotasks();
      expect(videoElement().getAttribute("src")).toContain(`streamRetry=${index + 1}`);
      expect(screen.getByTestId("stream-state")).toHaveTextContent("buffering");
    }
    expectNoActiveTimers(ports);
  });

  const retiredTimerCases: Array<{
    readonly label: string;
    readonly transition: (view: ReturnType<typeof render>, ports: VideoLifecyclePorts) => void;
  }> = [
    {
      label: "source replacement",
      transition: (view, ports) => {
        view.rerender(<VideoLifecycleHarness {...videoProps(streamSource("Projects%2Fother.mp4"), ports, { filePath: "Projects/other.mp4" })} />);
      }
    },
    {
      label: "file-path replacement with unchanged stream URL",
      transition: (view, ports) => {
        view.rerender(<VideoLifecycleHarness {...videoProps(streamSource(), ports, { filePath: "Projects/other.mp4" })} />);
      }
    },
    {
      label: "disable",
      transition: (view, ports) => {
        view.rerender(<VideoLifecycleHarness {...videoProps(streamSource(), ports, { enabled: false })} />);
      }
    },
      {
        label: "runtime ports replacement",
        transition: (view) => {
          view.rerender(<VideoLifecycleHarness {...videoProps(streamSource(), createPorts(), { ownerGeneration: 1 })} />);
        }
      },
      {
        label: "media-element-only replacement",
        transition: (view, ports) => {
          view.rerender(<VideoLifecycleHarness {...videoProps(streamSource(), ports, { mediaGeneration: 1 })} />);
        }
      }
  ];

  for (const timerCase of retiredTimerCases) {
    it(`T08 cleared retry callback is inert after ${timerCase.label}`, async () => {
      const ports = createPorts();
      const view = render(<VideoLifecycleHarness {...videoProps(streamSource(), ports)} />);
      await flushMicrotasks();
      fireEvent.error(videoElement());
      const staleTimer = ports.scheduled[0];
      expect(staleTimer).toBeDefined();

      timerCase.transition(view, ports);
      await flushMicrotasks();
      const sourceAfterRetirement = screen.getByTestId("effective-source").textContent;
      const attemptAfterRetirement = screen.getByTestId("retry-attempt").textContent;
      act(() => {
        invokeQueuedCallback(staleTimer);
      });
      await flushMicrotasks();

      expect(screen.getByTestId("effective-source").textContent).toBe(sourceAfterRetirement);
      expect(screen.getByTestId("retry-attempt").textContent).toBe(attemptAfterRetirement);
      expect(screen.getByTestId("stream-state")).not.toHaveTextContent("buffering");
      expect(screen.getByTestId("stream-state")).not.toHaveTextContent("retrying");
      expectNoActiveTimers(ports);
    });
  }

  it("T09 unmount retires the timer and the old callback cannot mutate a newly mounted owner", async () => {
    const ports = createPorts();
    const view = render(<VideoLifecycleHarness {...videoProps(streamSource(), ports)} />);
    await flushMicrotasks();
    fireEvent.error(videoElement());
    const staleTimer = ports.scheduled[0];
    view.unmount();
    expect(ports.clearTimeoutMock).toHaveBeenCalledWith(staleTimer?.id);

    render(<VideoLifecycleHarness {...videoProps(streamSource(), createPorts())} />);
    await flushMicrotasks();
    act(() => invokeQueuedCallback(staleTimer));
    await flushMicrotasks();
    expect(screen.getByTestId("effective-source")).not.toHaveTextContent("streamRetry=1");
    expectNoActiveTimers(ports);
  });

  it("T10 an old timer cannot consume or clear a replacement timer identity", async () => {
    const firstPorts = createPorts();
    const view = render(<VideoLifecycleHarness {...videoProps(streamSource(), firstPorts)} />);
    await flushMicrotasks();
    fireEvent.error(videoElement());
    const oldTimer = firstPorts.scheduled[0];

    const replacementPorts = createPorts();
    view.rerender(<VideoLifecycleHarness {...videoProps(streamSource("Projects%2Freplacement.mp4"), replacementPorts, { filePath: "Projects/replacement.mp4" })} />);
    await flushMicrotasks();
    fireEvent.error(videoElement());
    const replacementTimer = replacementPorts.scheduled[0];
    expect(replacementTimer?.active).toBe(true);

    act(() => invokeQueuedCallback(oldTimer));
    await flushMicrotasks();
    expect(replacementTimer?.active).toBe(true);
    view.unmount();
    expect(replacementPorts.clearTimeoutMock).toHaveBeenCalledWith(replacementTimer?.id);
  });

  it("T11 manual retry resets the established failure state and advances the retry URL once", async () => {
    const ports = createPorts();
    render(<VideoLifecycleHarness {...videoProps(streamSource(), ports)} />);
    await flushMicrotasks();
    for (let index = 0; index < 3; index += 1) {
      fireEvent.error(videoElement());
      act(() => fireTimer(ports.scheduled[index]));
      await flushMicrotasks();
    }
    fireEvent.error(videoElement());
    expect(screen.getByRole("button", { name: "Retry playback" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry playback" }));
    await flushMicrotasks();
    expect(screen.getByTestId("stream-state")).toHaveTextContent("buffering");
    expect(videoElement().getAttribute("src")).toContain("streamRetry=4");
    expect(videoElement().getAttribute("src")).not.toContain("streamRetry=5");
    expectNoActiveTimers(ports);
  });

  it("T12 stream, Blob, and disabled sources keep their retry/autoplay ownership boundaries", async () => {
    const streamPorts = createPorts();
    const streamView = render(<VideoLifecycleHarness {...videoProps(streamSource(), streamPorts)} />);
    await flushMicrotasks();
    fireEvent.error(videoElement());
    expect(streamPorts.scheduled).toHaveLength(1);
    streamView.unmount();
    expectNoActiveTimers(streamPorts);

    const blobPorts = createPorts();
    const blobView = render(<VideoLifecycleHarness {...videoProps("blob:offline-copy", blobPorts)} />);
    await flushMicrotasks();
    fireEvent.error(videoElement());
    expect(blobPorts.scheduled).toHaveLength(0);
    expectNoActiveTimers(blobPorts);
    blobView.unmount();

    const absentPorts = createPorts();
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    const absentView = render(<VideoLifecycleHarness {...videoProps(undefined, absentPorts)} />);
    await flushMicrotasks();
    expect(document.querySelector("video.media-preview-video")).toBeNull();
    expect(vi.mocked(HTMLMediaElement.prototype.play)).not.toHaveBeenCalled();
    expectNoActiveTimers(absentPorts);
    absentView.unmount();

    const disabledPorts = createPorts();
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    const disabledView = render(<VideoLifecycleHarness {...videoProps(streamSource(), disabledPorts, { enabled: false })} />);
    await flushMicrotasks();
    expect(document.querySelector("video.media-preview-video")).toBeNull();
    expect(vi.mocked(HTMLMediaElement.prototype.play)).not.toHaveBeenCalled();
    expectNoActiveTimers(disabledPorts);
    disabledView.unmount();
  });

  it("T13 StrictMode replay leaves one current timer and final unmount quiesces it", async () => {
    const ports = createPorts();
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const view = render(
      <StrictMode>
        <VideoLifecycleHarness {...videoProps(streamSource(), ports)} />
      </StrictMode>
    );
    await flushMicrotasks();
    const currentVideo = videoElement();
    expect(play).toHaveBeenCalledTimes(2);
    fireEvent.error(videoElement());
    expect(ports.scheduled).toHaveLength(1);
    expect(ports.scheduled.filter((timer) => timer.active)).toHaveLength(1);
    view.unmount();
    expect(ports.scheduled.filter((timer) => timer.active)).toHaveLength(0);
    expect(ports.clearTimeoutMock).toHaveBeenCalledWith(ports.scheduled[0]?.id);
    expect(pausedElements.filter((element) => element === currentVideo).length).toBeGreaterThanOrEqual(2);
  });

  it("T14 current media element identity keeps playback signals isolated after source replacement", async () => {
    const oldPublish = vi.fn<(playing: boolean) => void>();
    const replacementPublish = vi.fn<(playing: boolean) => void>();
    const ports = createPorts();
    const stageCapture: { current?: VideoPreviewStageBindings } = {};
    const view = render(<VideoLifecycleHarness {...videoProps("blob:alpha", ports, { onMediaPlaybackChange: oldPublish, stageCapture })} />);
    await flushMicrotasks();
    const retiredVideo = videoElement();
    fireEvent.playing(retiredVideo);
    oldPublish.mockClear();

    view.rerender(<VideoLifecycleHarness {...videoProps("blob:beta", ports, { onMediaPlaybackChange: replacementPublish, stageCapture })} />);
    await flushMicrotasks();
    const replacementVideo = videoElement();
    const replacementStage = stageCapture.current;
    expect(replacementStage).toBeDefined();
    act(() => {
      replacementStage?.onPlaying();
    });
    expect(replacementPublish).toHaveBeenCalledWith(true);
    replacementPublish.mockClear();
    expect(replacementPublish).not.toHaveBeenCalled();
    expect(oldPublish.mock.calls).toEqual([[false]]);
    expect(replacementVideo).toBe(videoElement());
    expectNoActiveTimers(ports);
  });

  const retiredHandlerCases: Array<{
    readonly invoke: (stage: VideoPreviewStageBindings) => void;
    readonly label: string;
    readonly prepareCurrent: boolean;
  }> = [
    { invoke: (stage) => stage.onError(), label: "onError", prepareCurrent: false },
    { invoke: (stage) => stage.onWaiting(), label: "onWaiting", prepareCurrent: false },
    { invoke: (stage) => stage.onCanPlay(), label: "onCanPlay", prepareCurrent: true },
    { invoke: (stage) => stage.onPlay(), label: "onPlay", prepareCurrent: false },
    { invoke: (stage) => stage.onPlaying(), label: "onPlaying", prepareCurrent: false },
    { invoke: (stage) => stage.onPause(), label: "onPause", prepareCurrent: false },
    { invoke: (stage) => stage.onEnded(), label: "onEnded", prepareCurrent: false }
  ];

  const retiredHandlerTransitions: Array<{
    readonly label: string;
    readonly transition: (view: ReturnType<typeof render>, ports: VideoLifecyclePorts, stageCapture: { current?: VideoPreviewStageBindings }, publish: (playing: boolean) => void) => void;
  }> = [
    {
      label: "source replacement",
      transition: (view, ports, stageCapture, publish) => {
        view.rerender(<VideoLifecycleHarness {...videoProps(streamSource("Projects%2Fother.mp4"), ports, { filePath: "Projects/other.mp4", onMediaPlaybackChange: publish, stageCapture })} />);
      }
    },
    {
      label: "media-element-only replacement",
      transition: (view, ports, stageCapture, publish) => {
        view.rerender(<VideoLifecycleHarness {...videoProps(streamSource(), ports, { mediaGeneration: 1, onMediaPlaybackChange: publish, stageCapture })} />);
      }
    },
    {
      label: "final unmount",
      transition: (view) => {
        view.unmount();
      }
    }
  ];

  for (const transitionCase of retiredHandlerTransitions) {
    for (const handlerCase of retiredHandlerCases) {
      it(`T14 retired ${handlerCase.label} is inert after ${transitionCase.label}`, async () => {
        const publish = vi.fn<(playing: boolean) => void>();
        const ports = createPorts();
        const stageCapture: { current?: VideoPreviewStageBindings } = {};
        const view = render(<VideoLifecycleHarness {...videoProps(streamSource(), ports, { onMediaPlaybackChange: publish, stageCapture })} />);
        await flushMicrotasks();
        const retiredVideo = videoElement();
        const retiredStage = stageCapture.current;
        expect(retiredStage).toBeDefined();

        transitionCase.transition(view, ports, stageCapture, publish);
        await flushMicrotasks();
        if (transitionCase.label === "final unmount") {
          expect(document.querySelector("video.media-preview-video")).toBeNull();
        } else {
          const replacementVideo = videoElement();
          expect(replacementVideo).not.toBe(retiredVideo);
          if (handlerCase.prepareCurrent) {
            const replacementStage = stageCapture.current;
            expect(replacementStage).toBeDefined();
            act(() => replacementStage?.onWaiting());
            await flushMicrotasks();
          }
        }

        const snapshot = () => ({
          autoplayBlocked: screen.queryByTestId("autoplay-blocked")?.textContent,
          effectiveSource: screen.queryByTestId("effective-source")?.textContent,
          playbackCalls: publish.mock.calls.map(([playing]) => playing),
          retryAttempt: screen.queryByTestId("retry-attempt")?.textContent,
          streamState: screen.queryByTestId("stream-state")?.textContent,
          timers: ports.scheduled.map((timer) => ({ active: timer.active, id: timer.id }))
        });
        const before = snapshot();
        act(() => handlerCase.invoke(retiredStage!));
        await flushMicrotasks();
        expect(snapshot(), `${handlerCase.label} after ${transitionCase.label}`).toEqual(before);
      });
    }
  }

  it("T15 path/source replacement cleanup reports the latest callback while pausing only the old element", async () => {
    const oldPublish = vi.fn<(playing: boolean) => void>();
    const replacementPublish = vi.fn<(playing: boolean) => void>();
    const ports = createPorts();
    const view = render(<VideoLifecycleHarness {...videoProps(streamSource(), ports, { onMediaPlaybackChange: oldPublish })} />);
    await flushMicrotasks();
    const oldVideo = videoElement();
    view.rerender(<VideoLifecycleHarness {...videoProps(streamSource("Projects%2Fother.mp4"), ports, { filePath: "Projects/other.mp4", onMediaPlaybackChange: replacementPublish })} />);
    await flushMicrotasks();
    expect(pausedElements).toContain(oldVideo);
    expect(oldPublish.mock.calls).toEqual([[false]]);
    expect(replacementPublish).not.toHaveBeenCalled();
    expect(videoElement()).not.toBe(oldVideo);
    expect(pausedElements.filter((element) => element === oldVideo)).toHaveLength(1);
    expectNoActiveTimers(ports);
  });

  it("T16 a current waiting event does not overwrite terminal failure and a current play event clears autoplay fallback", async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    const ports = createPorts();
    render(<VideoLifecycleHarness {...videoProps(streamSource(), ports)} />);
    await flushMicrotasks();
    expect(screen.getByTestId("autoplay-blocked")).toHaveTextContent("true");
    fireEvent.error(videoElement());
    fireEvent.error(videoElement());
    fireEvent.error(videoElement());
    fireEvent.error(videoElement());
    expect(screen.getByTestId("stream-state")).toHaveTextContent("failed");
    fireEvent.waiting(videoElement());
    expect(screen.getByTestId("stream-state")).toHaveTextContent("failed");
    fireEvent.playing(videoElement());
    expect(screen.getByTestId("autoplay-blocked")).toHaveTextContent("false");
  });

  it("T17 a current manual play rejection retains the fallback without creating retry work", async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockRejectedValueOnce(new DOMException("autoplay", "NotAllowedError"));
    const ports = createPorts();
    render(<VideoLifecycleHarness {...videoProps("blob:manual", ports)} />);
    await flushMicrotasks();
    play.mockRejectedValueOnce(new DOMException("manual", "NotAllowedError"));
    fireEvent.click(screen.getByRole("button", { name: "Play media" }));
    await flushMicrotasks();
    expect(screen.getByTestId("autoplay-blocked")).toHaveTextContent("true");
    expect(ports.scheduled).toHaveLength(0);
    expectNoActiveTimers(ports);
  });

  it("T22 manual retry clears the captured current timer and its queued callback cannot advance the replacement", async () => {
    const ports = createPorts();
    const stageCapture: { current?: VideoPreviewStageBindings } = {};
    render(<VideoLifecycleHarness {...videoProps(streamSource(), ports, { stageCapture })} />);
    await flushMicrotasks();
    fireEvent.error(videoElement());
    const clearedByManualRetry = ports.scheduled[0];
    expect(clearedByManualRetry?.active).toBe(true);
    act(() => {
      stageCapture.current?.retryStreamNow();
    });
    await flushMicrotasks();
    const sourceAfterManualRetry = screen.getByTestId("effective-source").textContent;
    expect(sourceAfterManualRetry).toContain("streamRetry=1");
    expect(clearedByManualRetry?.active).toBe(false);
    act(() => {
      invokeQueuedCallback(clearedByManualRetry);
    });
    await flushMicrotasks();
    expect(screen.getByTestId("effective-source").textContent).toBe(sourceAfterManualRetry);
    expect(screen.getByTestId("retry-attempt")).toHaveTextContent("0");
    expect(screen.getByTestId("stream-state")).toHaveTextContent("buffering");
  });

  it("T23 disable pauses exactly the retiring media once and does not affect a replacement", async () => {
    const publish = vi.fn<(playing: boolean) => void>();
    const ports = createPorts();
    const view = render(<VideoLifecycleHarness {...videoProps("blob:disable", ports, { onMediaPlaybackChange: publish })} />);
    await flushMicrotasks();
    const retiringVideo = videoElement();
    fireEvent.playing(retiringVideo);
    publish.mockClear();
    view.rerender(<VideoLifecycleHarness {...videoProps("blob:disable", ports, { enabled: false, onMediaPlaybackChange: publish })} />);
    await flushMicrotasks();
    expect(document.querySelector("video.media-preview-video")).toBeNull();
    expect(pausedElements.filter((element) => element === retiringVideo)).toHaveLength(1);
    expect(publish.mock.calls).toEqual([[false]]);
    expectNoActiveTimers(ports);
  });

  it("T24 final unmount pauses exactly the retiring media once and leaves no active timer", async () => {
    const publish = vi.fn<(playing: boolean) => void>();
    const ports = createPorts();
    const view = render(<VideoLifecycleHarness {...videoProps("blob:unmount", ports, { onMediaPlaybackChange: publish })} />);
    await flushMicrotasks();
    const retiringVideo = videoElement();
    fireEvent.playing(retiringVideo);
    publish.mockClear();
    view.unmount();
    expect(pausedElements.filter((element) => element === retiringVideo)).toHaveLength(1);
    expect(publish.mock.calls).toEqual([[false]]);
    expectNoActiveTimers(ports);
  });

  it("T20 the declarative stage keeps the current video identity tied to effectiveSource", async () => {
    const ports = createPorts();
    const view = render(<VideoLifecycleHarness {...videoProps("blob:alpha", ports)} />);
    await flushMicrotasks();
    const alpha = videoElement();
    view.rerender(<VideoLifecycleHarness {...videoProps("blob:beta", ports)} />);
    await flushMicrotasks();
    const beta = videoElement();
    expect(beta).not.toBe(alpha);
    expect(beta).toHaveAttribute("src", "blob:beta");
    expect(beta).toHaveAttribute("autoplay");
    expect(beta.muted).toBe(true);
    expect(beta.playsInline).toBe(true);
    expectNoActiveTimers(ports);
  });
});
