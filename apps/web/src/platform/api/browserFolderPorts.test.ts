import { ApiRequestError } from "../../lib/api";
import { createBrowsingCacheRepository } from "../../features/browsing";
import { folderCacheKey } from "../../features/browsing/cache/policy";
import { buildFileEntry } from "../../test/files";
import { createBrowserStringStorage } from "../storage/browserStringStorage";
import { createBrowserFolderPorts } from "./browserFolderPorts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listFiles = vi.fn();
const cache = createBrowsingCacheRepository(createBrowserStringStorage(), { nowIso: () => "2026-07-23T00:00:00.000Z" });

describe("browser folder ports", () => {
  beforeEach(() => {
    localStorage.clear();
    listFiles.mockReset();
  });

  it("passes the abort signal through and unwraps live items", async () => {
    const item = buildFileEntry("Docs/live.txt");
    listFiles.mockResolvedValue({ completeness: "complete" as const, path: "Docs", items: [item] });
    const ports = createBrowserFolderPorts(cache, { listFiles });
    const controller = new AbortController();

    await expect(ports.loadFolder({ path: "Docs", token: "token", signal: controller.signal }))
      .resolves.toEqual({ completeness: "complete" as const, kind: "success", items: [item] });
    expect(listFiles).toHaveBeenCalledWith("Docs", "token", controller.signal);
  });

  it("rejects malformed live entries at the browser trust boundary", async () => {
    listFiles.mockResolvedValue({ completeness: "complete" as const, path: "Docs", items: [{ path: "Docs/escape", name: "escape", isFolder: false, size: "large" }] });
    const ports = createBrowserFolderPorts(cache, { listFiles });

    await expect(ports.loadFolder({ path: "Docs", token: "token", signal: new AbortController().signal }))
      .resolves.toMatchObject({
        kind: "failure",
        error: new Error("The server returned invalid folder entries."),
        diagnostic: {
          phase: "item-schema",
          itemIndex: 0,
          itemShape: {
            presentKeys: ["isFolder", "name", "path", "size"],
            fieldTypes: { isFolder: "boolean", name: "string", path: "string", size: "string" }
          }
        }
      });
  });

  it.each([
    [{ completeness: "complete" as const, path: "Elsewhere", items: [] }, "response-path-mismatch"],
    [{ completeness: "complete" as const, path: "Docs", items: {} }, "items-not-array"],
    [{ completeness: "complete" as const, path: "Docs", items: [{ path: "Docs/a.txt", name: "b.txt", isFolder: false }] }, "basename-mismatch"],
    [{ completeness: "complete" as const, path: "Docs", items: [buildFileEntry("Elsewhere/a.txt")] }, "item-outside-folder"]
  ])("reports the safe rejection phase for %s", async (response, phase) => {
    listFiles.mockResolvedValue(response);
    const ports = createBrowserFolderPorts(cache, { listFiles });

    const outcome = await ports.loadFolder({ path: "Docs", token: "token", signal: new AbortController().signal });
    expect(outcome).toMatchObject({ kind: "failure", diagnostic: { phase } });
    expect(JSON.stringify(outcome)).not.toContain("Elsewhere/a.txt");
    expect(JSON.stringify(outcome)).not.toContain("Docs/a.txt");
  });

  it("reports a redacted basename comparison without inventing control characters", async () => {
    listFiles.mockResolvedValue({ completeness: "complete" as const,
      path: "Docs",
      items: [{ path: "Docs/Report.txt", name: "report.txt", isFolder: false }]
    });
    const ports = createBrowserFolderPorts(cache, { listFiles });

    const outcome = await ports.loadFolder({
      path: "Docs",
      token: "token",
      signal: new AbortController().signal
    });

    expect(outcome).toMatchObject({
      kind: "failure",
      diagnostic: {
        phase: "basename-mismatch",
        itemShape: {
          nameLength: 10,
          basenameComparison: {
            basenameLength: 10,
            equalAfterTrim: false,
            equalAfterNfc: false,
            equalIgnoringCase: true,
            firstDifferenceIndex: 0,
            basenameDifferenceCategory: "letter",
            nameDifferenceCategory: "letter"
          },
          flags: { hasControl: false }
        }
      }
    });
    expect(JSON.stringify(outcome)).not.toContain("Report.txt");
    expect(JSON.stringify(outcome)).not.toContain("report.txt");
  });

  it("classifies C1 characters as controls without retaining the value", async () => {
    listFiles.mockResolvedValue({ completeness: "complete" as const,
      path: "Docs",
      items: [{ path: "Docs/report.txt", name: "report\u0085.txt", isFolder: false }]
    });
    const ports = createBrowserFolderPorts(cache, { listFiles });

    const outcome = await ports.loadFolder({
      path: "Docs",
      token: "token",
      signal: new AbortController().signal
    });

    expect(outcome).toMatchObject({
      kind: "failure",
      diagnostic: {
        itemShape: {
          basenameComparison: { nameDifferenceCategory: "control" },
          flags: { hasControl: true }
        }
      }
    });
    expect(JSON.stringify(outcome)).not.toContain("report\u0085.txt");
  });

  it("preserves sanitized HTTP response diagnostics without retaining response values", async () => {
    const diagnostic = {
      phase: "envelope-schema" as const,
      status: 200,
      contentType: "json" as const,
      payloadBytes: 91,
      workerBuild: "worker-abc",
      apiContract: "2",
      issues: [{ path: ["data", "items", 0, "path"], code: "custom", actualType: "string" as const }]
    };
    listFiles.mockRejectedValue(new ApiRequestError("invalid", 200, "invalid_response", undefined, diagnostic));
    const ports = createBrowserFolderPorts(cache, { listFiles });

    await expect(ports.loadFolder({ path: "Docs", token: "token", signal: new AbortController().signal }))
      .resolves.toMatchObject({ kind: "failure", diagnostic });
  });

  it.each([
    [{ completeness: "complete" as const, path: "Elsewhere", items: [buildFileEntry("Elsewhere/a.txt")] }, "mismatched response path"],
    [{ completeness: "complete" as const, path: "Docs", items: [buildFileEntry("Elsewhere/a.txt")] }, "entry outside requested folder"],
    [{ completeness: "complete" as const, path: "Docs", items: [buildFileEntry("Docs//a.txt") ] }, "noncanonical entry path"]
  ])("rejects %s (%s)", async (response) => {
    listFiles.mockResolvedValue(response);
    const ports = createBrowserFolderPorts(cache, { listFiles });

    await expect(ports.loadFolder({ path: "Docs", token: "token", signal: new AbortController().signal }))
      .resolves.toMatchObject({ kind: "failure" });
  });

  it.each([
    ["Docs", "Docs/Sub/a.txt"],
    ["", "Docs/Sub/a.txt"]
  ])("accepts a contained descendant for folder %s", async (path, itemPath) => {
    const item = buildFileEntry(itemPath);
    listFiles.mockResolvedValue({ completeness: "complete" as const, path, items: [item] });
    const ports = createBrowserFolderPorts(cache, { listFiles });

    await expect(ports.loadFolder({ path, token: "token", signal: new AbortController().signal }))
      .resolves.toEqual({ completeness: "complete" as const, kind: "success", items: [item] });
  });

  it.each([
    [new ApiRequestError("expired", 401), "unauthorized"],
    [new ApiRequestError("reconnect", 409, "account_reconnect_required"), "reconnect-required"],
    [new ApiRequestError("server", 503), "transient"],
    [new TypeError("Failed to fetch"), "transient"],
    [new Error("invalid"), "failure"]
  ])("classifies %s as %s", async (error, expectedKind) => {
    listFiles.mockRejectedValue(error);
    const ports = createBrowserFolderPorts(cache, { listFiles });

    await expect(ports.loadFolder({ path: "Docs", token: "token", signal: new AbortController().signal }))
      .resolves.toMatchObject({ kind: expectedKind, error });
  });

  it("classifies aborted transport without exposing it as a failure", async () => {
    listFiles.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    const ports = createBrowserFolderPorts(cache, { listFiles });

    await expect(ports.loadFolder({ path: "Docs", token: "token", signal: new AbortController().signal }))
      .resolves.toEqual({ kind: "cancelled" });
  });

  it("accepts valid cached entries and rejects malformed persisted data", () => {
    const item = buildFileEntry("Docs/cached.txt");
    localStorage.setItem(folderCacheKey("ns", "Docs"), JSON.stringify({ cachedAt: "2026-01-01T00:00:00.000Z", value: [item] }));
    const ports = createBrowserFolderPorts(cache, { listFiles });
    expect(ports.readCachedFolder("ns", "Docs")).toEqual({ completeness: "unknown" as const, cachedAt: "2026-01-01T00:00:00.000Z", items: [item] });

    localStorage.setItem(folderCacheKey("ns", "Docs"), JSON.stringify({ cachedAt: 42, value: [{ path: "../escape", name: "escape", isFolder: false }] }));
    expect(ports.readCachedFolder("ns", "Docs")).toBeUndefined();

    localStorage.setItem(folderCacheKey("ns", "Docs"), JSON.stringify({ cachedAt: "2026-01-01T00:00:00.000Z", value: [buildFileEntry("Elsewhere/a.txt")] }));
    expect(ports.readCachedFolder("ns", "Docs")).toBeUndefined();

    localStorage.setItem(folderCacheKey("ns", "Docs"), JSON.stringify({ cachedAt: "2026-01-01T00:00:00.000Z", value: [buildFileEntry("Docs/Sub/a.txt")] }));
    expect(ports.readCachedFolder("ns", "Docs")).toEqual({ completeness: "unknown" as const,
      cachedAt: "2026-01-01T00:00:00.000Z",
      items: [buildFileEntry("Docs/Sub/a.txt")]
    });

  });

  it("keeps cache storage failures non-throwing", () => {
    const ports = createBrowserFolderPorts(cache, { listFiles });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });

    expect(() => ports.writeCachedFolder("ns", "Docs", [buildFileEntry("Docs/a.txt")], "complete")).not.toThrow();
  });
});
