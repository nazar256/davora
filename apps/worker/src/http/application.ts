import {
  connectAccountEndpoint,
  sessionEndpoint,
  streamTokenEndpoint,
  type ApiEnvelope,
  type StreamTokenResponse
} from "@davora/shared";

import type { AccountService } from "../accounts/service";
import { AccountRepositoryError } from "../accounts/repository";
import { createFileBackend } from "../files/createFileBackend";
import { executeFileRoute } from "../files/service";
import { resetMockEntries } from "../mock/data";
import { signSessionToken, signStreamToken, verifySessionToken, verifyStreamToken } from "../security/token";
import { json } from "../security/http";
import type { FileBackend } from "../files/backend";
import type { SessionPayload, StreamTokenPayload, WorkerEnv } from "../types";
import { createWorkerRequestContext, type WorkerRequestContext } from "./context";
import { normalizeWorkerFailure, workerFailure, workerFailureResponse } from "./failure";
import type { ParsedWorkerRoute, WorkerRoute } from "./router";

export interface WorkerApplicationDependencies {
  readonly accountService: AccountService;
  verifySessionToken(token: string): Promise<SessionPayload>;
  verifyStreamToken(token: string): Promise<StreamTokenPayload>;
  signSessionToken(payload: SessionPayload): Promise<string>;
  signStreamToken(payload: StreamTokenPayload): Promise<string>;
  createFileBackend(context: Parameters<typeof createFileBackend>[0]): FileBackend;
  resetMockEntries(): void;
  nowEpochSeconds(): number;
}

export function createWorkerApplicationDependencies(env: WorkerEnv, accountService: AccountService): WorkerApplicationDependencies {
  const tokenSecret = env.SESSION_TOKEN_SECRET ?? env.SESSION_SECRET;
  return {
    accountService,
    verifySessionToken: (token) => verifySessionToken(token, tokenSecret),
    verifyStreamToken: (token) => verifyStreamToken(token, tokenSecret),
    signSessionToken: (payload) => signSessionToken(payload, tokenSecret),
    signStreamToken: (payload) => signStreamToken(payload, tokenSecret),
    createFileBackend: (context) => createFileBackend(context, env),
    resetMockEntries,
    nowEpochSeconds: () => Math.floor(Date.now() / 1000)
  };
}

type BrowserContext = Extract<WorkerRequestContext, { auth: "browser" }>;
type SessionContext = Extract<WorkerRequestContext, { auth: "session" }>;
type AuthorizedContext = Extract<WorkerRequestContext, { auth: "session" | "stream" }>;

function browserContext(context: WorkerRequestContext): BrowserContext {
  if (context.auth !== "browser") throw workerFailure("unexpected_error", "browser-context");
  return context;
}

function sessionContext(context: WorkerRequestContext): SessionContext {
  if (context.auth !== "session") throw workerFailure("unexpected_error", "session-context");
  return context;
}

function authorizedContext(context: WorkerRequestContext): AuthorizedContext {
  if (context.auth !== "session" && context.auth !== "stream") {
    throw workerFailure("unexpected_error", "authorized-context");
  }
  return context;
}

function normalizeAccountApplicationFailure(error: unknown, fallback: "account_validation_failed" | "session_creation_failed" | "unexpected_error") {
  return error instanceof AccountRepositoryError
    ? workerFailure("account_store_failure", error.operation)
    : normalizeWorkerFailure(error, fallback);
}

async function executeAccountRoute(
  route: Extract<ParsedWorkerRoute, { id: "connectAccount" | "deleteAccount" | "session" }>,
  context: BrowserContext,
  env: WorkerEnv,
  dependencies: WorkerApplicationDependencies
): Promise<Response> {
  if (route.id === "connectAccount") {
    try {
      const result = await dependencies.accountService.connectAccount({ ...route.input, ...context.owner });
      const payload: ApiEnvelope<typeof result> = { data: result };
      return json(connectAccountEndpoint.successSchema.parse(payload), route.input.accountId ? 200 : 201);
    } catch (error) {
      throw normalizeAccountApplicationFailure(error, "account_validation_failed");
    }
  }
  if (route.id === "deleteAccount") {
    try {
      await dependencies.accountService.removeAccount(route.input.accountId, context.owner);
    } catch (error) {
      throw normalizeAccountApplicationFailure(error, "unexpected_error");
    }
    return new Response(null, { status: 204 });
  }

  if (env.APP_UNLOCK_CODE && route.input.unlockCode !== env.APP_UNLOCK_CODE) {
    throw workerFailure("invalid_unlock_code", "unlock-code");
  }
  try {
    const account = await dependencies.accountService.resolveForSession(route.input.accountId, context.owner);
    const exp = dependencies.nowEpochSeconds() + env.SESSION_TTL_SECONDS;
    const token = await dependencies.signSessionToken({
      scope: "davora",
      accountId: account.account.id,
      backend: account.account.backend,
      rootPath: account.account.rootPath,
      accountNonce: account.accountNonce,
      exp
    });
    return json(sessionEndpoint.successSchema.parse({
      data: {
        session: {
          token,
          expiresAt: new Date(exp * 1000).toISOString(),
          rootPath: account.account.rootPath,
          capabilities: account.capabilities,
          account: account.account
        }
      }
    }));
  } catch (error) {
    throw normalizeAccountApplicationFailure(error, "session_creation_failed");
  }
}

async function executeStreamTokenRoute(
  route: Extract<ParsedWorkerRoute, { id: "streamToken" }>,
  context: SessionContext,
  dependencies: WorkerApplicationDependencies
): Promise<Response> {
  const exp = Math.min(context.session.exp, dependencies.nowEpochSeconds() + 120);
  const token = await dependencies.signStreamToken({
    scope: "davora-stream",
    accountId: context.session.accountId,
    backend: context.session.backend,
    rootPath: context.session.rootPath,
    accountNonce: context.session.accountNonce,
    path: route.input.path,
    exp
  });
  const payload: ApiEnvelope<StreamTokenResponse> = {
    data: { token, path: route.input.path, expiresAt: new Date(exp * 1000).toISOString() }
  };
  return json(streamTokenEndpoint.successSchema.parse(payload));
}

async function executeApplicationRoute(
  request: Request,
  route: ParsedWorkerRoute,
  context: WorkerRequestContext,
  env: WorkerEnv,
  dependencies: WorkerApplicationDependencies
): Promise<Response> {
  if (route.id === "reset") {
    if (env.RUNTIME_MODE !== "development" || !env.MOCK_BACKEND || request.headers.get("x-davora-reset-token") !== env.SESSION_SECRET) {
      throw workerFailure("not_found", "reset-concealment");
    }
    try {
      await dependencies.accountService.clear();
    } catch (error) {
      throw normalizeAccountApplicationFailure(error, "unexpected_error");
    }
    dependencies.resetMockEntries();
    return new Response(null, { status: 204 });
  }
  if (route.id === "health") throw workerFailure("unexpected_error", "health-bootstrap");
  if (route.id === "connectAccount" || route.id === "deleteAccount" || route.id === "session") {
    return executeAccountRoute(route, browserContext(context), env, dependencies);
  }
  if (route.id === "streamToken") {
    return executeStreamTokenRoute(route, sessionContext(context), dependencies);
  }
  const authorized = authorizedContext(context);
  return executeFileRoute(route, request, dependencies.createFileBackend(authorized.account));
}

export async function handleWorkerApplication(
  request: Request,
  route: WorkerRoute,
  env: WorkerEnv,
  dependencies: WorkerApplicationDependencies
): Promise<Response> {
  try {
    const context = await createWorkerRequestContext(request, route, env, {
      verifySessionToken: dependencies.verifySessionToken,
      verifyStreamToken: dependencies.verifyStreamToken,
      resolveAuthorizedAccount: dependencies.accountService.resolveAuthorized
    });
    if (route.inputError !== undefined) throw route.inputError;
    return await executeApplicationRoute(request, route, context, env, dependencies);
  } catch (error) {
    return workerFailureResponse(error);
  }
}
