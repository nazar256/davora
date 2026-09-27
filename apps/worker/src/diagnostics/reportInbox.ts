import {
  diagnosticReportEndpoint,
  type ApiEnvelope,
  type ConnectedAccount,
  type DiagnosticReportMetadata,
  type DiagnosticReportReceipt
} from "@davora/shared";

import { workerFailure, isWorkerFailure } from "../http/failure";
import { json } from "../security/http";
import type { WorkerEnv } from "../types";

export const MAX_DIAGNOSTIC_REPORT_BYTES = 3 * 1024 * 1024;
const REPORTS_PER_ACCOUNT_PER_DAY = 3;
const RETENTION_DAYS = 30 as const;

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return bytesToHex(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
}

async function accountQuotaKey(
  secret: string,
  account: Pick<ConnectedAccount, "backend" | "baseUrl" | "username">
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const providerIdentity = JSON.stringify([
    account.backend,
    account.baseUrl,
    account.username.normalize("NFC").toLowerCase()
  ]);
  return bytesToHex(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`diagnostic-quota:v2:${providerIdentity}`)
  ));
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length")?.trim();
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw workerFailure("invalid_diagnostic_report", "content-length");
    }
    if (parsedLength > MAX_DIAGNOSTIC_REPORT_BYTES) {
      throw workerFailure("diagnostic_report_too_large", "declared-size");
    }
  }

  if (!request.body) throw workerFailure("invalid_diagnostic_report", "missing-body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DIAGNOSTIC_REPORT_BYTES) {
        await reader.cancel();
        throw workerFailure("diagnostic_report_too_large", "streamed-size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total < 4) throw workerFailure("invalid_diagnostic_report", "empty-body");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08));
}

function reportKey(metadata: DiagnosticReportMetadata): string {
  const date = new Date(metadata.generatedAt).toISOString().slice(0, 10);
  return `reports/v1/${date.replaceAll("-", "/")}/${metadata.reportId}.zip`;
}

function receipt(metadata: DiagnosticReportMetadata, acceptedAt: string, duplicate: boolean): Response {
  const payload: ApiEnvelope<DiagnosticReportReceipt> = {
    data: { reportId: metadata.reportId, acceptedAt, expiresAfterDays: RETENTION_DAYS, duplicate }
  };
  return json(diagnosticReportEndpoint.successSchema.parse(payload), duplicate ? 200 : 201);
}

async function enforceRateLimits(env: WorkerEnv, accountKey: string): Promise<void> {
  if (!env.DIAGNOSTIC_UPLOAD_ACCOUNT_RATE_LIMITER || !env.DIAGNOSTIC_UPLOAD_GLOBAL_RATE_LIMITER) {
    throw workerFailure("diagnostic_report_unavailable", "missing-rate-limiter");
  }
  const [account, global] = await Promise.all([
    env.DIAGNOSTIC_UPLOAD_ACCOUNT_RATE_LIMITER.limit({ key: accountKey }),
    env.DIAGNOSTIC_UPLOAD_GLOBAL_RATE_LIMITER.limit({ key: "diagnostic-report-global" })
  ]);
  if (!account.success || !global.success) {
    throw workerFailure("diagnostic_report_rate_limited", "short-window");
  }
}

async function reserveDailySlot(env: WorkerEnv, accountKey: string, date: string, reportId: string): Promise<string> {
  const bucket = env.DAVORA_DIAGNOSTIC_REPORTS;
  if (!bucket) throw workerFailure("diagnostic_report_unavailable", "missing-bucket");
  for (let slot = 0; slot < REPORTS_PER_ACCOUNT_PER_DAY; slot += 1) {
    const reserved = await bucket.put(`quota/v1/${date}/${accountKey}/${slot}`, null, {
      onlyIf: new Headers({ "if-none-match": "*" }),
      customMetadata: { reportId }
    });
    if (reserved) return `quota/v1/${date}/${accountKey}/${slot}`;
  }
  throw workerFailure("diagnostic_report_rate_limited", "daily-quota");
}

export async function uploadDiagnosticReport(
  request: Request,
  metadata: DiagnosticReportMetadata,
  account: Pick<ConnectedAccount, "backend" | "baseUrl" | "username">,
  env: WorkerEnv
): Promise<Response> {
  if (!env.DIAGNOSTIC_UPLOAD_ENABLED || !env.DIAGNOSTIC_QUOTA_SECRET || !env.DAVORA_DIAGNOSTIC_REPORTS) {
    throw workerFailure("diagnostic_report_unavailable", "disabled-or-missing-binding");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/zip") {
    throw workerFailure("invalid_diagnostic_report", "content-type");
  }

  const bucket = env.DAVORA_DIAGNOSTIC_REPORTS;
  const key = reportKey(metadata);
  try {
    const existing = await bucket.head(key);
    if (existing) {
      if (existing.customMetadata?.sha256 !== metadata.sha256) throw workerFailure("conflict", "report-id-reuse");
      return receipt(metadata, existing.customMetadata.acceptedAt ?? new Date().toISOString(), true);
    }

    const quotaAccountKey = await accountQuotaKey(env.DIAGNOSTIC_QUOTA_SECRET, account);
    await enforceRateLimits(env, quotaAccountKey);
    const bytes = await readBoundedBody(request);
    if (!isZip(bytes) || await sha256(bytes) !== metadata.sha256) {
      throw workerFailure("invalid_diagnostic_report", "zip-or-checksum");
    }

    const acceptedAt = new Date().toISOString();
    const acceptedDate = acceptedAt.slice(0, 10);
    const reservedSlot = await reserveDailySlot(env, quotaAccountKey, acceptedDate, metadata.reportId);
    let keepReservation = false;
    try {
      const stored = await bucket.put(key, bytes, {
        onlyIf: new Headers({ "if-none-match": "*" }),
        sha256: metadata.sha256,
        httpMetadata: { contentType: "application/zip" },
        customMetadata: {
          reportId: metadata.reportId,
          sha256: metadata.sha256,
          diagnosticsSchema: String(metadata.diagnosticsSchema),
          webBuild: metadata.webBuild,
          workerBuild: env.WORKER_BUILD_LABEL ?? "unknown",
          apiContract: "2",
          generatedAt: metadata.generatedAt,
          acceptedAt,
          size: String(bytes.byteLength)
        }
      });
      if (!stored) {
        const raced = await bucket.head(key);
        if (raced?.customMetadata?.sha256 === metadata.sha256) {
          return receipt(metadata, raced.customMetadata.acceptedAt ?? acceptedAt, true);
        }
        throw workerFailure("conflict", "report-id-race");
      }
      keepReservation = true;
      return receipt(metadata, acceptedAt, false);
    } finally {
      if (!keepReservation) await bucket.delete(reservedSlot);
    }
  } catch (error) {
    if (isWorkerFailure(error)) throw error;
    throw workerFailure("diagnostic_report_unavailable", error instanceof Error ? error.name : typeof error);
  }
}
