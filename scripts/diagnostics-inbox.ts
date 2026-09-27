import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const API_ROOT = "https://api.cloudflare.com/client/v4";
const REPORT_KEY = /^reports\/v1\/(\d{4})\/(\d{2})\/(\d{2})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.zip$/;

export interface DiagnosticsInboxArgs {
  readonly command: "pull" | "clear";
  readonly sinceDays: number;
  readonly limit: number;
  readonly reports: string[];
}

export interface DiagnosticsInboxOptions {
  readonly sinceDays: number;
  readonly limit: number;
  readonly accountId: string;
  readonly bucket: string;
  readonly token: string;
  readonly outputDirectory: string;
}

export interface DiagnosticsInboxClearOptions {
  readonly accountId: string;
  readonly bucket: string;
  readonly token: string;
  readonly reports: readonly string[];
}

interface PullDependencies {
  readonly fetch: typeof fetch;
  readonly mkdir: (path: string, options: { recursive: true }) => Promise<unknown>;
  readonly writeFile: (path: string, data: string | Uint8Array, options: { flag: "wx" }) => Promise<unknown>;
  readonly now: () => Date;
}

interface ClearDependencies {
  readonly fetch: typeof fetch;
}

interface ListedObject {
  readonly key?: string;
  readonly size?: number;
  readonly last_modified?: string;
  readonly custom_metadata?: Record<string, string>;
}

interface ListResponse {
  readonly success?: boolean;
  readonly result?: ListedObject[];
  readonly result_info?: { readonly cursor?: string; readonly is_truncated?: boolean };
}

const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function parseDiagnosticsInboxArgs(args: readonly string[]): DiagnosticsInboxArgs {
  const command = args[0];
  if (command === "pull") {
    let sinceDays = 30;
    let limit = 50;
    for (let index = 1; index < args.length; index += 2) {
      const flag = args[index];
      const rawValue = args[index + 1];
      if (!rawValue) throw new Error(`Missing value for ${flag ?? "argument"}.`);
      if (flag === "--since" && /^\d+d$/.test(rawValue)) sinceDays = Number.parseInt(rawValue, 10);
      else if (flag === "--limit" && /^\d+$/.test(rawValue)) limit = Number.parseInt(rawValue, 10);
      else throw new Error(`Unsupported argument: ${flag ?? rawValue}.`);
    }
    if (sinceDays < 1 || sinceDays > 30) throw new Error("--since must be between 1d and 30d.");
    if (limit < 1 || limit > 100) throw new Error("--limit must be between 1 and 100.");
    return { command, sinceDays, limit, reports: [] };
  }
  if (command === "clear") {
    const reports: string[] = [];
    for (let index = 1; index < args.length; index += 2) {
      const flag = args[index];
      const rawValue = args[index + 1];
      if (flag !== "--report") throw new Error(`Unsupported argument: ${flag ?? rawValue}.`);
      if (!rawValue) throw new Error(`Missing value for ${flag}.`);
      if (!REPORT_ID.test(rawValue)) throw new Error(`--report must be a report UUID, got: ${rawValue}.`);
      reports.push(rawValue);
    }
    if (reports.length === 0) throw new Error("clear requires at least one --report <uuid>.");
    if (new Set(reports).size !== reports.length) throw new Error("Duplicate --report arguments are not allowed.");
    if (reports.length > 100) throw new Error("clear accepts at most 100 report IDs.");
    return { command, sinceDays: 30, limit: 50, reports };
  }
  throw new Error("Expected the 'pull' or 'clear' command.");
}

const authHeaders = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  "cf-r2-jurisdiction": "eu"
});

type BucketCoordinates = { readonly accountId: string; readonly bucket: string };

const baseUrl = (options: BucketCoordinates): string =>
  `${API_ROOT}/accounts/${encodeURIComponent(options.accountId)}/r2/buckets/${encodeURIComponent(options.bucket)}/objects`;

const safeObjectUrl = (options: BucketCoordinates, key: string): string =>
  `${baseUrl(options)}/${key.split("/").map(encodeURIComponent).join("/")}`;

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseListedObject = (value: unknown): ListedObject | undefined => {
  if (!isUnknownRecord(value)) return undefined;
  const metadata: Record<string, string> = {};
  if (isUnknownRecord(value.custom_metadata)) {
    for (const [key, entry] of Object.entries(value.custom_metadata)) {
      if (typeof entry === "string") metadata[key] = entry;
    }
  }
  return {
    key: typeof value.key === "string" ? value.key : undefined,
    size: typeof value.size === "number" ? value.size : undefined,
    last_modified: typeof value.last_modified === "string" ? value.last_modified : undefined,
    custom_metadata: metadata
  };
};

const parseListResponse = async (response: Response): Promise<ListResponse> => {
  if (!response.ok) throw new Error(`Cloudflare list request failed with status ${response.status}.`);
  const payload: unknown = await response.json();
  if (!isUnknownRecord(payload) || payload.success !== true || !Array.isArray(payload.result)) {
    throw new Error("Cloudflare list response was invalid.");
  }
  const result = payload.result.map(parseListedObject).filter((item): item is ListedObject => item !== undefined);
  const resultInfo = isUnknownRecord(payload.result_info)
    ? {
        cursor: typeof payload.result_info.cursor === "string" ? payload.result_info.cursor : undefined,
        is_truncated: payload.result_info.is_truncated === true
      }
    : undefined;
  return { success: true, result, result_info: resultInfo };
};

const listReportObjects = async (
  options: { readonly accountId: string; readonly bucket: string; readonly token: string },
  dependencies: { readonly fetch: typeof fetch }
): Promise<ListedObject[]> => {
  const objects: ListedObject[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(baseUrl(options));
    url.searchParams.set("prefix", "reports/v1/");
    url.searchParams.set("per_page", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = await parseListResponse(await dependencies.fetch(url, { headers: authHeaders(options.token) }));
    objects.push(...(page.result ?? []));
    cursor = page.result_info?.is_truncated ? page.result_info.cursor : undefined;
  } while (cursor);
  return objects;
};

export async function pullDiagnosticReports(
  options: DiagnosticsInboxOptions,
  dependencies: PullDependencies = { fetch, mkdir, writeFile, now: () => new Date() }
): Promise<{ downloaded: number; skipped: number; outputDirectory: string }> {
  if (!options.accountId || !options.bucket || !options.token) throw new Error("Cloudflare account, bucket, and read token are required.");
  if (!options.outputDirectory.startsWith(".tmp/diagnostic-inbox/")) {
    throw new Error("Diagnostic reports may only be written under .tmp/diagnostic-inbox/.");
  }
  const cutoff = dependencies.now().getTime() - options.sinceDays * 24 * 60 * 60 * 1000;
  const candidates: ListedObject[] = [];
  let skipped = 0;
  for (const object of await listReportObjects(options, dependencies)) {
    const modified = object.last_modified ? Date.parse(object.last_modified) : Number.NaN;
    if (typeof object.key === "string" && object.key.startsWith("reports/v1/") && Number.isFinite(modified) && modified >= cutoff) {
      if (REPORT_KEY.test(object.key)) candidates.push(object);
      else skipped += 1;
    }
  }

  const selected = candidates
    .sort((left, right) => String(left.last_modified).localeCompare(String(right.last_modified)))
    .slice(0, options.limit);
  await dependencies.mkdir(options.outputDirectory, { recursive: true });
  const manifest: Array<Record<string, string | number>> = [];
  const filenames = new Set<string>();
  skipped += candidates.length - selected.length;
  for (const object of selected) {
    const objectKey = object.key;
    const match = objectKey?.match(REPORT_KEY);
    const expectedChecksum = object.custom_metadata?.sha256;
    if (!objectKey || !match || !expectedChecksum || !/^[a-f0-9]{64}$/.test(expectedChecksum)) {
      skipped += 1;
      continue;
    }
    const response = await dependencies.fetch(safeObjectUrl(options, objectKey), { headers: authHeaders(options.token) });
    if (!response.ok) throw new Error(`Cloudflare object request failed with status ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actualChecksum = createHash("sha256").update(bytes).digest("hex");
    if (actualChecksum !== expectedChecksum) throw new Error(`Checksum mismatch for report ${match[4]}.`);
    const filename = `${match[1]}-${match[2]}-${match[3]}-${match[4]}.zip`;
    if (filenames.has(filename)) throw new Error(`Duplicate report destination: ${filename}.`);
    filenames.add(filename);
    await dependencies.writeFile(`${options.outputDirectory}/${filename}`, bytes, { flag: "wx" });
    manifest.push({
      reportId: match[4] ?? "unknown",
      key: objectKey,
      filename,
      size: bytes.byteLength,
      sha256: actualChecksum,
      lastModified: object.last_modified ?? "unknown"
    });
  }
  await dependencies.writeFile(
    `${options.outputDirectory}/manifest.json`,
    `${JSON.stringify({ reports: manifest }, null, 2)}\n`,
    { flag: "wx" }
  );
  return { downloaded: manifest.length, skipped, outputDirectory: options.outputDirectory };
}

/**
 * Deletes report objects for explicitly handled report IDs. Only canonical
 * `reports/v1/YYYY/MM/DD/<uuid>.zip` keys whose UUID was requested are
 * removed — quota objects, unlisted IDs, and unrelated keys are untouched.
 */
export async function clearDiagnosticReports(
  options: DiagnosticsInboxClearOptions,
  dependencies: ClearDependencies = { fetch }
): Promise<{ deleted: number; missing: string[] }> {
  if (!options.accountId || !options.bucket || !options.token) {
    throw new Error("Cloudflare account, bucket, and write token are required.");
  }
  const wanted = new Set(options.reports);
  const keysToDelete: string[] = [];
  for (const object of await listReportObjects(options, dependencies)) {
    const match = object.key?.match(REPORT_KEY);
    const reportId = match?.[4];
    if (match && reportId && wanted.has(reportId)) {
      keysToDelete.push(match[0]);
    }
  }
  const deletedIds = new Set<string>();
  for (const key of keysToDelete) {
    const response = await dependencies.fetch(safeObjectUrl(options, key), {
      method: "DELETE",
      headers: authHeaders(options.token)
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok || (isUnknownRecord(payload) && payload.success === false)) {
      throw new Error(`Cloudflare delete request failed with status ${response.status}.`);
    }
    const match = key.match(REPORT_KEY);
    if (match?.[4]) deletedIds.add(match[4]);
  }
  return { deleted: keysToDelete.length, missing: [...wanted].filter((id) => !deletedIds.has(id)) };
}

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (entryPath === import.meta.url) {
  try {
    const args = parseDiagnosticsInboxArgs(process.argv.slice(2));
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
    const bucket = process.env.DAVORA_DIAGNOSTIC_REPORTS_BUCKET?.trim() || "davora-local-diagnostic-reports";
    if (args.command === "clear") {
      const token = process.env.CLOUDFLARE_DIAGNOSTICS_WRITE_TOKEN?.trim() ?? "";
      const result = await clearDiagnosticReports({ accountId, bucket, token, reports: args.reports });
      console.log(`Deleted ${result.deleted} report object(s); missing: ${result.missing.length > 0 ? result.missing.join(", ") : "none"}.`);
    } else {
      const token = process.env.CLOUDFLARE_DIAGNOSTICS_READ_TOKEN?.trim() ?? "";
      const runStamp = `${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 17)}-${randomUUID().slice(0, 8)}`;
      const result = await pullDiagnosticReports({
        sinceDays: args.sinceDays,
        limit: args.limit,
        accountId,
        token,
        bucket,
        outputDirectory: `.tmp/diagnostic-inbox/${runStamp}`
      });
      console.log(`Downloaded ${result.downloaded} report(s) to ${result.outputDirectory}; skipped ${result.skipped}.`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Diagnostic inbox command failed.");
    process.exitCode = 1;
  }
}
