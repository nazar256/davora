import {
  type ApiEnvelope,
  healthEndpoint,
  type HealthResponse
} from "@davora/shared";

import { json, originMatchesAllowedOrigin } from "./security/http";
import type { WorkerEnv } from "./types";
import {
  normalizeConfigurationWorkerFailure,
  workerFailure,
  workerFailureResponse
} from "./http/failure";
import { matchWorkerRoute, type WorkerRoute } from "./http/router";

export interface ConfigHealth {
  configLoaded: boolean;
  backend: "mock" | "nextcloud";
  rootPath: string;
  unlockRequired: boolean;
  missing: string[];
}

export interface RequestBootstrapCapabilities {
  inspectHealth(rawEnv: Record<string, unknown>): ConfigHealth;
  loadEnvironment(rawEnv: Record<string, unknown>): WorkerEnv;
}

export type RequestBootstrapResult =
  | {
      readonly kind: "respond";
      readonly response: Response;
      readonly origin: string | null;
      readonly allowedOrigins: readonly string[];
    }
  | {
      readonly kind: "admitted";
      readonly env: WorkerEnv;
      readonly route: WorkerRoute;
      readonly origin: string | null;
      readonly allowedOrigins: readonly string[];
    };

function parseAllowedOrigins(rawEnv: Record<string, unknown>): string[] {
  const allowedOrigins = typeof rawEnv.ALLOWED_ORIGINS === "string" ? rawEnv.ALLOWED_ORIGINS : "";
  return allowedOrigins
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function originAllowed(origin: string | null, allowedOrigins: readonly string[]): boolean {
  if (!origin || allowedOrigins.length === 0) {
    return true;
  }
  return originMatchesAllowedOrigin(origin, [...allowedOrigins]);
}

function healthResponse(health: ConfigHealth): Response {
  const payload: ApiEnvelope<HealthResponse> = {
    data: {
      app: "davora",
      configLoaded: health.configLoaded,
      backend: health.backend,
      rootPath: health.rootPath,
      unlockRequired: health.unlockRequired,
      connectionMode: "in_app",
      supportedAccountTypes: ["nextcloud"],
      ...(health.missing.length > 0 ? { missing: health.missing } : {})
    }
  };
  return json(healthEndpoint.successSchema.parse(payload));
}

export async function prepareWorkerRequest(
  request: Request,
  rawEnv: Record<string, unknown>,
  capabilities: RequestBootstrapCapabilities
): Promise<RequestBootstrapResult> {
  const origin = request.headers.get("origin");
  const preConfigAllowedOrigins = parseAllowedOrigins(rawEnv);
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return {
      kind: "respond",
      response: new Response(null, { status: 204 }),
      origin,
      allowedOrigins: preConfigAllowedOrigins
    };
  }

  if (url.pathname === healthEndpoint.path) {
    healthEndpoint.requestSchema.parse(undefined);
    return {
      kind: "respond",
      response: healthResponse(capabilities.inspectHealth(rawEnv)),
      origin,
      allowedOrigins: preConfigAllowedOrigins
    };
  }

  let env: WorkerEnv;
  try {
    env = capabilities.loadEnvironment(rawEnv);
  } catch (error) {
    return {
      kind: "respond",
      response: workerFailureResponse(normalizeConfigurationWorkerFailure(error)),
      origin,
      allowedOrigins: preConfigAllowedOrigins
    };
  }

  const resetCandidate = request.method === "POST" && url.pathname === "/api/mock/reset";

  if (!resetCandidate && !originAllowed(origin, env.ALLOWED_ORIGINS)) {
    return {
      kind: "respond",
      response: workerFailureResponse(workerFailure("origin_denied", "origin")),
      origin,
      allowedOrigins: env.ALLOWED_ORIGINS
    };
  }

  let route: WorkerRoute;
  try {
    route = await matchWorkerRoute(request);
  } catch (error) {
    return {
      kind: "respond",
      response: workerFailureResponse(error),
      origin,
      allowedOrigins: env.ALLOWED_ORIGINS
    };
  }

  return {
    kind: "admitted",
    env,
    route,
    origin,
    allowedOrigins: env.ALLOWED_ORIGINS
  };
}
