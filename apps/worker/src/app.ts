import { Buffer } from "node:buffer";

import {
  type ApiEnvelope,
  type ConnectAccountRequest,
  type ConnectAccountResponse,
  type CreateFolderRequest,
  type DeleteRequest,
  type FileResponse,
  type FilesResponse,
  type HealthResponse,
  type MetadataResponse,
  type MoveCopyRequest,
  type MutationResponse,
  type SearchResponse,
  type SessionRequest,
  type SessionResponse,
  type UploadFileRequest
} from "@davora/shared";

import {
  clearConnectedAccountsAndPersist,
  connectAccount,
  initializeConnectedAccounts,
  removeConnectedAccountAndPersist,
  resolveAccountForSession,
  resolveAuthorizedAccount
} from "./accounts/store";
import { configHealth, loadConfig } from "./config";
import {
  copyMockResource,
  createMockFolder,
  deleteMockResource,
  downloadMockFile,
  getMockMetadata,
  getMockOriginal,
  listMockFolder,
  moveMockResource,
  readMockFile,
  resetMockEntries,
  searchMockFiles,
  uploadMockFile
} from "./mock/data";
import { NextcloudClient } from "./nextcloud/client";
import { errorResponse, json, originMatchesAllowedOrigin, withCors } from "./security/http";
import { signSessionToken, verifySessionToken } from "./security/token";
import type { AuthorizedAccountContext, SessionPayload, WorkerEnv } from "./types";

function parseAllowedOrigins(rawEnv: Record<string, unknown>): string[] {
  const allowedOrigins = typeof rawEnv.ALLOWED_ORIGINS === "string" ? rawEnv.ALLOWED_ORIGINS : "";
  return allowedOrigins
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readBrowserOwnership(request: Request): { browserId: string; browserSecret: string } {
  const browserId = request.headers.get("x-davora-browser-id")?.trim();
  const browserSecret = request.headers.get("x-davora-browser-secret")?.trim();
  if (!browserId || !browserSecret) {
    throw new Error("Browser ownership headers are required.");
  }
  return { browserId, browserSecret };
}

function readBearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length).trim();
}

async function normalizeAuthorizedRequest(request: Request): Promise<Request> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/download" || request.method !== "POST") {
    return request;
  }

  const formData = await request.formData();
  const path = formData.get("path");
  const token = formData.get("token");
  if (typeof path !== "string" || typeof token !== "string" || !path.trim() || !token.trim()) {
    throw new Error("Download request is missing required fields.");
  }

  url.searchParams.set("path", path);
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(url.toString(), {
    method: "GET",
    headers
  });
}

async function requireSession(request: Request, env: WorkerEnv): Promise<SessionPayload> {
  const token = readBearerToken(request);
  if (!token) {
    throw new Error("Missing bearer token.");
  }
  return verifySessionToken(token, env.SESSION_SECRET);
}

function assertAllowedOrigin(request: Request, env: WorkerEnv): void {
  const origin = request.headers.get("origin");
  if (!origin || env.ALLOWED_ORIGINS.length === 0 || originMatchesAllowedOrigin(origin, env.ALLOWED_ORIGINS)) {
    return;
  }
  throw new Error("Request origin is not allowed.");
}

function createNextcloudClient(context: AuthorizedAccountContext, env: WorkerEnv): NextcloudClient {
  if (!context.credentials) {
    throw new Error("Reconnect this account before browsing files.");
  }

  return new NextcloudClient({
    baseUrl: context.credentials.baseUrl,
    username: context.credentials.username,
    appPassword: context.credentials.appPassword,
    rootPath: context.account.rootPath,
    maxFileBytes: env.NEXTCLOUD_MAX_FILE_BYTES,
    maxTextFileBytes: env.NEXTCLOUD_MAX_TEXT_FILE_BYTES
  });
}

function mutationError(message: string): Response {
  if (/reconnect this account/i.test(message)) {
    return errorResponse(409, "account_reconnect_required", message);
  }
  if (/confirmation/i.test(message)) {
    return errorResponse(400, "delete_confirmation_required", message);
  }
  if (/already exists/i.test(message)) {
    return errorResponse(409, "conflict", message);
  }
  if (/not found/i.test(message)) {
    return errorResponse(404, "not_found", message);
  }
  if (/permission/i.test(message)) {
    return errorResponse(403, "permission_denied", message);
  }
  return errorResponse(500, "mutation_failed", message);
}

async function readJsonBody<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

function parseAccountIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/accounts\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : undefined;
}

async function handleAuthorizedRequest(request: Request, env: WorkerEnv, session: SessionPayload): Promise<Response> {
  const context = await resolveAuthorizedAccount(session.accountId);
  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";

  if (session.rootPath !== context.account.rootPath || session.backend !== context.account.backend || session.accountNonce !== context.accountNonce) {
    return errorResponse(401, "session_mismatch", "Session no longer matches the selected account configuration.");
  }

  try {
    if (context.account.backend === "mock") {
      if (url.pathname === "/api/files") {
        const payload: ApiEnvelope<FilesResponse> = { data: { path, items: listMockFolder(context.account.id, path) } };
        return json(payload);
      }
      if (url.pathname === "/api/metadata") {
        const metadata = getMockMetadata(context.account.id, path);
        if (!metadata) {
          return errorResponse(404, "not_found", "Resource not found.");
        }
        const payload: ApiEnvelope<MetadataResponse> = { data: { metadata } };
        return json(payload);
      }
      if (url.pathname === "/api/file") {
        const file = readMockFile(context.account.id, path);
        if (!file) {
          return errorResponse(404, "not_found", "File not found.");
        }
        const payload: ApiEnvelope<FileResponse> = { data: { file } };
        return json(payload);
      }
      if (url.pathname === "/api/file/original") {
        const original = getMockOriginal(context.account.id, path);
        if (!original) {
          return errorResponse(404, "not_found", "File not found.");
        }
        return new Response(Buffer.from(original.body), {
          headers: {
            "content-type": original.metadata.mimeType ?? "application/octet-stream",
            "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(original.metadata.name)}`,
            "cache-control": "no-store"
          }
        });
      }
      if (url.pathname === "/api/search") {
        const query = url.searchParams.get("q") ?? "";
        const payload: ApiEnvelope<SearchResponse> = { data: { query, path, items: searchMockFiles(context.account.id, query, path) } };
        return json(payload);
      }
      if (url.pathname === "/api/download") {
        const file = downloadMockFile(context.account.id, path);
        if (!file) {
          return errorResponse(404, "not_found", "File not found.");
        }
        return new Response(Buffer.from(file.body), {
          headers: {
            "content-type": file.mimeType,
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
            "cache-control": "no-store"
          }
        });
      }
      if (url.pathname === "/api/folders" && request.method === "POST") {
        const body = await readJsonBody<CreateFolderRequest>(request);
        const result = createMockFolder(context.account.id, body.path ? body.path : path, body.name);
        const payload: ApiEnvelope<MutationResponse> = { data: { result } };
        return json(payload, 201);
      }
      if (url.pathname === "/api/upload" && request.method === "POST") {
        const result = uploadMockFile(context.account.id, await readJsonBody<UploadFileRequest>(request));
        const payload: ApiEnvelope<MutationResponse> = { data: { result } };
        return json(payload, 201);
      }
      if (url.pathname === "/api/move" && request.method === "POST") {
        const result = moveMockResource(context.account.id, await readJsonBody<MoveCopyRequest>(request));
        const payload: ApiEnvelope<MutationResponse> = { data: { result } };
        return json(payload);
      }
      if (url.pathname === "/api/copy" && request.method === "POST") {
        const result = copyMockResource(context.account.id, await readJsonBody<MoveCopyRequest>(request));
        const payload: ApiEnvelope<MutationResponse> = { data: { result } };
        return json(payload, 201);
      }
      if (url.pathname === "/api/delete" && request.method === "POST") {
        const result = deleteMockResource(context.account.id, await readJsonBody<DeleteRequest>(request));
        const payload: ApiEnvelope<MutationResponse> = { data: { result } };
        return json(payload);
      }
      return errorResponse(404, "not_found", "Route not found.");
    }

    const client = createNextcloudClient(context, env);
    if (url.pathname === "/api/files") {
      const payload: ApiEnvelope<FilesResponse> = { data: { path, items: await client.listFolder(path) } };
      return json(payload);
    }
    if (url.pathname === "/api/metadata") {
      const metadata = await client.getMetadata(path);
      if (!metadata) {
        return errorResponse(404, "not_found", "Resource not found.");
      }
      const payload: ApiEnvelope<MetadataResponse> = { data: { metadata } };
      return json(payload);
    }
    if (url.pathname === "/api/file") {
      const payload: ApiEnvelope<FileResponse> = { data: { file: await client.readFile(path) } };
      return json(payload);
    }
    if (url.pathname === "/api/file/original") {
      const file = await client.readOriginal(path);
      return new Response(Buffer.from(file.body), {
        headers: {
          "content-type": file.metadata.mimeType ?? "application/octet-stream",
          "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.metadata.name)}`,
          "cache-control": "no-store"
        }
      });
    }
    if (url.pathname === "/api/search") {
      const query = url.searchParams.get("q") ?? "";
      const payload: ApiEnvelope<SearchResponse> = { data: { query, path, items: await client.searchFiles(query, path) } };
      return json(payload);
    }
    if (url.pathname === "/api/download") {
      const file = await client.download(path);
      return new Response(Buffer.from(file.body), {
        headers: {
          "content-type": file.metadata.mimeType ?? "application/octet-stream",
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.metadata.name)}`,
          "cache-control": "no-store"
        }
      });
    }
    if (url.pathname === "/api/folders" && request.method === "POST") {
      const result = await client.createFolder(await readJsonBody<CreateFolderRequest>(request));
      const payload: ApiEnvelope<MutationResponse> = { data: { result } };
      return json(payload, 201);
    }
    if (url.pathname === "/api/upload" && request.method === "POST") {
      const result = await client.uploadFile(await readJsonBody<UploadFileRequest>(request));
      const payload: ApiEnvelope<MutationResponse> = { data: { result } };
      return json(payload, 201);
    }
    if (url.pathname === "/api/move" && request.method === "POST") {
      const result = await client.moveResource(await readJsonBody<MoveCopyRequest>(request));
      const payload: ApiEnvelope<MutationResponse> = { data: { result } };
      return json(payload);
    }
    if (url.pathname === "/api/copy" && request.method === "POST") {
      const result = await client.copyResource(await readJsonBody<MoveCopyRequest>(request));
      const payload: ApiEnvelope<MutationResponse> = { data: { result } };
      return json(payload, 201);
    }
    if (url.pathname === "/api/delete" && request.method === "POST") {
      const result = await client.deleteResource(await readJsonBody<DeleteRequest>(request));
      const payload: ApiEnvelope<MutationResponse> = { data: { result } };
      return json(payload);
    }

    return errorResponse(404, "not_found", "Route not found.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return mutationError(message);
  }
}

export async function handleRequest(request: Request, rawEnv: Record<string, unknown>): Promise<Response> {
  const origin = request.headers.get("origin");
  const allowedOrigins = parseAllowedOrigins(rawEnv);
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }), origin, allowedOrigins);
  }

  if (url.pathname === "/api/health") {
    const health = configHealth(rawEnv);
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
    return withCors(json(payload), origin, allowedOrigins);
  }

  let env: WorkerEnv;
  try {
    env = loadConfig(rawEnv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Configuration error.";
    return withCors(errorResponse(500, "config_error", message), origin, allowedOrigins);
  }

  try {
    await initializeConnectedAccounts(env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load local account state.";
    return withCors(errorResponse(500, "local_state_error", message), origin, allowedOrigins);
  }

  if (request.method === "POST" && url.pathname === "/api/mock/reset") {
    if (!env.MOCK_BACKEND || request.headers.get("x-davora-reset-token") !== rawEnv.SESSION_SECRET) {
      return withCors(errorResponse(404, "not_found", "Route not found."), origin, allowedOrigins);
    }
    await clearConnectedAccountsAndPersist(env);
    resetMockEntries();
    return withCors(new Response(null, { status: 204 }), origin, allowedOrigins);
  }

  try {
    assertAllowedOrigin(request, env);

    if (url.pathname === "/api/accounts" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as Partial<ConnectAccountRequest>;
      if (body.type !== "nextcloud") {
        return withCors(errorResponse(400, "unsupported_account_type", "Only Nextcloud accounts are supported in this pass."), origin, env.ALLOWED_ORIGINS);
      }

      try {
        const owner = readBrowserOwnership(request);
        const result = await connectAccount({
          accountId: body.accountId,
          cacheNamespace: body.cacheNamespace,
          baseUrl: body.baseUrl ?? "",
          username: body.username ?? "",
          appPassword: body.appPassword ?? "",
          label: body.label,
          browserId: owner.browserId,
          browserSecret: owner.browserSecret
        }, env);
        const payload: ApiEnvelope<ConnectAccountResponse> = { data: result };
        return withCors(json(payload, body.accountId ? 200 : 201), origin, env.ALLOWED_ORIGINS);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to connect account.";
        const status = /different browser context|Browser ownership headers/i.test(message)
          ? 403
          : /Account store persistence failed/i.test(message)
            ? 500
            : 400;
        const code = status === 500
          ? "internal_error"
          : status === 403
            ? "permission_denied"
            : "account_validation_failed";
        return withCors(errorResponse(status, code, message), origin, env.ALLOWED_ORIGINS);
      }
    }

    const deleteAccountId = parseAccountIdFromPath(url.pathname);
    if (deleteAccountId && request.method === "DELETE") {
      const owner = readBrowserOwnership(request);
      await removeConnectedAccountAndPersist(deleteAccountId, owner.browserId, owner.browserSecret, env);
      return withCors(new Response(null, { status: 204 }), origin, env.ALLOWED_ORIGINS);
    }

    if (url.pathname === "/api/session" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as Partial<SessionRequest>;
      if (!body.accountId) {
        return withCors(errorResponse(400, "account_required", "Select and connect an account before creating a session."), origin, env.ALLOWED_ORIGINS);
      }
      if (env.APP_UNLOCK_CODE && body.unlockCode !== env.APP_UNLOCK_CODE) {
        return withCors(errorResponse(401, "invalid_unlock_code", "Unlock code is invalid."), origin, env.ALLOWED_ORIGINS);
      }

      try {
        const owner = readBrowserOwnership(request);
        const accountContext = resolveAccountForSession(body.accountId, owner.browserId, owner.browserSecret);
        const exp = Math.floor(Date.now() / 1000) + env.SESSION_TTL_SECONDS;
        const token = await signSessionToken(
          {
            scope: "davora",
            accountId: accountContext.account.id,
            backend: accountContext.account.backend,
            rootPath: accountContext.account.rootPath,
            accountNonce: accountContext.accountNonce,
            exp
          },
          env.SESSION_SECRET
        );

        const payload: ApiEnvelope<SessionResponse> = {
          data: {
            session: {
              token,
              expiresAt: new Date(exp * 1000).toISOString(),
              rootPath: accountContext.account.rootPath,
              capabilities: accountContext.capabilities,
              account: accountContext.account
            }
          }
        };
        return withCors(json(payload), origin, env.ALLOWED_ORIGINS);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to create a session.";
        const code = /Reconnect this account/i.test(message)
          ? "account_reconnect_required"
          : /different browser context|Browser ownership headers/i.test(message)
            ? "permission_denied"
            : "session_creation_failed";
        const status = code === "account_reconnect_required" ? 409 : code === "permission_denied" ? 403 : 400;
        return withCors(errorResponse(status, code, message), origin, env.ALLOWED_ORIGINS);
      }
    }

    const authorizedRequest = await normalizeAuthorizedRequest(request);
    const session = await requireSession(authorizedRequest, env);
    return withCors(await handleAuthorizedRequest(authorizedRequest, env, session), origin, env.ALLOWED_ORIGINS);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = /origin/i.test(message)
      ? 403
      : /reconnect this account/i.test(message)
        ? 409
        : /bearer token|session token|expired/i.test(message)
          ? 401
          : /permission/i.test(message)
            ? 403
            : /required fields|path is required/i.test(message)
              ? 400
              : 500;
    const code = status === 401
      ? "unauthorized"
      : status === 403
        ? "permission_denied"
        : status === 409
          ? "account_reconnect_required"
          : status === 400
            ? "bad_request"
            : "unexpected_error";
    return withCors(errorResponse(status, code, message), origin, env.ALLOWED_ORIGINS);
  }
}
