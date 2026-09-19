/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import type { WorkerEnv } from "../src/types";

const modulePath = "../src/requestBootstrap.ts";
const admittedEnv = {
  SESSION_SECRET: "injected-secret",
  SESSION_TTL_SECONDS: 3600,
  ALLOWED_ORIGINS: ["https://app.example"],
  NEXTCLOUD_ROOT_PATH: "",
  NEXTCLOUD_ALLOWED_HOSTS: [],
  RUNTIME_MODE: "production" as const,
  ALLOW_LOCAL_NEXTCLOUD: false,
  NEXTCLOUD_MAX_FILE_BYTES: 1,
  NEXTCLOUD_MAX_TEXT_FILE_BYTES: 1,
  MOCK_BACKEND: true
} satisfies WorkerEnv;

type Health = {
  configLoaded: boolean;
  backend: "mock" | "nextcloud";
  rootPath: string;
  unlockRequired: boolean;
  missing: string[];
};

type BootstrapCapabilities = {
  inspectHealth(rawEnv: Record<string, unknown>): Health;
  loadEnvironment(rawEnv: Record<string, unknown>): WorkerEnv;
};

async function prepare(request: Request, rawEnv: Record<string, unknown>, capabilities: BootstrapCapabilities) {
  const owner = await import(/* @vite-ignore */ modulePath) as { prepareWorkerRequest: (request: Request, rawEnv: Record<string, unknown>, capabilities: BootstrapCapabilities) => Promise<unknown> };
  return owner.prepareWorkerRequest(request, rawEnv, capabilities);
}

function capabilities(trace: string[], overrides: Partial<BootstrapCapabilities> = {}): BootstrapCapabilities {
  return {
    inspectHealth: () => { trace.push("health"); return { configLoaded: true, backend: "mock", rootPath: "", unlockRequired: false, missing: [] }; },
    loadEnvironment: () => { trace.push("config"); return admittedEnv; },
    ...overrides
  };
}

describe("requestBootstrap injected capability contract", () => {
  let fetchSentinel: MockInstance<typeof globalThis.fetch> | undefined;

  beforeEach(() => {
    fetchSentinel = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network sentinel must not run"));
  });

  afterEach(() => {
    try {
      expect(fetchSentinel).not.toHaveBeenCalled();
    } finally {
      fetchSentinel?.mockRestore();
      fetchSentinel = undefined;
    }
  });

  function expectCorsNeutral(result: unknown): void {
    const response = (result as { response?: Response }).response;
    expect(response).toBeInstanceOf(Response);
    for (const header of ["access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "vary"]) {
      expect(response?.headers.get(header), header).toBeNull();
    }
  }

  it("returns CORS-neutral early responses and performs no work for OPTIONS", async () => {
    const trace: string[] = [];
    const result = await prepare(new Request("https://worker.example/api/files", { method: "OPTIONS", headers: { origin: "https://app.example" } }), { ALLOWED_ORIGINS: "https://app.example" }, capabilities(trace));
    expect(result).toMatchObject({ kind: "respond", origin: "https://app.example", allowedOrigins: ["https://app.example"] });
    expect((result as { response: Response }).response.status).toBe(204);
    expect(trace).toEqual([]);
    expectCorsNeutral(result);
  });

  it("keeps health before config/hydration/origin for complete and incomplete config", async () => {
    const completeTrace: string[] = [];
    const complete = await prepare(new Request("https://worker.example/api/health", { method: "PATCH" }), { SESSION_SECRET: "secret" }, capabilities(completeTrace));
    expect(complete).toMatchObject({ kind: "respond" });
    expectCorsNeutral(complete);
    expect(completeTrace).toEqual(["health"]);
    const incompleteTrace: string[] = [];
    const incomplete = await prepare(new Request("https://worker.example/api/health"), {}, capabilities(incompleteTrace, {
      inspectHealth: () => { incompleteTrace.push("health"); return { configLoaded: false, backend: "nextcloud", rootPath: "", unlockRequired: false, missing: ["SESSION_SECRET"] }; }
    }));
    expect(incomplete).toMatchObject({ kind: "respond" });
    expectCorsNeutral(incomplete);
    expect(incompleteTrace).toEqual(["health"]);
  });

  it("converts config failures without origin, routing, or downstream work", async () => {
    const configTrace: string[] = [];
    const configFailure = await prepare(new Request("https://worker.example/api/files"), {}, capabilities(configTrace, {
      loadEnvironment: () => { configTrace.push("config"); throw new Error("configuration detail"); }
    }));
    expect(configFailure).toMatchObject({ kind: "respond" });
    const response = (configFailure as { response: Response }).response;
    const body = await response.text();
    expect(response.status).toBe(500);
    expect(body).toContain("Configuration error.");
    expect(body).not.toContain("configuration detail");
    expectCorsNeutral(configFailure);
    expect(configTrace).toEqual(["config"]);
  });

  it("returns the parsed reset route for application-level concealment and execution", async () => {
    const wrongMethodTrace: string[] = [];
    const wrongMethod = await prepare(new Request("https://worker.example/api/mock/reset", { method: "GET" }), { SESSION_SECRET: admittedEnv.SESSION_SECRET }, capabilities(wrongMethodTrace));
    expect(wrongMethod).toMatchObject({ kind: "respond" });
    expect(wrongMethodTrace).toEqual(["config"]);
    const trace: string[] = [];
    const result = await prepare(new Request("https://worker.example/api/mock/reset", { method: "POST", headers: { "x-davora-reset-token": admittedEnv.SESSION_SECRET } }), { SESSION_SECRET: admittedEnv.SESSION_SECRET }, capabilities(trace, {
      loadEnvironment: () => { trace.push("config"); return { ...admittedEnv, RUNTIME_MODE: "development" }; }
    }));
    expect(result).toMatchObject({ kind: "admitted", route: { id: "reset", auth: "public" } });
    expect(trace).toEqual(["config"]);
  });

  it("admits only exact origins after successful lifecycle and returns normalized allowlist", async () => {
    const allowedTrace: string[] = [];
    const allowed = await prepare(new Request("https://worker.example/api/files", { headers: { origin: "https://app.example" } }), { ALLOWED_ORIGINS: "https://app.example" }, capabilities(allowedTrace));
    expect(allowed).toEqual({ kind: "admitted", env: admittedEnv, route: { id: "files", auth: "session", input: { path: "" } }, origin: "https://app.example", allowedOrigins: ["https://app.example"] });
    expect(allowedTrace).toEqual(["config"]);
    const deniedTrace: string[] = [];
    const denied = await prepare(new Request("https://worker.example/api/files", { headers: { origin: "https://attacker.example" } }), { ALLOWED_ORIGINS: "https://app.example" }, capabilities(deniedTrace));
    expect(denied).toMatchObject({ kind: "respond" });
    expectCorsNeutral(denied);
    expect(deniedTrace).toEqual(["config"]);
  });
});
