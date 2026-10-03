import type { SettingsDialogStageProps } from "../settingsDialog";
import type { SettingsDialogStageProjectionInput } from "./ports";

export function projectSettingsDialogStage(
  input: SettingsDialogStageProjectionInput
): SettingsDialogStageProps {
  return {
    open: input.surface.open,
    accounts: input.accounts.accounts,
    activeAccount: input.accounts.activeAccount,
    managementActiveAccount: input.accounts.managementActiveAccount,
    pendingRemovalAccounts: input.accounts.pendingRemovalAccounts,
    activeAccountId: input.accounts.activeAccountId,
    appBuildLabel: input.runtime.appBuildLabel,
    connectedAccountCount: input.accounts.connectedAccountCount,
    offline: input.runtime.offline,
    backendActionsDisabled: input.runtime.backendActionsDisabled,
    cacheSummary: input.cache.summary,
    closeActionLabel: input.surface.closeActionLabel,
    fileSizeDisplayMode: input.preferences.fileSizeDisplayMode,
    themeMode: input.preferences.themeMode,
    maxCacheableFileSizeBytes: input.preferences.maxCacheableFileSizeBytes,
    previewFreshnessIntervalSeconds: input.preferences.previewFreshnessIntervalSeconds,
    imagePreviewPrefetchCount: input.preferences.imagePreviewPrefetchCount,
    keepAwakeEnabled: input.preferences.keepAwakeEnabled,
    keepAwakeState: input.runtime.keepAwakeState,
    offlineItems: input.cache.offlineItems,
    retainedBytes: input.cache.retainedBytes,
    storageScope: input.cache.storageScope,
    estimateStorage: input.cache.estimateStorage,
    retryDisabled: input.cache.retryDisabled,
    onRetryOfflineItem: input.cache.onRetryOfflineItem,
    onClearCache: input.cache.onClearCache,
    onRemoveOfflineItem: input.cache.onRemoveOfflineItem,
    onClose: input.surface.onClose,
    onActiveAccountChange: input.accounts.onActiveAccountChange,
    onOpenAddAccount: input.accounts.onOpenAddAccount,
    onOpenReconnect: input.accounts.onOpenReconnect,
    onOpenRemove: input.accounts.onOpenRemove,
    onOpenedFileCacheLimitChange: input.cache.onOpenedFileCacheLimitChange,
    onMaxCacheableFileSizeChange: input.commands.handleMaxCacheableFileSizeChange,
    onPreviewFreshnessIntervalChange: input.commands.handlePreviewFreshnessIntervalChange,
    onImagePreviewPrefetchCountChange: input.commands.handleImagePreviewPrefetchCountChange,
    onKeepAwakeEnabledChange: input.commands.handleKeepAwakeEnabledChange,
    onThemeModeChange: input.commands.handleThemeModeChange,
    showHiddenFiles: input.preferences.showHiddenFiles,
    onShowHiddenFilesChange: input.commands.handleShowHiddenFilesChange,
    experimentalHeicPreviewEnabled: input.preferences.experimentalHeicPreviewEnabled,
    onExperimentalHeicPreviewEnabledChange: input.commands.handleExperimentalHeicPreviewEnabledChange,
    experimentalFolderAppShortcutsEnabled: input.preferences.experimentalFolderAppShortcutsEnabled,
    onExperimentalFolderAppShortcutsEnabledChange: input.commands.handleExperimentalFolderAppShortcutsEnabledChange,
    diagnosticsEnabled: input.preferences.diagnosticsEnabled,
    onDiagnosticsEnabledChange: input.commands.handleDiagnosticsEnabledChange,
    diagnostics: {
      storageSummary: input.diagnostics.storageSummary,
      onOpenReport: input.diagnostics.onOpenReport,
      onClearData: input.diagnostics.onClearData
    },
    onDismissFromScrim: input.surface.onDismissFromScrim
  };
}
