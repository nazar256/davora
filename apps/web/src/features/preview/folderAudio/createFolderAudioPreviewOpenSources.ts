import type { FileEntry } from "@davora/shared";

import type { FolderAudioPlayerInteraction } from "./useFolderAudioPlayer";

export interface FolderAudioPreviewOpenSources {
  pause(): void;
  activate(entry: FileEntry): void;
}

export function createFolderAudioPreviewOpenSources(
  getInteraction: () => FolderAudioPlayerInteraction | null | undefined
): FolderAudioPreviewOpenSources {
  return {
    pause: () => getInteraction()?.pause(),
    activate: (entry) => getInteraction()?.activate(entry)
  };
}
