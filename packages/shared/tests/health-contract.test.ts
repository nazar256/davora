import { describe, expect, it } from "vitest";

import {
  healthEndpoint,
  healthResponseSchema
} from "../src/api";

const healthResponse = {
  app: "davora",
  configLoaded: true,
  backend: "mock",
  rootPath: ".davora-agent-test",
  unlockRequired: false,
  connectionMode: "in_app",
  supportedAccountTypes: ["nextcloud"]
} as const;

describe("health endpoint contract", () => {
  it("declares the canonical public GET endpoint without changing Worker routing", () => {
    expect(healthEndpoint).toMatchObject({
      id: "health",
      method: "GET",
      path: "/api/health",
      auth: "public"
    });
    expect(healthEndpoint.requestSchema.parse(undefined)).toBeUndefined();
  });

  it("accepts the exact configured and incomplete health wire shapes", () => {
    expect(healthResponseSchema.parse(healthResponse)).toEqual(healthResponse);
    expect(healthResponseSchema.parse({
      ...healthResponse,
      configLoaded: false,
      missing: ["SESSION_SECRET"]
    })).toEqual({
      ...healthResponse,
      configLoaded: false,
      missing: ["SESSION_SECRET"]
    });
  });

  it("rejects missing, invalid, and unknown health fields", () => {
    expect(() => healthResponseSchema.parse({ ...healthResponse, app: "other" })).toThrow();
    expect(() => healthResponseSchema.parse({ ...healthResponse, configLoaded: "yes" })).toThrow();
    const { backend: _backend, ...withoutBackend } = healthResponse;
    expect(() => healthResponseSchema.parse(withoutBackend)).toThrow();
    expect(() => healthResponseSchema.parse({ ...healthResponse, extra: true })).toThrow();
  });
});
