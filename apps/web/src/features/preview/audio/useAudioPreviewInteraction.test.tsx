// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AudioPreviewStage } from "./AudioPreviewStage";
import type { AudioPreviewRuntimePorts } from "./ports";
import { useAudioPreviewInteraction } from "./useAudioPreviewInteraction";

function createPorts() {
  const callbacks: Array<() => void> = [];
  const ports: AudioPreviewRuntimePorts = {
    setTimeout: vi.fn((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    }),
    clearTimeout: vi.fn(),
    getLocationHref: () => "https://davora.test/",
    loadAudioPreviewPosition: vi.fn(() => undefined),
    saveAudioPreviewPosition: vi.fn(),
    clearAudioPreviewPosition: vi.fn()
  };
  return { callbacks, ports };
}

function Harness({ sourceUrl, ports }: { sourceUrl: string; ports: AudioPreviewRuntimePorts }) {
  const interaction = useAudioPreviewInteraction({
    source: { enabled: true, accountId: "account-a", path: "Music/track.mp3", sourceUrl },
    ports
  });
  return <AudioPreviewStage interaction={interaction} />;
}

describe("useAudioPreviewInteraction", () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("owns bounded stream retry and manual reset", () => {
    const fixture = createPorts();
    render(<Harness ports={fixture.ports} sourceUrl="/api/file/stream?path=Music%2Ftrack.mp3" />);
    const audio = document.querySelector("audio");
    if (!(audio instanceof HTMLAudioElement)) throw new Error("Expected audio element");
    fireEvent.error(audio);
    expect(fixture.ports.setTimeout).toHaveBeenCalledWith(expect.any(Function), 500);
    act(() => fixture.callbacks[0]?.());
    expect(document.querySelector("audio")?.getAttribute("src")).toContain("streamRetry=1");
  });

  it("does not retry Blob sources", () => {
    const fixture = createPorts();
    render(<Harness ports={fixture.ports} sourceUrl="blob:offline-copy" />);
    const audio = document.querySelector("audio");
    if (!(audio instanceof HTMLAudioElement)) throw new Error("Expected audio element");
    fireEvent.error(audio);
    expect(fixture.ports.setTimeout).not.toHaveBeenCalled();
  });
});
