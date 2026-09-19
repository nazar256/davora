import { FolderAudioPlayerStage } from "./FolderAudioPlayerStage";
import type { FolderAudioPlayerInteraction } from "./useFolderAudioPlayer";

interface FolderAudioBrowseMountProps {
  interaction: FolderAudioPlayerInteraction;
}

export function FolderAudioBrowseMount({ interaction }: FolderAudioBrowseMountProps) {
  if (!interaction.stage) {
    return null;
  }
  return <FolderAudioPlayerStage interaction={interaction} />;
}
