export const MEDIA_STREAM_RETRY_DELAYS_MS = [500, 1000, 2000] as const;

export const VIDEO_OVERLAY_AUTO_HIDE_DELAY_MS = 3000;

export type MediaStreamState = "idle" | "buffering" | "retrying" | "failed";

export function buildMediaRetryUrl(source: string, retryKey: number, baseUrl: string): string {
  if (retryKey <= 0 || source.startsWith("blob:")) {
    return source;
  }

  const url = new URL(source, baseUrl);
  url.searchParams.set("streamRetry", String(retryKey));
  return source.startsWith("/") ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

export function isStreamingMediaSource(source: string | undefined): boolean {
  return Boolean(source && !source.startsWith("blob:"));
}

export function shouldEnterBufferingOnWaiting(streamSource: boolean, currentState: MediaStreamState): boolean {
  return streamSource && currentState !== "retrying" && currentState !== "failed";
}

export function hasRemainingStreamRetries(retryAttempt: number, maxRetries: number): boolean {
  return retryAttempt < maxRetries;
}

export function resolveStreamRetryDelayMs(retryAttempt: number): number | undefined {
  if (retryAttempt <= 0 || retryAttempt > MEDIA_STREAM_RETRY_DELAYS_MS.length) {
    return undefined;
  }
  return MEDIA_STREAM_RETRY_DELAYS_MS[retryAttempt - 1];
}
