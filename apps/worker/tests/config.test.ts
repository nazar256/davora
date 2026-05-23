import { describe, expect, it } from "vitest";

import {
  configHealth,
  loadConfig,
  normalizeAccountLabel,
  normalizeNextcloudBaseUrl,
  validateNextcloudAppPassword,
  validateNextcloudUsername
} from "../src/config";
import { corsHeaders, originMatchesAllowedOrigin } from "../src/security/http";

describe("worker config", () => {
  it("loads mock backend with minimal settings", () => {
    const config = loadConfig({
      SESSION_SECRET: "secret",
      MOCK_BACKEND: "true",
      ALLOWED_ORIGINS: "http://127.0.0.1:4173"
    });

    expect(config.MOCK_BACKEND).toBe(true);
    expect(config.NEXTCLOUD_ROOT_PATH).toBe(".davora-agent-test");
  });

  it("allows non-mock mode without a host allowlist by default", () => {
    const config = loadConfig({ SESSION_SECRET: "secret", MOCK_BACKEND: "false" });
    expect(config.MOCK_BACKEND).toBe(false);
    expect(config.NEXTCLOUD_ALLOWED_HOSTS).toEqual([]);
    expect(normalizeNextcloudBaseUrl("https://cloud.example.com", config.NEXTCLOUD_ALLOWED_HOSTS)).toBe("https://cloud.example.com");
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
    const health = configHealth({ SESSION_SECRET: "secret", MOCK_BACKEND: "false", APP_UNLOCK_CODE: "open-sesame" });
    expect(health.configLoaded).toBe(true);
    expect(health.backend).toBe("nextcloud");
    expect(health.unlockRequired).toBe(true);
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
