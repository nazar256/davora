import { apiErrorEnvelopeSchema, type ApiEnvelope, type ApiError, type ApiErrorCode } from "@davora/shared";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function normalizeOrigin(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    if (LOOPBACK_HOSTS.has(url.hostname)) {
      url.hostname = "localhost";
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function originMatchesAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.includes("*")) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  return allowedOrigins.some((allowedOrigin) => {
    if (allowedOrigin === origin) {
      return true;
    }
    const normalizedAllowedOrigin = normalizeOrigin(allowedOrigin);
    return normalizedOrigin !== undefined && normalizedAllowedOrigin !== undefined && normalizedAllowedOrigin === normalizedOrigin;
  });
}

export function json<T>(payload: ApiEnvelope<T>, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

export function errorResponse(status: number, code: ApiErrorCode, message: string, details?: string): Response {
  const payload: ApiEnvelope<ApiError> = apiErrorEnvelopeSchema.parse({
    data: {
      code,
      message,
      ...(details ? { details } : {})
    }
  });

  return json(payload, status);
}

export function corsHeaders(origin: string | null, allowedOrigins: string[]): HeadersInit {
  const allowOrigin = origin && originMatchesAllowedOrigin(origin, allowedOrigins) ? origin : allowedOrigins[0] ?? "*";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-davora-browser-id,x-davora-browser-secret,x-davora-reset-token,x-davora-report-id,x-davora-report-sha256,x-davora-report-generated-at,x-davora-diagnostics-schema,x-davora-web-build",
    "access-control-expose-headers": "x-davora-worker-build,x-davora-api-contract",
    vary: "origin"
  };
}

export function withCors(response: Response, origin: string | null, allowedOrigins: string[]): Response {
  const next = new Response(response.body, response);
  const headers = corsHeaders(origin, allowedOrigins);
  Object.entries(headers).forEach(([key, value]) => {
    next.headers.set(key, String(value));
  });
  return next;
}
