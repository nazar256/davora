export function folderAudioBrowsePanelClassName(hasFolderAudioPlayer: boolean): string {
  return `file-browser-panel${hasFolderAudioPlayer ? " has-folder-audio-player" : ""}`;
}
