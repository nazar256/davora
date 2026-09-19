import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleRequest } from "../src/app";
import { MemoryAccountStateStorage } from "../src/accounts/storage";
import * as application from "../src/http/application";
import * as config from "../src/config";
import * as mockData from "../src/mock/data";
import * as router from "../src/http/router";

const ORIGIN = "http://127.0.0.1:4173";
const OTHER_ORIGIN = "https://attacker.example";
const accountStorage = new MemoryAccountStateStorage();
const ENV = {
  SESSION_SECRET: "bootstrap-secret-0123456789abcdef",
  RUNTIME_MODE: "development",
  MOCK_BACKEND: "true",
  ALLOWED_ORIGINS: ORIGIN,
  ACCOUNT_STATE_STORAGE: accountStorage
};
const OWNER_HEADERS = {
  origin: ORIGIN,
  "x-davora-browser-id": "bootstrap-browser",
  "x-davora-browser-secret": "bootstrap-browser-secret",
  "content-type": "application/json"
};

function request(path: string, init: RequestInit = {}, env: Record<string, unknown> = ENV): Promise<Response> {
  return handleRequest(new Request(`http://127.0.0.1:8787${path}`, init), env);
}

async function errorBody(response: Response): Promise<{ data: { code: string; message: string } }> {
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || !("data" in value)) throw new Error("Expected error envelope.");
  const data = value.data;
  if (!data || typeof data !== "object" || !("code" in data) || !("message" in data)
    || typeof data.code !== "string" || typeof data.message !== "string") throw new Error("Expected error envelope.");
  return { data: { code: data.code, message: data.message } };
}

function durableFailureEnv(status = 503): Record<string, unknown> {
  return {
    ...ENV,
    ACCOUNT_STATE_STORAGE: undefined,
    DAVORA_ACCOUNT_STORE: {
      idFromName: (name: string) => ({ toString: () => name }),
      get: () => ({ fetch: async () => new Response("failed", { status }) })
    }
  };
}

async function connectAccount(env: Record<string, unknown> = ENV): Promise<string> {
  const response = await request("/api/accounts", {
    method: "POST",
    headers: OWNER_HEADERS,
    body: JSON.stringify({ type: "nextcloud", baseUrl: "https://mock-account.example.com", username: "demo", appPassword: "password" })
  }, env);
  expect(response.status).toBe(201);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || !("data" in value) || !value.data || typeof value.data !== "object"
    || !("account" in value.data) || !value.data.account || typeof value.data.account !== "object"
    || !("id" in value.data.account) || typeof value.data.account.id !== "string") throw new Error("Expected account envelope.");
  return value.data.account.id;
}

describe("Worker request-bootstrap public characterization", () => {
  beforeEach(() => {
    accountStorage.reset();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network sentinel must not run"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    accountStorage.reset();
  });

  it("short-circuits every OPTIONS path before config, routing, or application work", async () => {
    const health = vi.spyOn(config, "configHealth");
    const load = vi.spyOn(config, "loadConfig");
    const match = vi.spyOn(router, "matchWorkerRoute");
    const execute = vi.spyOn(application, "handleWorkerApplication");
    for (const path of ["/api/health", "/api/accounts", "/api/files", "/api/unknown", "/api/mock/reset"]) {
      const response = await request(path, { method: "OPTIONS", headers: { origin: ORIGIN } });
      expect(response.status, path).toBe(204);
      expect(response.headers.get("access-control-allow-origin"), path).toBe(ORIGIN);
    }
    expect(health).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["GET", "POST", "PATCH"])("keeps %s /api/health method-permissive and config-free", async (method) => {
    const health = vi.spyOn(config, "configHealth");
    const load = vi.spyOn(config, "loadConfig");
    const match = vi.spyOn(router, "matchWorkerRoute");
    const execute = vi.spyOn(application, "handleWorkerApplication");
    const response = await request("/api/health", { method, headers: { origin: ORIGIN } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: { app: "davora", configLoaded: true, backend: "mock", rootPath: "", unlockRequired: false, connectionMode: "in_app", supportedAccountTypes: ["nextcloud"] } });
    expect(health).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("reports incomplete health without full config, origin admission, or application work", async () => {
    const load = vi.spyOn(config, "loadConfig");
    const execute = vi.spyOn(application, "handleWorkerApplication");
    const response = await request("/api/health", { headers: { origin: OTHER_ORIGIN } }, { MOCK_BACKEND: "false" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { app: "davora", configLoaded: false, backend: "nextcloud", rootPath: "", unlockRequired: false, connectionMode: "in_app", supportedAccountTypes: ["nextcloud"], missing: ["SESSION_SECRET"] } });
    expect(load).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("converts config failure before origin admission, routing, and application work", async () => {
    const match = vi.spyOn(router, "matchWorkerRoute");
    const execute = vi.spyOn(application, "handleWorkerApplication");
    const response = await request("/api/files", { headers: { origin: OTHER_ORIGIN } }, {});
    expect(response.status).toBe(500);
    await expect(errorBody(response)).resolves.toEqual({ data: { code: "config_error", message: "SESSION_SECRET is required. Provision it in the Worker runtime before release." } });
    expect(match).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps account storage outages through the closed repository failure contract", async () => {
    const response = await request("/api/accounts", {
      method: "POST",
      headers: OWNER_HEADERS,
      body: JSON.stringify({ type: "nextcloud", baseUrl: "https://mock-account.example.com", username: "demo", appPassword: "password" })
    }, durableFailureEnv());
    expect(response.status).toBe(500);
    await expect(errorBody(response)).resolves.toEqual({ data: { code: "internal_error", message: "Account store persistence failed." } });
  });

  it("keeps mock-reset concealed and admits only the exact token", async () => {
    const reset = vi.spyOn(mockData, "resetMockEntries");
    const accountId = await connectAccount();
    reset.mockClear();
    expect((await request("/api/mock/reset", { method: "POST" })).status).toBe(404);
    expect((await request("/api/mock/reset", { method: "POST", headers: { "x-davora-reset-token": "wrong" } })).status).toBe(404);
    const allowed = await request("/api/mock/reset", { method: "POST", headers: { "x-davora-reset-token": ENV.SESSION_SECRET } });
    expect(allowed.status).toBe(204);
    expect(reset).toHaveBeenCalledOnce();
    const session = await request("/api/session", { method: "POST", headers: OWNER_HEADERS, body: JSON.stringify({ accountId }) });
    expect(session.status).toBe(409);
  });

  it("conceals reset in non-mock mode before account storage is needed", async () => {
    const response = await request("/api/mock/reset", { method: "POST", headers: { "x-davora-reset-token": ENV.SESSION_SECRET } }, {
      SESSION_SECRET: ENV.SESSION_SECRET,
      RUNTIME_MODE: "development",
      MOCK_BACKEND: "false",
      NEXTCLOUD_ALLOWED_HOSTS: "nextcloud.example.com"
    });
    expect(response.status).toBe(404);
    await expect(errorBody(response)).resolves.toEqual({ data: { code: "not_found", message: "Route not found." } });
  });

  it("returns a redacted storage failure and never resets mock data when reset clear fails", async () => {
    const reset = vi.spyOn(mockData, "resetMockEntries");
    const response = await request("/api/mock/reset", {
      method: "POST",
      headers: { "x-davora-reset-token": ENV.SESSION_SECRET }
    }, durableFailureEnv());
    expect(response.status).toBe(500);
    await expect(errorBody(response)).resolves.toEqual({ data: { code: "internal_error", message: "Account store persistence failed." } });
    expect(reset).not.toHaveBeenCalled();
  });

  it("admits absent and allowed origins but rejects denied origins before routing", async () => {
    expect((await request("/api/files")).status).toBe(401);
    expect((await request("/api/files", { headers: { origin: ORIGIN } })).status).toBe(401);
    expect((await request("/api/files", { headers: { origin: "http://localhost:4173" } })).status).toBe(401);
    const match = vi.spyOn(router, "matchWorkerRoute");
    const denied = await request("/api/files", { headers: { origin: OTHER_ORIGIN } });
    expect(denied.status).toBe(403);
    await expect(errorBody(denied)).resolves.toEqual({ data: { code: "permission_denied", message: "Request origin is not allowed." } });
    expect(match).not.toHaveBeenCalled();
    expect((await request("/api/files", { headers: { origin: OTHER_ORIGIN } }, { ...ENV, ALLOWED_ORIGINS: "" })).status).toBe(401);
  });

  it("routes an admitted request through exactly one application owner and preserves CORS", async () => {
    const execute = vi.spyOn(application, "handleWorkerApplication").mockResolvedValue(new Response("application", { status: 202 }));
    const response = await request("/api/files", { headers: { origin: ORIGIN } });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("application");
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("keeps noncanonical GET reset concealed by the single router", async () => {
    const reset = vi.spyOn(mockData, "resetMockEntries");
    const response = await request("/api/mock/reset", { method: "GET" });
    expect(response.status).toBe(404);
    await expect(errorBody(response)).resolves.toEqual({ data: { code: "not_found", message: "Route not found." } });
    expect(reset).not.toHaveBeenCalled();
  });

  it("redacts unexpected application failures while preserving composed CORS", async () => {
    vi.spyOn(application, "handleWorkerApplication").mockRejectedValue(new Error("secret-upstream-detail"));
    const response = await request("/api/files", { headers: { origin: ORIGIN } });
    expect(response.status).toBe(500);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const body = await response.text();
    expect(body).toContain('"code":"unexpected_error"');
    expect(body).not.toContain("secret-upstream-detail");
  });
});
