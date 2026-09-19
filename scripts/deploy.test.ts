import { describe, expect, it } from "vitest";

import {
  assertRequiredWorkerSecrets,
  assertWorkerDestinationPolicy,
  buildWorkerSecretListArgs,
  DEFAULT_DEPLOYED_WORKER_ORIGIN,
  DEFAULT_PAGES_PROJECT_NAME,
  parseCommandJson,
  resolveWebDeployConfig
} from "./deploy";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("resolveWebDeployConfig", () => {
  it("reports malformed command JSON with command context", () => {
    expect(() => parseCommandJson("wrangler secret list --format json", "not-json"))
      .toThrow(/wrangler secret list --format json returned invalid JSON: Unexpected token/);
  });

  it("defaults the Pages build API origin when unset", () => {
    const config = resolveWebDeployConfig({});

    expect(config.apiBaseUrl).toBe(DEFAULT_DEPLOYED_WORKER_ORIGIN);
    expect(config.projectName).toBe(DEFAULT_PAGES_PROJECT_NAME);
    expect(config.wranglerArgs).toEqual([
      "pages",
      "deploy",
      "apps/web/dist",
      "--project-name",
      DEFAULT_PAGES_PROJECT_NAME
    ]);
    expect(config.usingDefaultProjectName).toBe(true);
  });

  it("preserves an explicit override and optional wrangler flags", () => {
    const config = resolveWebDeployConfig({
      VITE_API_BASE_URL: "https://example.com/api",
      CLOUDFLARE_PAGES_PROJECT_NAME: "davora-preview",
      CLOUDFLARE_PAGES_BRANCH: "preview",
      CLOUDFLARE_DEPLOY_COMMIT_HASH: "abc123",
      CLOUDFLARE_DEPLOY_COMMIT_MESSAGE: "deploy web",
      CLOUDFLARE_DEPLOY_COMMIT_DIRTY: "true",
      CLOUDFLARE_PAGES_SKIP_CACHING: "true",
      CLOUDFLARE_PAGES_NO_BUNDLE: "true",
      CLOUDFLARE_PAGES_UPLOAD_SOURCE_MAPS: "true"
    });

    expect(config.apiBaseUrl).toBe("https://example.com/api");
    expect(config.wranglerArgs).toEqual([
      "pages",
      "deploy",
      "apps/web/dist",
      "--project-name",
      "davora-preview",
      "--branch",
      "preview",
      "--commit-hash",
      "abc123",
      "--commit-message",
      "deploy web",
      "--commit-dirty",
      "--skip-caching",
      "--no-bundle",
      "--upload-source-maps"
    ]);
    expect(config.usingDefaultProjectName).toBe(false);
  });

  it("fails when a required worker secret is missing", () => {
    expect(() => assertRequiredWorkerSecrets([])).toThrowError(/Missing required Worker secret\(s\): SESSION_SECRET, ACCOUNT_STATE_SECRET, SESSION_TOKEN_SECRET/);
  });

  it("accepts deploy preflight when all production key roles are provisioned", () => {
    expect(() => assertRequiredWorkerSecrets([
      { name: "SESSION_SECRET", type: "secret_text" },
      { name: "ACCOUNT_STATE_SECRET", type: "secret_text" },
      { name: "SESSION_TOKEN_SECRET", type: "secret_text" }
    ])).not.toThrow();
  });

  it("allows the intentional public-host production default without an allowlist", () => {
    expect(() => assertWorkerDestinationPolicy({ MOCK_BACKEND: "false", RUNTIME_MODE: "production" }))
      .not.toThrow();
    expect(() => assertWorkerDestinationPolicy({ MOCK_BACKEND: "false", RUNTIME_MODE: "production", NEXTCLOUD_ALLOWED_HOSTS: "nextcloud.ownhost.top" }))
      .not.toThrow();
  });

  it("forwards deploy environment selectors into the secret-list preflight", () => {
    expect(buildWorkerSecretListArgs(["--env", "production", "--dry-run", "--name", "davora-prod"]))
      .toEqual(["secret", "list", "--format", "json", "--env", "production", "--name", "davora-prod"]);
    expect(buildWorkerSecretListArgs(["--env=preview", "--outdir", ".tmp/out"]))
      .toEqual(["secret", "list", "--format", "json", "--env=preview"]);
  });

  it("keeps the worker wrangler config aligned with durable account store binding and migration", () => {
    const wranglerToml = readFileSync(resolve(process.cwd(), "apps/worker/wrangler.toml"), "utf8");

    expect(wranglerToml).toMatch(/\[observability\.logs\][\s\S]*invocation_logs\s*=\s*false/);
    expect(wranglerToml).toMatch(/\[observability\.traces\][\s\S]*enabled\s*=\s*false/);
    expect(wranglerToml).toContain('name = "DAVORA_ACCOUNT_STORE"');
    expect(wranglerToml).toContain('class_name = "AccountStoreDurableObject"');
    expect(wranglerToml).toContain('new_sqlite_classes = ["AccountStoreDurableObject"]');
  });
});
