import { describe, expect, it, vi } from "vitest";

import { DEFAULT_UI_SETTINGS } from "../model";
import { buildAccount } from "../../../test/accounts";
import {
  projectSettingsDialogStage,
  type SettingsDialogStageProjectionInput
} from "./index";

function createInput(): SettingsDialogStageProjectionInput {
  const alpha = buildAccount("alpha", { displayName: "Alpha" });
  const beta = buildAccount("beta", { displayName: "Beta" });
  const command = vi.fn();
  return {
    preferences: DEFAULT_UI_SETTINGS,
    commands: {
      handleFileSizeDisplayModeChange: command,
      handleThemeModeChange: command,
      handleMaxCacheableFileSizeChange: command,
      handleImagePreviewFitModeChange: command,
      handlePreviewFreshnessIntervalChange: command,
      handleKeepAwakeEnabledChange: command,
      handleShowHiddenFilesChange: command,
      handleExperimentalHeicPreviewEnabledChange: command,
      handleDiagnosticsEnabledChange: command,
      handleSortModeChange: command
    },
    surface: {
      open: true,
      closeActionLabel: "Done",
      onClose: command,
      onDismissFromScrim: command
    },
    accounts: {
      accounts: [alpha, beta],
      activeAccount: alpha,
      managementActiveAccount: alpha,
      pendingRemovalAccounts: [{ account: alpha, phase: "revoke" }],
      activeAccountId: alpha.id,
      connectedAccountCount: 2,
      onActiveAccountChange: command,
      onOpenAddAccount: command,
      onOpenReconnect: command,
      onOpenRemove: command
    },
    cache: {
      summary: { itemCount: 1, totalBytes: 64, limitBytes: 256 },
      offlineItems: [{ rootId: "root", rootPath: "Projects", name: "Projects", kind: "folder", fileCount: 2, totalBytes: 64 }],
      onClearCache: command,
      onRemoveOfflineItem: command,
      onOpenedFileCacheLimitChange: command
    },
    diagnostics: {
      onOpenReport: command,
      onClearData: command
    },
    runtime: {
      appBuildLabel: "test-build",
      offline: true,
      backendActionsDisabled: true,
      keepAwakeState: "idle"
    }
  };
}

describe("projectSettingsDialogStage", () => {
  it("projects the complete settings stage from public grouped inputs", () => {
    const input = createInput();
    const stage = projectSettingsDialogStage(input);

    expect(stage).toMatchObject({
      open: true,
      closeActionLabel: "Done",
      accounts: input.accounts.accounts,
      activeAccount: input.accounts.activeAccount,
      managementActiveAccount: input.accounts.managementActiveAccount,
      pendingRemovalAccounts: input.accounts.pendingRemovalAccounts,
      activeAccountId: input.accounts.activeAccountId,
      connectedAccountCount: 2,
      appBuildLabel: "test-build",
      offline: true,
      backendActionsDisabled: true,
      cacheSummary: input.cache.summary,
      offlineItems: input.cache.offlineItems,
      fileSizeDisplayMode: DEFAULT_UI_SETTINGS.fileSizeDisplayMode,
      themeMode: DEFAULT_UI_SETTINGS.themeMode,
      maxCacheableFileSizeBytes: DEFAULT_UI_SETTINGS.maxCacheableFileSizeBytes,
      previewFreshnessIntervalSeconds: DEFAULT_UI_SETTINGS.previewFreshnessIntervalSeconds,
      keepAwakeEnabled: true,
      keepAwakeState: "idle",
      showHiddenFiles: false,
      experimentalHeicPreviewEnabled: false
    });
    expect(stage).not.toHaveProperty("token");
    expect(stage).not.toHaveProperty("password");
  });

  it("keeps projected setting and runtime commands wired without owning effects", () => {
    const input = createInput();
    const stage = projectSettingsDialogStage(input);

    stage.onThemeModeChange("dark");
    stage.onKeepAwakeEnabledChange(false);
    stage.onClearCache();
    stage.onActiveAccountChange("beta");

    expect(input.commands.handleThemeModeChange).toHaveBeenCalledWith("dark");
    expect(input.commands.handleKeepAwakeEnabledChange).toHaveBeenCalledWith(false);
    expect(input.cache.onClearCache).toHaveBeenCalled();
    expect(input.accounts.onActiveAccountChange).toHaveBeenCalledWith("beta");
  });
});
