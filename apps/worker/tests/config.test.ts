import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  configHealth,
  loadConfig,
  normalizeAccountLabel,
  normalizeNextcloudBaseUrl,
  validateAppUnlockCode,
  validateNextcloudAppPassword,
  validateSessionTokenSecret,
  validateNextcloudUsername,
  validateSessionSecret
} from "../src/config";
import { corsHeaders, originMatchesAllowedOrigin } from "../src/security/http";

describe("worker config", () => {
  const productionSecret = "0123456789abcdef0123456789abcdef";

  it("keeps the executable mock test server in explicit development mode", () => {
    const packageSource = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const devTestScript = packageSource.match(/"dev:test"\s*:\s*"([^"]+)"/)?.[1] ?? "";
    const scriptEnv: Record<string, string> = {};
    for (const token of devTestScript.split(/\s+/)) {
      const separator = token.indexOf("=");
      if (separator < 1) continue;
      scriptEnv[token.slice(0, separator)] = token.slice(separator + 1);
    }

    expect(scriptEnv).toMatchObject({
      RUNTIME_MODE: "development",
      SESSION_SECRET: "playwright-dev-secret",
      MOCK_BACKEND: "true"
    });
    expect(configHealth(scriptEnv).configLoaded).toBe(true);
  });

  it("loads mock backend with minimal settings", () => {
    const config = loadConfig({
      SESSION_SECRET: "secret",
      MOCK_BACKEND: "true",
      RUNTIME_MODE: "development",
      ALLOWED_ORIGINS: "http://127.0.0.1:4173"
    });

    expect(config.MOCK_BACKEND).toBe(true);
    expect(config.NEXTCLOUD_ROOT_PATH).toBe("");
  });

  it("uses a test root only when explicitly configured", () => {
    const config = loadConfig({
      SESSION_SECRET: "secret",
      MOCK_BACKEND: "true",
      RUNTIME_MODE: "development",
      ALLOWED_ORIGINS: "http://127.0.0.1:4173",
      NEXTCLOUD_ROOT_PATH: ".davora-agent-test"
    });

    expect(config.NEXTCLOUD_ROOT_PATH).toBe(".davora-agent-test");
  });

  it("allows arbitrary public production hosts when the optional allowlist is empty", () => {
    const openConfig = loadConfig({ SESSION_SECRET: productionSecret, MOCK_BACKEND: "false" });
    expect(openConfig.MOCK_BACKEND).toBe(false);
    expect(openConfig.NEXTCLOUD_ALLOWED_HOSTS).toEqual([]);
    const config = loadConfig({ SESSION_SECRET: productionSecret, MOCK_BACKEND: "false", NEXTCLOUD_ALLOWED_HOSTS: "nextcloud.example.invalid" });
    expect(config.MOCK_BACKEND).toBe(false);
    expect(config.NEXTCLOUD_ALLOWED_HOSTS).toEqual(["nextcloud.example.invalid"]);
    expect(normalizeNextcloudBaseUrl("https://nextcloud.example.invalid", config.NEXTCLOUD_ALLOWED_HOSTS)).toBe("https://nextcloud.example.invalid");
    expect(normalizeNextcloudBaseUrl("https://cloud.example.net", [], true, "production", false, true)).toBe("https://cloud.example.net");
    expect(() => normalizeNextcloudBaseUrl("http://cloud.example.net", [], true, "production", false, true)).toThrow(/not allowed|HTTP/i);
    expect(() => normalizeNextcloudBaseUrl("https://127.0.0.1", [], true, "production", false, true)).toThrow(/not allowed/i);
  });

  it("allows localhost only with explicit development mode and gate", () => {
    expect(() => loadConfig({ SESSION_SECRET: "secret", MOCK_BACKEND: "false", RUNTIME_MODE: "development", ALLOW_LOCAL_NEXTCLOUD: "true" })).not.toThrow();
    expect(() => normalizeNextcloudBaseUrl("http://127.0.0.1:8787", [], true, "development", true)).not.toThrow();
    expect(() => loadConfig({ SESSION_SECRET: productionSecret, MOCK_BACKEND: "false", ALLOW_LOCAL_NEXTCLOUD: "true" })).toThrow(/development/i);
  });

  it("normalizes allowlisted nextcloud URLs", () => {
    expect(normalizeNextcloudBaseUrl("https://nextcloud.example.invalid/", ["nextcloud.example.invalid"])).toBe("https://nextcloud.example.invalid");
    expect(() => normalizeNextcloudBaseUrl("https://example.com", ["nextcloud.example.invalid"])).toThrow(/allowlisted/);
  });

  it("validates account inputs for in-app connection", () => {
    expect(validateNextcloudUsername(" demo-user ")).toBe("demo-user");
    expect(() => validateNextcloudUsername("bad/name")).toThrow(/invalid characters/i);
    expect(validateNextcloudAppPassword(" secret-app-password ")).toBe("secret-app-password");
    expect(() => validateNextcloudAppPassword("   ")).toThrow(/APP_PASSWORD/i);
    expect(normalizeAccountLabel("  Personal cloud  ")).toBe("Personal cloud");
  });

  it("reports config health including unlock requirements", () => {
    const health = configHealth({ SESSION_SECRET: "secret", MOCK_BACKEND: "false", RUNTIME_MODE: "development", NEXTCLOUD_ALLOWED_HOSTS: "nextcloud.example.invalid", APP_UNLOCK_CODE: "open-sesame" });
    expect(health.configLoaded).toBe(true);
    expect(health.backend).toBe("nextcloud");
    expect(health.unlockRequired).toBe(true);

    const openHealth = configHealth({ SESSION_SECRET: productionSecret, MOCK_BACKEND: "false" });
    expect(openHealth.configLoaded).toBe(true);
    expect(openHealth.backend).toBe("nextcloud");
  });

  it("requires a strong session secret in production but permits short development fixtures", () => {
    expect(() => validateSessionSecret("secret", "production")).toThrow(/32 bytes/i);
    expect(validateSessionSecret("secret", "development")).toBe("secret");
    expect(validateSessionSecret(productionSecret, "production")).toBe(productionSecret);
    expect(validateSessionTokenSecret(undefined, productionSecret, "production")).toBe(productionSecret);
    expect(validateSessionTokenSecret("abcdef0123456789abcdef0123456789", productionSecret, "production")).toBe("abcdef0123456789abcdef0123456789");
    expect(() => loadConfig({ SESSION_SECRET: "legacy-short-state-key", ACCOUNT_STATE_SECRET: productionSecret, SESSION_TOKEN_SECRET: productionSecret, MOCK_BACKEND: "true" })).not.toThrow();
    expect(() => loadConfig({ SESSION_SECRET: "legacy-short-state-key", SESSION_TOKEN_SECRET: productionSecret, MOCK_BACKEND: "true" })).toThrow(/32 bytes/i);
  });

  it("rejects production unlock codes while preserving development unlock flow", () => {
    expect(() => validateAppUnlockCode("open-sesame", "production")).toThrow(/APP_UNLOCK_CODE.*production/i);
    expect(validateAppUnlockCode(" open-sesame ", "development")).toBe("open-sesame");
    expect(() => loadConfig({ SESSION_SECRET: productionSecret, MOCK_BACKEND: "true", APP_UNLOCK_CODE: "open-sesame" })).toThrow(/APP_UNLOCK_CODE.*production/i);
  });

  it("reports secret and unlock policy failures through config health", () => {
    const health = configHealth({ SESSION_SECRET: "secret", MOCK_BACKEND: "true", APP_UNLOCK_CODE: "open-sesame" });
    expect(health.configLoaded).toBe(false);
    expect(health.unlockRequired).toBe(true);
    expect(health.policyError).toMatch(/32 bytes|APP_UNLOCK_CODE.*production/i);

    const unlockHealth = configHealth({ SESSION_SECRET: productionSecret, MOCK_BACKEND: "true", APP_UNLOCK_CODE: "open-sesame" });
    expect(unlockHealth.configLoaded).toBe(false);
    expect(unlockHealth.policyError).toMatch(/APP_UNLOCK_CODE.*production/i);
  });

  it("treats localhost and loopback origins as the same dev origin", () => {
    expect(originMatchesAllowedOrigin("http://localhost:4173", ["http://127.0.0.1:4173"])).toBe(true);
    expect(originMatchesAllowedOrigin("http://127.0.0.1:4173", ["http://localhost:4173"])).toBe(true);
    expect(originMatchesAllowedOrigin("http://localhost:4174", ["http://127.0.0.1:4173"])).toBe(false);
  });

  it("echoes the request localhost origin in CORS headers when loopback is allowed", () => {
    const headers = new Headers(corsHeaders("http://localhost:4173", ["http://127.0.0.1:4173"]));
    expect(headers.get("access-control-allow-origin")).toBe("http://localhost:4173");
  });
});
