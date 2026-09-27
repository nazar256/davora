import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { clearDiagnosticReports, parseDiagnosticsInboxArgs, pullDiagnosticReports } from "./diagnostics-inbox";

describe("diagnostics inbox operator CLI", () => {
  it("parses one bounded read-only pull command", () => {
    expect(parseDiagnosticsInboxArgs(["pull", "--since", "7d", "--limit", "25"]))
      .toEqual({ command: "pull", sinceDays: 7, limit: 25, reports: [] });
    expect(() => parseDiagnosticsInboxArgs(["delete"])).toThrow(/pull.*clear/);
    expect(() => parseDiagnosticsInboxArgs(["pull", "--limit", "1001"])).toThrow(/limit/);
  });

  it("parses an explicit clear command with validated report IDs", () => {
    const idA = "123e4567-e89b-42d3-a456-426614174000";
    const idB = "55d08f42-fd98-49be-a4b9-528b57dd99ca";
    expect(parseDiagnosticsInboxArgs(["clear", "--report", idA, "--report", idB]))
      .toEqual({ command: "clear", sinceDays: 30, limit: 50, reports: [idA, idB] });
    expect(() => parseDiagnosticsInboxArgs(["clear"])).toThrow(/--report/);
    expect(() => parseDiagnosticsInboxArgs(["clear", "--report", "not-a-uuid"])).toThrow(/UUID/);
    expect(() => parseDiagnosticsInboxArgs(["clear", "--report", idA, "--report", idA])).toThrow(/[Dd]uplicate/);
    expect(() => parseDiagnosticsInboxArgs(["clear", "--all"])).toThrow(/Unsupported/);
    expect(() => parseDiagnosticsInboxArgs(["clear", "--report", idA, "--since", "7d"])).toThrow(/Unsupported/);
  });

  it("deletes only canonical report objects for the requested IDs", async () => {
    const idA = "123e4567-e89b-42d3-a456-426614174000";
    const idB = "55d08f42-fd98-49be-a4b9-528b57dd99ca";
    const otherId = "d93e7886-f30a-4c92-a55b-80ed756cf18d";
    const calls: Array<{ method: string; url: string; auth: string | null }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ method: init?.method ?? "GET", url, auth: new Headers(init?.headers).get("authorization") });
      if ((init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({
          success: true,
          result: [
            { key: `reports/v1/2026/09/24/${idA}.zip`, size: 10, last_modified: "2026-09-24T09:30:00.000Z" },
            { key: `reports/v1/2026/09/27/${idB}.zip`, size: 10, last_modified: "2026-09-27T09:30:00.000Z" },
            { key: `reports/v1/2026/09/25/${otherId}.zip`, size: 10, last_modified: "2026-09-25T09:30:00.000Z" },
            { key: "quota/v1/abc123", size: 0, last_modified: "2026-09-27T09:30:00.000Z" }
          ],
          result_info: { is_truncated: false }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    const result = await clearDiagnosticReports(
      { accountId: "account-id", bucket: "davora-local-diagnostic-reports", token: "write-token", reports: [idA, idB] },
      { fetch: fetchMock }
    );

    expect(result).toEqual({ deleted: 2, missing: [] });
    const deletes = calls.filter((call) => call.method === "DELETE");
    expect(deletes.map((call) => call.url)).toEqual([
      expect.stringContaining(`${idA}.zip`),
      expect.stringContaining(`${idB}.zip`)
    ]);
    expect(deletes.every((call) => call.auth === "Bearer write-token")).toBe(true);
    expect(calls.some((call) => call.url.includes(otherId) && call.method === "DELETE")).toBe(false);
    expect(calls.some((call) => call.url.includes("quota/") && call.method === "DELETE")).toBe(false);
  });

  it("reports missing IDs and deletes the same report ID across date partitions", async () => {
    const idA = "123e4567-e89b-42d3-a456-426614174000";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({
          success: true,
          result: ["23", "24"].map((day) => ({
            key: `reports/v1/2026/09/${day}/${idA}.zip`, size: 4, last_modified: `2026-09-${day}T09:30:00.000Z`
          })),
          result_info: { is_truncated: false }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    const result = await clearDiagnosticReports(
      { accountId: "account-id", bucket: "bucket", token: "write-token", reports: [idA, "ffffffff-ffff-4fff-afff-ffffffffffff"] },
      { fetch: fetchMock }
    );
    expect(result.deleted).toBe(2);
    expect(result.missing).toEqual(["ffffffff-ffff-4fff-afff-ffffffffffff"]);
  });

  it("fails closed when a delete request is rejected", async () => {
    const idA = "123e4567-e89b-42d3-a456-426614174000";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({
          success: true,
          result: [{ key: `reports/v1/2026/09/24/${idA}.zip`, size: 4, last_modified: "2026-09-24T09:30:00.000Z" }],
          result_info: { is_truncated: false }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: false }), { status: 403 });
    });

    await expect(clearDiagnosticReports(
      { accountId: "account-id", bucket: "bucket", token: "write-token", reports: [idA] },
      { fetch: fetchMock }
    )).rejects.toThrow(/403/);
  });

  it("lists, filters, downloads, verifies, and writes reports without mutation calls", async () => {
    const reportBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const sha256 = createHash("sha256").update(reportBytes).digest("hex");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer read-token");
      expect(init?.method ?? "GET").toBe("GET");
      if (url.includes("?")) {
        return new Response(JSON.stringify({
          success: true,
          result: [{
            key: "reports/v1/2026/09/24/123e4567-e89b-42d3-a456-426614174000.zip",
            size: reportBytes.byteLength,
            last_modified: "2026-09-24T09:30:00.000Z",
            custom_metadata: { reportId: "123e4567-e89b-42d3-a456-426614174000", sha256 }
          }, { key: "quota/v1/private", size: 0, last_modified: "2026-09-24T09:30:00.000Z" }],
          result_info: { is_truncated: false }
        }), { status: 200 });
      }
      return new Response(reportBytes, { status: 200 });
    });
    const writes: Array<{ path: string; data: string | Uint8Array }> = [];
    const result = await pullDiagnosticReports({
      accountId: "account-id",
      bucket: "davora-local-diagnostic-reports",
      token: "read-token",
      sinceDays: 30,
      limit: 50,
      outputDirectory: ".tmp/diagnostic-inbox/run"
    }, {
      fetch: fetchMock,
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (path: string, data: string | Uint8Array, options: { flag: "wx" }) => {
        expect(options).toEqual({ flag: "wx" });
        writes.push({ path, data });
      }),
      now: () => new Date("2026-09-24T10:00:00.000Z")
    });

    expect(result.downloaded).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writes.map((write) => write.path)).toEqual([
      ".tmp/diagnostic-inbox/run/2026-09-24-123e4567-e89b-42d3-a456-426614174000.zip",
      ".tmp/diagnostic-inbox/run/manifest.json"
    ]);
    expect(JSON.stringify(writes)).not.toContain("read-token");
  });

  it("rejects untrusted object keys and checksum mismatches", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("?")
      ? new Response(JSON.stringify({
        success: true,
        result: [{ key: "reports/v1/2026/09/24/../../escape.zip", size: 4, last_modified: "2026-09-24T09:30:00.000Z", custom_metadata: { sha256: "0".repeat(64) } }],
        result_info: { is_truncated: false }
      }), { status: 200 })
      : new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), { status: 200 }));
    await expect(pullDiagnosticReports({
      accountId: "account-id", bucket: "bucket", token: "read-token", sinceDays: 30, limit: 50,
      outputDirectory: ".tmp/diagnostic-inbox/run"
    }, { fetch: fetchMock, mkdir: vi.fn(), writeFile: vi.fn(), now: () => new Date("2026-09-24T10:00:00.000Z") }))
      .resolves.toMatchObject({ downloaded: 0, skipped: 1 });
  });

  it("keeps equal report ids from different dates distinct and never overwrites output", async () => {
    const reportBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const sha256 = createHash("sha256").update(reportBytes).digest("hex");
    const reportId = "123e4567-e89b-42d3-a456-426614174000";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("?")
      ? new Response(JSON.stringify({
        success: true,
        result: ["23", "24"].map((day) => ({
          key: `reports/v1/2026/09/${day}/${reportId}.zip`,
          size: reportBytes.byteLength,
          last_modified: `2026-09-${day}T09:30:00.000Z`,
          custom_metadata: { sha256 }
        })),
        result_info: { is_truncated: false }
      }), { status: 200 })
      : new Response(reportBytes, { status: 200 }));
    const written = new Set<string>();
    const writeFile = vi.fn(async (path: string, _data: string | Uint8Array, options: { flag: "wx" }) => {
      expect(options.flag).toBe("wx");
      if (written.has(path)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      written.add(path);
    });

    await expect(pullDiagnosticReports({
      accountId: "account-id", bucket: "bucket", token: "read-token", sinceDays: 30, limit: 50,
      outputDirectory: ".tmp/diagnostic-inbox/run"
    }, { fetch: fetchMock, mkdir: vi.fn(), writeFile, now: () => new Date("2026-09-24T10:00:00.000Z") }))
      .resolves.toMatchObject({ downloaded: 2 });
    expect([...written]).toEqual([
      `.tmp/diagnostic-inbox/run/2026-09-23-${reportId}.zip`,
      `.tmp/diagnostic-inbox/run/2026-09-24-${reportId}.zip`,
      ".tmp/diagnostic-inbox/run/manifest.json"
    ]);

    await expect(pullDiagnosticReports({
      accountId: "account-id", bucket: "bucket", token: "read-token", sinceDays: 30, limit: 50,
      outputDirectory: ".tmp/diagnostic-inbox/run"
    }, { fetch: fetchMock, mkdir: vi.fn(), writeFile, now: () => new Date("2026-09-24T10:00:00.000Z") }))
      .rejects.toMatchObject({ code: "EEXIST" });
  });
});
