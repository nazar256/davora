import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { parseDiagnosticsInboxArgs, pullDiagnosticReports } from "./diagnostics-inbox";

describe("diagnostics inbox operator CLI", () => {
  it("parses one bounded read-only pull command", () => {
    expect(parseDiagnosticsInboxArgs(["pull", "--since", "7d", "--limit", "25"])).toEqual({ sinceDays: 7, limit: 25 });
    expect(() => parseDiagnosticsInboxArgs(["delete"])).toThrow(/pull/);
    expect(() => parseDiagnosticsInboxArgs(["pull", "--limit", "1001"])).toThrow(/limit/);
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
