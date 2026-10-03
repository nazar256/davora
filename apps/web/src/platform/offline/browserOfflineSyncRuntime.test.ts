import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../../lib/api";
import { createBrowserOfflineSyncRuntime } from "./browserOfflineSyncRuntime";

const listFiles = vi.fn<typeof import("../../lib/api").listFiles>();
const fetchDownloadBlob = vi.fn<typeof import("../../lib/api").fetchDownloadBlob>();

const createRuntime = () => createBrowserOfflineSyncRuntime({ listFiles, fetchDownloadBlob });

describe("browser offline sync runtime", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards exact list/download arguments and reads blob text", async () => {
    const runtime = createRuntime();
    const signal = new AbortController().signal;
    const blob = new Blob(["hello"]);
    Object.defineProperty(blob, "text", { configurable: true, value: async () => "hello" });
    listFiles.mockResolvedValue({ completeness: "complete", path: "Docs", items: [] });
    fetchDownloadBlob.mockResolvedValue({ blob, filename: "a.txt" });

    await runtime.listFiles("Docs", "token", signal);
    const onProgress = vi.fn();
    await runtime.fetchDownloadBlob("Docs/a.txt", "token", { signal, onProgress });

    expect(listFiles).toHaveBeenCalledOnce();
    expect(listFiles).toHaveBeenCalledWith("Docs", "token", signal);
    expect(fetchDownloadBlob).toHaveBeenCalledOnce();
    expect(fetchDownloadBlob).toHaveBeenCalledWith("Docs/a.txt", "token", { signal, onProgress });
    expect(await runtime.readBlobText(blob)).toBe("hello");
  });

  it("creates an independent abort handle and classifies without retries", () => {
    const runtime = createRuntime();
    const handle = runtime.createAbortHandle();
    expect(handle.signal.aborted).toBe(false);
    handle.abort();
    handle.abort();
    expect(handle.signal.aborted).toBe(true);
    expect(runtime.isUnauthorized(new ApiRequestError("expired", 401))).toBe(true);
    expect(runtime.isReconnectRequired(new ApiRequestError("reconnect", 409, "account_reconnect_required"))).toBe(true);
    expect(runtime.toErrorMessage(new Error("safe"), "fallback")).toBe("safe");
    expect(runtime.toErrorMessage({ secret: "hidden" }, "fallback")).toBe("fallback");
  });
});
