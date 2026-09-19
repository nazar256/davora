import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import {
  buildMediaRetryUrl,
  hasRemainingStreamRetries,
  isStreamingMediaSource,
  MEDIA_STREAM_RETRY_DELAYS_MS,
  resolveStreamRetryDelayMs,
  shouldEnterBufferingOnWaiting,
  type MediaStreamState
} from "../media";
import {
  canRestoreAudioPreviewPosition,
  type AudioPreviewSource
} from "./model";
import type { AudioPreviewRuntimePorts } from "./ports";
import type { AudioPreviewInteraction } from "./types";
interface AudioPlaybackOwner {
  readonly element: HTMLAudioElement;
  readonly publish: (playing: boolean) => void;
}
export function useAudioPreviewInteraction({
  source,
  onMediaPlaybackChange,
  ports
}: {
  readonly source: AudioPreviewSource;
  readonly onMediaPlaybackChange?: (playing: boolean) => void;
  readonly ports: AudioPreviewRuntimePorts;
}): AudioPreviewInteraction {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mountedRef = useRef(true);
  const retryTimeoutRef = useRef<number | undefined>();
  const retryTimeoutPortsRef = useRef<AudioPreviewRuntimePorts | undefined>();
  const retryEpochRef = useRef(0);
  const activePlaybackOwnerRef = useRef<AudioPlaybackOwner | undefined>();
  const lastPersistedAudioSecondRef = useRef<number | undefined>();
  const onMediaPlaybackChangeRef = useRef(onMediaPlaybackChange);
  const [streamState, setStreamState] = useState<MediaStreamState>("idle");
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const streamSource = source.enabled && isStreamingMediaSource(source.sourceUrl);
  const effectiveSource = source.enabled && source.sourceUrl
    ? streamSource
      ? buildMediaRetryUrl(source.sourceUrl, retryKey, ports.getLocationHref())
      : source.sourceUrl
    : undefined;
  const audioElementKey = JSON.stringify({
    enabled: source.enabled,
    accountId: source.accountId ?? null,
    path: source.path ?? null,
    sourceUrl: source.sourceUrl ?? null,
    effectiveSource: effectiveSource ?? null
  });
  useEffect(() => {
    onMediaPlaybackChangeRef.current = onMediaPlaybackChange;
  }, [onMediaPlaybackChange]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const clearRetryTimeout = useCallback(() => {
    retryEpochRef.current += 1;
    const timeoutId = retryTimeoutRef.current;
    if (timeoutId !== undefined) {
      retryTimeoutPortsRef.current?.clearTimeout(timeoutId);
      retryTimeoutRef.current = undefined; retryTimeoutPortsRef.current = undefined;
    }
  }, []);
  const resetStreamState = useCallback(() => {
    clearRetryTimeout();
    setStreamState("idle"); setRetryAttempt(0); setRetryKey(0); setAutoplayBlocked(false);
  }, [clearRetryTimeout]);
  useEffect(() => {
    resetStreamState();
  }, [ports, resetStreamState, source.accountId, source.enabled, source.path, source.sourceUrl]);
  useEffect(() => clearRetryTimeout, [clearRetryTimeout]);
  const isCurrentMedia = useCallback((element: HTMLAudioElement): boolean => {
    return mountedRef.current && audioRef.current === element;
  }, []);
  const publishStoppedForRetiringMedia = useCallback((element: HTMLAudioElement) => {
    const activeOwner = activePlaybackOwnerRef.current;
    if (activeOwner?.element !== element) {
      return;
    }
    activePlaybackOwnerRef.current = undefined;
    activeOwner.publish(false);
  }, []);
  useEffect(() => {
    if (!source.enabled || !effectiveSource) {
      return;
    }
    const media = audioRef.current;
    if (!media) {
      return;
    }
    let cancelled = false;
    setAutoplayBlocked(false);
    try {
      void Promise.resolve(media.play()).catch(() => {
        if (!cancelled && isCurrentMedia(media)) {
          setAutoplayBlocked(true);
        }
      });
    } catch {
      if (!cancelled && isCurrentMedia(media)) {
        setAutoplayBlocked(true);
      }
    }
    return () => {
      cancelled = true;
      publishStoppedForRetiringMedia(media);
      try {
        media.pause();
      } catch {
        // Best-effort cleanup; media may already be detached.
      }
    };
  }, [audioElementKey, effectiveSource, isCurrentMedia, publishStoppedForRetiringMedia, source.enabled]);
  useLayoutEffect(() => {
    const audio = audioRef.current;
    const accountId = source.enabled ? source.accountId : undefined;
    const path = source.enabled ? source.path : undefined;
    if (!audio || !effectiveSource || !accountId || !path) {
      return;
    }
    const target = { accountId, path };
    let active = true;
    lastPersistedAudioSecondRef.current = undefined;
    const applyStoredPosition = (validateAgainstDuration: boolean) => {
      const storedPosition = ports.loadAudioPreviewPosition(target);
      if (storedPosition === undefined) {
        return;
      }
      if (validateAgainstDuration && !canRestoreAudioPreviewPosition(audio, storedPosition)) {
        ports.clearAudioPreviewPosition(target);
        try {
          audio.currentTime = 0;
        } catch {
        }
        return;
      }
      try {
        audio.currentTime = storedPosition;
      } catch {
      }
    };
    const persistPosition = (force: boolean) => {
      const currentTime = audio.currentTime;
      if (!Number.isFinite(currentTime) || currentTime <= 0) {
        if (force && lastPersistedAudioSecondRef.current !== undefined) {
          ports.clearAudioPreviewPosition(target);
          lastPersistedAudioSecondRef.current = 0;
        }
        return;
      }
      const roundedSecond = Math.floor(currentTime);
      if (!force && lastPersistedAudioSecondRef.current === roundedSecond) {
        return;
      }
      ports.saveAudioPreviewPosition(target, currentTime);
      lastPersistedAudioSecondRef.current = roundedSecond;
    };
    const clearPosition = () => {
      ports.clearAudioPreviewPosition(target);
      lastPersistedAudioSecondRef.current = 0;
    };
    function handleTimeUpdate() {
      if (active) {
        persistPosition(false);
      }
    }
    function handlePause() {
      if (active && !audio?.ended) {
        persistPosition(true);
      }
    }
    function handleEnded() {
      if (active) {
        clearPosition();
      }
    }
    function handleLoadedMetadata() {
      if (active) {
        applyStoredPosition(true);
      }
    }
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    applyStoredPosition(false);
    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      if (!audio.ended) {
        persistPosition(true);
      }
      active = false;
    };
  }, [audioElementKey, effectiveSource, ports, source.accountId, source.enabled, source.path]);
  const bindAudioRef = useCallback((element: HTMLAudioElement | null) => { audioRef.current = element; }, []);
  const handleMediaReady = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
    if (isCurrentMedia(event.currentTarget) && streamSource) setStreamState("idle");
  }, [isCurrentMedia, streamSource]);
  const handleMediaPlaying = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
    if (!isCurrentMedia(event.currentTarget)) {
      return;
    }
    handleMediaReady(event);
    setAutoplayBlocked(false);
    const publish = onMediaPlaybackChangeRef.current;
    if (publish) { activePlaybackOwnerRef.current = { element: event.currentTarget, publish }; publish(true); }
  }, [handleMediaReady, isCurrentMedia]);
  const handleMediaStopped = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
    if (!isCurrentMedia(event.currentTarget)) {
      return;
    }
    const activeOwner = activePlaybackOwnerRef.current;
    if (activeOwner?.element === event.currentTarget) { activePlaybackOwnerRef.current = undefined; activeOwner.publish(false); return; }
    onMediaPlaybackChangeRef.current?.(false);
  }, [isCurrentMedia]);
  const startPlayback = useCallback(() => {
    const media = audioRef.current;
    if (!media) return;
    setAutoplayBlocked(false);
    try {
      void Promise.resolve(media.play()).catch(() => {
        if (isCurrentMedia(media)) setAutoplayBlocked(true);
      });
    } catch {
      if (isCurrentMedia(media)) setAutoplayBlocked(true);
    }
  }, [isCurrentMedia]);
  const retryStreamNow = useCallback(() => {
    clearRetryTimeout();
    setRetryAttempt(0);
    setStreamState("buffering");
    setRetryKey((current) => current + 1);
  }, [clearRetryTimeout]);
  const handleMediaWaiting = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
    if (isCurrentMedia(event.currentTarget) && shouldEnterBufferingOnWaiting(streamSource, streamState)) setStreamState("buffering");
  }, [isCurrentMedia, streamSource, streamState]);
  const handleMediaError = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
    if (!isCurrentMedia(event.currentTarget)) {
      return;
    }
    handleMediaStopped(event);
    if (!streamSource) {
      return;
    }
    if (hasRemainingStreamRetries(retryAttempt, MEDIA_STREAM_RETRY_DELAYS_MS.length)) {
      const nextAttempt = retryAttempt + 1;
      setRetryAttempt(nextAttempt);
      setStreamState("retrying");
      clearRetryTimeout();
      const delayMs = resolveStreamRetryDelayMs(nextAttempt);
      if (delayMs !== undefined) {
        const retryEpoch = retryEpochRef.current;
        const timeoutId = ports.setTimeout(() => {
          if (retryEpochRef.current !== retryEpoch) {
            return;
          }
          retryTimeoutRef.current = undefined;
          retryTimeoutPortsRef.current = undefined;
          setStreamState("buffering");
          setRetryKey((current) => current + 1);
        }, delayMs);
        retryTimeoutRef.current = timeoutId;
        retryTimeoutPortsRef.current = ports;
      }
      return;
    }
    setStreamState("failed");
  }, [clearRetryTimeout, handleMediaStopped, isCurrentMedia, ports, retryAttempt, streamSource]);
  return {
    stage: {
      audioRef: bindAudioRef,
      audioElementKey,
      effectiveSource,
      streamSource,
      streamState,
      retryAttempt,
      maxRetries: MEDIA_STREAM_RETRY_DELAYS_MS.length,
      autoplayBlocked,
      onCanPlay: handleMediaReady,
      onWaiting: handleMediaWaiting,
      onError: handleMediaError,
      onPlay: handleMediaPlaying,
      onPlaying: handleMediaPlaying,
      onPause: handleMediaStopped,
      onEnded: handleMediaStopped,
      startPlayback,
      retryStreamNow
    }
  };
}
