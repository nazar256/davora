import { describe, expect, it } from "vitest";

import {
  assertRequiredWorkerSecrets,
  buildWorkerSecretListArgs,
  DEFAULT_DEPLOYED_WORKER_ORIGIN,
  DEFAULT_PAGES_PROJECT_NAME,
  resolveWebDeployConfig
} from "./deploy";

describe("resolveWebDeployConfig", () => {
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
    expect(() => assertRequiredWorkerSecrets([])).toThrowError(/Missing required Worker secret\(s\): SESSION_SECRET/);
  });

  it("accepts deploy preflight when SESSION_SECRET is provisioned", () => {
    expect(() => assertRequiredWorkerSecrets([{ name: "SESSION_SECRET", type: "secret_text" }])).not.toThrow();
  });

  it("forwards deploy environment selectors into the secret-list preflight", () => {
    expect(buildWorkerSecretListArgs(["--env", "production", "--dry-run", "--name", "davora-prod"]))
      .toEqual(["secret", "list", "--format", "json", "--env", "production", "--name", "davora-prod"]);
    expect(buildWorkerSecretListArgs(["--env=preview", "--outdir", ".tmp/out"]))
      .toEqual(["secret", "list", "--format", "json", "--env=preview"]);
  });
});
