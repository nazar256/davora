import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDownloadBlob, fetchOriginalFile, request } from "./api";
import { createBrowserAccountTransport } from "../platform/api/browserAccountTransport";
import { withBackendResponse, setBackendNetworkBlocked, setBackendRequestObserver, BackendNetworkBlockedError } from "./networkPolicy";

const signalBoundFetch = (responseInit: ResponseInit = {}, firstChunk = "first") => {
  let transportSignal: AbortSignal;
  let body: ReadableStream<Uint8Array>;
  let dispose = () => {};
  let bodyController: ReadableStreamDefaultController<Uint8Array>;
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    transportSignal = init!.signal!;
    body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
        const abort = () => controller.error(new DOMException("Aborted", "AbortError"));
        dispose = () => transportSignal.removeEventListener("abort", abort);
        if (transportSignal.aborted) abort();
        else {
          transportSignal.addEventListener("abort", abort, { once: true });
          if (firstChunk) controller.enqueue(new TextEncoder().encode(firstChunk));
        }
      },
      cancel() { dispose(); }
    });
    return new Response(body, responseInit);
  });
  return { fetch, get signal() { return transportSignal; }, get body() { return body; }, finish: () => { dispose(); bodyController.close(); }, fail: (error: Error) => { dispose(); bodyController.error(error); }, dispose: () => dispose() };
};

afterEach(() => {
  setBackendRequestObserver(null);
  setBackendNetworkBlocked(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("post-header response body cancellation", () => {
  it.each(["direct", "caller", "offline"] as const)("interrupts the pending body read: %s", async (mode) => {
    const transport = signalBoundFetch();
    vi.stubGlobal("fetch", transport.fetch);
    const caller = new AbortController();
    const consume = async (response: Response) => {
      const reader = response.body!.getReader();
      try {
        expect((await reader.read()).value).toEqual(new TextEncoder().encode("first"));
        const pending = reader.read().then(() => "completed", (error: Error) => error.name);
        if (mode === "offline") setBackendNetworkBlocked(true);
        else caller.abort();
        expect(transport.signal.aborted).toBe(true);
        expect(await pending).toBe("AbortError");
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
        transport.dispose();
      }
    };
    if (mode === "direct") await consume(await fetch("/api/download", { signal: caller.signal }));
    else await expect(withBackendResponse("/api/download", { signal: caller.signal }, consume)).rejects.toMatchObject({ name: "AbortError" });
  });
});

const accountTransport = createBrowserAccountTransport({ read: () => ({ browserId: "fixture-browser", browserSecret: "fixture-secret" }) });
const connect = () => accountTransport.connectAccount({ type: "nextcloud", label: "Fixture", baseUrl: "https://cloud.example.test", username: "fixture", appPassword: "fixture-password" });

describe("scoped response consumers", () => {
  it.each(["json", "schema", "http-error", "original", "download", "connect", "delete"] as const)("keeps global cancellation through %s body handling", async (consumer) => {
    const transport = signalBoundFetch({ status: consumer === "http-error" || consumer === "delete" ? 503 : 200 });
    vi.stubGlobal("fetch", transport.fetch);
    const onProgress = vi.fn();
    const pending = consumer === "json" ? request("/api/files")
      : consumer === "schema" ? request("/api/files", {}, undefined, { parse: () => ({ data: {} }) })
      : consumer === "http-error" ? request("/api/files")
      : consumer === "original" ? fetchOriginalFile("first.txt", "token")
      : consumer === "download" ? fetchDownloadBlob("first.txt", "token", { onProgress })
      : consumer === "connect" ? connect()
      : accountTransport.deleteConnectedAccount("fixture-account");
    const outcome = pending.then(() => "success", (error: Error) => error.name);
    await vi.waitFor(() => expect(transport.body.locked).toBe(true));
    if (consumer === "download") await vi.waitFor(() => expect(onProgress).toHaveBeenCalledWith(5, undefined));
    setBackendNetworkBlocked(true);
    setBackendNetworkBlocked(true);
    expect(await outcome).toBe("AbortError");
    if (consumer === "download") {
      expect(transport.body.locked).toBe(false);
      expect(onProgress).toHaveBeenCalledTimes(1);
    }
    await expect(request("/api/files")).rejects.toBeInstanceOf(BackendNetworkBlockedError);
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    transport.dispose();
  });

  it.each(["return", "throw", "swallow-return", "swallow-throw"] as const)("cleans scope and preserves cancellation priority on callback %s", async (mode) => {
    const transport = signalBoundFetch();
    vi.stubGlobal("fetch", transport.fetch);
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    const abort = vi.spyOn(AbortController.prototype, "abort");
    const original = new Error("parse failure");
    const pending = withBackendResponse("/api/files", { signal: caller.signal }, async () => {
      if (mode.startsWith("swallow")) caller.abort();
      if (mode.endsWith("throw")) throw original;
      return "finished";
    });
    if (mode.startsWith("swallow")) await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    else if (mode === "throw") await expect(pending).rejects.toBe(original);
    else await expect(pending).resolves.toBe("finished");
    expect(transport.signal.aborted).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    const calls = abort.mock.calls.length;
    caller.abort();
    setBackendNetworkBlocked(true);
    expect(abort).toHaveBeenCalledTimes(calls + 1);
    transport.dispose();
  });

  it("preserves a single header-time observation when a later body fails", async () => {
    const transport = signalBoundFetch();
    vi.stubGlobal("fetch", transport.fetch);
    let now = 10;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const observe = vi.fn();
    setBackendRequestObserver(observe);
    const failure = new Error("body failed");
    const pending = withBackendResponse("/api/files?path=private", {}, async (response) => {
      expect(observe).toHaveBeenCalledTimes(1);
      now = 200;
      transport.fail(failure);
      return response.text();
    });
    await expect(pending).rejects.toBe(failure);
    expect(observe).toHaveBeenCalledExactlyOnceWith({ method: "GET", url: "/api/files?path", result: "status", status: 200, durationMs: 0 });
    transport.dispose();
  });

  it("does not publish a pre-aborted response body", async () => {
    const transport = signalBoundFetch();
    vi.stubGlobal("fetch", transport.fetch);
    const caller = new AbortController();
    caller.abort();
    await expect(fetchOriginalFile("first.txt", "token", caller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(transport.signal.aborted).toBe(true);
    transport.dispose();
  });

  it.each(["complete", "read-error", "progress-error", "caller-abort"] as const)("releases the download reader after %s", async (mode) => {
    const transport = signalBoundFetch({ headers: { "content-type": "text/plain", "content-length": "5", "content-disposition": "attachment; filename*=UTF-8''first%20file.txt" } });
    vi.stubGlobal("fetch", transport.fetch);
    const caller = new AbortController();
    const failure = new Error("download failed");
    const onProgress = vi.fn(() => {
      if (mode === "progress-error") throw failure;
      if (mode === "read-error") transport.fail(failure);
      if (mode === "caller-abort") caller.abort();
      if (mode === "complete") transport.finish();
    });
    const pending = fetchDownloadBlob("first.txt", "token", { signal: caller.signal, onProgress });
    if (mode === "complete") {
      const result = await pending;
      expect(result.blob.size).toBe(5);
      expect(result.blob.type).toBe("text/plain");
      expect(result.filename).toBe("first file.txt");
    } else if (mode === "caller-abort") await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    else await expect(pending).rejects.toBe(failure);
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(5, 5);
    expect(transport.body.locked).toBe(false);
    expect(transport.signal.aborted).toBe(true);
    transport.dispose();
  });

  it("keeps completed invalid connect responses and delete 204 behavior", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("bad json")).mockResolvedValueOnce(new Response(null, { status: 204 })));
    await expect(connect()).resolves.toEqual({ kind: "invalid-http-success" });
    await expect(accountTransport.deleteConnectedAccount("fixture-account")).resolves.toBeUndefined();
  });
});

describe("header and reader cleanup boundaries", () => {
  it("aborts header wait through offline and emits only the original header-phase result", async () => {
    const observe = vi.fn();
    setBackendRequestObserver(observe);
    vi.stubGlobal("fetch", vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    const consume = vi.fn(async () => "unexpected");
    const pending = withBackendResponse("/api/files", { signal: caller.signal }, consume);
    setBackendNetworkBlocked(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(consume).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls[0]?.[0]).toMatchObject({ result: "aborted" });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("preserves the original failure when reader cancellation also fails", async () => {
    const failure = new Error("progress failed");
    const cancellation = vi.fn(() => Promise.reject(new Error("cleanup failed")));
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1])); },
      cancel: cancellation
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    await expect(fetchDownloadBlob("first.txt", "token", { onProgress: () => { throw failure; } })).rejects.toBe(failure);
    expect(cancellation).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });
});

it.each(["chunk", "end"] as const)("does not publish a queued %s after offline abort even if the gate reopens", async (boundary) => {
  const transport = signalBoundFetch({}, boundary === "chunk" ? "first" : "");
  vi.stubGlobal("fetch", transport.fetch);
  const nativeRead = ReadableStreamDefaultReader.prototype.read;
  vi.spyOn(ReadableStreamDefaultReader.prototype, "read").mockImplementationOnce(function (this: ReadableStreamDefaultReader<Uint8Array>) {
    if (boundary === "end") transport.finish();
    const pending = nativeRead.call(this);
    setBackendNetworkBlocked(true);
    setBackendNetworkBlocked(false);
    return pending;
  });
  const progress = vi.fn();
  await expect(fetchDownloadBlob("first.txt", "token", { onProgress: progress })).rejects.toMatchObject({ name: "AbortError" });
  expect(progress).not.toHaveBeenCalled();
  expect(transport.body.locked).toBe(false);
  transport.dispose();
});
