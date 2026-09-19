import { DEFAULT_UI_SETTINGS, type UiSettings } from "../model";
import type { SettingsService } from "../ports";

export function saveUiSettingChange(
  current: UiSettings,
  patch: Partial<UiSettings>,
  settingsService: SettingsService
): UiSettings {
  return settingsService.save({ ...DEFAULT_UI_SETTINGS, ...current, ...patch });
}
