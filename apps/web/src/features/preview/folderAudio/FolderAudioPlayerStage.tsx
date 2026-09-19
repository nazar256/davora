import {
  FileMusic,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  X
} from "lucide-react";

import { AUDIO_SKIP_SECONDS, formatPlaybackTime } from "./model";
import type { FolderAudioPlayerInteraction } from "./useFolderAudioPlayer";

interface FolderAudioPlayerStageProps {
  interaction: FolderAudioPlayerInteraction;
}

export function FolderAudioPlayerStage({ interaction }: FolderAudioPlayerStageProps) {
  const { stage } = interaction;
  if (!stage) {
    return null;
  }

  const {
    folderLabel,
    player,
    currentTrack,
    currentTrackIndex,
    durationSeconds,
    remainingSeconds,
    streamUrl,
    playing,
    error,
    audioRef,
    audioKey,
    onEnded,
    onLoadedMetadata,
    onPause,
    onPlay,
    onTimeUpdate,
    onSeek,
    onSkip,
    onSelectTrack,
    onTogglePlayback,
    onClose
  } = stage;

  return (
    <section aria-label={`Audio playlist for ${folderLabel}`} className="folder-audio-player">
      <div className="folder-audio-header">
        <div className="folder-audio-title">
          <span aria-hidden="true"><FileMusic /></span>
          <div>
            <p className="summary-label">Folder playlist</p>
            <p className="folder-audio-track">{currentTrack.name}</p>
          </div>
        </div>
        <button aria-label="Close folder audio player" className="icon-button quiet-button" onClick={onClose} title="Close player" type="button"><X aria-hidden="true" /></button>
      </div>
      <audio
        key={audioKey}
        onEnded={onEnded}
        onLoadedMetadata={(event) => onLoadedMetadata(event.currentTarget)}
        onPause={onPause}
        onPlay={onPlay}
        onTimeUpdate={(event) => onTimeUpdate(event.currentTarget)}
        ref={audioRef}
        src={streamUrl}
      />
      <div className="folder-audio-progress">
        <span>{formatPlaybackTime(player.positionSeconds)}</span>
        <input
          aria-label="Audio playback position"
          disabled={!streamUrl || durationSeconds <= 0}
          max={durationSeconds || 0}
          min={0}
          onChange={(event) => {
            onSeek(Number(event.currentTarget.value));
          }}
          step={1}
          type="range"
          value={Math.min(player.positionSeconds, durationSeconds || player.positionSeconds)}
        />
        <span>{remainingSeconds === undefined ? "--:--" : `-${formatPlaybackTime(remainingSeconds)}`}</span>
      </div>
      <div className="folder-audio-controls">
        <button aria-label="Skip back 15 seconds" disabled={!streamUrl} onClick={() => onSkip(-AUDIO_SKIP_SECONDS)} title="Back 15 seconds" type="button"><RotateCcw aria-hidden="true" /><span>15</span></button>
        <button
          aria-label="Previous audio track"
          disabled={currentTrackIndex <= 0}
          onClick={() => {
            const previous = player.tracks[currentTrackIndex - 1];
            if (previous) {
              onSelectTrack(previous, { play: playing });
            }
          }}
          title="Previous track"
          type="button"
        ><SkipBack aria-hidden="true" /></button>
        <button aria-label={playing ? "Pause folder audio" : "Play folder audio"} className="folder-audio-play-toggle" disabled={!streamUrl} onClick={onTogglePlayback} title={playing ? "Pause" : "Play"} type="button">{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
        <button
          aria-label="Next audio track"
          disabled={currentTrackIndex < 0 || currentTrackIndex >= player.tracks.length - 1}
          onClick={() => {
            const next = player.tracks[currentTrackIndex + 1];
            if (next) {
              onSelectTrack(next, { play: playing });
            }
          }}
          title="Next track"
          type="button"
        ><SkipForward aria-hidden="true" /></button>
        <button aria-label="Skip forward 15 seconds" disabled={!streamUrl} onClick={() => onSkip(AUDIO_SKIP_SECONDS)} title="Forward 15 seconds" type="button"><RotateCw aria-hidden="true" /><span>15</span></button>
      </div>
      {error ? <p className="status warning">{error}</p> : null}
    </section>
  );
}
