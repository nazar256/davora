import { describe, expect, it, vi } from "vitest";
import { apiEndpoints, buildCapabilitySet } from "@davora/shared";

import type { AuthorizedAccountContext, SessionPayload, StreamTokenPayload, WorkerEnv } from "../src/types";
import { createWorkerRequestContext } from "../src/http/context";
import { catalogRouteKeys, matchWorkerRoute } from "../src/http/router";

function request(path: string, method = "GET", body?: BodyInit, contentType?: string): Request {
  return new Request(`https://worker.test${path}`, {
    method,
    ...(body === undefined ? {} : {
      body,
      ...(contentType === undefined && !(body instanceof FormData)
        ? { headers: { "content-type": "application/json" } }
        : contentType ? { headers: { "content-type": contentType } } : {})
    })
  });
}

describe("catalog Worker router", () => {
  it("derives its complete route inventory from the canonical shared catalog", () => {
    expect(catalogRouteKeys).toEqual(Object.keys(apiEndpoints));
  });

  it.each([
    ["health", request("/api/health", "PATCH")],
    ["connectAccount", request("/api/accounts", "POST", JSON.stringify({ type: "nextcloud", baseUrl: "https://nextcloud.example", username: "a", appPassword: "p" }))],
    ["deleteAccount", request("/api/accounts/a%2Fb", "DELETE")],
    ["session", request("/api/session", "POST", JSON.stringify({ accountId: "a" }))],
    ["files", request("/api/files?path=Docs")],
    ["metadata", request("/api/metadata?path=Docs/a.txt", "PUT")],
    ["preview", request("/api/file?path=Docs/a.txt", "POST")],
    ["original", request("/api/file/original?path=Docs/a.txt", "DELETE")],
    ["streamToken", request("/api/file/stream-token?path=Docs/a.mp3", "POST")],
    ["stream", request("/api/file/stream?path=Docs/a.mp3", "PATCH")],
    ["search", request("/api/search?path=Docs&q=a")],
    ["download", request("/api/download?path=Docs/a.txt")],
    ["createFolder", request("/api/folders", "POST", JSON.stringify({ path: "Docs", name: "New" }))],
    ["upload", request("/api/upload", "POST", JSON.stringify({ path: "Docs", name: "a.txt", mimeType: "text/plain", contentBase64: "YQ==" }))],
    ["move", request("/api/move", "POST", JSON.stringify({ path: "Docs/a.txt", destinationPath: "Archive/a.txt" }))],
    ["copy", request("/api/copy", "POST", JSON.stringify({ path: "Docs/a.txt", destinationPath: "Archive/a.txt" }))],
    ["delete", request("/api/delete", "POST", JSON.stringify({ path: "Docs/a.txt", confirmName: "a.txt" }))],
    ["reset", request("/api/mock/reset", "POST")]
  ] as const)("matches and parses %s exactly once", async (id, input) => {
    await expect(matchWorkerRoute(input)).resolves.toMatchObject({ id });
  });

  it("normalizes the browser POST download authority without accepting query tokens", async () => {
    const form = new FormData();
    form.set("path", "Docs/a.txt");
    form.set("token", "session-token");
    await expect(matchWorkerRoute(request("/api/download", "POST", form))).resolves.toMatchObject({
      id: "download",
      input: { path: "Docs/a.txt" },
      authorityToken: "session-token"
    });
    await expect(matchWorkerRoute(request("/api/download?path=Docs/a.txt&token=query-token"))).resolves.not.toHaveProperty("authorityToken");
  });

  it("rejects wrong methods and defers malformed input behind authentication", async () => {
    await expect(matchWorkerRoute(request("/api/session"))).rejects.toMatchObject({ kind: "not_found" });
    await expect(matchWorkerRoute(request("/api/files?path=../escape"))).resolves.toMatchObject({ id: "files", inputError: { kind: "invalid_file_query" } });
    await expect(matchWorkerRoute(request("/api/upload", "POST", "not-json"))).resolves.toMatchObject({ id: "upload", inputError: { kind: "invalid_mutation_body" } });
    await expect(matchWorkerRoute(request("/api/move", "POST", "not-json"))).resolves.toMatchObject({ id: "move", inputError: { kind: "invalid_move_copy_json" } });
  });
});

const env = {
  SESSION_SECRET: "secret",
  SESSION_TTL_SECONDS: 3600,
  ALLOWED_ORIGINS: [],
  NEXTCLOUD_ROOT_PATH: "",
  NEXTCLOUD_ALLOWED_HOSTS: [],
  RUNTIME_MODE: "development",
  ALLOW_LOCAL_NEXTCLOUD: false,
  NEXTCLOUD_MAX_FILE_BYTES: 1,
  NEXTCLOUD_MAX_TEXT_FILE_BYTES: 1,
  MOCK_BACKEND: true
} satisfies WorkerEnv;

const account = {
  account: {
    id: "alpha",
    type: "nextcloud",
    displayName: "Alpha",
    baseUrl: "https://nextcloud.example",
    username: "alpha",
    rootPath: "",
    backend: "mock",
    connectionState: "connected",
    lastValidatedAt: "2026-09-01T00:00:00.000Z",
    cacheNamespace: "cache-alpha"
  },
  accountNonce: "nonce-alpha",
  capabilities: buildCapabilitySet("mock", { readOnly: false })
} satisfies AuthorizedAccountContext;

describe("typed Worker auth context", () => {
  it("rejects missing authority before account/backend resolution", async () => {
    const resolveAuthorizedAccount = vi.fn(async () => account);
    const deps = {
      verifySessionToken: vi.fn<(_: string) => Promise<SessionPayload>>(),
      verifyStreamToken: vi.fn<(_: string) => Promise<StreamTokenPayload>>(),
      resolveAuthorizedAccount
    };
    const browserRoute = await matchWorkerRoute(request("/api/session", "POST", JSON.stringify({ accountId: "alpha" })));
    await expect(createWorkerRequestContext(request("/api/session", "POST", JSON.stringify({ accountId: "alpha" })), browserRoute, env, deps)).rejects.toMatchObject({ kind: "permission_denied" });
    const sessionRoute = await matchWorkerRoute(request("/api/files?path=Docs"));
    await expect(createWorkerRequestContext(request("/api/files?path=Docs"), sessionRoute, env, deps)).rejects.toMatchObject({ kind: "missing_bearer" });
    expect(resolveAuthorizedAccount).not.toHaveBeenCalled();
  });

  it("binds stream path before resolving an account", async () => {
    const resolveAuthorizedAccount = vi.fn(async () => account);
    const verifyStreamToken = vi.fn(async (): Promise<StreamTokenPayload> => ({
      scope: "davora-stream", accountId: "alpha", backend: "mock", rootPath: "", accountNonce: "nonce-alpha",
      path: "Docs/other.mp3", exp: 2_000_000_000
    }));
    const input = request("/api/file/stream?path=Docs/a.mp3&streamToken=stream-token");
    const route = await matchWorkerRoute(input);
    await expect(createWorkerRequestContext(input, route, env, {
      verifySessionToken: vi.fn(), verifyStreamToken, resolveAuthorizedAccount
    })).rejects.toMatchObject({ kind: "stream_path_mismatch" });
    expect(resolveAuthorizedAccount).not.toHaveBeenCalled();
  });

  it("produces a fully bound session context", async () => {
    const payload: SessionPayload = {
      scope: "davora", accountId: "alpha", backend: "mock", rootPath: "", accountNonce: "nonce-alpha", exp: 2_000_000_000
    };
    const input = new Request("https://worker.test/api/files?path=Docs", { headers: { authorization: "Bearer session-token" } });
    const route = await matchWorkerRoute(input);
    const context = await createWorkerRequestContext(input, route, env, {
      verifySessionToken: vi.fn(async () => payload),
      verifyStreamToken: vi.fn(),
      resolveAuthorizedAccount: vi.fn(async () => account)
    });
    expect(context).toMatchObject({ auth: "session", route: { id: "files" }, session: payload, account });
  });
});
