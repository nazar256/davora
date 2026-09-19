export interface AudioPreviewResumeTarget {
  readonly accountId: string;
  readonly path: string;
}

export interface AudioPreviewRuntimePorts {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timeoutId: number | undefined): void;
  getLocationHref(): string;
  loadAudioPreviewPosition(target: AudioPreviewResumeTarget): number | undefined;
  saveAudioPreviewPosition(target: AudioPreviewResumeTarget, positionSeconds: number): void;
  clearAudioPreviewPosition(target: AudioPreviewResumeTarget): void;
}
