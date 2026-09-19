import {
  createStreamingFileUrl
} from "../../lib/api";
import {
  loadAudioPreviewPosition,
  saveAudioPreviewPosition
} from "../../lib/audioResume";

/** Local structural copies keep platform adapters independent of feature modules. */
export interface BrowserAudioPreviewResumeTarget {
  accountId: string;
  path: string;
}

export interface BrowserFolderAudioStoragePorts {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BrowserFolderAudioRuntimePorts {
  storage: BrowserFolderAudioStoragePorts;
  createStreamingFileUrl(path: string, token: string): Promise<string>;
  nowIso(): string;
  loadAudioPreviewPosition(target: BrowserAudioPreviewResumeTarget): number | undefined;
  saveAudioPreviewPosition(target: BrowserAudioPreviewResumeTarget, positionSeconds: number): void;
}

export function createBrowserFolderAudioPorts(): BrowserFolderAudioRuntimePorts {
  return {
    storage: localStorage,
    createStreamingFileUrl,
    nowIso: () => new Date().toISOString(),
    loadAudioPreviewPosition,
    saveAudioPreviewPosition
  } satisfies BrowserFolderAudioRuntimePorts;
}
