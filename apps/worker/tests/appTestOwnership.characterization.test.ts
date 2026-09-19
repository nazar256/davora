import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workerSource = resolve(testDirectory, "../src");
const suites = {
  root: resolve(testDirectory, "app.test.ts"),
  bootstrap: resolve(testDirectory, "bootstrap/worker-bootstrap.application.test.ts"),
  accounts: resolve(testDirectory, "accounts/account-application.integration.test.ts"),
  files: resolve(testDirectory, "files/file-application.integration.test.ts"),
  nextcloud: resolve(testDirectory, "nextcloud/nextcloud-sandbox.integration.test.ts")
} as const;

function source(path: string): string {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function testTitles(contents: string): string[] {
  return [...contents.matchAll(/\bit\s*\(\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]);
}

describe("Worker app-test ownership characterization", () => {
  it("keeps one root smoke owner and four explicit vertical application suites", () => {
    const entries = Object.entries(suites).map(([owner, path]) => ({ owner, titles: testTitles(source(path)) }));
    expect(entries.find(({ owner }) => owner === "root")?.titles).toHaveLength(1);
    for (const entry of entries.filter(({ owner }) => owner !== "root")) {
      expect(entry.titles.length, `${entry.owner} suite must own behavior`).toBeGreaterThan(0);
    }
    const titles = entries.flatMap(({ titles: ownedTitles }) => ownedTitles);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("keeps test policy modifiers, retries, and fake clocks out of application owners", () => {
    for (const [owner, path] of Object.entries(suites)) {
      const contents = source(path);
      expect(contents, owner).not.toMatch(/\b(?:it|test|describe)\.(?:only|skip|todo|fails)\s*\(/);
      expect(contents, owner).not.toMatch(/\b(?:retry|retries|testTimeout|hookTimeout)\s*:/);
      expect(contents, owner).not.toMatch(/\bvi\.useFakeTimers\s*\(/);
    }
  });

  it("keeps the Worker support surface explicit and bounded", () => {
    const supportDirectory = resolve(testDirectory, "support");
    expect(readdirSync(supportDirectory).sort()).toEqual([
      "durableAccountStoreHarness.ts",
      "workerApplicationHarness.ts"
    ]);
    const harness = source(resolve(supportDirectory, "workerApplicationHarness.ts"));
    expect(harness).toContain("MemoryAccountStateStorage");
    expect(harness).toContain("createProjectTempDir");
    expect(harness).not.toMatch(/\b(?:setInterval|setTimeout)\s*\(/);
  });

  it("keeps app composition on the single bootstrap and HTTP application path", () => {
    const app = source(resolve(workerSource, "app.ts"));
    expect(app).toContain("prepareWorkerRequest");
    expect(app).toContain("handleWorkerApplication");
    expect(app).toContain("createAccountServiceForEnvironment");
    for (const retiredOwner of [
      "accounts/store",
      "accountSessionRoute",
      "handleAccountSessionRequest",
      "authorizedFileIngress",
      "authorizedFileRoute",
      "handleAuthorizedFileRequest"
    ]) {
      expect(app).not.toContain(retiredOwner);
    }
  });

  it("keeps each application behavior title under exactly one owner", () => {
    const titleOwners = new Map<string, string>();
    for (const [owner, path] of Object.entries(suites)) {
      for (const title of testTitles(source(path))) {
        expect(titleOwners.has(title), `${title} already belongs to ${titleOwners.get(title)}`).toBe(false);
        titleOwners.set(title, owner);
      }
    }
    expect(titleOwners.size).toBeGreaterThan(30);
  });
});
