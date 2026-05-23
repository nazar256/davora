import { normalizeRootPath } from "@davora/shared";

import type { WorkerEnv } from "./types";

const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_PATTERN = /^[0-9a-f:]+$/i;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

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

function matchesHostPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }

  return hostname === pattern;
}

function isIpHostname(hostname: string): boolean {
  return IPV4_PATTERN.test(hostname) || hostname.includes(":") || IPV6_PATTERN.test(hostname.replace(/\[|\]/g, ""));
}

export function normalizeNextcloudBaseUrl(rawValue: string, allowedHosts: string[], requireAllowlist = true): string {
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

  if (url.protocol === "http:") {
    if (!isLocal) {
      throw new Error("NEXTCLOUD_BASE_URL must use HTTPS unless connecting to localhost for development.");
    }
  } else if (url.protocol !== "https:") {
    throw new Error("NEXTCLOUD_BASE_URL must use HTTP or HTTPS.");
  }

  if (!isLocal && isIpHostname(hostname)) {
    throw new Error("NEXTCLOUD_BASE_URL must use an allowlisted hostname.");
  }

  if (requireAllowlist && allowedHosts.length > 0 && !isLocal && !allowedHosts.some((pattern) => matchesHostPattern(hostname, pattern.toLowerCase()))) {
    throw new Error("NEXTCLOUD_BASE_URL hostname is not allowlisted.");
  }

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

export function loadConfig(env: Record<string, unknown>): WorkerEnv {
  const mockBackend = parseBoolean(readString(env, "MOCK_BACKEND"));
  const allowedOrigins = parseList(readString(env, "ALLOWED_ORIGINS"));
  const allowedHosts = parseList(readString(env, "NEXTCLOUD_ALLOWED_HOSTS"));
  const rootPath = normalizeRootPath(readString(env, "NEXTCLOUD_ROOT_PATH") || ".davora-agent-test");
  const sessionSecret = readString(env, "SESSION_SECRET")?.trim();

  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required. Provision it in the Worker runtime before release.");
  }

  return {
    SESSION_SECRET: sessionSecret,
    SESSION_TTL_SECONDS: parseNumber(readString(env, "SESSION_TTL_SECONDS"), 3600),
    ALLOWED_ORIGINS: allowedOrigins,
    APP_UNLOCK_CODE: readString(env, "APP_UNLOCK_CODE")?.trim() || undefined,
    NEXTCLOUD_ROOT_PATH: rootPath,
    NEXTCLOUD_ALLOWED_HOSTS: allowedHosts,
    NEXTCLOUD_MAX_FILE_BYTES: parseNumber(readString(env, "NEXTCLOUD_MAX_FILE_BYTES"), 64 * 1024),
    NEXTCLOUD_MAX_TEXT_FILE_BYTES: parseNumber(readString(env, "NEXTCLOUD_MAX_TEXT_FILE_BYTES"), 16 * 1024),
    MOCK_BACKEND: mockBackend,
    LOCAL_DEV_STATE_PATH: readString(env, "LOCAL_DEV_STATE_PATH")?.trim() || undefined,
    DAVORA_ACCOUNT_STORE: isDurableObjectNamespace(env.DAVORA_ACCOUNT_STORE) ? env.DAVORA_ACCOUNT_STORE : undefined
  };
}

export function configHealth(env: Record<string, unknown>) {
  const required = ["SESSION_SECRET"];

  const missing = required.filter((key) => !readString(env, key)?.trim());
  return {
    configLoaded: missing.length === 0,
    missing,
    backend: parseBoolean(readString(env, "MOCK_BACKEND")) ? "mock" as const : "nextcloud" as const,
    rootPath: normalizeRootPath(readString(env, "NEXTCLOUD_ROOT_PATH") || ".davora-agent-test"),
    unlockRequired: Boolean(readString(env, "APP_UNLOCK_CODE")?.trim())
  };
}
