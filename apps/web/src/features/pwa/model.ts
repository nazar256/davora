export function shouldShowUpdatePrompt(needRefresh: boolean, mode: string = import.meta.env.MODE): boolean {
  return needRefresh && mode !== "development";
}

export function isInstallAvailable(
  hasInstallPrompt: boolean,
  installPromptDismissed: boolean,
  standalone: boolean
): boolean {
  return hasInstallPrompt && !installPromptDismissed && !standalone;
}

export function shouldClearNeedRefreshInDev(needRefresh: boolean, mode: string = import.meta.env.MODE): boolean {
  return needRefresh && !shouldShowUpdatePrompt(true, mode);
}

export type InstallOutcome = "accepted" | "dismissed";

/** Which consumer owns the captured beforeinstallprompt event. */
export type InstallCaptureOwner = "app" | "folder-shortcut";

export function nextInstallStateAfterChoice(outcome: InstallOutcome): { clearPrompt: boolean; dismissed: boolean } {
  if (outcome === "accepted") {
    return { clearPrompt: true, dismissed: false };
  }

  return { clearPrompt: false, dismissed: true };
}
