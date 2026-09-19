// @vitest-environment jsdom

import { StrictMode } from "react";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { folderAudioStorageKey, type FileLikeEntry } from "./model";
import { FolderAudioPlayerStage } from "./FolderAudioPlayerStage";
import type { FolderAudioRuntimePorts } from "./ports";
import {
  useFolderAudioPlayer,
  type FolderAudioPlayerInteraction,
  type FolderAudioStageBindings
} from "./useFolderAudioPlayer";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: T) => void;
}

interface StreamRequest {
  readonly deferred: Deferred<string>;
  readonly path: string;
  readonly token: string;
}

interface AudioLifecyclePorts extends FolderAudioRuntimePorts {
  readonly savedPreviewPositions: Map<string, number>;
  readonly storageMap: Map<string, string>;
  readonly streamRequests: StreamRequest[];
  readonly createStreamingFileUrlMock: ReturnType<typeof vi.fn>;
  readonly saveAudioPreviewPositionMock: ReturnType<typeof vi.fn>;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise
  };
}

function createPorts(): AudioLifecyclePorts {
  const storageMap = new Map<string, string>();
  const savedPreviewPositions = new Map<string, number>();
  const streamRequests: StreamRequest[] = [];
  const createStreamingFileUrlMock = vi.fn((path: string, token: string) => {
    const request = {
      deferred: deferred<string>(),
      path,
      token
    };
    streamRequests.push(request);
    return request.deferred.promise;
  });
  const saveAudioPreviewPositionMock = vi.fn(({ accountId, path }: { accountId: string; path: string }, positionSeconds: number) => {
    savedPreviewPositions.set(`${accountId}:${path}`, positionSeconds);
  });
  return {
    createStreamingFileUrl: createStreamingFileUrlMock,
    createStreamingFileUrlMock,
    loadAudioPreviewPosition: ({ accountId, path }) => savedPreviewPositions.get(`${accountId}:${path}`),
    nowIso: () => "2026-08-25T05:30:00.000Z",
    saveAudioPreviewPosition: saveAudioPreviewPositionMock,
    saveAudioPreviewPositionMock,
    savedPreviewPositions,
    storage: {
      getItem: (key) => storageMap.get(key) ?? null,
      removeItem: (key) => {
        storageMap.delete(key);
      },
      setItem: (key, value) => {
        storageMap.set(key, value);
      }
    },
    storageMap,
    streamRequests
  };
}

const firstTrack: FileLikeEntry = {
  mimeType: "audio/mp4",
  name: "chapter.m4a",
  path: "Projects/chapter.m4a"
};
const secondTrack: FileLikeEntry = {
  mimeType: "audio/mp4",
  name: "second.m4a",
  path: "Projects/second.m4a"
};
const thirdTrack: FileLikeEntry = {
  mimeType: "audio/mp4",
  name: "third.m4a",
  path: "Projects/third.m4a"
};
const archiveTrack: FileLikeEntry = {
  mimeType: "audio/mp4",
  name: "chapter.m4a",
  path: "Archive/chapter.m4a"
};
const visibleItems = [firstTrack, secondTrack, thirdTrack];

interface AudioLifecycleHarnessProps {
  readonly accountId?: string;
  readonly cacheOnlyMode?: boolean;
  readonly folderLabel?: string;
  readonly folderPath?: string;
  readonly onPlayingChange?: (playing: boolean) => void;
  readonly ports: AudioLifecyclePorts;
  readonly token?: string;
  readonly visibleItems?: readonly FileLikeEntry[];
  readonly expose?: (interaction: FolderAudioPlayerInteraction) => void;
}

function AudioLifecycleHarness({
  accountId = "alpha",
  cacheOnlyMode = false,
  folderLabel,
  folderPath = "Projects",
  onPlayingChange,
  ports,
  token = "token-alpha",
  visibleItems: items = visibleItems,
  expose
}: AudioLifecycleHarnessProps) {
  const interaction = useFolderAudioPlayer({
    context: {
      accountId,
      cacheOnlyMode,
      folderLabel: folderLabel ?? folderPath,
      folderPath,
      token,
      visibleItems: items
    },
    onPlayingChange,
    ports
  });
  expose?.(interaction);

  return (
    <>
      <output data-testid="current-path">{interaction.stage?.currentTrack.path ?? ""}</output>
      <output data-testid="error">{interaction.stage?.error ?? ""}</output>
      <output data-testid="playing">{String(interaction.playing)}</output>
      <output data-testid="stream-url">{interaction.stage?.streamUrl ?? ""}</output>
      <FolderAudioPlayerStage interaction={interaction} />
    </>
  );
}

function audioElement(): HTMLAudioElement {
  const element = document.querySelector("section.folder-audio-player audio");
  if (!(element instanceof HTMLAudioElement)) {
    throw new Error("Expected the folder-audio element.");
  }
  return element;
}

function streamUrl(path: string): string {
  return `/api/file/stream?path=${encodeURIComponent(path)}&streamToken=opaque`;
}

async function flushMicrotasks() {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) {
      await Promise.resolve();
    }
  });
}

function latestRequest(ports: AudioLifecyclePorts): StreamRequest {
  const request = ports.streamRequests.at(-1);
  if (!request) {
    throw new Error("Expected a stream request.");
  }
  return request;
}

function currentInteraction(ref: { current?: FolderAudioPlayerInteraction }): FolderAudioPlayerInteraction {
  if (!ref.current) {
    throw new Error("Expected the current folder-audio interaction.");
  }
  return ref.current;
}

function currentStage(ref: { current?: FolderAudioPlayerInteraction }): FolderAudioStageBindings {
  const stage = currentInteraction(ref).stage;
  if (!stage) {
    throw new Error("Expected the current folder-audio stage.");
  }
  return stage;
}

async function activate(ref: { current?: FolderAudioPlayerInteraction }, entry = firstTrack) {
  act(() => {
    currentInteraction(ref).activate(entry);
  });
  await flushMicrotasks();
}

async function resolveLatest(ports: AudioLifecyclePorts) {
  latestRequest(ports).deferred.resolve(streamUrl(latestRequest(ports).path));
  await flushMicrotasks();
}

interface PendingPlay {
  readonly element: HTMLMediaElement;
  readonly deferred: Deferred<void>;
}

interface PendingPlaySession {
  readonly interactionRef: { current?: FolderAudioPlayerInteraction };
  readonly oldAudio: HTMLAudioElement;
  readonly oldStage: FolderAudioStageBindings;
  readonly pendingPlays: PendingPlay[];
  readonly ports: AudioLifecyclePorts;
  readonly view: ReturnType<typeof render>;
}

describe("useFolderAudioPlayer lifecycle characterization", () => {
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

  type PlayRetirementContext = "account" | "folder" | "token" | "cache-only" | "ports" | "close";

  async function preparePendingAutoplay(): Promise<PendingPlaySession> {
    const pendingPlays: PendingPlay[] = [];
    mediaPlayMock.mockImplementation(function (this: HTMLMediaElement) {
      const pending = {
        deferred: deferred<void>(),
        element: this
      };
      pendingPlays.push(pending);
      return pending.deferred.promise;
    });
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    const oldAudio = audioElement();
    const oldStage = currentStage(interactionRef);
    expect(pendingPlays).toHaveLength(1);
    expect(pendingPlays[0]?.element).toBe(oldAudio);
    return { interactionRef, oldAudio, oldStage, pendingPlays, ports, view };
  }

  async function preparePendingManual(): Promise<PendingPlaySession> {
    const session = await preparePendingAutoplay();
    session.pendingPlays[0]?.deferred.reject(new DOMException("autoplay", "NotAllowedError"));
    await flushMicrotasks();
    fireEvent.click(screen.getByRole("button", { name: "Play folder audio" }));
    await flushMicrotasks();
    expect(session.pendingPlays).toHaveLength(2);
    expect(session.pendingPlays[1]?.element).toBe(session.oldAudio);
    return session;
  }

  async function transitionPendingPlay(
    session: PendingPlaySession,
    context: PlayRetirementContext,
    retiredPlayCount: number
  ): Promise<{ readonly currentPending: PendingPlay; readonly replacementAudio: HTMLAudioElement; readonly replacementPorts: AudioLifecyclePorts }> {
    let replacementPorts = session.ports;
    switch (context) {
      case "account":
        {
          const replacementRef: { current?: FolderAudioPlayerInteraction } = {};
          session.view.rerender(<AudioLifecycleHarness accountId="beta" ports={session.ports} token="token-alpha" expose={(value) => { replacementRef.current = value; }} />);
          await waitFor(() => expect(screen.getByTestId("current-path")).toBeEmptyDOMElement());
          if (!replacementRef.current) throw new Error("Expected account replacement interaction.");
          session.interactionRef.current = replacementRef.current;
        }
        await activate(session.interactionRef, firstTrack);
        await resolveLatest(session.ports);
        break;
      case "folder":
        {
          const replacementRef: { current?: FolderAudioPlayerInteraction } = {};
          session.view.rerender(<AudioLifecycleHarness folderPath="Archive" folderLabel="Archive" visibleItems={[archiveTrack]} ports={session.ports} expose={(value) => { replacementRef.current = value; }} />);
          await waitFor(() => expect(screen.getByTestId("current-path")).toBeEmptyDOMElement());
          if (!replacementRef.current) throw new Error("Expected folder replacement interaction.");
          session.interactionRef.current = replacementRef.current;
        }
        await activate(session.interactionRef, archiveTrack);
        await resolveLatest(session.ports);
        break;
      case "token":
        session.view.rerender(<AudioLifecycleHarness ports={session.ports} token="token-beta" />);
        await flushMicrotasks();
        await resolveLatest(session.ports);
        break;
      case "cache-only":
        session.view.rerender(<AudioLifecycleHarness cacheOnlyMode ports={session.ports} />);
        await flushMicrotasks();
        session.view.rerender(<AudioLifecycleHarness ports={session.ports} token="token-alpha" />);
        await flushMicrotasks();
        await resolveLatest(session.ports);
        break;
      case "ports":
        replacementPorts = createPorts();
        session.view.rerender(<AudioLifecycleHarness expose={(value) => { session.interactionRef.current = value; }} ports={replacementPorts} />);
        await flushMicrotasks();
        await resolveLatest(replacementPorts);
        break;
      case "close":
        act(() => session.oldStage.onClose());
        await waitFor(() => expect(screen.queryByRole("region", { name: /Audio playlist/i })).not.toBeInTheDocument());
        await activate(session.interactionRef, firstTrack);
        await resolveLatest(session.ports);
        break;
    }
    const replacementAudio = audioElement();
    expect(replacementAudio).not.toBe(session.oldAudio);
    if (session.pendingPlays.length === retiredPlayCount) {
      fireEvent.click(screen.getByRole("button", { name: "Play folder audio" }));
      await flushMicrotasks();
    }
    const currentPending = session.pendingPlays.at(-1);
    if (!currentPending || session.pendingPlays.length <= retiredPlayCount) {
      throw new Error("Expected a current replacement play promise.");
    }
    expect(currentPending.element).toBe(replacementAudio);
    return { currentPending, replacementAudio, replacementPorts };
  }

  it("T01 current activation acquires one stream and autoplay pipeline", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);

    await activate(interactionRef);
    expect(ports.streamRequests).toHaveLength(1);
    expect(latestRequest(ports)).toMatchObject({ path: firstTrack.path, token: "token-alpha" });
    await resolveLatest(ports);

    expect(screen.getByTestId("current-path")).toHaveTextContent(firstTrack.path);
    expect(screen.getByTestId("stream-url")).toHaveTextContent(streamUrl(firstTrack.path));
    expect(mediaPlayMock).toHaveBeenCalledTimes(1);
    expect(audioElement().getAttribute("src")).toContain(encodeURIComponent(firstTrack.path));
  });

  it("T02 current stream failure is terminal and does not retry or play", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);

    await activate(interactionRef);
    latestRequest(ports).deferred.reject(new Error("stream unavailable"));
    await flushMicrotasks();

    expect(screen.getByTestId("error")).toHaveTextContent("Audio stream is unavailable right now.");
    expect(ports.streamRequests).toHaveLength(1);
    expect(mediaPlayMock).not.toHaveBeenCalled();
  });

  it("T03 current autoplay rejection exposes the established fallback and manual play remains available", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    mediaPlayMock.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);

    await activate(interactionRef);
    await resolveLatest(ports);
    expect(screen.getByTestId("error")).toHaveTextContent(/Playback was blocked by the browser/i);
    mediaPlayMock.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Play folder audio" }));
    await flushMicrotasks();
    expect(mediaPlayMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
  });

  it("T04 stale stream settlement is inert after track replacement and newer request", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    const oldRequest = latestRequest(ports);
    const oldStage = currentStage(interactionRef);

    act(() => oldStage.onSelectTrack(secondTrack, { play: false }));
    await flushMicrotasks();
    expect(ports.streamRequests).toHaveLength(2);
    const currentRequest = latestRequest(ports);
    oldRequest.deferred.resolve(streamUrl(oldRequest.path));
    await flushMicrotasks();
    expect(screen.getByTestId("current-path")).toHaveTextContent(secondTrack.path);
    expect(screen.getByTestId("stream-url")).toBeEmptyDOMElement();

    currentRequest.deferred.resolve(streamUrl(currentRequest.path));
    await flushMicrotasks();
    expect(screen.getByTestId("stream-url")).toHaveTextContent(streamUrl(secondTrack.path));
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
  });

  it("T05a stale stream settlement is inert after account replacement", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    const oldRequest = latestRequest(ports);

    view.rerender(<AudioLifecycleHarness accountId="beta" ports={ports} token="token-beta" />);
    await flushMicrotasks();
    oldRequest.deferred.reject(new Error("stale account stream"));
    await flushMicrotasks();
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
    expect(screen.getByTestId("current-path")).toBeEmptyDOMElement();
  });

  it("T05b stale stream settlement is inert after folder replacement", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    const oldRequest = latestRequest(ports);
    view.rerender(<AudioLifecycleHarness folderPath="Archive" folderLabel="Archive" ports={ports} />);
    await flushMicrotasks();
    oldRequest.deferred.reject(new Error("stale folder stream"));
    await flushMicrotasks();
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
    expect(screen.getByTestId("current-path")).toBeEmptyDOMElement();
  });

  it("T06a stale stream settlement is inert after token replacement", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    const oldRequest = latestRequest(ports);

    view.rerender(<AudioLifecycleHarness ports={ports} token="token-beta" />);
    await flushMicrotasks();
    expect(ports.streamRequests).toHaveLength(2);
    const replacementRequest = latestRequest(ports);
    oldRequest.deferred.resolve(streamUrl(oldRequest.path));
    await flushMicrotasks();
    expect(screen.getByTestId("stream-url")).toBeEmptyDOMElement();
    replacementRequest.deferred.resolve(streamUrl(replacementRequest.path));
    await flushMicrotasks();
    expect(screen.getByTestId("stream-url")).toHaveTextContent(streamUrl(firstTrack.path));
  });

  it("T06b stale stream settlement is inert after cache-only transition", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    const oldRequest = latestRequest(ports);
    view.rerender(<AudioLifecycleHarness cacheOnlyMode ports={ports} />);
    await flushMicrotasks();
    oldRequest.deferred.resolve(streamUrl(oldRequest.path));
    await flushMicrotasks();
    expect(screen.getByTestId("stream-url")).toBeEmptyDOMElement();
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
  });

  it("T06c stale stream settlement is inert after close", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    const oldRequest = latestRequest(ports);
    act(() => currentStage(interactionRef).onClose());
    await flushMicrotasks();
    oldRequest.deferred.resolve(streamUrl(oldRequest.path));
    await flushMicrotasks();
    expect(screen.queryByRole("region", { name: /Audio playlist/i })).not.toBeInTheDocument();
    view.unmount();
  });

  it("T06d stale stream settlement is inert after unmount", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    const unmountedRequest = latestRequest(ports);
    view.unmount();
    unmountedRequest.deferred.resolve(streamUrl(unmountedRequest.path));
    await flushMicrotasks();
    expect(screen.queryByRole("region", { name: /Audio playlist/i })).not.toBeInTheDocument();
  });

  it("T06e stale stream settlement is inert after ports replacement", async () => {
    const oldPorts = createPorts();
    const replacementPorts = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={oldPorts} />);
    await activate(interactionRef);
    const oldRequest = latestRequest(oldPorts);
    view.rerender(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={replacementPorts} />);
    await flushMicrotasks();
    expect(replacementPorts.streamRequests).toHaveLength(1);
    const replacementRequest = latestRequest(replacementPorts);
    oldRequest.deferred.resolve(streamUrl(oldRequest.path));
    await flushMicrotasks();
    expect(screen.getByTestId("stream-url")).toBeEmptyDOMElement();
    replacementRequest.deferred.resolve(streamUrl(replacementRequest.path));
    await flushMicrotasks();
    expect(screen.getByTestId("stream-url")).toHaveTextContent(streamUrl(firstTrack.path));
  });

  it("T07 same-track reactivation reuses only the current stream and current media", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    const originalAudio = audioElement();
    mediaPlayMock.mockClear();

    await activate(interactionRef, firstTrack);
    expect(ports.streamRequests).toHaveLength(1);
    expect(mediaPlayMock).toHaveBeenCalledTimes(1);
    expect(audioElement()).toBe(originalAudio);
  });

  it("T07b same-track token replacement does not reuse the prior media", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    const originalAudio = audioElement();
    view.rerender(<AudioLifecycleHarness ports={ports} token="token-beta" />);
    await flushMicrotasks();
    expect(ports.streamRequests).toHaveLength(2);
    await resolveLatest(ports);
    expect(audioElement()).not.toBe(originalAudio);
  });

  it("T07c same-track account replacement does not reuse the prior media", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    const originalAudio = audioElement();
    const replacementRef: { current?: FolderAudioPlayerInteraction } = {};
    view.rerender(<AudioLifecycleHarness accountId="beta" ports={ports} token="token-beta" expose={(value) => { replacementRef.current = value; }} />);
    await waitFor(() => expect(screen.getByTestId("current-path")).toBeEmptyDOMElement());
    await flushMicrotasks();
    if (!replacementRef.current) throw new Error("Expected account replacement interaction.");
    await activate(replacementRef, firstTrack);
    expect(ports.streamRequests).toHaveLength(2);
    await resolveLatest(ports);
    expect(audioElement()).not.toBe(originalAudio);
  });

  it("T07d same-track folder replacement does not reuse the prior media", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    const originalAudio = audioElement();
    const replacementRef: { current?: FolderAudioPlayerInteraction } = {};
    view.rerender(<AudioLifecycleHarness folderPath="Archive" folderLabel="Archive" ports={ports} expose={(value) => { replacementRef.current = value; }} />);
    await waitFor(() => expect(screen.getByTestId("current-path")).toBeEmptyDOMElement());
    await flushMicrotasks();
    if (!replacementRef.current) throw new Error("Expected folder replacement interaction.");
    await activate(replacementRef, firstTrack);
    expect(ports.streamRequests).toHaveLength(2);
    await resolveLatest(ports);
    expect(audioElement()).not.toBe(originalAudio);
  });

  it("T07e same-track ports replacement does not reuse the prior media", async () => {
    const oldPorts = createPorts();
    const replacementPorts = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={oldPorts} />);
    await activate(interactionRef);
    await resolveLatest(oldPorts);
    const originalAudio = audioElement();
    view.rerender(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={replacementPorts} />);
    await flushMicrotasks();
    expect(replacementPorts.streamRequests).toHaveLength(1);
    await resolveLatest(replacementPorts);
    expect(audioElement()).not.toBe(originalAudio);
  });

  it("T08 cache-only and token-absent contexts perform no stream request or autoplay work", async () => {
    const cacheOnlyPorts = createPorts();
    const cacheOnlyRef: { current?: FolderAudioPlayerInteraction } = {};
    render(<AudioLifecycleHarness cacheOnlyMode expose={(value) => { cacheOnlyRef.current = value; }} ports={cacheOnlyPorts} />);
    await activate(cacheOnlyRef);
    expect(cacheOnlyPorts.streamRequests).toHaveLength(0);
    expect(mediaPlayMock).not.toHaveBeenCalled();
    cleanup();

    const tokenlessPorts = createPorts();
    const tokenlessRef: { current?: FolderAudioPlayerInteraction } = {};
    render(<AudioLifecycleHarness expose={(value) => { tokenlessRef.current = value; }} ports={tokenlessPorts} token="" />);
    await activate(tokenlessRef);
    expect(tokenlessPorts.streamRequests).toHaveLength(0);
    expect(mediaPlayMock).not.toHaveBeenCalled();
  });

  it("T09 stale autoplay rejection cannot mark a replacement track blocked", async () => {
    const pendingPlays: PendingPlay[] = [];
    mediaPlayMock.mockImplementation(function (this: HTMLMediaElement) {
      const pending = {
        deferred: deferred<void>(),
        element: this
      };
      pendingPlays.push(pending);
      return pending.deferred.promise;
    });
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    expect(pendingPlays).toHaveLength(1);
    const oldAudio = audioElement();
    expect(pendingPlays[0]?.element).toBe(oldAudio);
    const oldStage = currentStage(interactionRef);
    act(() => oldStage.onSelectTrack(secondTrack, { play: true }));
    await flushMicrotasks();
    await resolveLatest(ports);
    expect(pendingPlays).toHaveLength(2);
    const replacementAudio = audioElement();
    expect(replacementAudio).not.toBe(oldAudio);
    expect(pendingPlays[1]?.element).toBe(replacementAudio);

    pendingPlays[0]?.deferred.reject(new DOMException("stale", "NotAllowedError"));
    await flushMicrotasks();
    expect(screen.getByTestId("current-path")).toHaveTextContent(secondTrack.path);
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
  });

  it("T10 current autoplay rejection remains visible and does not retry", async () => {
    const pendingPlays: PendingPlay[] = [];
    mediaPlayMock.mockImplementation(function (this: HTMLMediaElement) {
      const pending = {
        deferred: deferred<void>(),
        element: this
      };
      pendingPlays.push(pending);
      return pending.deferred.promise;
    });
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    pendingPlays[0]?.deferred.reject(new DOMException("blocked", "NotAllowedError"));
    await flushMicrotasks();
    expect(screen.getByTestId("error")).toHaveTextContent(/Playback was blocked by the browser/i);
    expect(ports.streamRequests).toHaveLength(1);
  });

  it("T11 stale manual-play rejection cannot mark a replacement track blocked", async () => {
    const pendingPlays: PendingPlay[] = [];
    mediaPlayMock.mockImplementation(function (this: HTMLMediaElement) {
      const pending = {
        deferred: deferred<void>(),
        element: this
      };
      pendingPlays.push(pending);
      return pending.deferred.promise;
    });
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    const oldAudio = audioElement();
    pendingPlays[0]?.deferred.reject(new DOMException("autoplay", "NotAllowedError"));
    await flushMicrotasks();
    const oldStage = currentStage(interactionRef);
    fireEvent.click(screen.getByRole("button", { name: "Play folder audio" }));
    expect(pendingPlays).toHaveLength(2);
    expect(pendingPlays[0]?.element).toBe(oldAudio);
    expect(pendingPlays[1]?.element).toBe(oldAudio);
    act(() => oldStage.onSelectTrack(secondTrack, { play: false }));
    await flushMicrotasks();
    const replacementAudio = audioElement();
    expect(replacementAudio).not.toBe(oldAudio);
    pendingPlays[1]?.deferred.reject(new DOMException("stale manual", "NotAllowedError"));
    await flushMicrotasks();
    expect(screen.getByTestId("current-path")).toHaveTextContent(secondTrack.path);
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
  });

  it.each(["account", "folder", "token", "cache-only", "ports", "close"] as const)(
    "T21 autoplay rejection after %s replacement cannot mark the current owner blocked",
    async (context) => {
      const session = await preparePendingAutoplay();
      const { currentPending } = await transitionPendingPlay(session, context, 1);
      currentPending.deferred.resolve();
      await flushMicrotasks();
      session.pendingPlays[0]?.deferred.reject(new DOMException("stale autoplay", "NotAllowedError"));
      await flushMicrotasks();
      expect(screen.getByTestId("error")).toBeEmptyDOMElement();
    }
  );

  it.each(["account", "folder", "token", "cache-only", "ports", "close"] as const)(
    "T22 manual-play rejection after %s replacement cannot mark the current owner blocked",
    async (context) => {
      const session = await preparePendingManual();
      const { currentPending } = await transitionPendingPlay(session, context, 2);
      currentPending.deferred.resolve();
      await flushMicrotasks();
      session.pendingPlays[1]?.deferred.reject(new DOMException("stale manual", "NotAllowedError"));
      await flushMicrotasks();
      expect(screen.getByTestId("error")).toBeEmptyDOMElement();
    }
  );

  async function prepareReplacement(): Promise<{
    readonly oldAudio: HTMLAudioElement;
    readonly oldStage: FolderAudioStageBindings;
    readonly ports: AudioLifecyclePorts;
    readonly replacementAudio: HTMLAudioElement;
    readonly interactionRef: { current?: FolderAudioPlayerInteraction };
  }> {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    const oldAudio = audioElement();
    const oldStage = currentStage(interactionRef);
    act(() => oldStage.onSelectTrack(secondTrack, { play: false }));
    await flushMicrotasks();
    await resolveLatest(ports);
    const replacementAudio = audioElement();
    expect(replacementAudio).not.toBe(oldAudio);
    return {
      oldAudio,
      oldStage,
      ports,
      replacementAudio,
      interactionRef
    };
  }

  it("T12 retired loaded-metadata callback cannot overwrite replacement duration", async () => {
    const prepared = await prepareReplacement();
    Object.defineProperty(prepared.oldAudio, "duration", { configurable: true, value: 120 });
    prepared.oldStage.onLoadedMetadata(prepared.oldAudio);
    await flushMicrotasks();
    expect(currentStage(prepared.interactionRef).durationSeconds).toBe(0);
  });

  it("T13 retired time-update callback cannot persist replacement position", async () => {
    const prepared = await prepareReplacement();
    Object.defineProperty(prepared.oldAudio, "currentTime", { configurable: true, writable: true, value: 99 });
    Object.defineProperty(prepared.oldAudio, "duration", { configurable: true, value: 120 });
    prepared.oldStage.onTimeUpdate(prepared.oldAudio);
    await flushMicrotasks();
    expect(prepared.ports.savedPreviewPositions.get(`alpha:${firstTrack.path}`)).toBeUndefined();
    expect(JSON.parse(prepared.ports.storageMap.get(folderAudioStorageKey("alpha", "Projects")) ?? "{}")).toMatchObject({
      currentPath: secondTrack.path,
      positionSeconds: 0
    });
  });

  it("T14a retired pause callback cannot publish replacement playback", async () => {
    const publish = vi.fn<(playing: boolean) => void>();
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} onPlayingChange={publish} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    const oldStage = currentStage(interactionRef);
    act(() => oldStage.onSelectTrack(secondTrack, { play: false }));
    await flushMicrotasks();
    await resolveLatest(ports);
    act(() => currentStage(interactionRef).onPlay());
    await flushMicrotasks();
    expect(screen.getByTestId("playing")).toHaveTextContent("true");
    publish.mockClear();
    oldStage.onPause();
    await flushMicrotasks();
    expect(screen.getByTestId("playing")).toHaveTextContent("true");
    expect(publish).not.toHaveBeenCalled();
  });

  it("T14b retired play callback cannot publish replacement playback", async () => {
    const publish = vi.fn<(playing: boolean) => void>();
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} onPlayingChange={publish} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    const oldStage = currentStage(interactionRef);
    act(() => oldStage.onSelectTrack(secondTrack, { play: false }));
    await flushMicrotasks();
    await resolveLatest(ports);
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
    publish.mockClear();
    oldStage.onPlay();
    await flushMicrotasks();
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
    expect(publish).not.toHaveBeenCalled();
  });

  it("T15a retired seek callback cannot move replacement media or persistence", async () => {
    const prepared = await prepareReplacement();
    Object.defineProperty(prepared.replacementAudio, "currentTime", { configurable: true, writable: true, value: 10 });
    Object.defineProperty(prepared.replacementAudio, "duration", { configurable: true, value: 100 });
    prepared.oldStage.onSeek(77);
    await flushMicrotasks();
    expect(prepared.replacementAudio.currentTime).toBe(10);
    expect(JSON.parse(prepared.ports.storageMap.get(folderAudioStorageKey("alpha", "Projects")) ?? "{}")).toMatchObject({
      currentPath: secondTrack.path,
      positionSeconds: 0
    });
  });

  it("T15b retired skip callback cannot move replacement media or persistence", async () => {
    const prepared = await prepareReplacement();
    Object.defineProperty(prepared.replacementAudio, "currentTime", { configurable: true, writable: true, value: 10 });
    Object.defineProperty(prepared.replacementAudio, "duration", { configurable: true, value: 100 });
    prepared.oldStage.onSkip(15);
    await flushMicrotasks();
    expect(prepared.replacementAudio.currentTime).toBe(10);
    expect(JSON.parse(prepared.ports.storageMap.get(folderAudioStorageKey("alpha", "Projects")) ?? "{}")).toMatchObject({
      currentPath: secondTrack.path,
      positionSeconds: 0
    });
  });

  it("T16a retired ended callback cannot advance the replacement owner", async () => {
    const prepared = await prepareReplacement();
    const requestCount = prepared.ports.streamRequests.length;
    prepared.oldStage.onEnded();
    await flushMicrotasks();
    expect(prepared.ports.streamRequests).toHaveLength(requestCount);
    expect(screen.getByTestId("current-path")).toHaveTextContent(secondTrack.path);
  });

  it("T16b retired selection callback cannot select the replacement owner", async () => {
    const prepared = await prepareReplacement();
    const requestCount = prepared.ports.streamRequests.length;
    prepared.oldStage.onSelectTrack(thirdTrack, { play: false });
    await flushMicrotasks();
    expect(prepared.ports.streamRequests).toHaveLength(requestCount);
    expect(screen.getByTestId("current-path")).toHaveTextContent(secondTrack.path);
  });

  it("T17a retired time-update callback after unmount cannot save", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    const oldStage = currentStage(interactionRef);
    const oldAudio = audioElement();
    view.unmount();
    Object.defineProperty(oldAudio, "currentTime", { configurable: true, writable: true, value: 88 });
    oldStage.onTimeUpdate(oldAudio);
    await flushMicrotasks();
    expect(ports.saveAudioPreviewPositionMock).not.toHaveBeenCalled();
  });

  it("T17b retired play callback after unmount cannot publish", async () => {
    const ports = createPorts();
    const publish = vi.fn<(playing: boolean) => void>();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} onPlayingChange={publish} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    const oldStage = currentStage(interactionRef);
    view.unmount();
    oldStage.onPlay();
    await flushMicrotasks();
    expect(publish).not.toHaveBeenCalledWith(true);
  });

  it("T18a account change isolates persisted resume positions and current controls", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    const oldStage = currentStage(interactionRef);
    const oldAudio = audioElement();
    Object.defineProperty(oldAudio, "currentTime", { configurable: true, writable: true, value: 12 });
    oldStage.onTimeUpdate(oldAudio);
    await flushMicrotasks();
    expect(ports.savedPreviewPositions.get(`alpha:${firstTrack.path}`)).toBe(12);

    const replacementRef: { current?: FolderAudioPlayerInteraction } = {};
    view.rerender(<AudioLifecycleHarness accountId="beta" ports={ports} token="token-beta" expose={(value) => { replacementRef.current = value; }} />);
    await waitFor(() => expect(screen.getByTestId("current-path")).toBeEmptyDOMElement());
    await activate(replacementRef, firstTrack);
    await resolveLatest(ports);
    const replacementAudio = audioElement();
    Object.defineProperty(replacementAudio, "currentTime", { configurable: true, writable: true, value: 21 });
    currentStage(replacementRef).onTimeUpdate(replacementAudio);
    await flushMicrotasks();
    expect(ports.savedPreviewPositions.get(`beta:${firstTrack.path}`)).toBe(21);
    expect(JSON.parse(ports.storageMap.get(folderAudioStorageKey("beta", "Projects")) ?? "{}")).toMatchObject({
      currentPath: firstTrack.path,
      positionSeconds: 21
    });
    Object.defineProperty(oldAudio, "currentTime", { configurable: true, writable: true, value: 99 });
    oldStage.onTimeUpdate(oldAudio);
    await flushMicrotasks();
    expect(ports.savedPreviewPositions.get(`alpha:${firstTrack.path}`)).toBe(12);
    expect(ports.savedPreviewPositions.get(`beta:${firstTrack.path}`)).toBe(21);
    expect(screen.getByTestId("current-path")).toHaveTextContent(firstTrack.path);
  });

  it("T18b folder change isolates persisted resume positions and current controls", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    const oldStage = currentStage(interactionRef);
    const oldAudio = audioElement();
    Object.defineProperty(oldAudio, "currentTime", { configurable: true, writable: true, value: 12 });
    oldStage.onTimeUpdate(oldAudio);
    await flushMicrotasks();
    expect(ports.savedPreviewPositions.get(`alpha:${firstTrack.path}`)).toBe(12);

    const replacementRef: { current?: FolderAudioPlayerInteraction } = {};
    view.rerender(<AudioLifecycleHarness folderPath="Archive" folderLabel="Archive" visibleItems={[archiveTrack]} ports={ports} expose={(value) => { replacementRef.current = value; }} />);
    await waitFor(() => expect(screen.getByTestId("current-path")).toBeEmptyDOMElement());
    await activate(replacementRef, archiveTrack);
    await resolveLatest(ports);
    const replacementAudio = audioElement();
    Object.defineProperty(replacementAudio, "currentTime", { configurable: true, writable: true, value: 21 });
    currentStage(replacementRef).onTimeUpdate(replacementAudio);
    await flushMicrotasks();
    expect(ports.savedPreviewPositions.get(`alpha:${archiveTrack.path}`)).toBe(21);
    expect(JSON.parse(ports.storageMap.get(folderAudioStorageKey("alpha", "Archive")) ?? "{}")).toMatchObject({
      currentPath: archiveTrack.path,
      positionSeconds: 21
    });
    Object.defineProperty(oldAudio, "currentTime", { configurable: true, writable: true, value: 99 });
    oldStage.onTimeUpdate(oldAudio);
    await flushMicrotasks();
    expect(ports.savedPreviewPositions.get(`alpha:${archiveTrack.path}`)).toBe(21);
    expect(screen.getByTestId("current-path")).toHaveTextContent(archiveTrack.path);
  });

  it("T18c ports change isolates persisted resume positions and current media", async () => {
    const oldPorts = createPorts();
    const replacementPorts = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={oldPorts} />);
    await activate(interactionRef);
    await resolveLatest(oldPorts);
    const oldStage = currentStage(interactionRef);
    const oldAudio = audioElement();
    Object.defineProperty(oldAudio, "currentTime", { configurable: true, writable: true, value: 12 });
    oldStage.onTimeUpdate(oldAudio);
    await flushMicrotasks();
    expect(oldPorts.savedPreviewPositions.get(`alpha:${firstTrack.path}`)).toBe(12);

    view.rerender(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={replacementPorts} />);
    await flushMicrotasks();
    await resolveLatest(replacementPorts);
    const replacementAudio = audioElement();
    expect(replacementAudio).not.toBe(oldAudio);
    Object.defineProperty(replacementAudio, "currentTime", { configurable: true, writable: true, value: 21 });
    currentStage(interactionRef).onTimeUpdate(replacementAudio);
    await flushMicrotasks();
    expect(replacementPorts.savedPreviewPositions.get(`alpha:${firstTrack.path}`)).toBe(21);

    Object.defineProperty(oldAudio, "currentTime", { configurable: true, writable: true, value: 99 });
    oldStage.onTimeUpdate(oldAudio);
    await flushMicrotasks();
    expect(oldPorts.savedPreviewPositions.get(`alpha:${firstTrack.path}`)).toBe(12);
    expect(replacementPorts.savedPreviewPositions.get(`alpha:${firstTrack.path}`)).toBe(21);
  });

  it("T19 current ended advances exactly once to the next track", async () => {
    const ports = createPorts();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    render(<AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} ports={ports} />);
    await activate(interactionRef);
    await resolveLatest(ports);
    fireEvent.ended(audioElement());
    await flushMicrotasks();
    expect(screen.getByTestId("current-path")).toHaveTextContent(secondTrack.path);
    expect(ports.streamRequests).toHaveLength(2);
    await resolveLatest(ports);
    expect(screen.getByTestId("stream-url")).toHaveTextContent(streamUrl(secondTrack.path));
  });

  it("T20 StrictMode retains one current stream/media owner and quiesces on unmount", async () => {
    const pendingPlays: PendingPlay[] = [];
    mediaPlayMock.mockImplementation(function (this: HTMLMediaElement) {
      const pending = {
        deferred: deferred<void>(),
        element: this
      };
      pendingPlays.push(pending);
      return pending.deferred.promise;
    });
    const ports = createPorts();
    const publish = vi.fn<(playing: boolean) => void>();
    const interactionRef: { current?: FolderAudioPlayerInteraction } = {};
    const view = render(
      <StrictMode>
        <AudioLifecycleHarness expose={(value) => { interactionRef.current = value; }} onPlayingChange={publish} ports={ports} />
      </StrictMode>
    );
    await activate(interactionRef);
    expect(ports.streamRequests).toHaveLength(1);
    await resolveLatest(ports);
    expect(mediaPlayMock).toHaveBeenCalledTimes(1);
    expect(pendingPlays[0]?.element).toBe(audioElement());
    const oldStage = currentStage(interactionRef);
    const oldAudio = audioElement();
    const stateKey = folderAudioStorageKey("alpha", "Projects");
    const storageBeforeUnmount = ports.storageMap.get(stateKey);
    ports.saveAudioPreviewPositionMock.mockClear();
    publish.mockClear();
    view.unmount();
    pendingPlays[0]?.deferred.reject(new DOMException("unmounted", "AbortError"));
    Object.defineProperty(oldAudio, "currentTime", { configurable: true, writable: true, value: 88 });
    oldStage.onTimeUpdate(oldAudio);
    oldStage.onPlay();
    oldStage.onPause();
    await flushMicrotasks();
    expect(ports.streamRequests).toHaveLength(1);
    expect(ports.saveAudioPreviewPositionMock).not.toHaveBeenCalled();
    expect(ports.storageMap.get(stateKey)).toBe(storageBeforeUnmount);
    expect(publish).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: /Audio playlist/i })).not.toBeInTheDocument();
  });
});
