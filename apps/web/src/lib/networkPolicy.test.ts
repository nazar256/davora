import { afterEach, describe, expect, it, vi } from "vitest";

import {
  withBackendResponse,
  BackendNetworkBlockedError,
  setBackendNetworkBlocked,
  setBackendRequestObserver,
  type BackendRequestObservation
} from "./networkPolicy";

const collect = () => {
  const observations: BackendRequestObservation[] = [];
  setBackendRequestObserver((observation) => { observations.push(observation); });
  return observations;
};

afterEach(() => {
  setBackendRequestObserver(null);
  setBackendNetworkBlocked(false);
  vi.unstubAllGlobals();
});

describe("backend request observation", () => {
  it("emits a status observation with a privacy-safe URL shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    const observations = collect();

    await withBackendResponse("https://worker.example.com/api/files/list?path=/secret&token=zzz#frag", {}, async (response) => response.text());

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      method: "GET",
      result: "status",
      status: 200
    });
    expect(observations[0]?.url).toBe("/api/files/list?path,token");
    expect(observations[0]?.url).not.toContain("/secret");
    expect(observations[0]?.url).not.toContain("zzz");
  });

  it("emits network-error when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const observations = collect();

    await expect(withBackendResponse("/api/health", {}, async (response) => response.text())).rejects.toThrow("offline");
    expect(observations[0]?.result).toBe("network-error");
  });

  it("emits aborted when the caller aborts", async () => {
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })));
    const observations = collect();

    const controller = new AbortController();
    const pending = withBackendResponse("/api/files", { signal: controller.signal }, async (response) => response.text());
    controller.abort();
    await expect(pending).rejects.toThrow();

    expect(observations[0]?.result).toBe("aborted");
  });

  it("emits blocked without calling fetch when offline mode is active", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const observations = collect();
    setBackendNetworkBlocked(true);

    await expect(withBackendResponse("/api/files", {}, async (response) => response.text())).rejects.toBeInstanceOf(BackendNetworkBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(observations[0]?.result).toBe("blocked");
  });

  it("never lets observer failures break request handling", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    setBackendRequestObserver(() => { throw new Error("observer blew up"); });

    await expect(withBackendResponse("/api/health", {}, async (response) => response.text())).resolves.toBe("ok");
  });

  it("emits nothing once the observer is removed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    const observations = collect();
    setBackendRequestObserver(null);

    await withBackendResponse("/api/health", {}, async (response) => response.text());
    expect(observations).toHaveLength(0);
  });
});
