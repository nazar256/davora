/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleRequest } from "../src/app";
import * as accountFactory from "../src/accounts/factory";
import * as backendFactory from "../src/files/createFileBackend";
import * as fileService from "../src/files/service";
import * as tokenSecurity from "../src/security/token";
import { signSessionToken, signStreamToken, verifySessionToken } from "../src/security/token";
import type { SessionPayload, StreamTokenPayload } from "../src/types";
import { MemoryAccountStateStorage } from "../src/accounts/storage";
import type { AccountService } from "../src/accounts/service";
import type { AuthorizedAccountContext } from "../src/types";

const ORIGIN = "http://127.0.0.1:4173";
const OTHER_ORIGIN = "https://attacker.example";
const SESSION_SECRET = "authorized-file-characterization-secret";
const accountStorage = new MemoryAccountStateStorage();
const BASE_ENV = {
  SESSION_SECRET,
  MOCK_BACKEND: "true",
  ALLOWED_ORIGINS: ORIGIN,
  ACCOUNT_STATE_STORAGE: accountStorage
};
const OWNER_HEADERS = {
  origin: ORIGIN,
  "x-davora-browser-id": "authorized-file-characterization-browser",
  "x-davora-browser-secret": "authorized-file-characterization-secret"
};

type ErrorEnvelope = { data: { code: string; message: string } };

function requestPath(path: string, init: RequestInit = {}, env: Record<string, unknown> = BASE_ENV): Promise<Response> {
  return handleRequest(new Request(`http://127.0.0.1:8787${path}`, init), env);
}

function authorizedRequest(token: string, path: string, init: RequestInit = {}, env: Record<string, unknown> = BASE_ENV): Promise<Response> {
  return requestPath(path, {
    ...init,
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${token}`,
      ...init.headers
    }
  }, env);
}

async function errorOf(response: Response): Promise<ErrorEnvelope["data"]> {
  return (await response.json() as ErrorEnvelope).data;
}

async function createSession(env: Record<string, unknown> = BASE_ENV): Promise<{ token: string; payload: SessionPayload; env: Record<string, unknown> }> {
  const accountResponse = await requestPath("/api/accounts", {
    method: "POST",
    headers: { ...OWNER_HEADERS, "content-type": "application/json" },
    body: JSON.stringify({
      type: "nextcloud",
      baseUrl: "https://mock-account.example.com",
      username: "characterization-user",
      appPassword: "characterization-password",
      label: "Authorized file characterization"
    })
  }, env);
  expect(accountResponse.status).toBe(201);
  const account = (await accountResponse.json() as { data: { account: { id: string } } }).data.account;
  const sessionResponse = await requestPath("/api/session", {
    method: "POST",
    headers: { ...OWNER_HEADERS, "content-type": "application/json" },
    body: JSON.stringify({ accountId: account.id })
  }, env);
  expect(sessionResponse.status).toBe(200);
  const token = (await sessionResponse.json() as { data: { session: { token: string } } }).data.session.token;
  const payload = await verifySessionToken(token, SESSION_SECRET);
  return { token, payload, env };
}

function streamPayload(session: SessionPayload, overrides: Partial<StreamTokenPayload> = {}): StreamTokenPayload {
  return {
    scope: "davora-stream",
    accountId: session.accountId,
    backend: session.backend,
    rootPath: session.rootPath,
    accountNonce: session.accountNonce,
    path: "Projects/song.mp3",
    exp: session.exp,
    ...overrides
  };
}

function expectCors(response: Response): void {
  expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  expect(response.headers.get("vary")).toBe("origin");
}

function interceptAccountResolution(
  interceptor: (service: AccountService, accountId: string) => Promise<AuthorizedAccountContext>
) {
  const createService = accountFactory.createAccountServiceForEnvironment;
  const resolver = vi.fn<(accountId: string) => void>();
  vi.spyOn(accountFactory, "createAccountServiceForEnvironment").mockImplementation((env) => {
    const service = createService(env);
    return {
      ...service,
      resolveAuthorized: async (accountId) => {
        resolver(accountId);
        return interceptor(service, accountId);
      }
    };
  });
  return resolver;
}

function traceIngressCapabilities(trace: string[]): void {
  interceptAccountResolution(async (service, accountId) => {
    trace.push("resolve-account");
    return service.resolveAuthorized(accountId);
  });

  const createBackend = backendFactory.createFileBackend;
  vi.spyOn(backendFactory, "createFileBackend").mockImplementation((context, env) => {
    trace.push("create-backend");
    return createBackend(context, env);
  });

  const handleFile = fileService.executeFileRoute;
  vi.spyOn(fileService, "executeFileRoute").mockImplementation(async (route, request, backend) => {
    trace.push("delegate-handler");
    return handleFile(route, request, backend);
  });

  const verifySession = tokenSecurity.verifySessionToken;
  vi.spyOn(tokenSecurity, "verifySessionToken").mockImplementation(async (token, secret) => {
    trace.push("verify-session");
    return verifySession(token, secret);
  });

  const verifyStream = tokenSecurity.verifyStreamToken;
  vi.spyOn(tokenSecurity, "verifyStreamToken").mockImplementation(async (token, secret) => {
    trace.push("verify-stream");
    return verifyStream(token, secret);
  });

  const signStream = tokenSecurity.signStreamToken;
  vi.spyOn(tokenSecurity, "signStreamToken").mockImplementation(async (payload, secret) => {
    trace.push("sign-stream");
    return signStream(payload, secret);
  });
}

describe("authorized-file authority pipeline (public handleRequest characterization)", () => {
  beforeEach(() => {
    accountStorage.reset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts only a nonblank POST download form and preserves the binary download contract", async () => {
    const { token, env } = await createSession();
    const form = new FormData();
    form.set("path", "Archive/image.bin");
    form.set("token", token);
    const valid = await requestPath("/api/download", {
      method: "POST",
      headers: { origin: ORIGIN },
      body: form
    }, env);
    expect(valid.status).toBe(200);
    expectCors(valid);
    expect(valid.headers.get("content-type")).toBe("application/octet-stream");
    expect(valid.headers.get("content-disposition")).toMatch(/attachment; filename\*=UTF-8''image\.bin/);
    expect(valid.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await valid.arrayBuffer())).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));

    const missingPath = new FormData();
    missingPath.set("token", token);
    const missing = await requestPath("/api/download", { method: "POST", headers: { origin: ORIGIN }, body: missingPath }, env);
    expect(missing.status).toBe(400);
    expectCors(missing);
    await expect(errorOf(missing)).resolves.toEqual({ code: "bad_request", message: "Download request is missing required fields." });

    const blankPath = new FormData();
    blankPath.set("path", " ");
    blankPath.set("token", token);
    const blankPathResponse = await requestPath("/api/download", { method: "POST", headers: { origin: ORIGIN }, body: blankPath }, env);
    expect(blankPathResponse.status).toBe(400);
    expectCors(blankPathResponse);
    await expect(errorOf(blankPathResponse)).resolves.toEqual({ code: "bad_request", message: "Download request is missing required fields." });

    const blankToken = new FormData();
    blankToken.set("path", "Archive/image.bin");
    blankToken.set("token", " ");
    const blankTokenResponse = await requestPath("/api/download", { method: "POST", headers: { origin: ORIGIN }, body: blankToken }, env);
    expect(blankTokenResponse.status).toBe(401);
    expectCors(blankTokenResponse);
    await expect(errorOf(blankTokenResponse)).resolves.toEqual({ code: "unauthorized", message: "Missing bearer token." });

    const invalidToken = new FormData();
    invalidToken.set("path", "Archive/image.bin");
    invalidToken.set("token", "not-a-session-token");
    const invalid = await requestPath("/api/download", { method: "POST", headers: { origin: ORIGIN }, body: invalidToken }, env);
    expect(invalid.status).toBe(401);
    expectCors(invalid);
    await expect(errorOf(invalid)).resolves.toEqual({ code: "unauthorized", message: "Malformed session token." });
  });

  it("ignores a GET query token and requires the ordinary bearer source", async () => {
    const { token, env } = await createSession();
    const valid = await authorizedRequest(token, "/api/download?path=Archive/image.bin&token=not-used", {}, env);
    expect(valid.status).toBe(200);
    expectCors(valid);
    const missing = await requestPath("/api/download?path=Archive/image.bin&token=not-used", { headers: { origin: ORIGIN } }, env);
    expect(missing.status).toBe(401);
    expectCors(missing);
    await expect(errorOf(missing)).resolves.toEqual({ code: "unauthorized", message: "Missing bearer token." });
  });

  it.each([
    ["missing bearer", undefined, 401, "Missing bearer token."],
    ["malformed bearer", "bad-token", 401, "Malformed session token."],
    ["invalid signature", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6ImRhdm9yYSJ9.invalid", 401, "Invalid session token signature."],
  ] as const)("keeps ordinary bearer failure %s closed", async (_name, token, status, message) => {
    const { env } = await createSession();
    const response = await requestPath("/api/files?path=Projects", {
      headers: { origin: ORIGIN, ...(token ? { authorization: `Bearer ${token}` } : {}) }
    }, env);
    expect(response.status).toBe(status);
    expectCors(response);
    await expect(errorOf(response)).resolves.toMatchObject({ code: "unauthorized", message });
  });

  it("rejects wrong scope, expired, and account-unavailable session credentials before file execution", async () => {
    const { payload, env } = await createSession();
    const wrongScope = await signStreamToken(streamPayload(payload), SESSION_SECRET);
    const wrongScopeResponse = await authorizedRequest(wrongScope, "/api/files?path=Projects", {}, env);
    expect(wrongScopeResponse.status).toBe(401);
    await expect(errorOf(wrongScopeResponse)).resolves.toEqual({ code: "unauthorized", message: "Invalid session token scope." });

    const expired = await signSessionToken({ ...payload, exp: Math.floor(Date.now() / 1000) - 1 }, SESSION_SECRET);
    const expiredResponse = await authorizedRequest(expired, "/api/files?path=Projects", {}, env);
    expect(expiredResponse.status).toBe(401);
    await expect(errorOf(expiredResponse)).resolves.toEqual({ code: "unauthorized", message: "Token expired." });

    const unavailable = await signSessionToken({ ...payload, accountId: "missing-account" }, SESSION_SECRET);
    const unavailableResponse = await authorizedRequest(unavailable, "/api/files?path=Projects", {}, env);
    expect(unavailableResponse.status).toBe(409);
    await expect(errorOf(unavailableResponse)).resolves.toEqual({ code: "account_reconnect_required", message: "Connected account is no longer available. Reconnect this account." });
  });

  it("rejects a correctly shaped stream token with an invalid signature", async () => {
    const { payload, env } = await createSession();
    const signed = await signStreamToken(streamPayload(payload), SESSION_SECRET);
    const [header, encodedPayload, signature] = signed.split(".");
    const invalidSignature = `${header}.${encodedPayload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    const response = await requestPath(`/api/file/stream?path=Projects/song.mp3&streamToken=${encodeURIComponent(invalidSignature)}`, { headers: { origin: ORIGIN } }, env);

    expect(response.status).toBe(401);
    expectCors(response);
    await expect(errorOf(response)).resolves.toEqual({ code: "unauthorized", message: "Invalid session token signature." });
  });

  it("traces valid bearer execution after authority and delegates exactly once", async () => {
    const { token, env } = await createSession();
    const trace: string[] = [];
    traceIngressCapabilities(trace);

    const response = await authorizedRequest(token, "/api/files?path=Projects", {}, env);

    expect(response.status).toBe(200);
    expect(trace).toEqual(["verify-session", "resolve-account", "create-backend", "delegate-handler"]);
  });

  it("traces stream-token issuance without backend construction or file delegation", async () => {
    const { token, env } = await createSession();
    const trace: string[] = [];
    traceIngressCapabilities(trace);

    const response = await authorizedRequest(token, "/api/file/stream-token?path=Projects/song.mp3", { method: "POST" }, env);

    expect(response.status).toBe(200);
    expect(trace).toEqual(["verify-session", "resolve-account", "sign-stream"]);
  });

  it("rejects origin and credentials before resolver, backend, signing, or handler work", async () => {
    const { token, env } = await createSession();
    const trace: string[] = [];
    const fail = (name: string) => vi.fn(() => {
      trace.push(name);
      throw new Error(`${name} must not run`);
    });
    const resolver = interceptAccountResolution(async () => fail("resolve-account")());
    const backend = vi.spyOn(backendFactory, "createFileBackend").mockImplementation(fail("create-backend"));
    const handler = vi.spyOn(fileService, "executeFileRoute").mockImplementation(fail("delegate-handler"));
    const sign = vi.spyOn(tokenSecurity, "signStreamToken").mockImplementation(fail("sign-stream"));

    const denied = await requestPath("/api/files?path=Projects", { headers: { origin: OTHER_ORIGIN, authorization: `Bearer ${token}` } }, env);
    expect(denied.status).toBe(403);
    expect(trace).toEqual([]);
    expect(resolver).not.toHaveBeenCalled();
    expect(backend).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();

    const malformed = await requestPath("/api/files?path=Projects", { headers: { origin: ORIGIN, authorization: "Bearer malformed" } }, env);
    expect(malformed.status).toBe(401);
    expect(trace).toEqual([]);
    expect(resolver).not.toHaveBeenCalled();
    expect(backend).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it("rejects an unavailable account after verification without backend or signing work", async () => {
    const { payload, env } = await createSession();
    const token = await signSessionToken({ ...payload, accountId: "missing-account" }, SESSION_SECRET);
    const trace: string[] = [];
    const backend = vi.spyOn(backendFactory, "createFileBackend").mockImplementation(() => {
      trace.push("create-backend");
      throw new Error("backend must not run");
    });
    const handler = vi.spyOn(fileService, "executeFileRoute").mockImplementation(() => {
      trace.push("delegate-handler");
      throw new Error("handler must not run");
    });
    const sign = vi.spyOn(tokenSecurity, "signStreamToken").mockImplementation(() => {
      trace.push("sign-stream");
      throw new Error("signer must not run");
    });

    const response = await authorizedRequest(token, "/api/files?path=Projects", {}, env);

    expect(response.status).toBe(409);
    expect(trace).toEqual([]);
    expect(backend).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it("rejects a mismatched resolver context before backend, signing, or handler work", async () => {
    const { token, env } = await createSession();
    const streamToken = await signStreamToken(streamPayload(await verifySessionToken(token, SESSION_SECRET)), SESSION_SECRET);
    const resolver = interceptAccountResolution(async (service, accountId) => {
      const resolved = await service.resolveAuthorized(accountId);
      return { ...resolved, account: { ...resolved.account, id: "resolver-returned-other-account" } };
    });
    const backend = vi.spyOn(backendFactory, "createFileBackend").mockImplementation(() => {
      throw new Error("backend must not run");
    });
    const handler = vi.spyOn(fileService, "executeFileRoute").mockImplementation(() => {
      throw new Error("handler must not run");
    });
    const sign = vi.spyOn(tokenSecurity, "signStreamToken").mockImplementation(() => {
      throw new Error("signer must not run");
    });

    const fileResponse = await authorizedRequest(token, "/api/files?path=Projects", {}, env);
    expect(fileResponse.status).toBe(401);
    await expect(errorOf(fileResponse)).resolves.toEqual({ code: "session_mismatch", message: "Session no longer matches the selected account configuration." });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(backend).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();

    const streamTokenResponse = await authorizedRequest(token, "/api/file/stream-token?path=Projects/song.mp3", { method: "POST" }, env);
    expect(streamTokenResponse.status).toBe(401);
    await expect(errorOf(streamTokenResponse)).resolves.toEqual({ code: "session_mismatch", message: "Session no longer matches the selected account configuration." });
    expect(sign).not.toHaveBeenCalled();

    const streamResponse = await requestPath(`/api/file/stream?path=Projects/song.mp3&streamToken=${encodeURIComponent(streamToken)}`, { headers: { origin: ORIGIN } }, env);
    expect(streamResponse.status).toBe(401);
    await expect(errorOf(streamResponse)).resolves.toEqual({ code: "session_mismatch", message: "Session no longer matches the selected account configuration." });
    expect(backend).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps rejected authority traces closed at each ordering boundary", async () => {
    const { payload, env } = await createSession();
    const trace: string[] = [];
    traceIngressCapabilities(trace);

    const wrongScope = await signStreamToken(streamPayload(payload), SESSION_SECRET);
    trace.length = 0;
    const wrongScopeResponse = await authorizedRequest(wrongScope, "/api/files?path=Projects", {}, env);
    expect(wrongScopeResponse.status).toBe(401);
    expect(trace).toEqual(["verify-session"]);
    trace.length = 0;

    const expired = await signSessionToken({ ...payload, exp: Math.floor(Date.now() / 1000) - 1 }, SESSION_SECRET);
    const expiredResponse = await authorizedRequest(expired, "/api/files?path=Projects", {}, env);
    expect(expiredResponse.status).toBe(401);
    expect(trace).toEqual(["verify-session"]);
    trace.length = 0;

    const mismatch = await signSessionToken({ ...payload, rootPath: "other-root" }, SESSION_SECRET);
    const mismatchResponse = await authorizedRequest(mismatch, "/api/files?path=Projects", {}, env);
    expect(mismatchResponse.status).toBe(401);
    expect(trace).toEqual(["verify-session", "resolve-account"]);
    trace.length = 0;

    const streamToken = await signStreamToken(streamPayload(payload), SESSION_SECRET);
    trace.length = 0;
    const wrongPathResponse = await requestPath(`/api/file/stream?path=Archive/image.bin&streamToken=${encodeURIComponent(streamToken)}`, { headers: { origin: ORIGIN } }, env);
    expect(wrongPathResponse.status).toBe(401);
    expect(trace).toEqual(["verify-stream"]);
  });

  it("redacts unexpected resolver failures", async () => {
    const { token, env } = await createSession();
    const resolver = interceptAccountResolution(async () => {
      throw new Error("authority-secret should never reach the response");
    });

    const response = await authorizedRequest(token, "/api/files?path=Projects", {}, env);
    const body = await response.text();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({ data: { code: "unexpected_error", message: "Unexpected error." } });
    expect(body).not.toContain("authority-secret");
  });

  it("binds ordinary session authority to account, backend, root, and nonce", async () => {
    const { payload, env } = await createSession();
    for (const [label, override] of [
      ["account", { accountId: "other-account" }],
      ["backend", { backend: "nextcloud" as const }],
      ["root", { rootPath: "other-root" }],
      ["nonce", { accountNonce: "other-nonce" }]
    ] as const) {
      const token = await signSessionToken({ ...payload, ...override }, SESSION_SECRET);
      const response = await authorizedRequest(token, "/api/files?path=Projects", {}, env);
      expect(response.status, label).toBe(label === "account" ? 409 : 401);
      await expect(errorOf(response)).resolves.toMatchObject({
        code: label === "account" ? "account_reconnect_required" : "session_mismatch"
      });
    }
  });

  it("accepts a path-bound stream token only on the stream route and preserves full/range headers", async () => {
    const { token, payload, env } = await createSession();
    const issued = await authorizedRequest(token, "/api/file/stream-token?path=Projects/song.mp3", { method: "POST" }, env);
    expect(issued.status).toBe(200);
    expectCors(issued);
    const issuedPayload = (await issued.json() as { data: { token: string; path: string; expiresAt: string } }).data;
    expect(issuedPayload.path).toBe("Projects/song.mp3");
    expect(Date.parse(issuedPayload.expiresAt)).toBeGreaterThan(Date.now());

    const streamUrl = `/api/file/stream?path=Projects/song.mp3&streamToken=${encodeURIComponent(issuedPayload.token)}`;
    const range = await requestPath(streamUrl, { headers: { origin: ORIGIN, range: "bytes=1-2" } }, env);
    expect(range.status).toBe(206);
    expectCors(range);
    expect(range.headers.get("accept-ranges")).toBe("bytes");
    expect(range.headers.get("cache-control")).toBe("no-store");
    expect(range.headers.get("content-range")).toBe("bytes 1-2/4");
    expect(range.headers.get("content-length")).toBe("2");
    expect(range.headers.get("content-disposition")).toMatch(/inline; filename\*=UTF-8''song\.mp3/);
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(new Uint8Array([0x44, 0x33]));

    const full = await requestPath(streamUrl, { headers: { origin: ORIGIN } }, env);
    expect(full.status).toBe(200);
    expectCors(full);
    expect(full.headers.get("content-length")).toBe("4");

    const wrongPath = await requestPath(`/api/file/stream?path=Archive/image.bin&streamToken=${encodeURIComponent(issuedPayload.token)}`, { headers: { origin: ORIGIN } }, env);
    expect(wrongPath.status).toBe(401);
    expectCors(wrongPath);
    await expect(errorOf(wrongPath)).resolves.toEqual({ code: "unauthorized", message: "Stream token does not match the requested path." });

    for (const [label, override] of [
      ["account", { accountId: "missing-stream-account" }],
      ["backend", { backend: "nextcloud" as const }],
      ["root", { rootPath: "other-root" }],
      ["nonce", { accountNonce: "other-nonce" }]
    ] as const) {
      const boundToken = await signStreamToken(streamPayload(payload, override), SESSION_SECRET);
      const boundResponse = await requestPath(`/api/file/stream?path=Projects/song.mp3&streamToken=${encodeURIComponent(boundToken)}`, { headers: { origin: ORIGIN } }, env);
      expect(boundResponse.status, label).toBe(label === "account" ? 409 : 401);
      expectCors(boundResponse);
      await expect(errorOf(boundResponse)).resolves.toMatchObject({
        code: label === "account" ? "account_reconnect_required" : "session_mismatch"
      });
    }

    const streamOnOriginal = await requestPath(`/api/file/original?path=Projects/song.mp3&streamToken=${encodeURIComponent(issuedPayload.token)}`, { headers: { origin: ORIGIN } }, env);
    expect(streamOnOriginal.status).toBe(401);
    expectCors(streamOnOriginal);
    await expect(errorOf(streamOnOriginal)).resolves.toEqual({ code: "unauthorized", message: "Missing bearer token." });

    const sessionQueryOnStream = await requestPath(`/api/file/stream?path=Projects/song.mp3&token=${encodeURIComponent(token)}`, { headers: { origin: ORIGIN } }, env);
    expect(sessionQueryOnStream.status).toBe(401);
    expectCors(sessionQueryOnStream);
    await expect(errorOf(sessionQueryOnStream)).resolves.toEqual({ code: "unauthorized", message: "Missing bearer token." });

    const wrongScope = await signSessionToken(payload, SESSION_SECRET);
    const wrongScopeResponse = await requestPath(`/api/file/stream?path=Projects/song.mp3&streamToken=${encodeURIComponent(wrongScope)}`, { headers: { origin: ORIGIN } }, env);
    expect(wrongScopeResponse.status).toBe(401);
    expectCors(wrongScopeResponse);
    await expect(errorOf(wrongScopeResponse)).resolves.toEqual({ code: "unauthorized", message: "Invalid stream token scope." });
  });

  it("keeps stream-token malformed and expired failures closed", async () => {
    const { payload, env } = await createSession();
    const malformed = await requestPath("/api/file/stream?path=Projects/song.mp3&streamToken=bad-token", { headers: { origin: ORIGIN } }, env);
    expect(malformed.status).toBe(401);
    expectCors(malformed);
    await expect(errorOf(malformed)).resolves.toEqual({ code: "unauthorized", message: "Malformed session token." });

    const expired = await signStreamToken(streamPayload(payload, { exp: Math.floor(Date.now() / 1000) - 1 }), SESSION_SECRET);
    const expiredResponse = await requestPath(`/api/file/stream?path=Projects/song.mp3&streamToken=${encodeURIComponent(expired)}`, { headers: { origin: ORIGIN } }, env);
    expect(expiredResponse.status).toBe(401);
    expectCors(expiredResponse);
    await expect(errorOf(expiredResponse)).resolves.toEqual({ code: "unauthorized", message: "Token expired." });
  });

  it("keeps stream-token issuance POST-only, path-validated, and capped by the parent session expiry", async () => {
    const shortEnv = { ...BASE_ENV, SESSION_TTL_SECONDS: "30" };
    const { token, env } = await createSession(shortEnv);
    const issued = await authorizedRequest(token, "/api/file/stream-token?path=Projects/song.mp3", { method: "POST" }, env);
    expect(issued.status).toBe(200);
    expect(Date.parse((await issued.json() as { data: { expiresAt: string } }).data.expiresAt) - Date.now()).toBeLessThanOrEqual(30_000);

    const wrongMethod = await authorizedRequest(token, "/api/file/stream-token?path=Projects/song.mp3", {}, env);
    expect(wrongMethod.status).toBe(404);
    expectCors(wrongMethod);
    await expect(errorOf(wrongMethod)).resolves.toEqual({ code: "not_found", message: "Route not found." });

    const invalidPath = await authorizedRequest(token, "/api/file/stream-token?path=../private", { method: "POST" }, env);
    expect(invalidPath.status).toBe(400);
    expectCors(invalidPath);
    await expect(errorOf(invalidPath)).resolves.toEqual({ code: "invalid_request", message: "File path query was invalid." });
  });

  it("keeps unknown and wrong-method routes concealed after authority and applies origin denial before file work", async () => {
    const { token, env } = await createSession();
    const unknown = await authorizedRequest(token, "/api/unknown", {}, env);
    expect(unknown.status).toBe(404);
    expectCors(unknown);
    await expect(errorOf(unknown)).resolves.toEqual({ code: "not_found", message: "Route not found." });
    const wrongMethod = await authorizedRequest(token, "/api/folders", {}, env);
    expect(wrongMethod.status).toBe(404);
    expectCors(wrongMethod);
    await expect(errorOf(wrongMethod)).resolves.toEqual({ code: "not_found", message: "Route not found." });

    const denied = await requestPath("/api/files?path=Projects", { headers: { origin: OTHER_ORIGIN, authorization: `Bearer ${token}` } }, env);
    expect(denied.status).toBe(403);
    expectCors(denied);
    await expect(errorOf(denied)).resolves.toEqual({ code: "permission_denied", message: "Request origin is not allowed." });
    expect(denied.headers.get("access-control-allow-origin")).toBe(ORIGIN);

    const deniedBeforeAuth = await requestPath("/api/files?path=Projects", { headers: { origin: OTHER_ORIGIN } }, env);
    expect(deniedBeforeAuth.status).toBe(403);
    expectCors(deniedBeforeAuth);
    await expect(errorOf(deniedBeforeAuth)).resolves.toEqual({ code: "permission_denied", message: "Request origin is not allowed." });
  });
});
