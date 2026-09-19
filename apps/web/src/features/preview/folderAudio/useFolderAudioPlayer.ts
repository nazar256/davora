import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  buildAudioPlaylistTracks,
  folderAudioStorageKey,
  isAudioFileEntry,
  normalizeAudioPlaylistState,
  resolveCurrentFolderAudioPlayer,
  resolveCurrentTrackIndex,
  resolveRemainingSeconds,
  resolveTrackDuration,
  canReuseFolderAudioStream,
  type AudioPlaylistTrack,
  type FileLikeEntry,
  type FolderAudioPlayerState
} from "./model";
import type { AudioPreviewResumeTarget, FolderAudioRuntimePorts } from "./ports";

interface FolderAudioPlayerContext {
  accountId: string;
  folderPath: string;
  folderLabel: string;
  token: string | undefined;
  cacheOnlyMode: boolean;
  visibleItems: readonly FileLikeEntry[];
}

interface UseFolderAudioPlayerOptions {
  context: FolderAudioPlayerContext | undefined;
  onPlayingChange?: (playing: boolean) => void;
  ports: FolderAudioRuntimePorts;
}

export interface FolderAudioStageBindings {
  folderLabel: string;
  player: FolderAudioPlayerState;
  currentTrack: AudioPlaylistTrack;
  currentTrackIndex: number;
  durationSeconds: number;
  remainingSeconds: number | undefined;
  streamUrl: string | undefined;
  playing: boolean;
  error: string | undefined;
  audioRef: (element: HTMLAudioElement | null) => void;
  audioKey: string;
  onEnded: () => void;
  onLoadedMetadata: (audio: HTMLAudioElement) => void;
  onPause: () => void;
  onPlay: () => void;
  onTimeUpdate: (audio: HTMLAudioElement) => void;
  onSeek: (positionSeconds: number) => void;
  onSkip: (deltaSeconds: number) => void;
  onSelectTrack: (track: AudioPlaylistTrack, options?: { play?: boolean }) => void;
  onTogglePlayback: () => void;
  onClose: () => void;
}

export interface FolderAudioPlayerInteraction {
  playing: boolean;
  pause: () => void;
  activate: (entry: FileLikeEntry) => void;
  stage: FolderAudioStageBindings | undefined;
}

interface FolderAudioLifecycleOwner {
  readonly accountId: string | undefined;
  readonly cacheOnlyMode: boolean;
  readonly folderPath: string;
  readonly ports: FolderAudioRuntimePorts;
  readonly requestKey: number;
  readonly token: string | undefined;
  readonly trackPath: string | undefined;
}

interface FolderAudioStageOwner {
  readonly lifecycle: FolderAudioLifecycleOwner;
  readonly streamUrl: string | undefined;
}

function loadFolderAudioPlayerState(
  accountId: string,
  folderPath: string,
  ports: FolderAudioRuntimePorts
): FolderAudioPlayerState | undefined {
  try {
    const raw = ports.storage.getItem(folderAudioStorageKey(accountId, folderPath));
    return raw ? normalizeAudioPlaylistState(JSON.parse(raw)) : undefined;
  } catch {
    ports.storage.removeItem(folderAudioStorageKey(accountId, folderPath));
    return undefined;
  }
}

function saveFolderAudioPlayerState(state: FolderAudioPlayerState, ports: FolderAudioRuntimePorts): FolderAudioPlayerState {
  const normalized = normalizeAudioPlaylistState({ ...state, updatedAt: ports.nowIso() });
  if (!normalized) {
    return state;
  }
  ports.storage.setItem(folderAudioStorageKey(normalized.accountId, normalized.folderPath), JSON.stringify(normalized));
  return normalized;
}

export function useFolderAudioPlayer({
  context,
  onPlayingChange,
  ports
}: UseFolderAudioPlayerOptions): FolderAudioPlayerInteraction {
  const [folderAudioPlayer, setFolderAudioPlayer] = useState<FolderAudioPlayerState | undefined>();
  const [folderAudioStreamUrl, setFolderAudioStreamUrl] = useState<string | undefined>();
  const [folderAudioStreamRequestKey, setFolderAudioStreamRequestKey] = useState(0);
  const [folderAudioPlaying, setFolderAudioPlaying] = useState(false);
  const [folderAudioError, setFolderAudioError] = useState<string | undefined>();

  const folderAudioRef = useRef<HTMLAudioElement | null>(null);
  const folderAudioPlayRequestedRef = useRef(false);
  const folderAudioResumePendingRef = useRef<{ path: string; positionSeconds: number } | undefined>();
  const onPlayingChangeRef = useRef(onPlayingChange);
  const mountedRef = useRef(false);
  const currentLifecycleOwnerRef = useRef<FolderAudioLifecycleOwner>();
  const currentStageOwnerRef = useRef<FolderAudioStageOwner>();
  const audioOwnerRef = useRef<{ owner: FolderAudioStageOwner; element: HTMLAudioElement }>();

  const accountId = context?.accountId;
  const folderPath = context?.folderPath ?? "";
  const folderLabel = context?.folderLabel ?? "";
  const token = context?.token;
  const cacheOnlyMode = context?.cacheOnlyMode ?? false;
  const visibleItems = context?.visibleItems;

  const currentFolderAudioPlayer = resolveCurrentFolderAudioPlayer(folderAudioPlayer, accountId, folderPath);
  const currentFolderAudioTrack = currentFolderAudioPlayer?.tracks.find((track) => track.path === currentFolderAudioPlayer.currentPath);
  const currentFolderAudioIndex = currentFolderAudioPlayer ? resolveCurrentTrackIndex(currentFolderAudioPlayer) : -1;
  const streamTrackPath = currentFolderAudioPlayer?.currentPath;

  const lifecycleOwner = useMemo<FolderAudioLifecycleOwner>(() => ({
    accountId,
    cacheOnlyMode,
    folderPath,
    ports,
    requestKey: folderAudioStreamRequestKey,
    token,
    trackPath: streamTrackPath
  }), [accountId, cacheOnlyMode, folderPath, folderAudioStreamRequestKey, ports, streamTrackPath, token]);
  const stageOwner = useMemo<FolderAudioStageOwner>(() => ({
    lifecycle: lifecycleOwner,
    streamUrl: folderAudioStreamUrl
  }), [folderAudioStreamUrl, lifecycleOwner]);

  const isCurrentLifecycleOwner = useCallback((owner: FolderAudioLifecycleOwner) => (
    mountedRef.current && currentLifecycleOwnerRef.current === owner
  ), []);
  const isCurrentStageOwner = useCallback((owner: FolderAudioStageOwner) => (
    mountedRef.current && currentStageOwnerRef.current === owner
  ), []);
  const currentAudioFor = useCallback((owner: FolderAudioStageOwner) => {
    const boundAudio = audioOwnerRef.current;
    return boundAudio?.owner === owner ? boundAudio.element : undefined;
  }, []);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      audioOwnerRef.current?.element.pause();
      audioOwnerRef.current = undefined;
      currentLifecycleOwnerRef.current = undefined;
      currentStageOwnerRef.current = undefined;
      folderAudioRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    currentLifecycleOwnerRef.current = lifecycleOwner;
    return () => {
      if (currentLifecycleOwnerRef.current === lifecycleOwner) {
        currentLifecycleOwnerRef.current = undefined;
      }
    };
  }, [lifecycleOwner]);

  useLayoutEffect(() => {
    currentStageOwnerRef.current = stageOwner;
    return () => {
      const boundAudio = audioOwnerRef.current;
      if (boundAudio?.owner === stageOwner) {
        boundAudio.element.pause();
        audioOwnerRef.current = undefined;
        if (folderAudioRef.current === boundAudio.element) {
          folderAudioRef.current = null;
        }
      }
      if (currentStageOwnerRef.current === stageOwner) {
        currentStageOwnerRef.current = undefined;
      }
    };
  }, [stageOwner]);

  useEffect(() => {
    onPlayingChangeRef.current = onPlayingChange;
  }, [onPlayingChange]);

  useEffect(() => {
    onPlayingChangeRef.current?.(folderAudioPlaying);
  }, [folderAudioPlaying]);

  const setPlaying = useCallback((playing: boolean) => {
    setFolderAudioPlaying(playing);
  }, []);

  const setAndPersistFolderAudioPlayer = useCallback((
    owner: FolderAudioLifecycleOwner,
    updater: (previous: FolderAudioPlayerState) => FolderAudioPlayerState | undefined
  ) => {
    if (!isCurrentLifecycleOwner(owner)) {
      return;
    }
    setFolderAudioPlayer((previous) => {
      if (
        !previous
        || previous.accountId !== owner.accountId
        || previous.folderPath !== owner.folderPath
        || !isCurrentLifecycleOwner(owner)
      ) {
        return previous;
      }
      const next = updater(previous);
      return next ? saveFolderAudioPlayerState(next, owner.ports) : next;
    });
  }, [isCurrentLifecycleOwner]);

  const playFolderAudio = useCallback((owner: FolderAudioStageOwner) => {
    if (!isCurrentStageOwner(owner)) {
      return;
    }
    const audio = currentAudioFor(owner);
    if (!audio) {
      return;
    }
    folderAudioPlayRequestedRef.current = false;

    const handlePlaybackFailure = () => {
      if (!isCurrentStageOwner(owner) || currentAudioFor(owner) !== audio) {
        return;
      }
      setPlaying(false);
      setFolderAudioError("Playback was blocked by the browser. Use Play to try again.");
    };
    try {
      const playResult = audio.play();
      void Promise.resolve(playResult).then(() => {
        if (isCurrentStageOwner(owner) && currentAudioFor(owner) === audio) {
          setFolderAudioError(undefined);
        }
      }, handlePlaybackFailure);
    } catch {
      handlePlaybackFailure();
    }
  }, [currentAudioFor, isCurrentStageOwner, setPlaying]);

  const pause = useCallback(() => {
    const owner = currentStageOwnerRef.current;
    if (!owner || !isCurrentStageOwner(owner)) {
      return;
    }
    folderAudioPlayRequestedRef.current = false;
    currentAudioFor(owner)?.pause();
    setPlaying(false);
    setFolderAudioStreamUrl(undefined);
  }, [currentAudioFor, isCurrentStageOwner, setPlaying]);

  const selectFolderAudioTrack = useCallback((owner: FolderAudioStageOwner, track: AudioPlaylistTrack, options: { play?: boolean } = {}) => {
    const lifecycle = owner.lifecycle;
    if (!isCurrentStageOwner(owner) || !currentFolderAudioPlayer || !lifecycle.accountId) {
      return;
    }
    const audio = currentAudioFor(owner);
    audio?.pause();
    folderAudioPlayRequestedRef.current = options.play === true;
    const savedPreviewPosition = lifecycle.ports.loadAudioPreviewPosition({ accountId: lifecycle.accountId, path: track.path }) ?? 0;
    const next = saveFolderAudioPlayerState({
      ...currentFolderAudioPlayer,
      currentPath: track.path,
      positionSeconds: savedPreviewPosition,
      durationSeconds: undefined,
      dismissed: false,
      updatedAt: lifecycle.ports.nowIso()
    }, lifecycle.ports);
    folderAudioResumePendingRef.current = next.positionSeconds > 0
      ? { path: track.path, positionSeconds: next.positionSeconds }
      : undefined;
    setFolderAudioStreamUrl(undefined);
    setFolderAudioStreamRequestKey((key) => key + 1);
    setFolderAudioPlayer(next);
    setPlaying(false);
    setFolderAudioError(undefined);
  }, [currentAudioFor, currentFolderAudioPlayer, isCurrentStageOwner, setPlaying]);

  const skipFolderAudio = useCallback((owner: FolderAudioStageOwner, deltaSeconds: number) => {
    if (!isCurrentStageOwner(owner) || !currentFolderAudioPlayer) {
      return;
    }
    const audio = currentAudioFor(owner);
    if (!audio) {
      return;
    }
    audio.currentTime = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : Number.MAX_SAFE_INTEGER, audio.currentTime + deltaSeconds));
    const nextPosition = audio.currentTime;
    setAndPersistFolderAudioPlayer(owner.lifecycle, (previous) => ({
      ...previous,
      positionSeconds: nextPosition,
      durationSeconds: Number.isFinite(audio.duration) ? audio.duration : previous.durationSeconds
    }));
  }, [currentAudioFor, currentFolderAudioPlayer, isCurrentStageOwner, setAndPersistFolderAudioPlayer]);

  const toggleFolderAudioPlayback = useCallback((owner: FolderAudioStageOwner) => {
    if (!isCurrentStageOwner(owner)) {
      return;
    }
    const audio = currentAudioFor(owner);
    if (!audio) {
      return;
    }
    if (folderAudioPlaying) {
      folderAudioPlayRequestedRef.current = false;
      audio.pause();
      setPlaying(false);
      return;
    }
    playFolderAudio(owner);
  }, [currentAudioFor, folderAudioPlaying, isCurrentStageOwner, playFolderAudio, setPlaying]);

  const closeFolderAudioPlayer = useCallback((owner: FolderAudioStageOwner) => {
    if (!isCurrentStageOwner(owner)) {
      return;
    }
    folderAudioPlayRequestedRef.current = false;
    currentAudioFor(owner)?.pause();
    setPlaying(false);
    setAndPersistFolderAudioPlayer(owner.lifecycle, (previous) => ({ ...previous, dismissed: true }));
  }, [currentAudioFor, isCurrentStageOwner, setAndPersistFolderAudioPlayer, setPlaying]);

  const activate = useCallback((entry: FileLikeEntry) => {
    const owner = lifecycleOwner;
    if (!isCurrentLifecycleOwner(owner) || !owner.accountId || !isAudioFileEntry(entry)) {
      return;
    }

    const tracks = buildAudioPlaylistTracks(visibleItems ?? [], entry);
    if (tracks.length === 0) {
      return;
    }

    const savedFolderState = loadFolderAudioPlayerState(owner.accountId, owner.folderPath, owner.ports);
    const savedPreviewPosition = owner.ports.loadAudioPreviewPosition({ accountId: owner.accountId, path: entry.path }) ?? 0;
    const nextState = saveFolderAudioPlayerState({
      accountId: owner.accountId,
      folderPath: owner.folderPath,
      tracks,
      currentPath: entry.path,
      positionSeconds: savedFolderState?.currentPath === entry.path ? savedFolderState.positionSeconds : savedPreviewPosition,
      durationSeconds: savedFolderState?.currentPath === entry.path ? savedFolderState.durationSeconds : undefined,
      dismissed: false,
      updatedAt: owner.ports.nowIso()
    }, owner.ports);

    const currentStage = currentStageOwnerRef.current;
    const canReuse = currentStage === stageOwner && canReuseFolderAudioStream(
      folderAudioPlayer,
      owner.accountId,
      owner.folderPath,
      entry.path,
      folderAudioStreamUrl,
      Boolean(currentAudioFor(stageOwner))
    );

    if (canReuse) {
      setFolderAudioPlayer(nextState);
      setFolderAudioError(undefined);
      playFolderAudio(stageOwner);
      return;
    }

    folderAudioResumePendingRef.current = nextState.positionSeconds > 0
      ? { path: entry.path, positionSeconds: nextState.positionSeconds }
      : undefined;
    currentAudioFor(stageOwner)?.pause();
    setFolderAudioStreamUrl(undefined);
    setFolderAudioStreamRequestKey((key) => key + 1);
    setFolderAudioPlayer(nextState);
    folderAudioPlayRequestedRef.current = true;
    setPlaying(false);
    setFolderAudioError(undefined);
  }, [
    currentAudioFor,
    folderAudioPlayer,
    folderAudioStreamUrl,
    isCurrentLifecycleOwner,
    lifecycleOwner,
    playFolderAudio,
    setPlaying,
    stageOwner,
    visibleItems
  ]);

  useEffect(() => {
    if (!accountId) {
      setFolderAudioPlayer(undefined);
      return;
    }
    const saved = loadFolderAudioPlayerState(accountId, folderPath, ports);
    if (saved && !saved.dismissed) {
      folderAudioResumePendingRef.current = saved.positionSeconds > 0
        ? { path: saved.currentPath, positionSeconds: saved.positionSeconds }
        : undefined;
      setFolderAudioPlayer(saved);
      return;
    }
    setFolderAudioPlayer((previous) => {
      if (!previous || previous.accountId !== accountId || previous.folderPath !== folderPath) {
        setPlaying(false);
        return undefined;
      }
      return previous;
    });
  }, [accountId, folderPath, ports, setPlaying]);

  useEffect(() => {
    let cancelled = false;
    setFolderAudioStreamUrl(undefined);
    setFolderAudioError(undefined);
    if (!lifecycleOwner.trackPath || !lifecycleOwner.token || lifecycleOwner.cacheOnlyMode) {
      folderAudioPlayRequestedRef.current = false;
      setPlaying(false);
      return;
    }

    void lifecycleOwner.ports.createStreamingFileUrl(lifecycleOwner.trackPath, lifecycleOwner.token)
      .then((url) => {
        if (!cancelled && isCurrentLifecycleOwner(lifecycleOwner)) {
          setFolderAudioStreamUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled && isCurrentLifecycleOwner(lifecycleOwner)) {
          folderAudioPlayRequestedRef.current = false;
          setPlaying(false);
          setFolderAudioError("Audio stream is unavailable right now.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isCurrentLifecycleOwner, lifecycleOwner, setPlaying]);

  useEffect(() => {
    if (!folderAudioStreamUrl || !folderAudioPlayRequestedRef.current) {
      return;
    }
    folderAudioPlayRequestedRef.current = false;
    playFolderAudio(stageOwner);
  }, [folderAudioStreamUrl, playFolderAudio, stageOwner]);

  const handleLoadedMetadata = useCallback((owner: FolderAudioStageOwner, audio: HTMLAudioElement) => {
    if (!isCurrentStageOwner(owner) || currentAudioFor(owner) !== audio || !currentFolderAudioPlayer || !currentFolderAudioTrack) {
      return;
    }
    const pendingResume = folderAudioResumePendingRef.current?.path === currentFolderAudioTrack.path
      ? folderAudioResumePendingRef.current.positionSeconds
      : currentFolderAudioPlayer.positionSeconds;
    if (Number.isFinite(pendingResume) && pendingResume > 0) {
      audio.currentTime = Math.min(pendingResume, Number.isFinite(audio.duration) ? audio.duration : pendingResume);
    }
    folderAudioResumePendingRef.current = undefined;
    setAndPersistFolderAudioPlayer(owner.lifecycle, (previous) => ({
      ...previous,
      durationSeconds: Number.isFinite(audio.duration) ? audio.duration : previous.durationSeconds
    }));
  }, [currentAudioFor, currentFolderAudioPlayer, currentFolderAudioTrack, isCurrentStageOwner, setAndPersistFolderAudioPlayer]);

  const handleTimeUpdate = useCallback((owner: FolderAudioStageOwner, audio: HTMLAudioElement) => {
    if (!isCurrentStageOwner(owner) || currentAudioFor(owner) !== audio || !currentFolderAudioPlayer || !currentFolderAudioTrack || !owner.lifecycle.accountId) {
      return;
    }
    if (folderAudioResumePendingRef.current?.path === currentFolderAudioTrack.path) {
      return;
    }
    const nextPosition = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    setAndPersistFolderAudioPlayer(owner.lifecycle, (previous) => ({
      ...previous,
      positionSeconds: nextPosition,
      durationSeconds: Number.isFinite(audio.duration) ? audio.duration : previous.durationSeconds
    }));
    owner.lifecycle.ports.saveAudioPreviewPosition({ accountId: owner.lifecycle.accountId, path: currentFolderAudioTrack.path }, nextPosition);
  }, [currentAudioFor, currentFolderAudioPlayer, currentFolderAudioTrack, isCurrentStageOwner, setAndPersistFolderAudioPlayer]);

  const handleSeek = useCallback((owner: FolderAudioStageOwner, nextPosition: number) => {
    if (!isCurrentStageOwner(owner)) {
      return;
    }
    const audio = currentAudioFor(owner);
    if (audio && Number.isFinite(nextPosition)) {
      audio.currentTime = nextPosition;
    }
    setAndPersistFolderAudioPlayer(owner.lifecycle, (previous) => ({
      ...previous,
      positionSeconds: Number.isFinite(nextPosition) ? nextPosition : previous.positionSeconds
    }));
  }, [currentAudioFor, isCurrentStageOwner, setAndPersistFolderAudioPlayer]);

  const handleEnded = useCallback((owner: FolderAudioStageOwner) => {
    if (!isCurrentStageOwner(owner) || currentAudioFor(owner) === undefined || !currentFolderAudioPlayer) {
      return;
    }
    const nextTrack = currentFolderAudioPlayer.tracks[currentFolderAudioIndex + 1];
    if (nextTrack) {
      selectFolderAudioTrack(owner, nextTrack, { play: true });
      return;
    }
    setPlaying(false);
    setAndPersistFolderAudioPlayer(owner.lifecycle, (previous) => ({ ...previous, positionSeconds: 0 }));
  }, [currentAudioFor, currentFolderAudioIndex, currentFolderAudioPlayer, isCurrentStageOwner, selectFolderAudioTrack, setAndPersistFolderAudioPlayer, setPlaying]);

  const bindAudioRef = useCallback((element: HTMLAudioElement | null) => {
    if (element) {
      folderAudioRef.current = element;
      audioOwnerRef.current = { owner: stageOwner, element };
      return;
    }
    if (audioOwnerRef.current?.owner === stageOwner) {
      const boundAudio = audioOwnerRef.current.element;
      audioOwnerRef.current = undefined;
      if (folderAudioRef.current === boundAudio) {
        folderAudioRef.current = null;
      }
    }
  }, [stageOwner]);

  const onPause = useCallback(() => {
    if (isCurrentStageOwner(stageOwner) && currentAudioFor(stageOwner)) {
      setPlaying(false);
    }
  }, [currentAudioFor, isCurrentStageOwner, setPlaying, stageOwner]);
  const onPlay = useCallback(() => {
    if (isCurrentStageOwner(stageOwner) && currentAudioFor(stageOwner)) {
      setPlaying(true);
    }
  }, [currentAudioFor, isCurrentStageOwner, setPlaying, stageOwner]);
  const onSelectTrack = useCallback((track: AudioPlaylistTrack, options?: { play?: boolean }) => {
    selectFolderAudioTrack(stageOwner, track, options);
  }, [selectFolderAudioTrack, stageOwner]);
  const onTogglePlayback = useCallback(() => {
    toggleFolderAudioPlayback(stageOwner);
  }, [stageOwner, toggleFolderAudioPlayback]);
  const onClose = useCallback(() => {
    closeFolderAudioPlayer(stageOwner);
  }, [closeFolderAudioPlayer, stageOwner]);

  const stage = currentFolderAudioPlayer && currentFolderAudioTrack ? {
    folderLabel,
    player: currentFolderAudioPlayer,
    currentTrack: currentFolderAudioTrack,
    currentTrackIndex: currentFolderAudioIndex,
    durationSeconds: resolveTrackDuration(currentFolderAudioPlayer),
    remainingSeconds: resolveRemainingSeconds(currentFolderAudioPlayer),
    streamUrl: folderAudioStreamUrl,
    playing: folderAudioPlaying,
    error: folderAudioError,
    audioRef: bindAudioRef,
    audioKey: folderAudioStreamUrl ?? currentFolderAudioTrack.path,
    onEnded: () => handleEnded(stageOwner),
    onLoadedMetadata: (audio: HTMLAudioElement) => handleLoadedMetadata(stageOwner, audio),
    onPause,
    onPlay,
    onTimeUpdate: (audio: HTMLAudioElement) => handleTimeUpdate(stageOwner, audio),
    onSeek: (positionSeconds: number) => handleSeek(stageOwner, positionSeconds),
    onSkip: (deltaSeconds: number) => skipFolderAudio(stageOwner, deltaSeconds),
    onSelectTrack,
    onTogglePlayback,
    onClose
  } satisfies FolderAudioStageBindings : undefined;

  return {
    playing: folderAudioPlaying,
    pause,
    activate,
    stage
  };
}

export type { AudioPreviewResumeTarget };
