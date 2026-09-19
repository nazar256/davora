import { beforeEach, describe, expect, it } from "vitest";

import { handleRequest } from "../../src/app";
import { env, resetConnectedAccountStoreForTests } from "../support/workerApplicationHarness";

beforeEach(() => {
  resetConnectedAccountStoreForTests();
});

describe("worker bootstrap application", () => {
  it("reports in-app account connection model from health", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:8787/api/health", {
      headers: { origin: "http://127.0.0.1:4173" }
    }), { ...env, APP_UNLOCK_CODE: "open-sesame" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4173");
    expect(await response.json()).toEqual({
      data: {
        app: "davora",
        configLoaded: true,
        backend: "mock",
        rootPath: "",
        unlockRequired: true,
        connectionMode: "in_app",
        supportedAccountTypes: ["nextcloud"]
      }
    });
  })

  it("advertises account deletion and browser ownership headers in cross-origin preflight", async () => {
    const response = await handleRequest(
      new Request("http://127.0.0.1:8787/api/accounts/account-sentinel", {
        method: "OPTIONS",
        headers: {
          origin: "http://127.0.0.1:4173",
          "access-control-request-method": "DELETE",
          "access-control-request-headers": "x-davora-browser-id,x-davora-browser-secret"
        }
      }),
      env
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4173");
    expect(response.headers.get("access-control-allow-methods")?.split(",").map((method) => method.trim())).toContain("DELETE");
    const allowedHeaders = response.headers.get("access-control-allow-headers")?.split(",").map((header) => header.trim().toLowerCase());
    expect(allowedHeaders).toEqual(expect.arrayContaining(["x-davora-browser-id", "x-davora-browser-secret"]));
  })

  it("preserves the current method-permissive health route during the contract pilot", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:8787/api/health", { method: "POST" }), env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        app: "davora",
        configLoaded: true,
        backend: "mock",
        rootPath: "",
        unlockRequired: false,
        connectionMode: "in_app",
        supportedAccountTypes: ["nextcloud"]
      }
    });
  })

  it("reports incomplete health configuration with the exact missing-field envelope", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:8787/api/health"), { MOCK_BACKEND: "false" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        app: "davora",
        configLoaded: false,
        backend: "nextcloud",
        rootPath: "",
        unlockRequired: false,
        connectionMode: "in_app",
        supportedAccountTypes: ["nextcloud"],
        missing: ["SESSION_SECRET"]
      }
    });
  })

  it("gates mock reset behind the configured reset token", async () => {
    const denied = await handleRequest(
      new Request("http://127.0.0.1:8787/api/mock/reset", { method: "POST" }),
      env
    );
    expect(denied.status).toBe(404);

    const allowed = await handleRequest(
      new Request("http://127.0.0.1:8787/api/mock/reset", {
        method: "POST",
        headers: { "x-davora-reset-token": env.SESSION_SECRET }
      }),
      env
    );
    expect(allowed.status).toBe(204);
  })

  it("blocks requests without a token", async () => {
    const response = await handleRequest(
      new Request("http://127.0.0.1:8787/api/files", {
        headers: { origin: "http://127.0.0.1:4173" }
      }),
      env
    );

    expect(response.status).toBe(401);
  })
});

