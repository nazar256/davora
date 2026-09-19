import { useMemo } from "react";

import type { InstallCaptureOwner, InstallOutcome } from "../model";
import type { ReloadPromptStageProps } from "../ReloadPromptStage";
import type { PwaRuntimePorts } from "../ports";
import { usePwaPromptState } from "../usePwaPromptState";

export interface PwaInstallBinding {
  readonly available: boolean;
  readonly busy: boolean;
  readonly onInstall: () => void;
}

export interface PwaInstallCaptureBinding {
  readonly owner: InstallCaptureOwner;
  readonly available: boolean;
  readonly claim: (owner: InstallCaptureOwner) => void;
  readonly release: () => void;
  readonly prompt: (owner: InstallCaptureOwner) => Promise<InstallOutcome | "unavailable">;
}

export interface PwaWorkspace {
  readonly install: PwaInstallBinding;
  readonly installCapture: PwaInstallCaptureBinding;
  readonly reloadPrompt: ReloadPromptStageProps;
}

export function usePwaWorkspace(ports: PwaRuntimePorts): PwaWorkspace {
  const prompt = usePwaPromptState(ports);

  return useMemo(
    () => ({
      install: {
        available: prompt.installAvailable,
        busy: prompt.installing,
        onInstall: () => { void prompt.installApp(); }
      },
      installCapture: {
        owner: prompt.installCaptureOwner,
        available: prompt.installCaptureAvailable,
        claim: prompt.setInstallCaptureOwner,
        release: () => prompt.setInstallCaptureOwner("app"),
        prompt: prompt.promptInstallCapture
      },
      reloadPrompt: {
        needRefresh: prompt.needRefresh,
        onDismiss: prompt.dismissUpdatePrompt,
        onReload: prompt.reloadApp,
        reloading: prompt.reloading
      }
    }),
    [prompt]
  );
}
