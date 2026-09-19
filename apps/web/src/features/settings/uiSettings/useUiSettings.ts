import { useCallback, useRef, useState } from "react";

import type { SortMode } from "../../browsing";
import type { FileSizeDisplayMode } from "../../../lib/fileSize";
import type { SettingsService } from "../ports";
import type { ThemeMode } from "../model";
import { saveUiSettingChange } from "./controller";
import type { UiSettingsPorts } from "./ports";
import {
  buildExperimentalFolderAppShortcutsEnabledStatusMessage,
  buildExperimentalHeicPreviewEnabledStatusMessage,
  buildFileSizeDisplayModeStatusMessage,
  buildKeepAwakeEnabledStatusMessage,
  buildMaxCacheableFileSizeStatusMessage,
  buildPreviewFreshnessIntervalStatusMessage,
  buildShowHiddenFilesStatusMessage,
  buildSortModeStatusMessage,
  buildThemeModeStatusMessage
} from "./presentation";

export interface UseUiSettingsInput {
  readonly settingsService: SettingsService;
  readonly ports: UiSettingsPorts;
}

export function useUiSettings(input: UseUiSettingsInput) {
  const { settingsService, ports } = input;
  const [uiSettings, setUiSettings] = useState(() => settingsService.load());
  const uiSettingsRef = useRef(uiSettings);
  uiSettingsRef.current = uiSettings;

  const persistSetting = useCallback((patch: Parameters<typeof saveUiSettingChange>[1], statusMessage?: string) => {
    const nextSettings = saveUiSettingChange(uiSettingsRef.current, patch, settingsService);
    setUiSettings(nextSettings);
    if (statusMessage !== undefined) {
      ports.announceStatus(statusMessage);
    }
  }, [settingsService, ports]);

  const handleFileSizeDisplayModeChange = useCallback((mode: FileSizeDisplayMode) => {
    persistSetting({ fileSizeDisplayMode: mode }, buildFileSizeDisplayModeStatusMessage(mode));
  }, [persistSetting]);

  const handleThemeModeChange = useCallback((mode: ThemeMode) => {
    persistSetting({ themeMode: mode }, buildThemeModeStatusMessage(mode));
  }, [persistSetting]);

  const handleMaxCacheableFileSizeChange = useCallback((limitBytes: number) => {
    const displayMode = uiSettingsRef.current.fileSizeDisplayMode;
    const nextSettings = saveUiSettingChange(
      uiSettingsRef.current,
      { maxCacheableFileSizeBytes: limitBytes },
      settingsService
    );
    setUiSettings(nextSettings);
    ports.announceStatus(buildMaxCacheableFileSizeStatusMessage(nextSettings.maxCacheableFileSizeBytes, displayMode));
  }, [settingsService, ports]);

  const handleImagePreviewFitModeChange = useCallback((mode: "fill" | "fit") => {
    persistSetting({ imagePreviewFitMode: mode });
  }, [persistSetting]);

  const handlePreviewFreshnessIntervalChange = useCallback((intervalSeconds: number) => {
    const nextSettings = saveUiSettingChange(
      uiSettingsRef.current,
      { previewFreshnessIntervalSeconds: intervalSeconds },
      settingsService
    );
    setUiSettings(nextSettings);
    ports.announceStatus(buildPreviewFreshnessIntervalStatusMessage(nextSettings.previewFreshnessIntervalSeconds));
  }, [settingsService, ports]);

  const handleKeepAwakeEnabledChange = useCallback((enabled: boolean) => {
    persistSetting({ keepAwakeEnabled: enabled }, buildKeepAwakeEnabledStatusMessage(enabled));
  }, [persistSetting]);

  const handleShowHiddenFilesChange = useCallback((show: boolean) => {
    persistSetting({ showHiddenFiles: show }, buildShowHiddenFilesStatusMessage(show));
  }, [persistSetting]);

  const handleExperimentalHeicPreviewEnabledChange = useCallback((enabled: boolean) => {
    persistSetting(
      { experimentalHeicPreviewEnabled: enabled },
      buildExperimentalHeicPreviewEnabledStatusMessage(enabled)
    );
  }, [persistSetting]);

  const handleExperimentalFolderAppShortcutsEnabledChange = useCallback((enabled: boolean) => {
    persistSetting(
      { experimentalFolderAppShortcutsEnabled: enabled },
      buildExperimentalFolderAppShortcutsEnabledStatusMessage(enabled)
    );
  }, [persistSetting]);

  const handleSortModeChange = useCallback((mode: SortMode) => {
    persistSetting({ sortMode: mode }, buildSortModeStatusMessage(mode));
  }, [persistSetting]);

  return {
    uiSettings,
    handleFileSizeDisplayModeChange,
    handleThemeModeChange,
    handleMaxCacheableFileSizeChange,
    handleImagePreviewFitModeChange,
    handlePreviewFreshnessIntervalChange,
    handleKeepAwakeEnabledChange,
    handleShowHiddenFilesChange,
    handleExperimentalHeicPreviewEnabledChange,
    handleExperimentalFolderAppShortcutsEnabledChange,
    handleSortModeChange
  };
}
