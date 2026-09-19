import type { TransferTask } from "../../transfers";
import { selectTransferWakeLockReasons } from "../../transfers";

export type WakeLockReason = "mediaPlayback" | "download" | "offlineSync" | "transferQueue";

export type ScreenWakeLockState =
  | "disabled"
  | "unsupported"
  | "idle"
  | "requesting"
  | "active"
  | "denied";

export interface WakeLockReasonInput {
  readonly previewMediaPlaying: boolean;
  readonly folderAudioPlaying: boolean;
  readonly transferTasks: readonly TransferTask[];
}

export function mergeWakeLockReasons(input: WakeLockReasonInput): WakeLockReason[] {
  const reasons = new Set<WakeLockReason>();
  if (input.previewMediaPlaying || input.folderAudioPlaying) {
    reasons.add("mediaPlayback");
  }
  for (const reason of selectTransferWakeLockReasons(input.transferTasks)) {
    reasons.add(reason);
  }
  return [...reasons];
}

export function formatWakeLockReasonLabel(reasons: readonly WakeLockReason[]): string {
  return reasons.map((reason) => reason === "mediaPlayback"
    ? "media playback"
    : reason === "download"
      ? "downloads"
      : reason === "offlineSync"
        ? "offline sync"
        : "transfers").join(", ");
}
