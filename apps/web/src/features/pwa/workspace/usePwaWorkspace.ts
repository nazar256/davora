import { useMemo } from "react";

import type { ReloadPromptStageProps } from "../ReloadPromptStage";
import type { PwaRuntimePorts } from "../ports";
import { usePwaPromptState } from "../usePwaPromptState";

export interface PwaInstallBinding {
  readonly available: boolean;
  readonly busy: boolean;
  readonly onInstall: () => void;
}

export interface PwaWorkspace {
  readonly install: PwaInstallBinding;
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
