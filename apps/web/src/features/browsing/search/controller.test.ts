import { describe, expect, it, vi } from "vitest";

import { buildFileEntry } from "../../../test/files";
import { executeSearch, type SearchControllerCallbacks } from "./controller";
import type { SearchEvent, SearchRequest } from "./model";
import type { SearchPorts } from "./ports";

const searchItem = (path: string, score = 1) => ({ ...buildFileEntry(path), score });
const request: SearchRequest = {
  key: { accountId: "account", cacheNamespace: "namespace", path: "Docs", query: " Raw " },
  generation: 1,
  contextToken: {}
};

const setup = () => {
  const events: SearchEvent[] = [];
  const ports: SearchPorts = {
    createAbortHandle: () => new AbortController(),
    loadSearch: vi.fn().mockResolvedValue({ completeness: "complete" as const, kind: "success", items: [searchItem("Docs/live.txt", 2)] }),
    readCachedSearch: vi.fn(),
    writeCachedSearch: vi.fn()
  };
  const callbacks: SearchControllerCallbacks = {
    emit: vi.fn((event: SearchEvent) => { events.push(event); return true; }),
    onSessionTerminated: vi.fn()
  };
  return { events, ports, callbacks };
};

describe("search controller", () => {
  it("loads live first, preserves order, then writes only accepted results", async () => {
    const { ports, callbacks, events } = setup();
    const items = [searchItem("Docs/z.txt", 2), searchItem("Docs/a.txt", 1)];
    vi.mocked(ports.loadSearch).mockResolvedValue({ completeness: "complete" as const, kind: "success", items });

    await executeSearch({ request, token: "token", mode: "online", explicitOfflineItems: [], signal: new AbortController().signal }, ports, callbacks);

    expect(ports.readCachedSearch).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ completeness: "complete" as const, type: "live-response-accepted", items });
    expect(ports.writeCachedSearch).toHaveBeenCalledWith("namespace", "Docs", " Raw ", items);
  });

  it("contains cache write failure without replacing accepted live results", async () => {
    const { ports, callbacks, events } = setup();
    vi.mocked(ports.writeCachedSearch).mockImplementation(() => { throw new Error("quota"); });
    await executeSearch({ request, token: "token", mode: "online", explicitOfflineItems: [], signal: new AbortController().signal }, ports, callbacks);
    expect(events.map((event) => event.type)).toEqual(["request-started", "live-response-accepted"]);
  });

  it.each([[[searchItem("Docs/cached.txt")], "cached-fallback-shown"], [[], "cached-fallback-shown"], [undefined, "load-failed"]] as const)(
    "uses failure-only cache fallback %#",
    async (cached, expected) => {
      const { ports, callbacks, events } = setup();
      vi.mocked(ports.loadSearch).mockResolvedValue({ kind: "failure", error: new Error("offline") });
      vi.mocked(ports.readCachedSearch).mockReturnValue(cached ? [...cached] : cached);
      await executeSearch({ request, token: "token", mode: "online", explicitOfflineItems: [], signal: new AbortController().signal }, ports, callbacks);
      expect(events.at(-1)?.type).toBe(expected);
    }
  );

  it("does not use explicit-offline items for a routine online failure", async () => {
    const { ports, callbacks, events } = setup();
    const explicitOfflineItems = [searchItem("Docs/local-only.txt")];
    vi.mocked(ports.loadSearch).mockResolvedValue({ kind: "failure", error: new Error("offline") });
    vi.mocked(ports.readCachedSearch).mockReturnValue(undefined);

    await executeSearch({
      request,
      token: "token",
      mode: "online",
      explicitOfflineItems,
      signal: new AbortController().signal
    }, ports, callbacks);

    expect(events.map((event) => event.type)).toEqual(["request-started", "load-failed"]);
    expect(events).not.toContainEqual(expect.objectContaining({ type: "explicit-offline-shown", items: explicitOfflineItems }));
  });

  it("contains cache read failures as an empty failed result", async () => {
    const { ports, callbacks, events } = setup();
    vi.mocked(ports.loadSearch).mockResolvedValue({ kind: "failure", error: new Error("offline") });
    vi.mocked(ports.readCachedSearch).mockImplementation(() => { throw new Error("denied"); });
    await executeSearch({ request, token: "token", mode: "online", explicitOfflineItems: [], signal: new AbortController().signal }, ports, callbacks);
    expect(events.at(-1)?.type).toBe("load-failed");
  });

  it("uses explicit-offline results with zero API or cache I/O", async () => {
    const { ports, callbacks, events } = setup();
    const items = [searchItem("Docs/local.txt")];
    await executeSearch({ request, mode: "explicit-offline", explicitOfflineItems: items, signal: new AbortController().signal }, ports, callbacks);
    expect(ports.loadSearch).not.toHaveBeenCalled();
    expect(ports.readCachedSearch).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "explicit-offline-shown", items });
  });

  it.each(["unauthorized", "reconnect-required"] as const)("terminates only through the current %s outcome without cache fallback", async (kind) => {
    const { ports, callbacks, events } = setup();
    const error = new Error(kind);
    vi.mocked(ports.loadSearch).mockResolvedValue({ kind, error });
    await executeSearch({ request, token: "token", mode: "online", explicitOfflineItems: [], signal: new AbortController().signal }, ports, callbacks);
    expect(events.at(-1)?.type).toBe("request-cancelled");
    expect(ports.readCachedSearch).not.toHaveBeenCalled();
    expect(callbacks.onSessionTerminated).toHaveBeenCalledWith(kind, error);
    expect(callbacks.onSessionTerminated).toHaveBeenCalledTimes(1);
  });
});
