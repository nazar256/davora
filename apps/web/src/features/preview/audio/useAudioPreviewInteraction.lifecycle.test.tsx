// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FilePreview } from "@davora/shared";

import { buildFilePreview } from "../../../test/files";
import {
  AudioPreviewStage,
  useAudioPreviewInteraction
} from "../audio";
import type { PreviewModalRuntimePorts } from "../shell/ports";

interface AudioLifecycleHarnessProps {
  readonly open: boolean;
  readonly accountId?: string;
  readonly file?: FilePreview;
  readonly blobUrl?: string;
  readonly ports: PreviewModalRuntimePorts;
  readonly onMediaPlaybackChange?: (playing: boolean) => void;
  readonly onClose?: () => void;
}

/**
 * Direct owner harness: this matrix intentionally bypasses the shell and
 * renders the public audio interaction/stage pair under test.
 */
function AudioPreviewLifecycleHarness({
  open,
  accountId,
  file,
  blobUrl,
  onMediaPlaybackChange,
  ports
}: AudioLifecycleHarnessProps) {
  const interaction = useAudioPreviewInteraction({
    source: {
      enabled: open && file?.viewer === "audio",
      accountId,
      path: file?.path,
      sourceUrl: blobUrl
    },
    onMediaPlaybackChange,
    ports
  });
  return <AudioPreviewStage interaction={interaction} />;
}

const PreviewModalStage = AudioPreviewLifecycleHarness;

interface ScheduledTimeout {
  readonly callback: () => void;
  readonly delayMs: number;
}

function createPorts(overrides: Partial<PreviewModalRuntimePorts> = {}) {
  const scheduled: ScheduledTimeout[] = [];
  const cleared: number[] = [];
  let nextTimeoutId = 1;
  const ports: PreviewModalRuntimePorts = {
    pdf: {
      loadPdfJs: vi.fn(),
      fetch: vi.fn(),
      requestAnimationFrame: (callback) => {
        callback(0);
        return 1;
      },
      getDevicePixelRatio: () => 1,
      createResizeObserver: () => undefined
    },
    video: {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      getLocationHref: () => "https://davora.test/files"
    },
    setTimeout: (callback, delayMs) => {
      scheduled.push({ callback, delayMs });
      return nextTimeoutId++;
    },
    clearTimeout: (timeoutId) => {
      if (timeoutId !== undefined) {
        cleared.push(timeoutId);
      }
    },
    getLocationHref: () => "https://davora.test/files",
    startOriginalFileOpen: vi.fn(() => ({ completion: Promise.resolve(), cancel: vi.fn() })),
    addWindowKeydownListener: vi.fn(() => vi.fn()),
    loadAudioPreviewPosition: vi.fn(() => undefined),
    saveAudioPreviewPosition: vi.fn(),
    clearAudioPreviewPosition: vi.fn(),
    ...overrides
  };
  return { ports, scheduled, cleared };
}

function props(overrides: Partial<AudioLifecycleHarnessProps> = {}): AudioLifecycleHarnessProps {
  return {
    open: true,
    accountId: "account-alpha",
    ports: createPorts().ports,
    ...overrides
  };
}

function audioProps(source: string, overrides: Partial<AudioLifecycleHarnessProps> = {}): AudioLifecycleHarnessProps {
  return props({
    blobUrl: source,
    file: buildFilePreview("Music/track.mp3", {
      viewer: "audio",
      name: "track.mp3",
      mimeType: "audio/mpeg"
    }),
    ...overrides
  });
}

function audioElement(): HTMLAudioElement {
  const element = document.querySelector("audio.media-preview-audio");
  if (!(element instanceof HTMLAudioElement)) {
    throw new Error("Expected the modal audio element.");
  }
  return element;
}

const RESUME_EVENTS = ["loadedmetadata", "timeupdate", "pause", "ended"] as const;
const LATE_MEDIA_EVENTS = [
  "loadedmetadata",
  "timeupdate",
  "pause",
  "ended",
  "error",
  "play",
  "playing",
  "waiting",
  "canplay"
] as const;
const RESUME_LISTENER_NAMES = new Set([
  "handleLoadedMetadata",
  "handleTimeUpdate",
  "handlePause",
  "handleEnded"
]);

interface MediaListenerRecord {
  readonly event: string;
  readonly element: HTMLMediaElement;
  readonly listener: EventListenerOrEventListenerObject;
}

function captureMediaListeners() {
  const added: MediaListenerRecord[] = [];
  const removed: MediaListenerRecord[] = [];
  vi.spyOn(HTMLMediaElement.prototype, "addEventListener").mockImplementation(function (
    this: HTMLMediaElement,
    event,
    listener,
    options
  ) {
    if (listener && RESUME_EVENTS.some((resumeEvent) => resumeEvent === String(event)) && typeof listener === "function" && RESUME_LISTENER_NAMES.has(listener.name)) {
      added.push({ event: String(event), element: this, listener });
    }
    EventTarget.prototype.addEventListener.call(this, event, listener, options);
  });
  vi.spyOn(HTMLMediaElement.prototype, "removeEventListener").mockImplementation(function (
    this: HTMLMediaElement,
    event,
    listener,
    options
  ) {
    if (listener && RESUME_EVENTS.some((resumeEvent) => resumeEvent === String(event)) && typeof listener === "function" && RESUME_LISTENER_NAMES.has(listener.name)) {
      removed.push({ event: String(event), element: this, listener });
    }
    EventTarget.prototype.removeEventListener.call(this, event, listener, options);
  });
  return { added, removed };
}

function expectResumeListenersRemoved(
  listeners: ReturnType<typeof captureMediaListeners>,
  element: HTMLAudioElement,
  expectedAdds = 1
) {
  for (const event of RESUME_EVENTS) {
    const ownerListeners = listeners.added.filter((entry) => entry.element === element && entry.event === event);
    expect(ownerListeners).toHaveLength(expectedAdds);
    for (const ownerListener of ownerListeners.slice(0, expectedAdds === 2 ? 1 : undefined)) {
      expect(
        listeners.removed.filter((entry) => entry.element === element && entry.event === event && entry.listener === ownerListener.listener),
        `${event} ${typeof ownerListener.listener === "function" ? ownerListener.listener.name : "object"} removed=${listeners.removed.filter((entry) => entry.element === element && entry.event === event).map((entry) => typeof entry.listener === "function" ? entry.listener.name : "object").join(",")}`
      ).toHaveLength(1);
    }
  }
}

function dispatchLateMediaEvents(element: HTMLAudioElement) {
  for (const event of LATE_MEDIA_EVENTS) {
    element.dispatchEvent(new Event(event));
  }
}

describe("public modal audio lifecycle owner", () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("preserves exact stream and Blob sources, with retry identity only for streams", () => {
    const stream = createPorts();
    const { rerender } = render(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3&streamToken=opaque", { ports: stream.ports })} />);
    expect(audioElement().getAttribute("src")).toBe("/api/file/stream?path=Music%2Ftrack.mp3&streamToken=opaque");

    fireEvent.error(audioElement());
    expect(stream.scheduled).toHaveLength(1);
    act(() => stream.scheduled[0]?.callback());
    expect(audioElement().getAttribute("src")).toBe("/api/file/stream?path=Music%2Ftrack.mp3&streamToken=opaque&streamRetry=1");

    const offline = createPorts();
    rerender(<PreviewModalStage {...audioProps("blob:offline-copy", { ports: offline.ports })} />);
    expect(audioElement().getAttribute("src")).toBe("blob:offline-copy");
    fireEvent.error(audioElement());
    expect(offline.scheduled).toHaveLength(0);
  });

  it("keeps the bounded 500/1000/2000 retry schedule and manual reset", () => {
    const fixture = createPorts();
    render(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", { ports: fixture.ports })} />);

    for (const [index, delayMs] of [500, 1000, 2000].entries()) {
      fireEvent.error(audioElement());
      expect(fixture.scheduled[index]?.delayMs).toBe(delayMs);
      act(() => fixture.scheduled[index]?.callback());
      expect(audioElement().getAttribute("src")).toContain(`streamRetry=${index + 1}`);
    }

    fireEvent.error(audioElement());
    expect(screen.getByText(/Media playback could not continue after several retries/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry playback/i }));
    expect(audioElement().getAttribute("src")).toContain("streamRetry=4");
    expect(screen.queryByText(/Media playback could not continue after several retries/i)).not.toBeInTheDocument();

    fireEvent.error(audioElement());
    expect(fixture.scheduled[fixture.scheduled.length - 1]?.delayMs).toBe(500);
    expect(screen.getByText(/Stream interrupted\. Retrying playback shortly \(1\/3\)/i)).toBeInTheDocument();
  });

  it("exposes autoplay success, synchronous throw, rejected promise, and manual recovery", async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    render(<PreviewModalStage {...audioProps("blob:offline-copy")} />);
    expect(play).toHaveBeenCalled();
    cleanup();

    play.mockImplementationOnce(() => {
      throw new DOMException("blocked", "NotAllowedError");
    });
    render(<PreviewModalStage {...audioProps("blob:sync-throw")} />);
    expect(await screen.findByText(/Autoplay was blocked by the browser/i)).toBeInTheDocument();
    cleanup();

    play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    render(<PreviewModalStage {...audioProps("blob:rejected")} />);
    expect(await screen.findByText(/Autoplay was blocked by the browser/i)).toBeInTheDocument();
    play.mockResolvedValueOnce(undefined);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Play media" }));
      await Promise.resolve();
    });
    expect(screen.queryByText(/Autoplay was blocked by the browser/i)).not.toBeInTheDocument();
  });

  it("suppresses a rejected autoplay promise after the viewer is replaced", async () => {
    const rejecters: Array<(reason?: unknown) => void> = [];
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(() => new Promise<void>((_resolve, reject) => {
      rejecters.push(reject);
    }));
    const fixture = createPorts();
    const { rerender } = render(<PreviewModalStage {...audioProps("blob:alpha", { ports: fixture.ports })} />);
    expect(rejecters).toHaveLength(1);
    rerender(
      <PreviewModalStage
        {...props({
          ports: fixture.ports,
          file: buildFilePreview("Notes/readme.txt", { viewer: "text", name: "readme.txt" })
        })}
      />
    );
    await act(async () => {
      rejecters[0]?.(new DOMException("stale", "NotAllowedError"));
      await Promise.resolve();
    });
    expect(screen.queryByText(/Autoplay was blocked by the browser/i)).not.toBeInTheDocument();
  });

  const staleAutoplayRejectionCases: Array<{
    readonly label: string;
    readonly strictMode?: boolean;
    readonly transition: (context: {
      readonly rerender: (ui: ReactElement) => void;
      readonly unmount: () => void;
      readonly replacementPublish: (playing: boolean) => void;
      readonly fixture: ReturnType<typeof createPorts>;
    }) => void;
  }> = [
    {
      label: "a source-only change",
      transition: ({ rerender, replacementPublish, fixture }) => {
        rerender(<PreviewModalStage {...audioProps("blob:beta", { onMediaPlaybackChange: replacementPublish, ports: fixture.ports })} />);
      }
    },
    {
      label: "an unchanged-stream path-only change",
      transition: ({ rerender, replacementPublish, fixture }) => {
        rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", {
          file: buildFilePreview("Music/path-only.mp3", { viewer: "audio", name: "path-only.mp3", mimeType: "audio/mpeg" }),
          onMediaPlaybackChange: replacementPublish,
          ports: fixture.ports
        })} />);
      }
    },
    {
      label: "an unchanged-stream account-only change",
      transition: ({ rerender, replacementPublish, fixture }) => {
        rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", {
          accountId: "account-beta",
          onMediaPlaybackChange: replacementPublish,
          ports: fixture.ports
        })} />);
      }
    },
    {
      label: "a viewer replacement",
      transition: ({ rerender, replacementPublish, fixture }) => {
        rerender(<PreviewModalStage {...props({
          file: buildFilePreview("Notes/readme.txt", { viewer: "text", name: "readme.txt" }),
          ports: fixture.ports
        })} />);
        rerender(<PreviewModalStage {...audioProps("blob:viewer-replacement", { onMediaPlaybackChange: replacementPublish, ports: fixture.ports })} />);
      }
    },
    {
      label: "a controlled close",
      transition: ({ rerender, replacementPublish, fixture }) => {
        rerender(<PreviewModalStage {...audioProps("blob:alpha", { open: false, ports: fixture.ports })} />);
        rerender(<PreviewModalStage {...audioProps("blob:close-replacement", { onMediaPlaybackChange: replacementPublish, ports: fixture.ports })} />);
      }
    },
    {
      label: "unmount",
      transition: ({ unmount, replacementPublish, fixture }) => {
        unmount();
        render(<PreviewModalStage {...audioProps("blob:unmount-replacement", { onMediaPlaybackChange: replacementPublish, ports: fixture.ports })} />);
      }
    },
    {
      label: "authentic StrictMode replay",
      strictMode: true,
      transition: ({ rerender, replacementPublish, fixture }) => {
        rerender(
          <StrictMode>
            <PreviewModalStage {...audioProps("blob:strict-replacement", { onMediaPlaybackChange: replacementPublish, ports: fixture.ports })} />
          </StrictMode>
        );
      }
    }
  ];

  for (const rejectionCase of staleAutoplayRejectionCases) {
    it(`keeps deferred autoplay rejection inert after ${rejectionCase.label}`, async () => {
      const rejecters: Array<(reason?: unknown) => void> = [];
      const replacementPublish = vi.fn<(playing: boolean) => void>();
      const fixture = createPorts();
      vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(() => new Promise<void>((_resolve, reject) => {
        rejecters.push(reject);
      }));
      const initial = <PreviewModalStage {...audioProps(
        rejectionCase.strictMode ? "blob:strict-alpha" : "/api/file/stream?path=Music%2Ftrack.mp3",
        { onMediaPlaybackChange: vi.fn(), ports: fixture.ports }
      )} />;
      const rendered = rejectionCase.strictMode
        ? render(<StrictMode>{initial}</StrictMode>)
        : render(initial);
      const replayEffectCount = rejectionCase.strictMode ? 2 : 1;
      expect(rejecters).toHaveLength(replayEffectCount);

      rejectionCase.transition({
        rerender: rendered.rerender,
        unmount: rendered.unmount,
        replacementPublish,
        fixture
      });

      await act(async () => {
        for (const reject of rejecters.slice(0, replayEffectCount)) {
          reject(new DOMException("stale", "NotAllowedError"));
        }
        await Promise.resolve();
      });

      expect(screen.queryByText("Autoplay was blocked by the browser. Use Play media to start playback.")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Play media" })).not.toBeInTheDocument();
      expect(replacementPublish).not.toHaveBeenCalled();
    });
  }

  it("publishes the current playback event contract", () => {
    const onMediaPlaybackChange = vi.fn<(playing: boolean) => void>();
    render(<PreviewModalStage {...audioProps("blob:offline-copy", { onMediaPlaybackChange })} />);
    const audio = audioElement();

    fireEvent.waiting(audio);
    fireEvent.canPlay(audio);
    fireEvent.play(audio);
    fireEvent.playing(audio);
    fireEvent.pause(audio);
    fireEvent.ended(audio);
    fireEvent.error(audio);

    expect(onMediaPlaybackChange.mock.calls.map(([playing]) => playing)).toEqual([true, true, false, false, false]);
  });

  it("clears retry timers on replacement and controlled close", () => {
    const fixture = createPorts();
    const onClose = vi.fn();
    const { rerender, unmount } = render(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", { onClose, ports: fixture.ports })} />);
    fireEvent.error(audioElement());
    expect(fixture.scheduled).toHaveLength(1);

    rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Fother.mp3", { onClose, ports: fixture.ports })} />);
    expect(fixture.cleared).toContain(1);
    rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Fother.mp3", { onClose, open: false, ports: fixture.ports })} />);
    expect(onClose).not.toHaveBeenCalled();
    unmount();
    expect(fixture.cleared.length).toBeGreaterThanOrEqual(1);
  });

  it("advances one live retry callback into buffering and publishes one retry URL", () => {
    const fixture = createPorts();
    render(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", { ports: fixture.ports })} />);
    fireEvent.error(audioElement());
    const retry = fixture.scheduled[0]?.callback;
    expect(retry).toBeTypeOf("function");

    act(() => retry?.());

    expect(audioElement().getAttribute("src")).toContain("streamRetry=1");
    expect(screen.getByText(/Buffering media stream/i)).toBeInTheDocument();
  });

  function expectRetiredRetryCallbackToBeInert(
    label: string,
    transition: (rerender: (ui: ReactElement) => void, fixture: ReturnType<typeof createPorts>) => void,
    strictMode = false
  ) {
    it(`keeps a cleared retry callback inert after ${label}`, () => {
      const fixture = createPorts();
      const initial = <PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", { ports: fixture.ports })} />;
      const rendered = strictMode
        ? render(<StrictMode>{initial}</StrictMode>)
        : render(initial);
      fireEvent.error(audioElement());
      const staleCallback = fixture.scheduled[0]?.callback;
      expect(staleCallback).toBeTypeOf("function");

      transition(rendered.rerender, fixture);
      expect(fixture.cleared).toEqual([1]);
      act(() => staleCallback?.());
      expect(audioElement().getAttribute("src")).not.toContain("streamRetry=1");
    });
  }

  expectRetiredRetryCallbackToBeInert("a source-only change", (rerender, fixture) => {
    rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3&variant=next", { ports: fixture.ports })} />);
  });

  expectRetiredRetryCallbackToBeInert("a path-only change", (rerender, fixture) => {
    rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", {
      file: buildFilePreview("Music/other.mp3", { viewer: "audio", name: "other.mp3", mimeType: "audio/mpeg" }),
      ports: fixture.ports
    })} />);
  });

  expectRetiredRetryCallbackToBeInert("an account-only change", (rerender, fixture) => {
    rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", { accountId: "account-beta", ports: fixture.ports })} />);
  });

  expectRetiredRetryCallbackToBeInert("a viewer replacement", (rerender, fixture) => {
    rerender(<PreviewModalStage {...props({
      blobUrl: "/api/file/stream?path=Music%2Ftrack.mp3",
      file: buildFilePreview("Notes/readme.txt", { viewer: "text", name: "readme.txt" }),
      ports: fixture.ports
    })} />);
    rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Freplacement.mp3", { ports: fixture.ports })} />);
  });

  expectRetiredRetryCallbackToBeInert("an audio replacement", (rerender, fixture) => {
    rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Freplacement.mp3", {
      file: buildFilePreview("Music/replacement.mp3", { viewer: "audio", name: "replacement.mp3", mimeType: "audio/mpeg" }),
      accountId: "account-beta",
      ports: fixture.ports
    })} />);
  });

  expectRetiredRetryCallbackToBeInert("a controlled close", (rerender, fixture) => {
    rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", { open: false, ports: fixture.ports })} />);
    rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", { ports: fixture.ports })} />);
  });

  it("keeps a cleared retry callback inert after unmount", () => {
    const fixture = createPorts();
    const { unmount } = render(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", { ports: fixture.ports })} />);
    fireEvent.error(audioElement());
    const staleCallback = fixture.scheduled[0]?.callback;
    expect(staleCallback).toBeTypeOf("function");
    unmount();
    expect(fixture.cleared).toEqual([1]);
    render(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", { ports: fixture.ports })} />);
    act(() => staleCallback?.());
    expect(audioElement().getAttribute("src")).not.toContain("streamRetry=1");
  });

  it("retires a retry callback when runtime ports are replaced and schedules later errors through the replacement", () => {
    const portsA = createPorts();
    const portsB = createPorts();
    const { rerender } = render(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", { ports: portsA.ports })} />);

    fireEvent.error(audioElement());
    const staleCallback = portsA.scheduled[0]?.callback;
    expect(staleCallback).toBeTypeOf("function");

    rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", { ports: portsB.ports })} />);
    expect(portsA.cleared).toEqual([1]);
    expect(portsB.cleared).toEqual([]);
    act(() => staleCallback?.());
    expect(audioElement().getAttribute("src")).not.toContain("streamRetry=1");
    expect(screen.queryByText(/Stream interrupted/i)).not.toBeInTheDocument();

    fireEvent.error(audioElement());
    expect(portsB.scheduled).toHaveLength(1);
    expect(portsA.scheduled).toHaveLength(1);
  });

  it("keeps StrictMode replay from leaving more than one active retry timer", () => {
    const fixture = createPorts();
    const { unmount } = render(
      <StrictMode>
        <PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", { ports: fixture.ports })} />
      </StrictMode>
    );
    fireEvent.error(audioElement());
    expect(fixture.scheduled).toHaveLength(1);
    unmount();
    expect(fixture.cleared).toContain(1);
  });

  it("retires a retry scheduled by the first StrictMode effect lifetime", () => {
    const fixture = createPorts();
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockImplementationOnce(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event("error"));
      return Promise.resolve();
    });

    render(
      <StrictMode>
        <PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", { ports: fixture.ports })} />
      </StrictMode>
    );
    const staleCallback = fixture.scheduled[0]?.callback;
    expect(staleCallback).toBeTypeOf("function");
    expect(fixture.cleared).toEqual([1]);

    act(() => staleCallback?.());

    expect(audioElement().getAttribute("src")).not.toContain("streamRetry=1");
    expect(screen.queryByText(/Buffering media stream/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stream interrupted/i)).not.toBeInTheDocument();
  });

  it("keeps a current retry callback inert after the replacement that follows StrictMode replay", () => {
    const fixture = createPorts();
    const { rerender } = render(
      <StrictMode>
        <PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", { ports: fixture.ports })} />
      </StrictMode>
    );
    fireEvent.error(audioElement());
    const staleCallback = fixture.scheduled[0]?.callback;
    expect(staleCallback).toBeTypeOf("function");
    rerender(
      <StrictMode>
        <PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Freplacement.mp3", { ports: fixture.ports })} />
      </StrictMode>
    );
    expect(fixture.cleared).toEqual([1]);
    act(() => staleCallback?.());
    expect(audioElement().getAttribute("src")).not.toContain("streamRetry=1");
  });

  it("restores immediately, revalidates at metadata, deduplicates rounded time updates, and clears on end", () => {
    const load = vi.fn<PreviewModalRuntimePorts["loadAudioPreviewPosition"]>(() => 12.5);
    const save = vi.fn<PreviewModalRuntimePorts["saveAudioPreviewPosition"]>();
    const clear = vi.fn<PreviewModalRuntimePorts["clearAudioPreviewPosition"]>();
    const fixture = createPorts({
      loadAudioPreviewPosition: load,
      saveAudioPreviewPosition: save,
      clearAudioPreviewPosition: clear
    });
    render(<PreviewModalStage {...audioProps("blob:offline-copy", { ports: fixture.ports })} />);
    const audio = audioElement();
    Object.defineProperty(audio, "duration", { configurable: true, value: 100 });
    expect(audio.currentTime).toBe(12.5);
    fireEvent.loadedMetadata(audio);
    expect(load).toHaveBeenCalledTimes(2);

    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 12.1 });
    fireEvent.timeUpdate(audio);
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 12.9 });
    fireEvent.timeUpdate(audio);
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 13.0 });
    fireEvent.timeUpdate(audio);
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 14.2 });
    fireEvent.pause(audio);
    const savedPositions = save.mock.calls.map((call) => call[1]);
    expect(savedPositions).toEqual([12.1, 13, 14.2]);

    fireEvent.ended(audio);
    expect(clear).toHaveBeenCalledWith({ accountId: "account-alpha", path: "Music/track.mp3" });
  });

  it("clears a near-end metadata position and persists the retiring identity on replacement", () => {
    const load = vi.fn<PreviewModalRuntimePorts["loadAudioPreviewPosition"]>(() => 99.5);
    const save = vi.fn<PreviewModalRuntimePorts["saveAudioPreviewPosition"]>();
    const clear = vi.fn<PreviewModalRuntimePorts["clearAudioPreviewPosition"]>();
    const fixture = createPorts({
      loadAudioPreviewPosition: load,
      saveAudioPreviewPosition: save,
      clearAudioPreviewPosition: clear
    });
    const { rerender } = render(<PreviewModalStage {...audioProps("blob:alpha", { ports: fixture.ports })} />);
    const alpha = audioElement();
    Object.defineProperty(alpha, "duration", { configurable: true, value: 100 });
    fireEvent.loadedMetadata(alpha);
    expect(clear).toHaveBeenCalledWith({ accountId: "account-alpha", path: "Music/track.mp3" });

    Object.defineProperty(alpha, "currentTime", { configurable: true, writable: true, value: 15 });
    rerender(<PreviewModalStage {...audioProps("blob:beta", { accountId: "account-beta", ports: fixture.ports })} />);
    expect(save).toHaveBeenCalledWith({ accountId: "account-alpha", path: "Music/track.mp3" }, 15);
    expect(save).not.toHaveBeenCalledWith({ accountId: "account-beta", path: "Music/track.mp3" }, 15);
  });

  it("persists resume teardown on controlled close and unmount", () => {
    const save = vi.fn<PreviewModalRuntimePorts["saveAudioPreviewPosition"]>();
    const fixture = createPorts({ saveAudioPreviewPosition: save });
    const { rerender, unmount } = render(<PreviewModalStage {...audioProps("blob:close", { ports: fixture.ports })} />);
    const closeAudio = audioElement();
    Object.defineProperty(closeAudio, "currentTime", { configurable: true, writable: true, value: 21.25 });
    rerender(<PreviewModalStage {...audioProps("blob:close", { open: false, ports: fixture.ports })} />);
    expect(save).toHaveBeenCalledWith({ accountId: "account-alpha", path: "Music/track.mp3" }, 21.25);

    rerender(<PreviewModalStage {...audioProps("blob:unmount", { ports: fixture.ports })} />);
    const unmountAudio = audioElement();
    Object.defineProperty(unmountAudio, "currentTime", { configurable: true, writable: true, value: 34.5 });
    unmount();
    expect(save).toHaveBeenCalledWith({ accountId: "account-alpha", path: "Music/track.mp3" }, 34.5);
  });

  it("retires resume state independently for path, source, and account changes", () => {
    const save = vi.fn<PreviewModalRuntimePorts["saveAudioPreviewPosition"]>();
    const fixture = createPorts({ saveAudioPreviewPosition: save });
    const { rerender } = render(<PreviewModalStage {...audioProps("blob:alpha", { ports: fixture.ports })} />);
    const alpha = audioElement();
    Object.defineProperty(alpha, "currentTime", { configurable: true, writable: true, value: 11 });
    rerender(<PreviewModalStage {...audioProps("blob:alpha", {
      file: buildFilePreview("Music/path-only.mp3", { viewer: "audio", name: "path-only.mp3", mimeType: "audio/mpeg" }),
      ports: fixture.ports
    })} />);
    expect(save).toHaveBeenCalledWith({ accountId: "account-alpha", path: "Music/track.mp3" }, 11);

    const pathAudio = audioElement();
    Object.defineProperty(pathAudio, "currentTime", { configurable: true, writable: true, value: 22 });
    rerender(<PreviewModalStage {...audioProps("blob:source-only", {
      file: buildFilePreview("Music/path-only.mp3", { viewer: "audio", name: "path-only.mp3", mimeType: "audio/mpeg" }),
      ports: fixture.ports
    })} />);
    expect(save).toHaveBeenCalledWith({ accountId: "account-alpha", path: "Music/path-only.mp3" }, 22);

    const sourceAudio = audioElement();
    Object.defineProperty(sourceAudio, "currentTime", { configurable: true, writable: true, value: 33 });
    rerender(<PreviewModalStage {...audioProps("blob:source-only", {
      accountId: "account-beta",
      file: buildFilePreview("Music/path-only.mp3", { viewer: "audio", name: "path-only.mp3", mimeType: "audio/mpeg" }),
      ports: fixture.ports
    })} />);
    expect(save).toHaveBeenCalledWith({ accountId: "account-alpha", path: "Music/path-only.mp3" }, 33);
    expect(save).not.toHaveBeenCalledWith({ accountId: "account-beta", path: "Music/path-only.mp3" }, 33);
  });

  it("keeps retired media events from publishing or persisting into the replacement tuple", () => {
    const save = vi.fn<PreviewModalRuntimePorts["saveAudioPreviewPosition"]>();
    const onMediaPlaybackChange = vi.fn<(playing: boolean) => void>();
    const fixture = createPorts({ saveAudioPreviewPosition: save });
    const { rerender } = render(<PreviewModalStage {...audioProps("blob:alpha", { onMediaPlaybackChange, ports: fixture.ports })} />);
    const retiredAudio = audioElement();
    Object.defineProperty(retiredAudio, "currentTime", { configurable: true, writable: true, value: 17 });
    rerender(<PreviewModalStage {...audioProps("blob:beta", {
      accountId: "account-beta",
      file: buildFilePreview("Music/replacement.mp3", { viewer: "audio", name: "replacement.mp3", mimeType: "audio/mpeg" }),
      onMediaPlaybackChange,
      ports: fixture.ports
    })} />);
    const saveCountAfterRetirement = save.mock.calls.length;
    const publicationCountAfterRetirement = onMediaPlaybackChange.mock.calls.length;

    fireEvent.timeUpdate(retiredAudio);
    fireEvent.pause(retiredAudio);
    fireEvent.ended(retiredAudio);
    fireEvent.error(retiredAudio);

    expect(save.mock.calls.length).toBe(saveCountAfterRetirement);
    expect(onMediaPlaybackChange.mock.calls.length).toBe(publicationCountAfterRetirement);
    expect(save).not.toHaveBeenCalledWith({ accountId: "account-beta", path: "Music/replacement.mp3" }, 17);
  });

  const retirementCases: Array<{
    readonly label: string;
    readonly source?: string;
    readonly retire: (context: {
      readonly rerender: (ui: ReactElement) => void;
      readonly unmount: () => void;
      readonly fixture: ReturnType<typeof createPorts>;
    }) => HTMLAudioElement | null;
  }> = [
    {
      label: "source-only change",
      retire: ({ rerender, fixture }) => {
        rerender(<PreviewModalStage {...audioProps("blob:beta", { ports: fixture.ports })} />);
        return audioElement();
      }
    },
    {
      label: "path-only change",
      source: "/api/file/stream?path=Music%2Ftrack.mp3",
      retire: ({ rerender, fixture }) => {
        rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", {
          file: buildFilePreview("Music/path-only.mp3", { viewer: "audio", name: "path-only.mp3", mimeType: "audio/mpeg" }),
          ports: fixture.ports
        })} />);
        return audioElement();
      }
    },
    {
      label: "account-only change",
      source: "/api/file/stream?path=Music%2Ftrack.mp3",
      retire: ({ rerender, fixture }) => {
        rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", { accountId: "account-beta", ports: fixture.ports })} />);
        return audioElement();
      }
    },
    {
      label: "viewer replacement",
      retire: ({ rerender, fixture }) => {
        rerender(<PreviewModalStage {...props({
          file: buildFilePreview("Notes/readme.txt", { viewer: "text", name: "readme.txt" }),
          ports: fixture.ports
        })} />);
        return null;
      }
    },
    {
      label: "audio replacement",
      retire: ({ rerender, fixture }) => {
        rerender(<PreviewModalStage {...audioProps("blob:beta", {
          accountId: "account-beta",
          file: buildFilePreview("Music/replacement.mp3", { viewer: "audio", name: "replacement.mp3", mimeType: "audio/mpeg" }),
          ports: fixture.ports
        })} />);
        return audioElement();
      }
    },
    {
      label: "controlled close",
      retire: ({ rerender, fixture }) => {
        rerender(<PreviewModalStage {...audioProps("blob:alpha", { open: false, ports: fixture.ports })} />);
        rerender(<PreviewModalStage {...audioProps("blob:reopened", { ports: fixture.ports })} />);
        return audioElement();
      }
    },
    {
      label: "unmount",
      retire: ({ unmount, fixture }) => {
        unmount();
        render(<PreviewModalStage {...audioProps("blob:replaced-after-unmount", { ports: fixture.ports })} />);
        return audioElement();
      }
    }
  ];

  for (const retirementCase of retirementCases) {
    it(`retires all audio resources and ignores late events after ${retirementCase.label}${retirementCase.source ? " with unchanged streaming source" : ""}`, () => {
      const save = vi.fn<PreviewModalRuntimePorts["saveAudioPreviewPosition"]>();
      const clear = vi.fn<PreviewModalRuntimePorts["clearAudioPreviewPosition"]>();
      const onMediaPlaybackChange = vi.fn<(playing: boolean) => void>();
      const fixture = createPorts({
        loadAudioPreviewPosition: vi.fn(() => undefined),
        saveAudioPreviewPosition: save,
        clearAudioPreviewPosition: clear
      });
      const listeners = captureMediaListeners();
      const pause = vi.mocked(HTMLMediaElement.prototype.pause);
      const pausedElements: HTMLMediaElement[] = [];
      pause.mockClear();
      pause.mockImplementation(function (this: HTMLMediaElement) {
        pausedElements.push(this);
      });

      const initialSource = retirementCase.source ?? "blob:alpha";
      const rendered = render(<PreviewModalStage {...audioProps(initialSource, {
        onMediaPlaybackChange,
        ports: fixture.ports
      })} />);
      const retiredAudio = audioElement();
      Object.defineProperty(retiredAudio, "currentTime", { configurable: true, writable: true, value: 17 });

      const replacementAudio = retirementCase.retire({
        rerender: rendered.rerender,
        unmount: rendered.unmount,
        fixture
      });
      expect(pausedElements).toContain(retiredAudio);
      expectResumeListenersRemoved(listeners, retiredAudio);

      const retiringTarget = { accountId: "account-alpha", path: "Music/track.mp3" };
      const saveCountAfterRetirement = save.mock.calls.length;
      const clearCountAfterRetirement = clear.mock.calls.length;
      const publicationCountAfterRetirement = onMediaPlaybackChange.mock.calls.length;
      const scheduledCountAfterRetirement = fixture.scheduled.length;
      expect(save.mock.calls.filter(([target]) => target.accountId === retiringTarget.accountId && target.path === retiringTarget.path)).toHaveLength(1);
      expect(clear.mock.calls.filter(([target]) => target.accountId === retiringTarget.accountId && target.path === retiringTarget.path).length).toBeLessThanOrEqual(1);

      const replacementSource = replacementAudio?.getAttribute("src");
      if (replacementAudio) {
        expect(replacementAudio).not.toBe(retiredAudio);
        if (retirementCase.source) {
          expect(retiredAudio.getAttribute("src")).toBe(retirementCase.source);
          expect(replacementSource).toBe(retirementCase.source);
        }
        Object.defineProperty(replacementAudio, "currentTime", { configurable: true, writable: true, value: 23 });
      }
      dispatchLateMediaEvents(retiredAudio);

      expect(save.mock.calls.length).toBe(saveCountAfterRetirement);
      expect(clear.mock.calls.length).toBe(clearCountAfterRetirement);
      expect(onMediaPlaybackChange.mock.calls.length).toBe(publicationCountAfterRetirement);
      expect(fixture.scheduled.length).toBe(scheduledCountAfterRetirement);
      expect(screen.queryByText(/Buffering media stream|Stream interrupted|Media playback could not continue/i)).not.toBeInTheDocument();
      expect(replacementAudio?.getAttribute("src")).toBe(replacementSource);
      if (replacementAudio) {
        expect(replacementAudio.currentTime).toBe(23);
      }
    });
  }

  const activePlaybackRetirementCases: Array<{
    readonly label: string;
    readonly retire: (context: {
      readonly rerender: (ui: ReactElement) => void;
      readonly unmount: () => void;
      readonly replacementPublish: (playing: boolean) => void;
      readonly fixture: ReturnType<typeof createPorts>;
    }) => HTMLAudioElement | null;
  }> = [
    {
      label: "source-only change",
      retire: ({ rerender, replacementPublish, fixture }) => {
        rerender(<PreviewModalStage {...audioProps("blob:beta", { onMediaPlaybackChange: replacementPublish, ports: fixture.ports })} />);
        return audioElement();
      }
    },
    {
      label: "path-only change with unchanged streaming source",
      retire: ({ rerender, replacementPublish, fixture }) => {
        rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", {
          file: buildFilePreview("Music/path-only.mp3", { viewer: "audio", name: "path-only.mp3", mimeType: "audio/mpeg" }),
          onMediaPlaybackChange: replacementPublish,
          ports: fixture.ports
        })} />);
        return audioElement();
      }
    },
    {
      label: "account-only change with unchanged streaming source",
      retire: ({ rerender, replacementPublish, fixture }) => {
        rerender(<PreviewModalStage {...audioProps("/api/file/stream?path=Music%2Ftrack.mp3", {
          accountId: "account-beta",
          onMediaPlaybackChange: replacementPublish,
          ports: fixture.ports
        })} />);
        return audioElement();
      }
    },
    {
      label: "viewer replacement",
      retire: ({ rerender, replacementPublish, fixture }) => {
        rerender(<PreviewModalStage {...props({
          file: buildFilePreview("Notes/readme.txt", { viewer: "text", name: "readme.txt" }),
          onMediaPlaybackChange: replacementPublish,
          ports: fixture.ports
        })} />);
        return null;
      }
    },
    {
      label: "controlled close",
      retire: ({ rerender, replacementPublish, fixture }) => {
        rerender(<PreviewModalStage {...audioProps("blob:alpha", {
          open: false,
          onMediaPlaybackChange: replacementPublish,
          ports: fixture.ports
        })} />);
        return null;
      }
    },
    {
      label: "unmount",
      retire: ({ unmount, replacementPublish, fixture }) => {
        unmount();
        render(<PreviewModalStage {...audioProps("blob:replacement-after-unmount", {
          onMediaPlaybackChange: replacementPublish,
          ports: fixture.ports
        })} />);
        return audioElement();
      }
    },
    {
      label: "full audio replacement",
      retire: ({ rerender, replacementPublish, fixture }) => {
        rerender(<PreviewModalStage {...audioProps("blob:beta", {
          accountId: "account-beta",
          file: buildFilePreview("Music/replacement.mp3", { viewer: "audio", name: "replacement.mp3", mimeType: "audio/mpeg" }),
          onMediaPlaybackChange: replacementPublish,
          ports: fixture.ports
        })} />);
        return audioElement();
      }
    }
  ];

  for (const retirementCase of activePlaybackRetirementCases) {
    it(`publishes one stopped event to the retiring owner after ${retirementCase.label}`, () => {
      const oldPublish = vi.fn<(playing: boolean) => void>();
      const replacementPublish = vi.fn<(playing: boolean) => void>();
      const fixture = createPorts();
      const pause = vi.mocked(HTMLMediaElement.prototype.pause);
      const pausedElements: HTMLMediaElement[] = [];
      pause.mockClear();
      pause.mockImplementation(function (this: HTMLMediaElement) {
        pausedElements.push(this);
      });

      const initialSource = retirementCase.label.includes("streaming")
        ? "/api/file/stream?path=Music%2Ftrack.mp3"
        : "blob:alpha";
      const rendered = render(<PreviewModalStage {...audioProps(initialSource, {
        onMediaPlaybackChange: oldPublish,
        ports: fixture.ports
      })} />);
      const retiredAudio = audioElement();
      fireEvent.playing(retiredAudio);
      expect(oldPublish).toHaveBeenCalledWith(true);
      oldPublish.mockClear();
      replacementPublish.mockClear();

      const replacementAudio = retirementCase.retire({
        rerender: rendered.rerender,
        unmount: rendered.unmount,
        replacementPublish,
        fixture
      });

      expect(oldPublish.mock.calls).toEqual([[false]]);
      expect(replacementPublish).not.toHaveBeenCalled();
      expect(pausedElements).toContain(retiredAudio);

      dispatchLateMediaEvents(retiredAudio);
      expect(oldPublish.mock.calls).toEqual([[false]]);
      expect(replacementPublish).not.toHaveBeenCalled();
      expect(replacementAudio).not.toBe(retiredAudio);
    });
  }

  it("does not publish a second stopped event when live pause already retired playback", () => {
    const oldPublish = vi.fn<(playing: boolean) => void>();
    const replacementPublish = vi.fn<(playing: boolean) => void>();
    const fixture = createPorts();
    const { rerender } = render(<PreviewModalStage {...audioProps("blob:pause", {
      onMediaPlaybackChange: oldPublish,
      ports: fixture.ports
    })} />);
    const retiredAudio = audioElement();
    fireEvent.playing(retiredAudio);
    oldPublish.mockClear();
    fireEvent.pause(retiredAudio);
    expect(oldPublish.mock.calls).toEqual([[false]]);
    oldPublish.mockClear();

    rerender(<PreviewModalStage {...audioProps("blob:replacement-after-pause", {
      onMediaPlaybackChange: replacementPublish,
      ports: fixture.ports
    })} />);
    expect(oldPublish).not.toHaveBeenCalled();
    expect(replacementPublish).not.toHaveBeenCalled();
  });

  it("publishes active StrictMode teardown to the retiring owner exactly once", () => {
    const oldPublish = vi.fn<(playing: boolean) => void>();
    const replacementPublish = vi.fn<(playing: boolean) => void>();
    const fixture = createPorts();
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    const pausedElements: HTMLMediaElement[] = [];
    pause.mockClear();
    pause.mockImplementation(function (this: HTMLMediaElement) {
      pausedElements.push(this);
    });

    const rendered = render(
      <StrictMode>
        <PreviewModalStage {...audioProps("blob:strict-alpha", { onMediaPlaybackChange: oldPublish, ports: fixture.ports })} />
      </StrictMode>
    );
    const retiredAudio = audioElement();
    oldPublish.mockClear();
    replacementPublish.mockClear();
    fireEvent.playing(retiredAudio);
    oldPublish.mockClear();

    rendered.rerender(
      <StrictMode>
        <PreviewModalStage {...audioProps("blob:strict-beta", { onMediaPlaybackChange: replacementPublish, ports: fixture.ports })} />
      </StrictMode>
    );
    const replacementAudio = audioElement();

    expect(oldPublish.mock.calls).toEqual([[false]]);
    expect(replacementPublish).not.toHaveBeenCalled();
    expect(pausedElements).toContain(retiredAudio);
    expect(document.querySelectorAll("audio.media-preview-audio")).toHaveLength(1);
    dispatchLateMediaEvents(retiredAudio);
    expect(oldPublish.mock.calls).toEqual([[false]]);
    expect(replacementPublish).not.toHaveBeenCalled();
    expect(replacementAudio).not.toBe(retiredAudio);
  });

  it("keeps StrictMode replay resources single-owned before retiring the old audio", () => {
    const save = vi.fn<PreviewModalRuntimePorts["saveAudioPreviewPosition"]>();
    const clear = vi.fn<PreviewModalRuntimePorts["clearAudioPreviewPosition"]>();
    const onMediaPlaybackChange = vi.fn<(playing: boolean) => void>();
    const fixture = createPorts({
      loadAudioPreviewPosition: vi.fn(() => undefined),
      saveAudioPreviewPosition: save,
      clearAudioPreviewPosition: clear
    });
    const listeners = captureMediaListeners();
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    const pausedElements: HTMLMediaElement[] = [];
    pause.mockClear();
    pause.mockImplementation(function (this: HTMLMediaElement) {
      pausedElements.push(this);
    });

    const rendered = render(
      <StrictMode>
        <PreviewModalStage {...audioProps("blob:strict-alpha", { onMediaPlaybackChange, ports: fixture.ports })} />
      </StrictMode>
    );
    const retiredAudio = audioElement();
    Object.defineProperty(retiredAudio, "currentTime", { configurable: true, writable: true, value: 17 });
    expect(document.querySelectorAll("audio.media-preview-audio")).toHaveLength(1);
    for (const event of RESUME_EVENTS) {
      const ownerListeners = listeners.added.filter((entry) => entry.element === retiredAudio && entry.event === event);
      expect(ownerListeners).toHaveLength(2);
      expect(listeners.removed.filter((entry) => entry.element === retiredAudio && entry.event === event && entry.listener === ownerListeners[0]?.listener)).toHaveLength(1);
    }

    // The first StrictMode cleanup is setup noise. Count only the retiring
    // identity's terminal persistence below.
    save.mockClear();
    clear.mockClear();

    rendered.rerender(
      <StrictMode>
        <PreviewModalStage {...audioProps("blob:strict-beta", { onMediaPlaybackChange, ports: fixture.ports })} />
      </StrictMode>
    );
    const replacementAudio = audioElement();
    expect(replacementAudio).not.toBe(retiredAudio);
    expect(document.querySelectorAll("audio.media-preview-audio")).toHaveLength(1);
    expect(pausedElements).toContain(retiredAudio);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ accountId: "account-alpha", path: "Music/track.mp3" }, 17);
    expect(clear).not.toHaveBeenCalled();
    for (const event of RESUME_EVENTS) {
      const ownerListeners = listeners.added.filter((entry) => entry.element === retiredAudio && entry.event === event);
      expect(listeners.removed.filter((entry) => entry.element === retiredAudio && entry.event === event && ownerListeners.some((owner) => owner.listener === entry.listener))).toHaveLength(2);
    }

    const saveCountAfterRetirement = save.mock.calls.length;
    const clearCountAfterRetirement = clear.mock.calls.length;
    const publicationCountAfterRetirement = onMediaPlaybackChange.mock.calls.length;
    dispatchLateMediaEvents(retiredAudio);
    expect(save.mock.calls.length).toBe(saveCountAfterRetirement);
    expect(clear.mock.calls.length).toBe(clearCountAfterRetirement);
    expect(onMediaPlaybackChange.mock.calls.length).toBe(publicationCountAfterRetirement);
    expect(replacementAudio.getAttribute("src")).toBe("blob:strict-beta");

    Object.defineProperty(replacementAudio, "currentTime", { configurable: true, writable: true, value: 23 });
    save.mockClear();
    clear.mockClear();
    rendered.unmount();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ accountId: "account-alpha", path: "Music/track.mp3" }, 23);
    expect(clear).not.toHaveBeenCalled();
    const replacementSaveCountAfterUnmount = save.mock.calls.length;
    const replacementClearCountAfterUnmount = clear.mock.calls.length;
    dispatchLateMediaEvents(replacementAudio);
    expect(save.mock.calls.length).toBe(replacementSaveCountAfterUnmount);
    expect(clear.mock.calls.length).toBe(replacementClearCountAfterUnmount);
  });

  it("binds and removes resume listeners once for a source that arrives after open", () => {
    const added: Array<{ event: string; element: EventTarget; listener: EventListenerOrEventListenerObject }> = [];
    const removed: Array<{ event: string; element: EventTarget; listener: EventListenerOrEventListenerObject }> = [];
    const add = vi.spyOn(HTMLMediaElement.prototype, "addEventListener").mockImplementation(function (this: HTMLMediaElement, event, listener, options) {
      if (listener) {
        added.push({ event: String(event), element: this, listener });
      }
      EventTarget.prototype.addEventListener.call(this, event, listener, options);
    });
    const remove = vi.spyOn(HTMLMediaElement.prototype, "removeEventListener").mockImplementation(function (this: HTMLMediaElement, event, listener, options) {
      if (listener) {
        removed.push({ event: String(event), element: this, listener });
      }
      EventTarget.prototype.removeEventListener.call(this, event, listener, options);
    });
    const fixture = createPorts();
    const { rerender } = render(<PreviewModalStage {...props({ file: buildFilePreview("Music/track.mp3", { viewer: "audio" }), ports: fixture.ports })} />);
    expect(document.querySelector("audio")).toBeNull();
    rerender(<PreviewModalStage {...audioProps("blob:cached-after-open", { ports: fixture.ports })} />);
    const audio = audioElement();
    const expectedEvents = ["loadedmetadata", "timeupdate", "pause", "ended"];
    const ownerListenerNames = new Set(["handleLoadedMetadata", "handleTimeUpdate", "handlePause", "handleEnded"]);
    for (const event of expectedEvents) {
      const ownerListeners = added.filter((entry) => entry.element === audio && entry.event === event && typeof entry.listener === "function" && ownerListenerNames.has(entry.listener.name));
      expect(ownerListeners).toHaveLength(1);
      expect(removed).not.toContainEqual(expect.objectContaining({ element: audio, event, listener: ownerListeners[0]?.listener }));
    }
    rerender(<PreviewModalStage {...props({ open: false, ports: fixture.ports })} />);
    for (const event of expectedEvents) {
      const ownerListeners = added.filter((entry) => entry.element === audio && entry.event === event && typeof entry.listener === "function" && ownerListenerNames.has(entry.listener.name));
      expect(removed.filter((entry) => entry.element === audio && entry.event === event && entry.listener === ownerListeners[0]?.listener)).toHaveLength(1);
    }
    add.mockRestore();
    remove.mockRestore();
  });
});
