import { useCallback, useMemo, useRef, useState } from "react";

import { createFolderAudioPreviewOpenSources } from "./createFolderAudioPreviewOpenSources";
import type { FileLikeEntry } from "./model";
import type { FolderAudioRuntimePorts } from "./ports";
import type { FolderAudioPlayerInteraction } from "./useFolderAudioPlayer";
import { useFolderAudioPlayer } from "./useFolderAudioPlayer";

export interface FolderAudioMountContext {
  accountId: string;
  folderPath: string;
  folderLabel: string;
  token: string | undefined;
  cacheOnlyMode: boolean;
  visibleItems: readonly FileLikeEntry[];
}

export interface UseFolderAudioMountInput {
  context: FolderAudioMountContext | undefined;
  ports: FolderAudioRuntimePorts;
}

export function useFolderAudioMount({ context, ports }: UseFolderAudioMountInput) {
  const interactionRef = useRef<FolderAudioPlayerInteraction | null>(null);
  const [playing, setPlaying] = useState(false);

  const interaction = useFolderAudioPlayer({
    context,
    onPlayingChange: setPlaying,
    ports
  });
  interactionRef.current = interaction;

  const previewOpenSources = useMemo(
    () => createFolderAudioPreviewOpenSources(() => interactionRef.current),
    []
  );

  const pauseForExclusivePlayback = useCallback(() => {
    interactionRef.current?.pause();
  }, []);

  const bindPreviewMediaPlaybackChange = useCallback(
    (onPreviewPlayingChange: (playing: boolean) => void) => (previewMediaPlaying: boolean) => {
      onPreviewPlayingChange(previewMediaPlaying);
      if (previewMediaPlaying) {
        pauseForExclusivePlayback();
      }
    },
    [pauseForExclusivePlayback]
  );

  return {
    playing,
    interaction,
    hasPlayer: Boolean(interaction.stage),
    previewOpenSources,
    pauseForExclusivePlayback,
    bindPreviewMediaPlaybackChange
  };
}
