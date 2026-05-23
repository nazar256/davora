export interface AudioPreviewResumeTarget {
  accountId: string;
  path: string;
}

const STORAGE_KEY_PREFIX = "davora-audio-preview-position:";

function storageKey(target: AudioPreviewResumeTarget): string {
  return `${STORAGE_KEY_PREFIX}${target.accountId}:${target.path}`;
}

export function loadAudioPreviewPosition(target: AudioPreviewResumeTarget): number | undefined {
  try {
    const raw = localStorage.getItem(storageKey(target));
    if (!raw) {
      return undefined;
    }

    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function saveAudioPreviewPosition(target: AudioPreviewResumeTarget, positionSeconds: number): void {
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 0) {
    clearAudioPreviewPosition(target);
    return;
  }

  try {
    localStorage.setItem(storageKey(target), String(positionSeconds));
  } catch {
    // Best-effort only: if storage is unavailable or full, audio still opens at 0:00.
  }
}

export function clearAudioPreviewPosition(target: AudioPreviewResumeTarget): void {
  try {
    localStorage.removeItem(storageKey(target));
  } catch {
    // Best-effort only.
  }
}
