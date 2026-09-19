/**
 * Structured redaction for diagnostic payloads.
 *
 * The goal is to preserve enough shape for debugging — operation type, depth,
 * extension, item kind, stable report-local placeholders — while never
 * exposing real filenames, folder names, account identifiers, URLs, or secrets.
 * Pure module: no browser globals, no clocks.
 */

import type { RedactedPathRef } from "./model";

export interface DiagnosticsRedactor {
  /** Map a raw path to a stable alias plus safe shape metadata. */
  path(path: string, kind?: "file" | "folder"): RedactedPathRef;
  /** Map any raw identifier (account id, session id, ...) to a stable alias. */
  alias(prefix: string, raw: string | undefined): string | undefined;
  /** Reduce a URL to a route template without query, hash, or credentials. */
  route(url: string): string;
  /** Sanitize free-form error text: strip URLs and token-like material. */
  message(text: string, maxLength?: number): string;
}

const extensionOf = (path: string): string | undefined => {
  const last = path.split("/").at(-1) ?? "";
  const dot = last.lastIndexOf(".");
  if (dot <= 0 || dot === last.length - 1) {
    return undefined;
  }
  const extension = last.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(extension) ? extension : undefined;
};

const depthOf = (path: string): number => {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments.length;
};

const URL_PATTERN = /https?:\/\/[^\s"'\])>}]+/gi;
const TOKEN_PATTERN = /\b(?:eyJ[A-Za-z0-9_-]{10,}|[A-Za-z0-9_-]{32,})\b/g;
const ABSOLUTE_PATH_PATTERN = /(?<=["'\s(=])\/[^\s"'\])>}]{2,}/g;

/**
 * One redactor per report/session keeps aliases stable within that scope so a
 * human can correlate "path-4" across events without learning real names.
 */
export const createDiagnosticsRedactor = (): DiagnosticsRedactor => {
  const aliases = new Map<string, string>();
  const counters = new Map<string, number>();

  const alias = (prefix: string, raw: string | undefined): string | undefined => {
    if (raw === undefined || raw === "") {
      return undefined;
    }
    const key = `${prefix}:${raw}`;
    const existing = aliases.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    const assigned = `${prefix}-${next}`;
    aliases.set(key, assigned);
    return assigned;
  };

  return {
    path(path, kind) {
      const normalized = path.startsWith("/") ? path : `/${path}`;
      return {
        alias: alias("path", normalized) ?? "path-0",
        depth: depthOf(normalized),
        extension: kind === "folder" ? undefined : extensionOf(normalized),
        kind
      };
    },
    alias,
    route(url) {
      let pathname = url;
      try {
        pathname = new URL(url, "https://redacted.local").pathname;
      } catch {
        const queryIndex = url.indexOf("?");
        pathname = (queryIndex >= 0 ? url.slice(0, queryIndex) : url).replace(/^https?:\/\/[^/]+/i, "");
      }
      const segments = pathname.split("/").filter((segment) => segment.length > 0).slice(0, 3);
      return `/${segments.join("/")}`;
    },
    message(text, maxLength = 300) {
      const sanitized = text
        .replace(URL_PATTERN, "<url>")
        .replace(TOKEN_PATTERN, "<redacted>")
        .replace(ABSOLUTE_PATH_PATTERN, (match) => {
          const depth = match.split("/").filter((segment) => segment.length > 0).length;
          return `<path:${depth}>`;
        });
      return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength)}…` : sanitized;
    }
  };
};

/** Classify a Worker API route into a privacy-safe request category. */
export const categorizeApiRoute = (route: string): "auth" | "files" | "preview" | "download" | "health" | "mutation" | "other" => {
  if (route.startsWith("/api/health")) {
    return "health";
  }
  if (route.startsWith("/api/accounts") || route.startsWith("/api/session")
    || route.startsWith("/api/auth") || route.startsWith("/api/unlock")) {
    return "auth";
  }
  if (route.startsWith("/api/preview") || route.startsWith("/api/content")
    || route.startsWith("/api/stream")) {
    return "preview";
  }
  if (route.startsWith("/api/download") || route.startsWith("/api/archive")) {
    return "download";
  }
  if (route.startsWith("/api/files")) {
    return "files";
  }
  return "other";
};
