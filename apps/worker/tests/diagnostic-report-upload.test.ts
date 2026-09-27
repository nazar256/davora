import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiErrorEnvelopeSchema, diagnosticReportEndpoint } from "@davora/shared";

import { handleRequest } from "../src/app";
import {
  createSessionToken,
  env as baseEnv,
  ownerHeaders,
  resetConnectedAccountStoreForTests
} from "./support/workerApplicationHarness";

const REPORT_ID = "123e4567-e89b-42d3-a456-426614174000";
const GENERATED_AT = "2026-09-24T09:27:58.000Z";
const MAX_BYTES = 3 * 1024 * 1024;
const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);

const hex = (value: ArrayBuffer): string => [...new Uint8Array(value)]
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");

const checksum = async (bytes: Uint8Array): Promise<string> =>
  hex(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));

interface StoredObject {
  readonly bytes: Uint8Array;
  readonly customMetadata: Record<string, string>;
  readonly httpMetadata?: Record<string, string>;
}

class FakeR2Bucket {
  readonly objects = new Map<string, StoredObject>();
  failReportPut = false;

  async head(key: string) {
    const stored = this.objects.get(key);
    return stored ? { key, size: stored.bytes.byteLength, customMetadata: stored.customMetadata } : null;
  }

  async put(key: string, value: ArrayBuffer | ArrayBufferView | string | null, options: {
    onlyIf?: Headers | { etagDoesNotMatch?: string };
    customMetadata?: Record<string, string>;
    httpMetadata?: Record<string, string>;
  } = {}) {
    const exclusive = options.onlyIf instanceof Headers
      ? options.onlyIf.get("if-none-match") === "*"
      : options.onlyIf?.etagDoesNotMatch === "*";
    if (exclusive && this.objects.has(key)) return null;
    if (this.failReportPut && key.startsWith("reports/")) throw new Error("private-storage-sentinel");
    const bytes = typeof value === "string"
      ? new TextEncoder().encode(value)
      : value === null
        ? new Uint8Array()
        : ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          : new Uint8Array(value);
    this.objects.set(key, {
      bytes: new Uint8Array(bytes),
      customMetadata: { ...(options.customMetadata ?? {}) },
      httpMetadata: options.httpMetadata
    });
    return { key, size: bytes.byteLength, customMetadata: options.customMetadata ?? {} };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}

const passingLimiter = () => ({ limit: vi.fn(async () => ({ success: true })) });

const uploadEnv = (bucket: FakeR2Bucket, overrides: Record<string, unknown> = {}) => ({
  ...baseEnv,
  DIAGNOSTIC_UPLOAD_ENABLED: "true",
  DIAGNOSTIC_QUOTA_SECRET: "diagnostic-quota-secret-0123456789abcdef",
  DAVORA_DIAGNOSTIC_REPORTS: bucket,
  DIAGNOSTIC_UPLOAD_ACCOUNT_RATE_LIMITER: passingLimiter(),
  DIAGNOSTIC_UPLOAD_GLOBAL_RATE_LIMITER: passingLimiter(),
  WORKER_BUILD_LABEL: "worker-abcdef123456",
  ...overrides
});

const reportHeaders = async (token: string, bytes = zipBytes, overrides: Record<string, string> = {}) => ({
  ...ownerHeaders,
  authorization: `Bearer ${token}`,
  "content-type": "application/zip",
  "x-davora-report-id": REPORT_ID,
  "x-davora-report-sha256": await checksum(bytes),
  "x-davora-report-generated-at": GENERATED_AT,
  "x-davora-diagnostics-schema": "2",
  "x-davora-web-build": "web-abcdef123456",
  ...overrides
});

const upload = async (
  token: string | undefined,
  bucket: FakeR2Bucket,
  bytes = zipBytes,
  options: { headers?: Record<string, string>; env?: Record<string, unknown> } = {}
) => handleRequest(new Request("http://127.0.0.1:8787/api/diagnostic-reports", {
  method: "POST",
  headers: token
    ? await reportHeaders(token, bytes, options.headers)
    : { ...ownerHeaders, "content-type": "application/zip", ...(options.headers ?? {}) },
  body: bytes
}), options.env ?? uploadEnv(bucket));

const errorCode = async (response: Response): Promise<string> => {
  const payload: unknown = await response.json();
  return apiErrorEnvelopeSchema.parse(payload).data.code;
};

describe("diagnostic report upload", () => {
  beforeEach(() => resetConnectedAccountStoreForTests());

  it("authenticates before reading or storing the report", async () => {
    const bucket = new FakeR2Bucket();
    const response = await upload(undefined, bucket);

    expect(response.status).toBe(401);
    expect(bucket.objects.size).toBe(0);
  });

  it("fails closed while upload is disabled", async () => {
    const { token } = await createSessionToken();
    const bucket = new FakeR2Bucket();
    const response = await upload(token, bucket, zipBytes, { env: baseEnv });

    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("diagnostic_report_unavailable");
    expect(bucket.objects.size).toBe(0);
  });

  it("stores a private report with safe metadata and returns a receipt", async () => {
    const { token, accountId } = await createSessionToken();
    const bucket = new FakeR2Bucket();
    const response = await upload(token, bucket);

    expect(response.status).toBe(201);
    const receiptPayload: unknown = await response.json();
    const parsedReceipt = diagnosticReportEndpoint.successSchema.parse(receiptPayload);
    expect(parsedReceipt.data).toMatchObject({
      reportId: REPORT_ID,
      expiresAfterDays: 30,
      duplicate: false
    });
    expect(Number.isFinite(Date.parse(parsedReceipt.data.acceptedAt))).toBe(true);
    const reportEntries = [...bucket.objects.entries()].filter(([key]) => key.startsWith("reports/v1/2026/09/24/"));
    expect(reportEntries).toHaveLength(1);
    expect(reportEntries[0]?.[0]).toBe(`reports/v1/2026/09/24/${REPORT_ID}.zip`);
    expect(reportEntries[0]?.[1].bytes).toEqual(zipBytes);
    expect(reportEntries[0]?.[1].customMetadata).toMatchObject({
      reportId: REPORT_ID,
      sha256: await checksum(zipBytes),
      diagnosticsSchema: "2",
      webBuild: "web-abcdef123456",
      workerBuild: "worker-abcdef123456",
      apiContract: "2"
    });
    const serialized = JSON.stringify([...bucket.objects.entries()]);
    expect(serialized).not.toContain(accountId);
    expect(serialized).not.toContain("demo-user");
  });

  it("makes same-checksum retries idempotent and rejects UUID reuse with different content", async () => {
    const { token } = await createSessionToken();
    const bucket = new FakeR2Bucket();

    expect((await upload(token, bucket)).status).toBe(201);
    const duplicate = await upload(token, bucket);
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ data: { reportId: REPORT_ID, duplicate: true } });

    const different = new Uint8Array([...zipBytes, 0x01]);
    const conflict = await upload(token, bucket, different);
    expect(conflict.status).toBe(409);
    expect(await errorCode(conflict)).toBe("conflict");
    expect([...bucket.objects.keys()].filter((key) => key.startsWith("reports/"))).toHaveLength(1);
  });

  it("rejects bad type, bad checksum, declared oversize, and streamed oversize", async () => {
    const { token } = await createSessionToken();
    const bucket = new FakeR2Bucket();

    const badType = await upload(token, bucket, zipBytes, { headers: { "content-type": "text/plain" } });
    expect(badType.status).toBe(400);
    expect(await errorCode(badType)).toBe("invalid_diagnostic_report");

    const badChecksum = await upload(token, bucket, zipBytes, { headers: { "x-davora-report-sha256": "0".repeat(64) } });
    expect(badChecksum.status).toBe(400);

    const declared = await upload(token, bucket, zipBytes, { headers: { "content-length": String(MAX_BYTES + 1) } });
    expect(declared.status).toBe(413);
    expect(await errorCode(declared)).toBe("diagnostic_report_too_large");

    const oversized = new Uint8Array(MAX_BYTES + 1);
    oversized.set(zipBytes);
    const streamed = await upload(token, bucket, oversized, { headers: { "content-length": "" } });
    expect(streamed.status).toBe(413);
    expect(bucket.objects.size).toBe(0);
  });

  it("enforces short-window rate limits before storage", async () => {
    const { token } = await createSessionToken();
    const bucket = new FakeR2Bucket();
    const denied = { limit: vi.fn(async () => ({ success: false })) };
    const response = await upload(token, bucket, zipBytes, {
      env: uploadEnv(bucket, { DIAGNOSTIC_UPLOAD_ACCOUNT_RATE_LIMITER: denied })
    });

    expect(response.status).toBe(429);
    expect(await errorCode(response)).toBe("diagnostic_report_rate_limited");
    expect(bucket.objects.size).toBe(0);
  });

  it("accepts only three reports per account and server UTC day even when client dates differ", async () => {
    const { token } = await createSessionToken();
    const bucket = new FakeR2Bucket();
    for (let index = 0; index < 3; index += 1) {
      const reportId = `123e4567-e89b-42d3-a456-42661417400${index}`;
      const response = await upload(token, bucket, zipBytes, {
        headers: {
          "x-davora-report-id": reportId,
          "x-davora-report-generated-at": `2026-09-${String(20 + index).padStart(2, "0")}T09:27:58.000Z`
        }
      });
      expect(response.status).toBe(201);
    }
    const fourth = await upload(token, bucket, zipBytes, {
      headers: {
        "x-davora-report-id": "123e4567-e89b-42d3-a456-426614174003",
        "x-davora-report-generated-at": "2026-09-23T09:27:58.000Z"
      }
    });
    expect(fourth.status).toBe(429);
    expect(await errorCode(fourth)).toBe("diagnostic_report_rate_limited");
    expect([...bucket.objects.keys()].filter((key) => key.startsWith("reports/"))).toHaveLength(3);
  });

  it("shares the daily quota across repeated connections to the same provider identity", async () => {
    const first = await createSessionToken();
    const second = await createSessionToken();
    expect(first.accountId).not.toBe(second.accountId);
    const bucket = new FakeR2Bucket();

    for (let index = 0; index < 3; index += 1) {
      const response = await upload(index < 2 ? first.token : second.token, bucket, zipBytes, {
        headers: { "x-davora-report-id": `123e4567-e89b-42d3-a456-42661417401${index}` }
      });
      expect(response.status).toBe(201);
    }

    const fourth = await upload(second.token, bucket, zipBytes, {
      headers: { "x-davora-report-id": "123e4567-e89b-42d3-a456-426614174013" }
    });
    expect(fourth.status).toBe(429);
    expect(await errorCode(fourth)).toBe("diagnostic_report_rate_limited");
  });

  it("redacts storage failures and returns an unavailable response", async () => {
    const { token } = await createSessionToken();
    const bucket = new FakeR2Bucket();
    bucket.failReportPut = true;
    const response = await upload(token, bucket);

    expect(response.status).toBe(503);
    const responseBody = await response.text();
    const parsedBody: unknown = JSON.parse(responseBody);
    expect(apiErrorEnvelopeSchema.parse(parsedBody).data.code).toBe(
      "diagnostic_report_unavailable"
    );
    expect(responseBody).not.toContain("private-storage-sentinel");
    expect([...bucket.objects.keys()].filter((key) => key.startsWith("quota/"))).toHaveLength(0);
  });
});
