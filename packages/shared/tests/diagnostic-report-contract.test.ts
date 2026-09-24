import { describe, expect, it } from "vitest";

import { apiEndpoints } from "../src";

describe("diagnostic report upload contract", () => {
  it("defines an exact session-authenticated raw ZIP endpoint", () => {
    const endpoint = apiEndpoints.diagnosticReport;

    expect(endpoint).toBeDefined();
    expect(endpoint).toMatchObject({
      id: "diagnosticReport",
      method: "POST",
      matchPolicy: "method",
      path: "/api/diagnostic-reports",
      auth: "session"
    });
    expect(endpoint?.requestSchema.safeParse({
      reportId: "123e4567-e89b-42d3-a456-426614174000",
      sha256: "a".repeat(64),
      generatedAt: "2026-09-24T09:27:58.000Z",
      diagnosticsSchema: 2,
      webBuild: "abcdef123456"
    }).success).toBe(true);
    expect(endpoint?.requestSchema.safeParse({
      reportId: "../../escape",
      sha256: "not-a-checksum",
      generatedAt: "yesterday",
      diagnosticsSchema: 0,
      webBuild: "<script>"
    }).success).toBe(false);
    expect(endpoint?.successSchema.safeParse({
      data: {
        reportId: "123e4567-e89b-42d3-a456-426614174000",
        acceptedAt: "2026-09-24T09:28:00.000Z",
        expiresAfterDays: 30,
        duplicate: false
      }
    }).success).toBe(true);
  });
});
