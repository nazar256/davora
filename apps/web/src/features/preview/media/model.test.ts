import { describe, expect, it } from "vitest";

import {
  buildMediaRetryUrl,
  hasRemainingStreamRetries,
  isStreamingMediaSource,
  MEDIA_STREAM_RETRY_DELAYS_MS,
  resolveStreamRetryDelayMs,
  shouldEnterBufferingOnWaiting
} from "./model";

describe("video preview model", () => {
  it("builds streamRetry URLs for worker stream sources only", () => {
    const baseUrl = "https://davora.test/";
    expect(buildMediaRetryUrl("/api/file/stream?path=clip.mp4&streamToken=abc", 0, baseUrl)).toBe(
      "/api/file/stream?path=clip.mp4&streamToken=abc"
    );
    expect(buildMediaRetryUrl("/api/file/stream?path=clip.mp4&streamToken=abc", 2, baseUrl)).toBe(
      "/api/file/stream?path=clip.mp4&streamToken=abc&streamRetry=2"
    );
    expect(buildMediaRetryUrl("blob:offline-copy", 2, baseUrl)).toBe("blob:offline-copy");
  });

  it("detects streaming versus offline blob sources", () => {
    expect(isStreamingMediaSource("/api/file/stream?path=clip.mp4")).toBe(true);
    expect(isStreamingMediaSource("blob:offline-copy")).toBe(false);
    expect(isStreamingMediaSource(undefined)).toBe(false);
  });

  it("keeps waiting transitions out of retrying and failed states", () => {
    expect(shouldEnterBufferingOnWaiting(true, "idle")).toBe(true);
    expect(shouldEnterBufferingOnWaiting(true, "retrying")).toBe(false);
    expect(shouldEnterBufferingOnWaiting(true, "failed")).toBe(false);
    expect(shouldEnterBufferingOnWaiting(false, "idle")).toBe(false);
  });

  it("exposes the bounded retry schedule", () => {
    expect(MEDIA_STREAM_RETRY_DELAYS_MS).toEqual([500, 1000, 2000]);
    expect(hasRemainingStreamRetries(0, MEDIA_STREAM_RETRY_DELAYS_MS.length)).toBe(true);
    expect(hasRemainingStreamRetries(2, MEDIA_STREAM_RETRY_DELAYS_MS.length)).toBe(true);
    expect(hasRemainingStreamRetries(3, MEDIA_STREAM_RETRY_DELAYS_MS.length)).toBe(false);
    expect(resolveStreamRetryDelayMs(1)).toBe(500);
    expect(resolveStreamRetryDelayMs(3)).toBe(2000);
    expect(resolveStreamRetryDelayMs(4)).toBeUndefined();
  });
});
