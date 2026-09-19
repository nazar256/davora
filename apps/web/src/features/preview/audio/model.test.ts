// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { canRestoreAudioPreviewPosition } from "./model";

describe("audio preview model", () => {
  it("accepts positive positions before the media end tolerance", () => {
    const audio = document.createElement("audio");
    Object.defineProperty(audio, "duration", { configurable: true, value: 100 });
    expect(canRestoreAudioPreviewPosition(audio, 12.5)).toBe(true);
    expect(canRestoreAudioPreviewPosition(audio, 99)).toBe(false);
  });

  it("rejects unusable persisted positions", () => {
    const audio = document.createElement("audio");
    expect(canRestoreAudioPreviewPosition(audio, Number.NaN)).toBe(false);
    expect(canRestoreAudioPreviewPosition(audio, 0)).toBe(false);
    expect(canRestoreAudioPreviewPosition(audio, -1)).toBe(false);
  });
});
