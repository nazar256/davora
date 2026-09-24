import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserDiagnosticsUpload } from "./browserDiagnosticsUpload";

afterEach(() => vi.unstubAllGlobals());

describe("browser diagnostic report upload", () => {
  it("sends one authenticated ZIP with integrity and version headers", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify({
      data: {
        reportId: new Headers(init?.headers).get("x-davora-report-id"),
        acceptedAt: "2026-09-24T09:27:58.000Z",
        expiresAfterDays: 30,
        duplicate: false
      }
    }), { status: 201, headers: { "content-type": "application/json" } }));
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({
        data: {
          reportId: new Headers(init?.headers).get("x-davora-report-id"),
          acceptedAt: "2026-09-24T09:27:58.000Z",
          expiresAfterDays: 30,
          duplicate: false
        }
      }), { status: 201, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const receipt = await createBrowserDiagnosticsUpload().upload({
      reportId: "123e4567-e89b-42d3-a456-426614174000",
      blob: new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], { type: "application/zip" }),
      generatedAt: "2026-09-24T09:27:58.000Z",
      diagnosticsSchema: 2,
      appBuild: "web-abcdef",
      token: "session-token"
    });

    expect(receipt.reportId).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = capturedInit;
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(Blob);
    expect(init?.headers).toMatchObject({
      authorization: "Bearer session-token",
      "content-type": "application/zip",
      "x-davora-diagnostics-schema": "2",
      "x-davora-web-build": "web-abcdef",
      "x-davora-report-generated-at": "2026-09-24T09:27:58.000Z"
    });
    expect(new Headers(init?.headers).get("x-davora-report-id")).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(new Headers(init?.headers).get("x-davora-report-sha256")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects an oversized bundle before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createBrowserDiagnosticsUpload().upload({
      reportId: "123e4567-e89b-42d3-a456-426614174000",
      blob: new Blob([new Uint8Array(3 * 1024 * 1024 + 1)]),
      generatedAt: "2026-09-24T09:27:58.000Z",
      diagnosticsSchema: 2,
      appBuild: "web-abcdef",
      token: "session-token"
    })).rejects.toThrow("DiagnosticReportTooLarge");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
