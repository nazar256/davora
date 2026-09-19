import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Executable ownership index for the behavior contract.
 *
 * This deliberately contains paths, not source hashes. A source hash can tell
 * us that a file changed, but it cannot tell us that a contract still has a
 * live test owner. The index is therefore checked against both the contract
 * IDs and the current filesystem on every web test run.
 */
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspaceRoot = resolve(webRoot, "../..");
const contractPath = resolve(workspaceRoot, "docs/BEHAVIOR_CONTRACT.md");
const rootAppTestPath = resolve(webRoot, "src/App.test.tsx");
const appIntegrationOwners = {
  "captures the real closed preview Stage binding with complete props and callback eligibility": "src/features/preview/workspace/AppPreviewMediaIntegration.test.tsx",
  "keeps captured cross-folder search archive roots after the query is cleared": "src/features/browsing/workspace/AppBrowsingCrossFeatureIntegration.test.tsx",
  "updates responsive shell surfaces after a post-mount viewport transition": "src/features/navigation/AppNavigationCrossFeatureIntegration.test.tsx",
  "confirms single-item delete without asking the user to type the target name": "src/features/operations/selection/workspace/AppOperationsCrossFeatureIntegration.test.tsx",
  "adds file and folder favourites from item actions and removes shortcuts without deleting files": "src/features/browsing/workspace/AppBrowsingCrossFeatureIntegration.test.tsx",
  "opens favourite folders and files from the mobile navigation drawer": "src/features/browsing/workspace/AppBrowsingCrossFeatureIntegration.test.tsx",
  "characterizes the current App navigation-drawer composition, key, inputs, and selection favourite parity": "src/features/navigation/AppNavigationCrossFeatureIntegration.test.tsx",
  "keeps no-account drawer absent and closes navigation exactly once before drawer actions": "src/features/navigation/AppNavigationCrossFeatureIntegration.test.tsx",
  "labels only files and complete folder roots that are available offline": "src/features/offline/workspace/AppOfflineCrossFeatureIntegration.test.tsx",
  "does not label metadata-only files or roots with an unreadable offline entry": "src/features/offline/workspace/AppOfflineCrossFeatureIntegration.test.tsx",
  "persists manual favourite reorder and marks missing favourites as unavailable": "src/features/browsing/workspace/AppBrowsingCrossFeatureIntegration.test.tsx",
  "keeps the app running when browser storage cannot save favourites": "src/features/browsing/workspace/AppBrowsingCrossFeatureIntegration.test.tsx",
  "retains an active offline sync beyond the terminal transfer history cap": "src/features/offline/workspace/AppOfflineCrossFeatureIntegration.test.tsx",
  "maps browser back to close an automatically opened transfer tray without leaving the folder": "src/features/offline/workspace/AppOfflineCrossFeatureIntegration.test.tsx",
  "derives operation surfaces from exact capabilities while preserving download-based offline retention": "src/features/operations/selection/workspace/AppOperationsCrossFeatureIntegration.test.tsx",
  "discards offline estimation that completes after the active account changes": "src/features/offline/workspace/AppOfflineCrossFeatureIntegration.test.tsx",
  "invalidates keep-offline confirmation on connectivity loss and rejects its detached callback": "src/features/offline/workspace/AppOfflineCrossFeatureIntegration.test.tsx",
  "opens account management from the main workspace and can switch accounts": "src/features/accounts/workspace/AppAccountCrossFeatureIntegration.test.tsx",
  "shows unlock guidance when APP_UNLOCK_CODE is required": "src/features/accounts/workspace/AppAccountCrossFeatureIntegration.test.tsx",
  "keeps a failed unlock secret out of status, errors, persistence, and console sinks": "src/features/accounts/workspace/AppAccountCrossFeatureIntegration.test.tsx",
  "keeps the mobile shell header minimal while moving account status into profile and settings": "src/features/navigation/AppNavigationCrossFeatureIntegration.test.tsx",
  "does not prefetch adjacent videos while keeping them available for explicit navigation": "src/features/preview/workspace/AppPreviewMediaIntegration.test.tsx",
  "adds gallery next controls for photos and ignores oversized blobs for browser cache storage": "src/features/preview/workspace/AppPreviewMediaIntegration.test.tsx",
  "opens audio with a streaming URL before the full file is retained in the background": "src/features/preview/workspace/AppPreviewMediaIntegration.test.tsx",
  "autoplays audio and video previews and pauses the previous media when switching": "src/features/preview/workspace/AppPreviewMediaIntegration.test.tsx",
  "navigates from audio preview back to the previous media item": "src/features/preview/workspace/AppPreviewMediaIntegration.test.tsx",
  "removes the persistent Davora app name from connected in-app chrome": "src/features/navigation/AppNavigationCrossFeatureIntegration.test.tsx",
  "closes settings and action dialogs when clicking outside": "src/features/navigation/AppNavigationCrossFeatureIntegration.test.tsx"
} as const;
const appIntegrationPaths = [...new Set(Object.values(appIntegrationOwners))];

const contractIds = [
  "ACC-01", "ACC-02", "ACC-03", "ACC-04", "ACC-05", "ACC-06",
  "WS-01", "SORT-01", "ACC-07", "ACC-08",
  "NAV-01", "NAV-02", "NAV-03", "NAV-04", "NAV-05",
  "BRW-01", "BRW-02", "BRW-03", "BRW-04", "BRW-05", "BRW-06", "BRW-07", "BRW-08", "BRW-09", "BRW-10", "BRW-11",
  "MUT-01", "MUT-02", "MUT-03", "MUT-04", "MUT-05", "MUT-06", "MUT-07", "MUT-08", "MUT-09", "MUT-10", "MUT-11", "MUT-12",
  "OFF-01", "OFF-02", "OFF-03", "OFF-04", "OFF-05", "OFF-06", "OFF-07",
  "PRV-01", "PRV-02", "PRV-03", "PRV-04", "PRV-05", "PRV-06",
  "UI-01", "UI-02", "UI-03", "UI-04", "UI-05", "UI-06", "UI-07", "UI-08", "UI-09",
  "SEC-01", "SEC-02", "SEC-03", "SEC-04", "SEC-05"
] as const;

type ContractId = (typeof contractIds)[number];
type EvidenceKind = "unit" | "integration" | "browser" | "visual" | "pwa";
type OwnerCitation = Readonly<{ readonly kind: EvidenceKind; readonly path: string; readonly title: string }>;

const owner = (kind: EvidenceKind, path: string, title: string): OwnerCitation => ({ kind, path, title });

const coverage: Record<ContractId, OwnerCitation> = {
  "ACC-01": owner("integration", "src/features/accounts/workspace/AppAccountBootstrapIntegration.test.tsx", "shows the first-run connect account flow"),
  "ACC-02": owner("integration", "src/features/accounts/actions/workspace/AppAccountRemovalIntegration.test.tsx", "keeps remote revoke failure visible and retryable in the removal dialog"),
  "ACC-03": owner("unit", "src/features/accounts/registry/security-remediation.test.ts", "does not let a deferred reconnect activate A after switching to B"),
  "ACC-04": owner("unit", "src/browser-contract.test.ts", "keeps raw WebDAV and backend credential surfaces out of browser source"),
  "ACC-05": owner("integration", "src/features/accounts/workspace/AppAccountBootstrapIntegration.test.tsx", "pauses automatic restore after a terminal session failure until the user retries manually"),
  "ACC-06": owner("integration", "src/features/accounts/workspace/AppAccountBootstrapIntegration.test.tsx", "uses the first operational account for bootstrap while settings keeps a pending management target"),
  "WS-01": owner("unit", "src/features/workspace/status/useWorkspaceStatus.test.tsx", "keeps commands stable and preserves same-turn last-writer order"),
  "SORT-01": owner("unit", "src/features/browsing/appBar/useAppBarSortPanel.test.tsx", "keeps the panel open when the settings callback throws"),
  "ACC-07": owner("unit", "../worker/tests/persisted-account-state-codec.test.ts", "rejects malformed envelopes and wrong secrets without exposing error details"),
  "ACC-08": owner("unit", "src/browser-ownership-account-transport.characterization.test.ts", "reads the latest committed pair for every request rather than caching authority"),
  "NAV-01": owner("unit", "src/features/navigation/useWorkspaceNavigation.test.ts", "syncs path and account to the URL through the port"),
  "NAV-02": owner("integration", "src/features/navigation/AppNavigationIntegration.test.tsx", "keeps browser Back wired to the current workflow after an App rerender"),
  "NAV-03": owner("integration", "src/features/navigation/AppNavigationIntegration.test.tsx", "maps browser back to close settings and mobile search surfaces first"),
  "NAV-04": owner("unit", "src/features/navigation/pullToRefresh/usePullToRefresh.test.tsx", "refreshes and clears after a full pull release"),
  "NAV-05": owner("unit", "src/features/navigation/useWorkspaceSurfaceCoordinator.test.ts", "combines all ten surfaces for pull-to-refresh reads"),
  "BRW-01": owner("unit", "src/features/browsing/workspace/AppBrowsingDisplayIntegration.test.tsx", "groups folders above files and sorts within each group by the active sort mode"),
  "BRW-02": owner("integration", "src/features/browsing/workspace/AppBrowsingDisplayIntegration.test.tsx", "uses breadcrumb home navigation without redundant all-files or up-level buttons"),
  "BRW-03": owner("unit", "src/features/browsing/favourites/useFavouriteActions.test.tsx", "exposes toggle, remove, reorder, and open through the favourites controller"),
  "BRW-04": owner("integration", "src/features/operations/selection/workspace/AppSelectionLifecycleIntegration.test.tsx", "uses a clear mobile actions and details sheet flow"),
  "BRW-05": owner("unit", "src/features/browsing/folder/useFolder.test.tsx", "suppresses previous folder items as soon as the complete key changes"),
  "BRW-06": owner("unit", "src/features/browsing/search/controller.test.ts", "loads live first, preserves order, then writes only accepted results"),
  "BRW-07": owner("unit", "src/features/operations/selection/useBatchSelection.test.tsx", "removes only still-current captured members"),
  "BRW-08": owner("unit", "src/features/operations/selection/focused.test.tsx", "tags immutable identity and preserves monotonic versions through clear and rebind"),
  "BRW-09": owner("integration", "src/features/operations/selection/workspace/AppSelectionLifecycleIntegration.test.tsx", "retains focused selection when search is replaced or cleared"),
  "BRW-10": owner("unit", "src/features/browsing/workspace/useBrowsingWorkspace.test.tsx", "characterizes the cross-producer precedence and ordering matrix"),
  "BRW-11": owner("unit", "src/features/browsing/favourites/useFavouriteReorderInteraction.test.tsx", "rebinds active listeners to a committed replacement environment"),
  "MUT-01": owner("integration", "src/features/operations/upload/AppUploadIntegration.test.tsx", "uploads a directory while preserving relative paths under the current folder"),
  "MUT-02": owner("unit", "src/features/operations/destination/planner.test.ts", "plans batch copies in source order and accounts for earlier planned conflicts"),
  "MUT-03": owner("unit", "src/features/operations/mutation/model.test.ts", "accepts exactly one ordered delete removal and rejects duplicate, reordered, substituted, and skipped progress"),
  "MUT-04": owner("integration", "src/features/operations/mutation/workspace/AppMutationCurrentnessIntegration.test.tsx", "makes a pending delete attempt inert after path navigation without closing its replacement"),
  "MUT-05": owner("unit", "../../packages/shared/tests/paths.test.ts", "rejects traversal and encoded separators"),
  "MUT-06": owner("unit", "src/features/operations/context/model.test.ts", "aborts when the operation context token changes"),
  "MUT-07": owner("unit", "src/features/operations/copyMove/useCopyMove.test.ts", "uses the latest owner for retained batch commands and snapshots ordered entries"),
  "MUT-08": owner("unit", "src/features/operations/delete/controller.test.ts", "executes deepest-first, accepts each success once, and refreshes once"),
  "MUT-09": owner("integration", "src/features/operations/mutation/workspace/AppMutationWorkflowIntegration.test.tsx", "uses one selection action surface for multi-item delete"),
  "MUT-10": owner("integration", "src/features/operations/mutation/workspace/AppMutationWorkflowIntegration.test.tsx", "makes an in-flight batch delete inert after account change without closing a replacement delete dialog"),
  "MUT-11": owner("integration", "src/features/operations/download/workspace/AppDownloadIntegration.test.tsx", "downloads a mixed file and folder batch as one zip archive"),
  "MUT-12": owner("integration", "src/features/operations/upload/AppUploadIntegration.test.tsx", "aborts an in-flight upload when its account, token, and capability owner is replaced"),
  "OFF-01": owner("unit", "src/features/browsing/cache/repository.test.ts", "uses collision-safe v2 keys and preserves the envelope format"),
  "OFF-02": owner("integration", "src/features/offline/mode/AppExplicitOfflineModeIntegration.test.tsx", "restores explicit offline mode without probes and exposes only readable offline files and ancestors"),
  "OFF-03": owner("unit", "src/features/offline/retention/controller.test.ts", "routes remove and normal-clear commands through typed ports"),
  "OFF-04": owner("unit", "src/features/accounts/registry/useAccountRegistry.test.tsx", "publishes committed snapshots and makes stale repair work inert"),
  "OFF-05": owner("integration", "src/features/offline/workspace/AppOfflineApplicationIntegration.test.tsx", "starts keep-offline sync as a background transfer and closes the confirmation dialog"),
  "OFF-06": owner("unit", "src/features/offline/connectivity/useBrowserConnectivity.test.tsx", "publishes transitions and ignores duplicate notifications"),
  "OFF-07": owner("integration", "src/features/offline/workspace/AppOfflineApplicationIntegration.test.tsx", "keeps a batch selection offline and removes offline copies from settings without server delete"),
  "PRV-01": owner("unit", "src/features/preview/media/model.test.ts", "detects streaming versus offline blob sources"),
  "PRV-02": owner("unit", "src/features/preview/image/geometry.test.ts", "calculates fill and fit content rectangles at an object position"),
  "PRV-03": owner("unit", "../worker/tests/http-router-context.test.ts", "rejects wrong methods and malformed data before dispatch"),
  "PRV-04": owner("integration", "src/features/preview/workspace/AppPreviewMediaIntegration.test.tsx", "autoplays audio and video previews and pauses the previous media when switching"),
  "PRV-05": owner("unit", "src/features/preview/session/usePreviewSession.test.tsx", "releases blob resources exactly once and keeps stream URLs non-revocable"),
  "PRV-06": owner("integration", "src/features/preview/session/AppPreviewSessionIntegration.test.tsx", "releases an applied preview Blob exactly once when App unmounts"),
  "UI-01": owner("pwa", "tests/pwa.spec.ts", "manifest metadata and Chrome installability checks pass outside incognito blockers"),
  "UI-02": owner("unit", "src/features/settings/theme/themeStartupOwnership.characterization.test.ts", "proves pure policy parity between bootstrap and the Settings theme model"),
  "UI-03": owner("visual", "tests/responsive-layout.spec.ts", "PER-74 responsive visual QA keeps core browser controls within representative viewports"),
  "UI-04": owner("integration", "src/app/AppShell.test.tsx", "preserves pull indicator ARIA, copy precedence, and shell touch handlers"),
  "UI-05": owner("unit", "src/app/AppShell.test.tsx", "preserves workspace DOM classes, stage order, toggle intent, and file-list ref"),
  "UI-06": owner("integration", "src/features/settings/workspace/AppSettingsIntegration.test.tsx", "persists System, Light, and Dark appearance modes and applies the selected theme"),
  "UI-07": owner("unit", "src/features/navigation/viewport/useResponsiveViewport.test.tsx", "publishes transitions while keeping duplicate snapshots referentially stable"),
  "UI-08": owner("unit", "src/features/pwa/workspace/usePwaWorkspace.test.tsx", "projects only install and reload presentation bindings"),
  "UI-09": owner("unit", "src/features/navigation/pullToRefresh/usePullToRefresh.test.tsx", "refreshes and clears after a full pull release"),
  "SEC-01": owner("unit", "../worker/tests/app.test.ts", "connects an account, creates a bound session, and lists files in mock mode"),
  "SEC-02": owner("unit", "../../packages/shared/tests/paths.test.ts", "rejects traversal and encoded separators"),
  "SEC-03": owner("unit", "../worker/tests/nextcloud-destination-policy.test.ts", "guards every NextcloudClient request immediately before fetch"),
  "SEC-04": owner("unit", "../worker/tests/http-failure.test.ts", "maps every closed failure to a redacted public envelope"),
  "SEC-05": owner("unit", "../../packages/shared/tests/health-contract.test.ts", "accepts the exact configured and incomplete health wire shapes")
};

function expandContractIds(source: string): string[] {
  const ids = new Set<string>();
  for (const line of source.split(/\r?\n/u)) {
    const firstCell = line.match(/^\|\s*([^|]+)\|/u)?.[1] ?? "";
    for (const range of firstCell.match(/[A-Z]+-\d+(?:\.\.[A-Z]+-\d+)?/gu) ?? []) {
      const [start, end = start] = range.split("..");
      const [, startNumber] = start.split("-");
      const [prefix, endNumber] = end.split("-");
      for (let number = Number(startNumber); number <= Number(endNumber); number += 1) {
        ids.add(`${prefix}-${String(number).padStart(2, "0")}`);
      }
    }
  }
  return [...ids];
}

function executableTitleCount(source: string, title: string): number {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return source.match(new RegExp(`^\\s*(?:it|test)\\(\\s*["']${escapedTitle}["']\\s*,`, "gmu"))?.length ?? 0;
}

describe("behavior-contract executable authority", () => {
  it("enumerates every unique contract ID and gives it a live owner citation", () => {
    const contractSource = readFileSync(contractPath, "utf8");
    expect(expandContractIds(contractSource)).toEqual([...contractIds]);
    expect(Object.keys(coverage).sort()).toEqual([...contractIds].sort());

    for (const id of contractIds) {
      const citation = coverage[id];
      expect(citation.path, `${id} citation must be a source/test path`).toMatch(/(?:\.test\.(?:ts|tsx)|\.spec\.ts)$/u);
      expect(citation.path, `${id} citation must be a live source path`).not.toMatch(/(?:sha256|hash|\.tmp)/iu);
      const citationPath = resolve(webRoot, citation.path);
      expect(existsSync(citationPath), `${id} stale citation: ${citation.path}`).toBe(true);
      const source = readFileSync(citationPath, "utf8");
      expect(source, `${id} non-executable citation: ${citation.path}`).toMatch(/\b(?:it|test)\s*\(/u);
      expect(executableTitleCount(source, citation.title), `${id} exact title/path ownership: ${citation.path} :: ${citation.title}`).toBe(1);
    }
  });

  it("does not accept historical-only or duplicate contract ownership", () => {
    const allIds = Object.keys(coverage);
    expect(new Set(allIds).size).toBe(allIds.length);
    const identities = Object.entries(coverage).map(([id, citation]) => `${id}:${citation.kind}:${citation.path}:${citation.title}`);
    expect(new Set(identities).size).toBe(identities.length);
    for (const [id, citation] of Object.entries(coverage)) {
      expect(citation.path, `${id} historical-only owner`).not.toMatch(/(?:sha256|hash|\.tmp)/iu);
      expect(citation.title, `${id} executable title`).not.toHaveLength(0);
    }
  });

  it("keeps App test ownership in cohesive feature suites and within budget", () => {
    const rootSource = readFileSync(rootAppTestPath, "utf8");
    expect(rootSource.split(/\r?\n/u).length).toBeLessThanOrEqual(500);
    expect(rootSource).not.toMatch(/from\s+["']\.\/features\//u);

    const integrationSources = new Map(appIntegrationPaths.map((path) => [path, readFileSync(resolve(webRoot, path), "utf8")]));
    expect(integrationSources.size).toBe(6);
    for (const [path, source] of integrationSources) {
      expect(source.split(/\r?\n/u).length, `${path} concentration budget`).toBeLessThanOrEqual(500);
    }

    for (const [title, expectedPath] of Object.entries(appIntegrationOwners)) {
      const declaration = `it("${title}"`;
      expect(rootSource.split(declaration).length - 1, `${title} root ownership`).toBe(0);
      const owners = [...integrationSources.entries()]
        .filter(([, source]) => source.split(declaration).length - 1 > 0)
        .map(([path]) => path);
      expect(owners, `${title} feature ownership`).toEqual([expectedPath]);
      const expectedSource = integrationSources.get(expectedPath);
      expect(expectedSource, `${title} expected owner source`).toBeDefined();
      if (!expectedSource) throw new Error(`Missing expected owner source for ${title}`);
      expect(expectedSource.split(declaration).length - 1, `${title} duplicate ownership`).toBe(1);
    }
  });

  it("keeps each migrated App behavior test in the declared owner suite", () => {
    const allTitles = Object.keys(appIntegrationOwners);
    expect(allTitles).toHaveLength(28);
    expect(new Set(allTitles).size).toBe(allTitles.length);
    expect(appIntegrationPaths.every((path) => path.includes("/features/"))).toBe(true);
  });
});
