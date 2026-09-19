import { getViewerKind } from "@davora/shared";

export const AUDIO_PLAYLIST_PREFIX = "davora-folder-audio:";
export const AUDIO_SKIP_SECONDS = 15;

export interface AudioPlaylistTrack {
  path: string;
  name: string;
  mimeType?: string;
  size?: number;
}

export interface FolderAudioPlayerState {
  accountId: string;
  folderPath: string;
  tracks: AudioPlaylistTrack[];
  currentPath: string;
  positionSeconds: number;
  durationSeconds?: number;
  dismissed: boolean;
  updatedAt: string;
}

export interface FileLikeEntry {
  path: string;
  name: string;
  mimeType?: string;
  size?: number;
  isFolder?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isAudioPlaylistTrack(value: unknown): value is AudioPlaylistTrack {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.path === "string" && typeof value.name === "string";
}

export function folderAudioStorageKey(accountId: string, folderPath: string): string {
  return `${AUDIO_PLAYLIST_PREFIX}${accountId}:${encodeURIComponent(folderPath)}`;
}

export function isAudioFileEntry(entry: FileLikeEntry): boolean {
  return getViewerKind(entry.mimeType) === "audio" || entry.mimeType?.toLowerCase().startsWith("audio/") === true;
}

export function toAudioPlaylistTrack(entry: FileLikeEntry | AudioPlaylistTrack): AudioPlaylistTrack {
  return {
    path: entry.path,
    name: entry.name,
    mimeType: entry.mimeType,
    size: entry.size
  };
}

export function normalizeAudioPlaylistState(value: unknown): FolderAudioPlayerState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    typeof value.accountId !== "string" ||
    typeof value.folderPath !== "string" ||
    typeof value.currentPath !== "string" ||
    !Array.isArray(value.tracks)
  ) {
    return undefined;
  }

  const tracks = value.tracks
    .filter(isAudioPlaylistTrack)
    .map(toAudioPlaylistTrack);
  if (tracks.length === 0) {
    return undefined;
  }

  const currentTrack = tracks.find((track) => track.path === value.currentPath) ?? tracks[0];
  if (!currentTrack) {
    return undefined;
  }
  return {
    accountId: value.accountId,
    folderPath: value.folderPath,
    tracks,
    currentPath: currentTrack.path,
    positionSeconds: typeof value.positionSeconds === "number" && Number.isFinite(value.positionSeconds) ? Math.max(0, value.positionSeconds) : 0,
    durationSeconds: typeof value.durationSeconds === "number" && Number.isFinite(value.durationSeconds) ? Math.max(0, value.durationSeconds) : undefined,
    dismissed: value.dismissed === true,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString()
  };
}

export function formatPlaybackTime(seconds: number | undefined): string {
  if (!Number.isFinite(seconds) || seconds === undefined || seconds < 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function buildAudioPlaylistTracks(
  visibleItems: readonly FileLikeEntry[],
  entry: FileLikeEntry
): AudioPlaylistTrack[] {
  const visibleAudioTracks = visibleItems
    .filter((item) => !item.isFolder && isAudioFileEntry(item))
    .map(toAudioPlaylistTrack);
  return visibleAudioTracks.some((track) => track.path === entry.path)
    ? visibleAudioTracks
    : [...visibleAudioTracks, toAudioPlaylistTrack(entry)];
}

export function resolveCurrentFolderAudioPlayer(
  player: FolderAudioPlayerState | undefined,
  accountId: string | undefined,
  folderPath: string
): FolderAudioPlayerState | undefined {
  if (!accountId || !player || player.accountId !== accountId || player.folderPath !== folderPath || player.dismissed) {
    return undefined;
  }
  return player;
}

export function resolveCurrentTrackIndex(player: FolderAudioPlayerState): number {
  return player.tracks.findIndex((track) => track.path === player.currentPath);
}

export function resolveTrackDuration(player: FolderAudioPlayerState): number {
  return player.durationSeconds ?? 0;
}

export function resolveRemainingSeconds(player: FolderAudioPlayerState): number | undefined {
  const duration = resolveTrackDuration(player);
  if (duration <= 0) {
    return undefined;
  }
  return Math.max(0, duration - player.positionSeconds);
}

export function canReuseFolderAudioStream(
  player: FolderAudioPlayerState | undefined,
  accountId: string,
  folderPath: string,
  trackPath: string,
  streamUrl: string | undefined,
  hasAudioElement: boolean
): boolean {
  return player?.accountId === accountId
    && player.folderPath === folderPath
    && player.currentPath === trackPath
    && Boolean(streamUrl)
    && hasAudioElement;
}
