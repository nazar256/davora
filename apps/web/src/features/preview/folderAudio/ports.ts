export interface AudioPreviewResumeTarget {
  accountId: string;
  path: string;
}

export interface FolderAudioStoragePorts {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface FolderAudioRuntimePorts {
  storage: FolderAudioStoragePorts;
  createStreamingFileUrl(path: string, token: string): Promise<string>;
  nowIso(): string;
  loadAudioPreviewPosition(target: AudioPreviewResumeTarget): number | undefined;
  saveAudioPreviewPosition(target: AudioPreviewResumeTarget, positionSeconds: number): void;
}
