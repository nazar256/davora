import { normalizeRootPath } from "@davora/shared";

import type { WorkerEnv } from "./types";
import type { AccountStateStorage } from "./accounts/storage";
import { createNextcloudDestinationPolicy, normalizeNextcloudAllowedHosts } from "./security/nextcloudDestinationPolicy";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const MIN_PRODUCTION_SESSION_SECRET_BYTES = 32;

export class WorkerConfigurationError extends Error {
  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "WorkerConfigurationError";
  }
}

type RuntimeMode = "production" | "development";

function readString(env: Record<string, unknown>, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" ? value : undefined;
}

function isDurableObjectNamespace(value: unknown): value is NonNullable<WorkerEnv["DAVORA_ACCOUNT_STORE"]> {
  return Boolean(
    value
      && typeof value === "object"
      && "idFromName" in value
      && typeof (value as { idFromName?: unknown }).idFromName === "function"
      && "get" in value
      && typeof (value as { get?: unknown }).get === "function"
  );
}

function isAccountStateStorage(value: unknown): value is AccountStateStorage {
  return Boolean(
    value
      && typeof value === "object"
      && "read" in value
      && typeof value.read === "function"
      && "compareAndSet" in value
      && typeof value.compareAndSet === "function"
  );
}

function isDiagnosticR2Bucket(value: unknown): value is NonNullable<WorkerEnv["DAVORA_DIAGNOSTIC_REPORTS"]> {
  return Boolean(value && typeof value === "object" && "head" in value && typeof value.head === "function"
    && "put" in value && typeof value.put === "function"
    && "delete" in value && typeof value.delete === "function");
}

function isDiagnosticRateLimiter(value: unknown): value is NonNullable<WorkerEnv["DIAGNOSTIC_UPLOAD_ACCOUNT_RATE_LIMITER"]> {
  return Boolean(value && typeof value === "object" && "limit" in value && typeof value.limit === "function");
}

function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function runtimeModeFromEnv(env: Record<string, unknown>): RuntimeMode {
  return readString(env, "RUNTIME_MODE")?.trim().toLowerCase() === "development" ? "development" : "production";
}

function validateSecret(rawValue: string | undefined, runtimeMode: RuntimeMode, name: string, enforceProductionMinimum = true): string {
  const value = rawValue?.trim();
  if (!value) {
    throw new WorkerConfigurationError(`${name} is required. Provision it in the Worker runtime before release.`);
  }
  if (runtimeMode === "production" && enforceProductionMinimum && new TextEncoder().encode(value).byteLength < MIN_PRODUCTION_SESSION_SECRET_BYTES) {
    throw new WorkerConfigurationError(`${name} must contain at least 32 bytes in production.`);
  }
  return value;
}

export function validateSessionSecret(rawValue: string | undefined, runtimeMode: RuntimeMode): string {
  return validateSecret(rawValue, runtimeMode, "SESSION_SECRET");
}

export function validateSessionTokenSecret(rawValue: string | undefined, fallback: string, runtimeMode: RuntimeMode): string {
  return validateSecret(rawValue ?? fallback, runtimeMode, "SESSION_TOKEN_SECRET");
}

export function validateAppUnlockCode(rawValue: string | undefined, runtimeMode: RuntimeMode): string | undefined {
  const value = rawValue?.trim() || undefined;
  if (runtimeMode === "production" && value) {
    throw new WorkerConfigurationError("APP_UNLOCK_CODE is disabled in production; leave it unset.");
  }
  return value;
}

export function normalizeNextcloudBaseUrl(
  rawValue: string,
  allowedHosts: string[],
  requireAllowlist = true,
  runtimeMode: "production" | "development" = "production",
  allowLocalNextcloud = false,
  allowAnyHost = false
): string {
  let url: URL;
  try {
    url = new URL(rawValue.trim());
  } catch {
    throw new Error("NEXTCLOUD_BASE_URL must be a valid absolute URL.");
  }

  if (url.username || url.password) {
    throw new Error("NEXTCLOUD_BASE_URL must not include embedded credentials.");
  }

  if (url.search || url.hash) {
    throw new Error("NEXTCLOUD_BASE_URL must not include query strings or fragments.");
  }

  const hostname = url.hostname.toLowerCase();
  const isLocal = LOCAL_HOSTS.has(hostname);
  if (!allowAnyHost && requireAllowlist && allowedHosts.length === 0 && !(runtimeMode === "development" && allowLocalNextcloud && isLocal)) {
    throw new Error("NEXTCLOUD_ALLOWED_HOSTS must contain at least one exact hostname.");
  }
  if (!allowAnyHost && !requireAllowlist && runtimeMode === "production" && allowedHosts.length === 0) {
    throw new Error("NEXTCLOUD_ALLOWED_HOSTS must contain at least one exact hostname.");
  }
  createNextcloudDestinationPolicy({ runtimeMode, allowLocalNextcloud, allowedHosts, allowAnyHost }).assertAllowed(url);

  const strippedDavPath = url.pathname.replace(/\/+$/, "").replace(/\/remote\.php\/dav$/i, "");
  if (/\/remote\.php\/dav\//i.test(strippedDavPath)) {
    throw new Error("NEXTCLOUD_BASE_URL must point to the instance base URL, not a DAV resource.");
  }

  url.pathname = strippedDavPath || "/";
  return url.toString().replace(/\/$/, "");
}

export function validateNextcloudUsername(rawValue: string): string {
  const value = rawValue.trim();
  if (!value) {
    throw new Error("NEXTCLOUD_USERNAME is required.");
  }
  if (/[/\\\u0000-\u001F\u007F]/.test(value)) {
    throw new Error("NEXTCLOUD_USERNAME contains invalid characters.");
  }
  return value;
}

export function validateNextcloudAppPassword(rawValue: string): string {
  const value = rawValue.trim();
  if (!value) {
    throw new Error("NEXTCLOUD_APP_PASSWORD is required.");
  }
  return value;
}

export function normalizeAccountLabel(rawValue: string | undefined): string | undefined {
  const value = rawValue?.trim();
  return value ? value.slice(0, 120) : undefined;
}

function loadValidatedConfig(env: Record<string, unknown>): WorkerEnv {
  const mockBackend = parseBoolean(readString(env, "MOCK_BACKEND"));
  const allowedOrigins = parseList(readString(env, "ALLOWED_ORIGINS"));
  const allowedHosts = normalizeNextcloudAllowedHosts(parseList(readString(env, "NEXTCLOUD_ALLOWED_HOSTS")));
  const runtimeMode = runtimeModeFromEnv(env);
  const allowLocalNextcloud = parseBoolean(readString(env, "ALLOW_LOCAL_NEXTCLOUD"));
  const allowAnyHost = !mockBackend && runtimeMode === "production" && allowedHosts.length === 0;
  const rootPath = normalizeRootPath(readString(env, "NEXTCLOUD_ROOT_PATH"));
  const rawSessionSecret = readString(env, "SESSION_SECRET");
  const rawSessionTokenSecret = readString(env, "SESSION_TOKEN_SECRET");
  const rawAccountStateSecret = readString(env, "ACCOUNT_STATE_SECRET");
  const migrationKeysPresent = Boolean(rawAccountStateSecret?.trim() && rawSessionTokenSecret?.trim());
  const sessionSecret = validateSecret(rawSessionSecret, runtimeMode, "SESSION_SECRET", !migrationKeysPresent);
  const accountStateSecret = validateSecret(rawAccountStateSecret ?? sessionSecret, runtimeMode, "ACCOUNT_STATE_SECRET");
  const sessionTokenSecret = validateSessionTokenSecret(rawSessionTokenSecret, sessionSecret, runtimeMode);
  const appUnlockCode = validateAppUnlockCode(readString(env, "APP_UNLOCK_CODE"), runtimeMode);
  if (runtimeMode === "production" && allowLocalNextcloud) {
    throw new WorkerConfigurationError("ALLOW_LOCAL_NEXTCLOUD is only valid in development mode.");
  }
  if (!mockBackend && !allowAnyHost && allowedHosts.length === 0 && !(runtimeMode === "development" && allowLocalNextcloud)) {
    throw new WorkerConfigurationError("NEXTCLOUD_ALLOWED_HOSTS must contain at least one exact hostname for the real backend.");
  }

  return {
    SESSION_SECRET: sessionSecret,
    ACCOUNT_STATE_SECRET: accountStateSecret,
    SESSION_TOKEN_SECRET: sessionTokenSecret,
    SESSION_TTL_SECONDS: parseNumber(readString(env, "SESSION_TTL_SECONDS"), 3600),
    ALLOWED_ORIGINS: allowedOrigins,
    APP_UNLOCK_CODE: appUnlockCode,
    NEXTCLOUD_ROOT_PATH: rootPath,
    NEXTCLOUD_ALLOWED_HOSTS: allowedHosts,
    RUNTIME_MODE: runtimeMode,
    ALLOW_LOCAL_NEXTCLOUD: allowLocalNextcloud,
    NEXTCLOUD_MAX_FILE_BYTES: parseNumber(readString(env, "NEXTCLOUD_MAX_FILE_BYTES"), 64 * 1024),
    NEXTCLOUD_MAX_TEXT_FILE_BYTES: parseNumber(readString(env, "NEXTCLOUD_MAX_TEXT_FILE_BYTES"), 16 * 1024),
    MOCK_BACKEND: mockBackend,
    LOCAL_DEV_STATE_PATH: readString(env, "LOCAL_DEV_STATE_PATH")?.trim() || undefined,
    DAVORA_ACCOUNT_STORE: isDurableObjectNamespace(env.DAVORA_ACCOUNT_STORE) ? env.DAVORA_ACCOUNT_STORE : undefined,
    ACCOUNT_STATE_STORAGE: isAccountStateStorage(env.ACCOUNT_STATE_STORAGE) ? env.ACCOUNT_STATE_STORAGE : undefined,
    DIAGNOSTIC_UPLOAD_ENABLED: parseBoolean(readString(env, "DIAGNOSTIC_UPLOAD_ENABLED")),
    DIAGNOSTIC_QUOTA_SECRET: readString(env, "DIAGNOSTIC_QUOTA_SECRET")?.trim() || undefined,
    WORKER_BUILD_LABEL: readString(env, "WORKER_BUILD_LABEL")?.trim() || undefined,
    DAVORA_DIAGNOSTIC_REPORTS: isDiagnosticR2Bucket(env.DAVORA_DIAGNOSTIC_REPORTS) ? env.DAVORA_DIAGNOSTIC_REPORTS : undefined,
    DIAGNOSTIC_UPLOAD_ACCOUNT_RATE_LIMITER: isDiagnosticRateLimiter(env.DIAGNOSTIC_UPLOAD_ACCOUNT_RATE_LIMITER)
      ? env.DIAGNOSTIC_UPLOAD_ACCOUNT_RATE_LIMITER
      : undefined,
    DIAGNOSTIC_UPLOAD_GLOBAL_RATE_LIMITER: isDiagnosticRateLimiter(env.DIAGNOSTIC_UPLOAD_GLOBAL_RATE_LIMITER)
      ? env.DIAGNOSTIC_UPLOAD_GLOBAL_RATE_LIMITER
      : undefined
  };
}

export function loadConfig(env: Record<string, unknown>): WorkerEnv {
  try {
    return loadValidatedConfig(env);
  } catch (error) {
    if (error instanceof WorkerConfigurationError) throw error;
    throw new WorkerConfigurationError("Worker configuration is invalid.");
  }
}

export function configHealth(env: Record<string, unknown>) {
  const required = ["SESSION_SECRET"];

  const rawSessionSecret = readString(env, "SESSION_SECRET");
  const rawAccountStateSecret = readString(env, "ACCOUNT_STATE_SECRET");
  const rawSessionTokenSecret = readString(env, "SESSION_TOKEN_SECRET");
  const rawAppUnlockCode = readString(env, "APP_UNLOCK_CODE");
  const runtimeMode = runtimeModeFromEnv(env);
  const allowAnyHost = !parseBoolean(readString(env, "MOCK_BACKEND")) && runtimeMode === "production" && parseList(readString(env, "NEXTCLOUD_ALLOWED_HOSTS")).length === 0;
  const missing = required.filter((key) => !readString(env, key)?.trim());
  let policyError: string | undefined;
  try {
    const allowedHosts = normalizeNextcloudAllowedHosts(parseList(readString(env, "NEXTCLOUD_ALLOWED_HOSTS")));
    const allowLocalNextcloud = parseBoolean(readString(env, "ALLOW_LOCAL_NEXTCLOUD"));
    const migrationKeysPresent = Boolean(rawAccountStateSecret?.trim() && rawSessionTokenSecret?.trim());
    validateSecret(rawSessionSecret, runtimeMode, "SESSION_SECRET", !migrationKeysPresent);
    validateSecret(rawAccountStateSecret ?? rawSessionSecret, runtimeMode, "ACCOUNT_STATE_SECRET");
    validateSessionTokenSecret(rawSessionTokenSecret, rawSessionSecret?.trim() ?? "", runtimeMode);
    validateAppUnlockCode(rawAppUnlockCode, runtimeMode);
    if (runtimeMode === "production" && allowLocalNextcloud) throw new Error("ALLOW_LOCAL_NEXTCLOUD is only valid in development mode.");
    if (!parseBoolean(readString(env, "MOCK_BACKEND")) && !allowAnyHost && allowedHosts.length === 0 && !(runtimeMode === "development" && allowLocalNextcloud)) {
      throw new Error("NEXTCLOUD_ALLOWED_HOSTS is required for the real backend.");
    }
  } catch (error) {
    policyError = error instanceof Error ? error.message : "Destination policy configuration is invalid.";
  }
  return {
    configLoaded: missing.length === 0 && !policyError,
    missing,
    backend: parseBoolean(readString(env, "MOCK_BACKEND")) ? "mock" as const : "nextcloud" as const,
    rootPath: normalizeRootPath(readString(env, "NEXTCLOUD_ROOT_PATH")),
    unlockRequired: Boolean(rawAppUnlockCode?.trim()),
    ...(policyError ? { policyError } : {})
  };
}
