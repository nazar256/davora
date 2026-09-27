import type { ConnectedAccount } from "@davora/shared";

import type { SettingsDialogStageProps } from "../settingsDialog";
import type { UiSettings } from "../model";
import type { SettingsService } from "../ports";
import type { ThemePreferencePorts } from "../theme";
import type { FileSizeDisplayMode } from "../../../lib/fileSize";
import type { ScreenWakeLockState } from "../../offline/wakeLock";

export interface SettingsPreferencesWorkspaceInput {
  readonly settingsService: SettingsService;
  readonly themePorts: ThemePreferencePorts;
  readonly announceStatus: (message: string) => void;
}

export interface SettingsPreferencesWorkspaceCommands {
  readonly handleFileSizeDisplayModeChange: (mode: FileSizeDisplayMode) => void;
  readonly handleThemeModeChange: (mode: UiSettings["themeMode"]) => void;
  readonly handleMaxCacheableFileSizeChange: (limitBytes: number) => void;
  readonly handleImagePreviewFitModeChange: (mode: UiSettings["imagePreviewFitMode"]) => void;
  readonly handlePreviewFreshnessIntervalChange: (intervalSeconds: number) => void;
  readonly handleImagePreviewPrefetchCountChange: (count: UiSettings["imagePreviewPrefetchCount"]) => void;
  readonly handleKeepAwakeEnabledChange: (enabled: boolean) => void;
  readonly handleShowHiddenFilesChange: (show: boolean) => void;
  readonly handleExperimentalHeicPreviewEnabledChange: (enabled: boolean) => void;
  readonly handleExperimentalFolderAppShortcutsEnabledChange: (enabled: boolean) => void;
  readonly handleDiagnosticsEnabledChange: (enabled: boolean) => void;
  readonly handleSortModeChange: (mode: UiSettings["sortMode"]) => void;
  readonly handleVideoMutedChange: (muted: boolean) => void;
}

export interface SettingsPreferencesWorkspaceOutput {
  readonly preferences: UiSettings;
  readonly commands: SettingsPreferencesWorkspaceCommands;
}

export interface SettingsDialogStageProjectionInput {
  readonly preferences: UiSettings;
  readonly commands: SettingsPreferencesWorkspaceCommands;
  readonly surface: Pick<
    SettingsDialogStageProps,
    "open" | "closeActionLabel" | "onClose" | "onDismissFromScrim"
  >;
  readonly accounts: {
    readonly accounts: ConnectedAccount[];
    readonly activeAccount?: ConnectedAccount;
    readonly managementActiveAccount?: ConnectedAccount;
    readonly pendingRemovalAccounts?: SettingsDialogStageProps["pendingRemovalAccounts"];
    readonly activeAccountId?: string;
    readonly connectedAccountCount: number;
    readonly onActiveAccountChange: (accountId: string) => void;
    readonly onOpenAddAccount: () => void;
    readonly onOpenReconnect: () => void;
    readonly onOpenRemove: () => void;
  };
  readonly cache: {
    readonly summary: SettingsDialogStageProps["cacheSummary"];
    readonly offlineItems: SettingsDialogStageProps["offlineItems"];
    readonly onClearCache: () => void;
    readonly onRemoveOfflineItem: (rootId: string) => void;
    readonly onOpenedFileCacheLimitChange: (limitBytes: number) => void;
  };
  readonly runtime: {
    readonly appBuildLabel: string;
    readonly offline: boolean;
    readonly backendActionsDisabled?: boolean;
    readonly keepAwakeState: ScreenWakeLockState;
  };
  readonly diagnostics: {
    readonly storageSummary?: string;
    readonly onOpenReport: () => void;
    readonly onClearData: () => void;
  };
}
