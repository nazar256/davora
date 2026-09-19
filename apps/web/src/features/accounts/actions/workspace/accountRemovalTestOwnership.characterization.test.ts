import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workspaceDir = dirname(fileURLToPath(import.meta.url));
const appTestPath = resolve(workspaceDir, "../../../../App.test.tsx");
const featureTestPath = resolve(workspaceDir, "AppAccountRemovalIntegration.test.tsx");

const selectedTitles = [
  "clears account-scoped favourites when the account is removed",
  "purges only the removed account namespace while retaining another account cache",
  "keeps Beta active and preserves Beta browser state while Alpha removal is pending",
  "keeps remote revoke failure visible and retryable in the removal dialog",
  "closes a reloaded remove dialog after the retry completes remote revoke",
  "keeps a reloaded revoke-pending account out of session restore and exposes retry removal",
  "exposes a reloaded purge-pending account as browser-cleanup retry",
  "closes settings before opening remove and Back dismisses only the remove surface",
  "retains pending removal when favourite storage cleanup fails and retries the exact key",
  "retries local-only removal cleanup without repeating remote deletion",
  "redacts token-shaped remote removal failures from UI and browser state"
] as const;

function readIfPresent(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function titleCount(source: string, title: string): number {
  const escaped = title.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  return source.match(new RegExp(`(?:it|test)\\(\\s*[\"']${escaped}[\"']`, "g"))?.length ?? 0;
}

describe("account-removal App integration test ownership characterization", () => {
  it("requires each selected contract exactly once in the feature suite and nowhere in App.test.tsx", () => {
    const app = readIfPresent(appTestPath);
    const feature = readIfPresent(featureTestPath);
    for (const title of selectedTitles) {
      expect(titleCount(feature, title), `feature title count: ${title}`).toBe(1);
      expect(titleCount(app, title), `App.test.tsx title residue: ${title}`).toBe(0);
    }
  });

  it("requires the feature suite to render App through an injected AppServices bundle", () => {
    const feature = readIfPresent(featureTestPath);
    expect(feature, "feature suite must import the structural AppServices contract").toMatch(/AppServices/);
    expect(feature, "feature suite must pass services to App").toMatch(/<App\b[^>]*\bservices\s*=/s);
  });

  it("rejects broad API and browser-service module mocks in the feature suite", () => {
    const feature = readIfPresent(featureTestPath);
    const broadMock = /vi\.mock\(\s*["'][^"']*(?:lib\/api|app\/createBrowserAppServices)[^"']*["']/;
    expect(feature).not.toMatch(broadMock);
  });
});
