import type { BrowserOwnership } from "../accounts/transaction";
import type {
  AuthorizedAccountContext,
  SessionPayload,
  StreamTokenPayload,
  WorkerEnv
} from "../types";
import { workerFailure } from "./failure";
import type { WorkerRoute } from "./router";

export type WorkerRequestContext =
  | {
      readonly auth: "public";
      readonly request: Request;
      readonly route: WorkerRoute;
      readonly env: WorkerEnv;
      readonly origin: string | null;
    }
  | {
      readonly auth: "browser";
      readonly request: Request;
      readonly route: WorkerRoute;
      readonly env: WorkerEnv;
      readonly origin: string | null;
      readonly owner: BrowserOwnership;
    }
  | {
      readonly auth: "session";
      readonly request: Request;
      readonly route: WorkerRoute;
      readonly env: WorkerEnv;
      readonly origin: string | null;
      readonly session: SessionPayload;
      readonly account: AuthorizedAccountContext;
    }
  | {
      readonly auth: "stream";
      readonly request: Request;
      readonly route: WorkerRoute;
      readonly env: WorkerEnv;
      readonly origin: string | null;
      readonly stream: StreamTokenPayload;
      readonly account: AuthorizedAccountContext;
    };

export interface WorkerContextDependencies {
  verifySessionToken(token: string): Promise<SessionPayload>;
  verifyStreamToken(token: string): Promise<StreamTokenPayload>;
  resolveAuthorizedAccount(accountId: string): Promise<AuthorizedAccountContext>;
}

function readBrowserOwnership(request: Request): BrowserOwnership {
  const browserId = request.headers.get("x-davora-browser-id")?.trim();
  const browserSecret = request.headers.get("x-davora-browser-secret")?.trim();
  if (!browserId || !browserSecret) throw workerFailure("permission_denied", "browser-ownership");
  return { browserId, browserSecret };
}

function readBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw workerFailure("missing_bearer", "authorization-header");
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) throw workerFailure("missing_bearer", "authorization-header");
  return token;
}

function assertAccountClaims(
  claims: Pick<SessionPayload, "accountId" | "backend" | "rootPath" | "accountNonce">,
  account: AuthorizedAccountContext
): void {
  if (claims.accountId !== account.account.id
    || claims.backend !== account.account.backend
    || claims.rootPath !== account.account.rootPath
    || claims.accountNonce !== account.accountNonce) {
    throw workerFailure("session_mismatch", "account-claims");
  }
}

export async function createWorkerRequestContext(
  request: Request,
  route: WorkerRoute,
  env: WorkerEnv,
  dependencies: WorkerContextDependencies
): Promise<WorkerRequestContext> {
  const origin = request.headers.get("origin");
  if (route.auth === "public") return { auth: "public", request, route, env, origin };
  if (route.auth === "browser") {
    return { auth: "browser", request, route, env, origin, owner: readBrowserOwnership(request) };
  }
  if (route.auth === "stream") {
    const token = new URL(request.url).searchParams.get("streamToken")?.trim();
    if (!token) throw workerFailure("missing_stream_token", "stream-token-query");
    const stream = await dependencies.verifyStreamToken(token);
    if (route.inputError === undefined && (route.id !== "stream" || stream.path !== route.input.path)) {
      throw workerFailure("stream_path_mismatch", "stream-path");
    }
    const account = await dependencies.resolveAuthorizedAccount(stream.accountId);
    assertAccountClaims(stream, account);
    return { auth: "stream", request, route, env, origin, stream, account };
  }

  const token = route.id === "download" && route.authorityToken
    ? route.authorityToken
    : readBearerToken(request);
  const session = await dependencies.verifySessionToken(token);
  const account = await dependencies.resolveAuthorizedAccount(session.accountId);
  assertAccountClaims(session, account);
  return { auth: "session", request, route, env, origin, session, account };
}
