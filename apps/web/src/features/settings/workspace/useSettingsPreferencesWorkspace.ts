import { useMemo } from "react";

import { useThemePreference } from "../theme";
import { useUiSettings } from "../uiSettings";
import type {
  SettingsPreferencesWorkspaceInput,
  SettingsPreferencesWorkspaceOutput,
  SettingsPreferencesWorkspaceCommands
} from "./ports";

export function useSettingsPreferencesWorkspace(
  input: SettingsPreferencesWorkspaceInput
): SettingsPreferencesWorkspaceOutput {
  const uiSettingsPorts = useMemo(
    () => ({ announceStatus: input.announceStatus }),
    [input.announceStatus]
  );
  const uiSettings = useUiSettings({
    settingsService: input.settingsService,
    ports: uiSettingsPorts
  });

  useThemePreference(uiSettings.uiSettings.themeMode, input.themePorts);

  const commands = useMemo<SettingsPreferencesWorkspaceCommands>(() => ({
    handleFileSizeDisplayModeChange: uiSettings.handleFileSizeDisplayModeChange,
    handleThemeModeChange: uiSettings.handleThemeModeChange,
    handleMaxCacheableFileSizeChange: uiSettings.handleMaxCacheableFileSizeChange,
    handleImagePreviewFitModeChange: uiSettings.handleImagePreviewFitModeChange,
    handlePreviewFreshnessIntervalChange: uiSettings.handlePreviewFreshnessIntervalChange,
    handleImagePreviewPrefetchCountChange: uiSettings.handleImagePreviewPrefetchCountChange,
    handleKeepAwakeEnabledChange: uiSettings.handleKeepAwakeEnabledChange,
    handleShowHiddenFilesChange: uiSettings.handleShowHiddenFilesChange,
    handleExperimentalHeicPreviewEnabledChange: uiSettings.handleExperimentalHeicPreviewEnabledChange,
    handleExperimentalFolderAppShortcutsEnabledChange: uiSettings.handleExperimentalFolderAppShortcutsEnabledChange,
    handleDiagnosticsEnabledChange: uiSettings.handleDiagnosticsEnabledChange,
    handleSortModeChange: uiSettings.handleSortModeChange,
    handleVideoMutedChange: uiSettings.handleVideoMutedChange
  }), [
    uiSettings.handleExperimentalFolderAppShortcutsEnabledChange,
    uiSettings.handleDiagnosticsEnabledChange,
    uiSettings.handleExperimentalHeicPreviewEnabledChange,
    uiSettings.handleFileSizeDisplayModeChange,
    uiSettings.handleImagePreviewFitModeChange,
    uiSettings.handleKeepAwakeEnabledChange,
    uiSettings.handleMaxCacheableFileSizeChange,
    uiSettings.handlePreviewFreshnessIntervalChange,
    uiSettings.handleImagePreviewPrefetchCountChange,
    uiSettings.handleShowHiddenFilesChange,
    uiSettings.handleSortModeChange,
    uiSettings.handleThemeModeChange,
    uiSettings.handleVideoMutedChange
  ]);

  return {
    preferences: uiSettings.uiSettings,
    commands
  };
}
