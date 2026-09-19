import { describe, expect, it, vi } from "vitest";

import type { AppShellCommonBindings } from "./AppShell";
import {
  projectAppShellComposition,
  type AppShellCompositionInput
} from "./projectAppShellComposition";
import type { SettingsPreferencesWorkspaceCommands } from "../features/settings/workspace/ports";
import { DEFAULT_UI_SETTINGS } from "../features/settings/model";
import { buildAccount } from "../test/accounts";

function leaf<T>(label: string): T {
  // Each opaque leaf is intentionally distinct so a projection wiring error is observable.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return Object.freeze({ label }) as T;
}

function settingsCommands(): SettingsPreferencesWorkspaceCommands {
  return {
    handleFileSizeDisplayModeChange: vi.fn(),
    handleThemeModeChange: vi.fn(),
    handleMaxCacheableFileSizeChange: vi.fn(),
    handleImagePreviewFitModeChange: vi.fn(),
    handlePreviewFreshnessIntervalChange: vi.fn(),
    handleKeepAwakeEnabledChange: vi.fn(),
    handleShowHiddenFilesChange: vi.fn(),
    handleExperimentalHeicPreviewEnabledChange: vi.fn(),
    handleExperimentalFolderAppShortcutsEnabledChange: vi.fn(),
    handleDiagnosticsEnabledChange: vi.fn(),

    handleSortModeChange: vi.fn()
  };
}

function compositionInput(
  gate: AppShellCompositionInput["bootstrap"]["gate"]["kind"] = "continue",
  options: { browserOffline?: boolean; explicitOfflineMode?: boolean; narrow?: boolean; showDetailsRail?: boolean } = {}
): {
  input: AppShellCompositionInput;
  closeChrome: ReturnType<typeof vi.fn>;
  toggleCalls: Array<{ browserOffline: boolean; workerUnavailable: boolean }>;
  offlineToggle: ReturnType<AppShellCompositionInput["status"]["shellToggle"]>;
} {
  const browserOffline = options.browserOffline ?? false;
  const explicitOfflineMode = options.explicitOfflineMode ?? false;
  const closeChrome = vi.fn<(surface: "settings") => void>();
  const toggleCalls: Array<{ browserOffline: boolean; workerUnavailable: boolean }> = [];
  const offlineToggle = leaf<ReturnType<AppShellCompositionInput["status"]["shellToggle"]>>("offline-toggle");
  const shellToggle: AppShellCompositionInput["status"]["shellToggle"] = (value) => {
    toggleCalls.push(value);
    return offlineToggle;
  };
  const account = buildAccount("alpha", { displayName: "Alpha" });
  const commands = settingsCommands();
  const accountCommands = {
    switchActive: vi.fn(),
    openAddFromSettings: vi.fn(),
    openReconnectFromSettings: vi.fn(),
    openRemoveFromSettings: vi.fn()
  };
  const settings = {
    preferences: { ...DEFAULT_UI_SETTINGS, showHiddenFiles: true },
    commands,
    open: true,
    isNarrowScreen: options.narrow ?? false,
    closeChrome,
    accounts: {
      accounts: [account],
      activeAccount: account,
      managementActiveAccount: account,
      pendingRemovalAccounts: [],
      activeAccountId: account.id,
      connectedAccountCount: 1,
      commands: accountCommands
    },
    cache: {
      summary: { itemCount: 1, totalBytes: 10, limitBytes: 100 },
      offlineItems: [],
      onClearCache: vi.fn(),
      onRemoveOfflineItem: vi.fn(),
      onOpenedFileCacheLimitChange: vi.fn()
    },
    diagnostics: {
      storageSummary: "2 sessions",
      onOpenReport: vi.fn(),
      onClearData: vi.fn()
    },
    runtime: {
      appBuildLabel: "build-test",
      offline: browserOffline,
      explicitOfflineMode,
      keepAwakeState: "active" as const
    }
  };
  const input: AppShellCompositionInput = {
    showDetailsRail: options.showDetailsRail ?? true,
    common: {
      reloadPrompt: leaf<AppShellCommonBindings["reloadPrompt"]>("reload-prompt"),
      appBar: leaf<AppShellCommonBindings["appBar"]>("app-bar"),
      navigationDrawer: {
        key: "alpha",
        props: leaf<NonNullable<AppShellCommonBindings["navigationDrawer"]>["props"]>("navigation-drawer")
      },
      removeAccount: leaf<AppShellCommonBindings["removeAccount"]>("remove-account")
    },
    reportBug: leaf<AppShellCompositionInput["reportBug"]>("report-bug"),
    workspace: {
      pullToRefresh: leaf("pull-to-refresh"),
      browsePanelClassName: "browse-panel-with-audio",
      browseHeader: leaf("browse-header"),
      folderAudio: leaf("folder-audio"),
      fileList: leaf("file-list"),
      selectionDetails: leaf("selection-details"),
      quickActions: leaf("quick-actions")
    },
    settings,
    bootstrap: {
      registryNotice: "registry-notice",
      accountBootstrapError: "account-bootstrap-error",
      connectStage: leaf("connect-stage"),
      gate: { kind: gate },
      restoreStage: leaf("restore-stage"),
      unlockStage: leaf("unlock-stage")
    },
    status: {
      banner: leaf("banner"),
      browserOffline,
      workerUnavailable: true,
      shellToggle
    },
    overlays: {
      folderShortcut: leaf("folder-shortcut"),
      offlineSync: leaf("offline-sync"),
      connectAccount: leaf("connect-account"),
      mutation: leaf("mutation"),
      preview: leaf("preview")
    }
  };
  return { input, closeChrome, toggleCalls, offlineToggle };
}

describe("projectAppShellComposition", () => {
  it.each([true, false])("projects the continue branch with exact leaf identities and shared settings (%s)", (showDetailsRail) => {
    const { input, toggleCalls, offlineToggle } = compositionInput("continue", { showDetailsRail });
    const projected = projectAppShellComposition(input);

    expect(projected.kind).toBe("workspace");
    if (projected.kind !== "workspace") throw new Error("Expected workspace projection.");
    expect(projected.workspace.className).toBe(showDetailsRail ? "workspace-layout" : "workspace-layout workspace-layout-full");
    expect(projected.workspace.pullToRefresh).toBe(input.workspace.pullToRefresh);
    expect(projected.workspace.browseHeader).toBe(input.workspace.browseHeader);
    expect(projected.workspace.folderAudio).toBe(input.workspace.folderAudio);
    expect(projected.workspace.fileList).toBe(input.workspace.fileList);
    expect(projected.workspace.selectionDetails).toBe(input.workspace.selectionDetails);
    expect(projected.workspace.quickActions).toBe(input.workspace.quickActions);
    expect(projected.common.reloadPrompt).toBe(input.common.reloadPrompt);
    expect(projected.common.appBar).toBe(input.common.appBar);
    expect(projected.common.navigationDrawer).toBe(input.common.navigationDrawer);
    expect(projected.common.removeAccount).toBe(input.common.removeAccount);
    expect(projected.status.banner).toBe(input.status.banner);
    expect(projected.status.offlineToggle).toBe(offlineToggle);
    expect(projected.common.settings).toBe(projected.overlays.settings);
    expect(projected.workspace.browsePanelClassName).toBe(input.workspace.browsePanelClassName);
    expect(projected.overlays.offlineSync).toBe(input.overlays.offlineSync);
    expect(projected.overlays.connectAccount).toBe(input.overlays.connectAccount);
    expect(projected.overlays.mutation).toBe(input.overlays.mutation);
    expect(projected.overlays.preview).toBe(input.overlays.preview);
    expect(toggleCalls).toEqual([{ browserOffline: false, workerUnavailable: true }]);
  });

  it.each([
    { narrow: true, expectedLabel: "Done" },
    { narrow: false, expectedLabel: "Close" }
  ])("preserves settings close policy and callbacks ($expectedLabel)", ({ narrow, expectedLabel }) => {
    const { input, closeChrome } = compositionInput("continue", { narrow });
    const projected = projectAppShellComposition(input);
    if (projected.kind !== "workspace") throw new Error("Expected workspace projection.");

    expect(projected.overlays.settings.closeActionLabel).toBe(expectedLabel);
    projected.overlays.settings.onClose();
    projected.overlays.settings.onDismissFromScrim?.();
    expect(closeChrome).toHaveBeenNthCalledWith(1, "settings");
    expect(closeChrome).toHaveBeenNthCalledWith(2, "settings");
    expect(projected.overlays.settings.onActiveAccountChange).toBe(input.settings.accounts.commands.switchActive);
    expect(projected.overlays.settings.onClearCache).toBe(input.settings.cache.onClearCache);
    expect(projected.overlays.settings.onThemeModeChange).toBe(input.settings.commands.handleThemeModeChange);
  });

  it("distinguishes browser-offline from explicit-offline action policy", () => {
    const browserOffline = projectAppShellComposition(compositionInput("continue", { browserOffline: true }).input);
    const explicitOffline = projectAppShellComposition(compositionInput("continue", { explicitOfflineMode: true }).input);
    if (browserOffline.kind !== "workspace" || explicitOffline.kind !== "workspace") throw new Error("Expected workspace projections.");
    expect(browserOffline.overlays.settings.offline).toBe(true);
    expect(browserOffline.overlays.settings.backendActionsDisabled).toBe(false);
    expect(explicitOffline.overlays.settings.offline).toBe(true);
    expect(explicitOffline.overlays.settings.backendActionsDisabled).toBe(true);
  });

  it("keeps bootstrap error precedence and forwards all bootstrap stages", () => {
    const { input } = compositionInput("restore");
    const projected = projectAppShellComposition(input);
    expect(projected.kind).toBe("bootstrap");
    if (projected.kind !== "bootstrap") throw new Error("Expected bootstrap projection.");
    expect(projected.bootstrap.bootstrapError).toBe("registry-notice");
    expect(projected.bootstrap.connectStage).toBe(input.bootstrap.connectStage);
    expect(projected.bootstrap.gate).toBe(input.bootstrap.gate);
    expect(projected.bootstrap.restoreStage).toBe(input.bootstrap.restoreStage);
    expect(projected.bootstrap.unlockStage).toBe(input.bootstrap.unlockStage);
  });
});
