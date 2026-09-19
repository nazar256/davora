import { useMemo } from "react";

import type { TransferTask } from "../../transfers";
import { formatWakeLockReasonLabel, mergeWakeLockReasons } from "./model";
import type { ScreenWakeLockPort } from "./ports";
import { useScreenWakeLock } from "./useScreenWakeLock";

export interface UseWakeLockInput {
  readonly keepAwakeEnabled: boolean;
  readonly previewMediaPlaying: boolean;
  readonly folderAudioPlaying: boolean;
  readonly transferTasks: readonly TransferTask[];
  readonly ports: ScreenWakeLockPort;
}

export function useWakeLock(input: UseWakeLockInput) {
  const reasons = useMemo(
    () => mergeWakeLockReasons({
      previewMediaPlaying: input.previewMediaPlaying,
      folderAudioPlaying: input.folderAudioPlaying,
      transferTasks: input.transferTasks
    }),
    [input.folderAudioPlaying, input.previewMediaPlaying, input.transferTasks]
  );
  const screenWakeLock = useScreenWakeLock({
    enabled: input.keepAwakeEnabled,
    reasons,
    ports: input.ports
  });
  const reasonLabel = useMemo(
    () => formatWakeLockReasonLabel(screenWakeLock.reasons),
    [screenWakeLock.reasons]
  );

  return {
    state: screenWakeLock.state,
    reasons: screenWakeLock.reasons,
    supported: screenWakeLock.supported,
    reasonLabel,
    active: screenWakeLock.state === "active"
  };
}
