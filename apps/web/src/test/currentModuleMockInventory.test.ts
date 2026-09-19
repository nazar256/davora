import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface MockRule {
  readonly id: string;
  readonly owner: string;
  readonly removalCondition: string;
  readonly testPath: RegExp;
  readonly module: RegExp;
}

interface MockCallsite {
  readonly testPath: string;
  readonly module: string;
}

const mockRules: readonly MockRule[] = [
  {
    id: "virtual-pwa-registration",
    owner: "PWA platform adapter",
    removalCondition: "Remove when the Vite virtual registration module has an official deterministic browser-independent test adapter.",
    testPath: /^src\/.+\.test\.tsx?$/,
    module: /^virtual:pwa-register\/react$/
  },
  {
    id: "idb-keyval-browser-adapter",
    owner: "opened-file repository adapter",
    removalCondition: "Remove when idb-keyval provides transaction-failure injection or the repository gains a production-motivated storage port.",
    testPath: /^src\/platform\/storage\/openedFileRepository\.test\.ts$/,
    module: /^idb-keyval$/
  },
  {
    id: "app-declarative-projection",
    owner: "app composition",
    removalCondition: "Remove a callsite when that declarative shell or projection test can consume an already-projected public stage without mounting feature owners.",
    testPath: /^src\/app\/(?:AppShell|useAppWorkspacePresentation)\.test\.tsx$/,
    module: /^(?:\.\/projectAppShellComposition|\.\.\/features\/(?:accounts|browsing|offline\/sync|operations|preview\/(?:folderAudio|shell)|pwa|settings)|\.\.\/components\/StateBanner)$/
  },
  {
    id: "platform-hook-composition",
    owner: "PWA application/platform composition",
    removalCondition: "Remove when the hook composition is replaced by a pure production projector; do not add hook factories solely for tests.",
    testPath: /^src\/(?:platform\/pwa\/useBrowserPwaRuntimePorts|features\/pwa\/workspace\/usePwaWorkspace)\.test\.tsx$/,
    module: /^(?:\.\/browserPwaPorts|\.\/useBrowserPwaRegistration|\.\.\/usePwaPromptState)$/
  },
  {
    id: "workspace-child-composition",
    owner: "feature application-workspace composition",
    removalCondition: "Remove each callsite when the child composition becomes a pure projector or an existing production requirement introduces a typed composition constructor; low-level runtime ports are not hook factories.",
    testPath: /^src\/features\/(?:browsing\/workspace\/useBrowsingApplicationWorkspace|operations\/(?:workspace\/useOperationsApplicationWorkspace|mutation\/workspace\/useMutationWorkspace|upload\/useUploadInteraction|download\/workspace\/useDownloadWorkspace)|preview\/workspace\/usePreviewWorkspace)\.test\.tsx$/,
    module: /^(?:\.\/useBrowsingWorkspace|\.\/useFolderLoadCoordination|\.\/useOperationAuthorityWorkspace|\.\.\/selection|\.\/index|\.\.\/useMutationWorkflowLifecycle|\.\.\/\.\.\/destination|\.\.\/useMutationWorkflow|\.\.\/\.\.\/delete|\.\.\/\.\.\/copyMove|\.\/orchestration|\.\.\/useDownload|\.\.\/session|\.\.\/open|\.\.\/folderAudio)$/
  },
  {
    id: "app-integration-shell-observer",
    owner: "cross-feature integration harness",
    removalCondition: "Remove when the asserted AppShell observation is available through a public typed projection without replacing the rendered shell.",
    testPath: /^src\/features\/.+Integration\.test\.tsx$/,
    module: /^(?:\.\.\/)+app\/AppShell$/
  },
  {
    id: "viewer-render-boundary",
    owner: "preview and navigation view integration",
    removalCondition: "Remove when the real heavy renderer can run deterministically in jsdom or a production renderer port already exists; do not add a test-only renderer port.",
    testPath: /^src\/(?:features\/(?:navigation\/AppNavigationIntegration|preview\/(?:image\/AppImagePreviewIntegration|shell\/PreviewModalStage))|features\/preview\/shell\/PreviewModalStage)\.test\.tsx$/,
    module: /^(?:\.\.\/\.\.\/components\/MarkdownPreview|\.\.\/\.\.\/lib\/heicPreview|\.\.\/\.\.\/\.\.\/lib\/heicPreview|\.\.\/image|\.\.\/pdf|\.\.\/video|\.\.\/\.\.\/\.\.\/components\/MarkdownPreview)$/
  }
] as const;

function collectTestFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(path));
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function collectMockCallsites(): MockCallsite[] {
  const root = resolve(process.cwd(), "src");
  const callsites: MockCallsite[] = [];
  for (const file of collectTestFiles(root)) {
    const source = readFileSync(file, "utf8");
    const expression = /vi\.mock\(\s*["']([^"']+)["']/g;
    for (const match of source.matchAll(expression)) {
      callsites.push({
        testPath: relative(process.cwd(), file),
        module: match[1]
      });
    }
  }
  return callsites.sort((left, right) => `${left.testPath}:${left.module}`.localeCompare(`${right.testPath}:${right.module}`));
}

describe("current module-mock exception inventory", () => {
  it("classifies every live module mock under exactly one owned exception with a removal condition", () => {
    const callsites = collectMockCallsites();
    expect(callsites.length).toBeGreaterThan(0);

    for (const callsite of callsites) {
      const matches = mockRules.filter((rule) => rule.testPath.test(callsite.testPath) && rule.module.test(callsite.module));
      expect(matches, `unclassified or ambiguous module mock ${callsite.testPath} -> ${callsite.module}`).toHaveLength(1);
      expect(matches[0].owner.trim().length).toBeGreaterThan(5);
      expect(matches[0].removalCondition.trim().length).toBeGreaterThan(30);
    }
  });

  it("keeps every exception rule live and forbids retired service-level module mocks", () => {
    const callsites = collectMockCallsites();
    for (const rule of mockRules) {
      expect(
        callsites.some((callsite) => rule.testPath.test(callsite.testPath) && rule.module.test(callsite.module)),
        `stale mock exception rule ${rule.id}`
      ).toBe(true);
    }

    const forbiddenServiceMocks = callsites.filter((callsite) => /(?:lib\/api|createBrowserAppServices|openedFileRepository)$/.test(callsite.module));
    expect(forbiddenServiceMocks).toEqual([]);
  });
});
