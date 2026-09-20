import { describe, expect, it } from "vitest";

import {
  assertRequiredWorkerSecrets,
  assertWorkerDestinationPolicy,
  buildWorkerSecretListArgs,
  DEFAULT_DEPLOYED_WORKER_ORIGIN,
  DEFAULT_PAGES_BRANCH,
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

  it("defaults the Pages build API origin and pins the production branch when unset", () => {
    const config = resolveWebDeployConfig({}, () => ({}));

    expect(config.apiBaseUrl).toBe(DEFAULT_DEPLOYED_WORKER_ORIGIN);
    expect(config.projectName).toBe(DEFAULT_PAGES_PROJECT_NAME);
    expect(config.branch).toBe(DEFAULT_PAGES_BRANCH);
    expect(config.wranglerArgs).toEqual([
      "pages",
      "deploy",
      "apps/web/dist",
      "--project-name",
      DEFAULT_PAGES_PROJECT_NAME,
      "--branch",
      DEFAULT_PAGES_BRANCH
    ]);
    expect(config.usingDefaultProjectName).toBe(true);
    expect(config.usingDefaultBranch).toBe(true);
  });

  it("derives deploy provenance from git when env overrides are absent", () => {
    const config = resolveWebDeployConfig({}, () => ({
      commitHash: "abc123def",
      commitMessage: "deploy from test",
      dirty: true
    }));

    expect(config.wranglerArgs).toContain("--commit-hash");
    expect(config.wranglerArgs).toContain("abc123def");
    expect(config.wranglerArgs).toContain("--commit-message");
    expect(config.wranglerArgs).toContain("deploy from test");
    expect(config.wranglerArgs).toContain("--commit-dirty");
  });

  it("omits provenance flags when git metadata is unavailable and the tree is clean", () => {
    const config = resolveWebDeployConfig({}, () => ({}));
    expect(config.wranglerArgs).not.toContain("--commit-hash");
    expect(config.wranglerArgs).not.toContain("--commit-dirty");

    const clean = resolveWebDeployConfig({}, () => ({ commitHash: "abc123", commitMessage: "msg", dirty: false }));
    expect(clean.wranglerArgs).not.toContain("--commit-dirty");
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
    expect(config.branch).toBe("preview");
    expect(config.usingDefaultBranch).toBe(false);
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
    expect(() => assertWorkerDestinationPolicy({ MOCK_BACKEND: "false", RUNTIME_MODE: "production", NEXTCLOUD_ALLOWED_HOSTS: "nextcloud.example.invalid" }))
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
