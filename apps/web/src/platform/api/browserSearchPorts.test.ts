import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../../lib/api";
import { createBrowsingCacheRepository } from "../../features/browsing";
import { searchCacheKey } from "../../features/browsing/cache/policy";
import { buildFileEntry } from "../../test/files";
import { createBrowserStringStorage } from "../storage/browserStringStorage";
import { createBrowserSearchPorts } from "./browserSearchPorts";

const searchFiles = vi.fn();
const item = (path: string, score = 1) => ({ ...buildFileEntry(path), score });
const cache = createBrowsingCacheRepository(createBrowserStringStorage(), { nowIso: () => "2026-07-23T00:00:00.000Z" });

describe("browser search ports", () => {
  beforeEach(() => {
    localStorage.clear();
    searchFiles.mockReset();
  });

  it("passes raw query and abort signal through while preserving live order", async () => {
    const items = [item("Docs/z.txt", 2), item("Docs/a.txt", 1)];
    searchFiles.mockResolvedValue({ completeness: "partial", path: "Docs", query: " Raw ", items });
    const controller = new AbortController();
    const ports = createBrowserSearchPorts(cache, { searchFiles });
    await expect(ports.loadSearch({ path: "Docs", query: " Raw ", token: "token", signal: controller.signal }))
      .resolves.toEqual({ kind: "success", items, completeness: "partial" });
    expect(searchFiles).toHaveBeenCalledWith("Docs", " Raw ", "token", controller.signal);
  });

  it.each([
    { completeness: "complete", path: "Other", query: "x", items: [item("Other/a.txt")] },
    { completeness: "complete", path: "Docs", query: "other", items: [item("Docs/a.txt")] },
    { completeness: "complete", path: "Docs", query: "x", items: [item("Elsewhere/a.txt")] },
    { completeness: "complete", path: "Docs", query: "x", items: [{ ...item("Docs/a.txt"), name: "wrong.txt" }] },
    { completeness: "complete", path: "Docs", query: "x", items: [{ ...item("Docs/a.txt"), score: Number.POSITIVE_INFINITY }] }
  ])("rejects mismatched or malformed live data %#", async (response) => {
    searchFiles.mockResolvedValue(response);
    const ports = createBrowserSearchPorts(cache, { searchFiles });
    await expect(ports.loadSearch({ path: "Docs", query: "x", token: "token", signal: new AbortController().signal }))
      .resolves.toMatchObject({ kind: "failure" });
  });

  it.each([
    [new ApiRequestError("expired", 401), "unauthorized"],
    [new ApiRequestError("reconnect", 409, "account_reconnect_required"), "reconnect-required"],
    [new DOMException("Aborted", "AbortError"), "cancelled"],
    [new Error("bad"), "failure"]
  ])("classifies transport outcome %#", async (error, kind) => {
    searchFiles.mockRejectedValue(error);
    const ports = createBrowserSearchPorts(cache, { searchFiles });
    await expect(ports.loadSearch({ path: "Docs", query: "x", token: "token", signal: new AbortController().signal }))
      .resolves.toMatchObject({ kind });
  });

  it("validates cached values and keeps query matching case-insensitive", () => {
    const ports = createBrowserSearchPorts(cache, { searchFiles });
    ports.writeCachedSearch("ns", "Docs", "Report", [item("Docs/report.txt")]);
    expect(ports.readCachedSearch("ns", "Docs", "report")).toEqual([item("Docs/report.txt")]);
    ports.writeCachedSearch("ns", "Docs", "bad", [item("Docs/valid.txt")]);
    const badKey = searchCacheKey("ns", "Docs", "bad");
    expect(badKey).toBeDefined();
    if (!badKey) throw new Error("Expected cached search key.");
    localStorage.setItem(badKey, JSON.stringify({ cachedAt: "now", value: [item("Elsewhere/a.txt")] }));
    expect(ports.readCachedSearch("ns", "Docs", "bad")).toBeUndefined();
  });

  it("keeps path and query cache components unambiguous", () => {
    const ports = createBrowserSearchPorts(cache, { searchFiles });
    ports.writeCachedSearch("ns", "a:b", "c", [item("a:b/first.txt")]);
    ports.writeCachedSearch("ns", "a", "b:c", [item("a/second.txt")]);
    expect(ports.readCachedSearch("ns", "a:b", "c")).toEqual([item("a:b/first.txt")]);
    expect(ports.readCachedSearch("ns", "a", "b:c")).toEqual([item("a/second.txt")]);
  });
});

it.each([undefined, "unknown", null, false])("rejects missing or invalid injected API coverage %s without fallback requests", async (completeness) => {
  searchFiles.mockReset().mockResolvedValue({ path: "Docs", query: "x", items: [], completeness });
  const ports = createBrowserSearchPorts(cache, { searchFiles });
  await expect(ports.loadSearch({ path: "Docs", query: "x", token: "token", signal: new AbortController().signal })).resolves.toMatchObject({ kind: "failure" });
  expect(searchFiles).toHaveBeenCalledOnce();
});
