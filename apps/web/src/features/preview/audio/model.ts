const AUDIO_PREVIEW_RESUME_END_TOLERANCE_SECONDS = 1;

export interface AudioPreviewSource {
  readonly enabled: boolean;
  readonly accountId?: string;
  readonly path?: string;
  readonly sourceUrl?: string;
}

export function canRestoreAudioPreviewPosition(audio: HTMLAudioElement, positionSeconds: number): boolean {
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 0) {
    return false;
  }

  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    return positionSeconds < Math.max(0, audio.duration - AUDIO_PREVIEW_RESUME_END_TOLERANCE_SECONDS);
  }

  return true;
}
