import { describe, expect, it, vi } from "vitest";

import { createStreamingFileUrl, fetchOriginalFile, getFile } from "./api";

describe("preview API cancellation", () => {
  it.each([
    ["preview metadata", (signal: AbortSignal) => getFile("Photos/image.png", "token", signal)],
    ["original binary", (signal: AbortSignal) => fetchOriginalFile("Photos/image.png", "token", signal)],
    ["stream token", (signal: AbortSignal) => createStreamingFileUrl("Music/song.mp3", "token", signal)]
  ] as const)("forwards the caller signal and preserves AbortError for %s", async (_label, requestFor) => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const request = requestFor(controller.signal);
    const forwardedSignal = fetchMock.mock.calls[0]?.[1]?.signal;

    expect(forwardedSignal).toBeInstanceOf(AbortSignal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(forwardedSignal?.aborted).toBe(true);
  });
});
