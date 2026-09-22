
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  buildMediaRetryUrl,
  hasRemainingStreamRetries,
  isStreamingMediaSource,
  MEDIA_STREAM_RETRY_DELAYS_MS,
  resolveStreamRetryDelayMs,
  shouldEnterBufferingOnWaiting,
  VIDEO_OVERLAY_AUTO_HIDE_DELAY_MS,
  type MediaStreamState
} from "../media";
import type { VideoPreviewRuntimePorts } from "./ports";

interface VideoPreviewSource {
  enabled: boolean;
  blobUrl?: string;
  filePath?: string;
}

interface VideoPreviewInteractionOptions {
  source: VideoPreviewSource;
  muted?: boolean;
  onMediaPlaybackChange?: (playing: boolean) => void;
  onMutedChange?: (muted: boolean) => void;
  ports: VideoPreviewRuntimePorts;
}

interface RetryTimer {
  readonly id: number;
  readonly token: symbol;
}

interface VideoOwner {
  media: HTMLVideoElement | null;
  mediaSource?: string;
  ports: VideoPreviewRuntimePorts;
  playbackChange?: (playing: boolean) => void;
  mutedChange?: (muted: boolean) => void;
  retired: boolean;
  retryTimer?: RetryTimer;
  overlayTimer?: RetryTimer;
}

interface VideoMediaEventLike {
  readonly currentTarget?: EventTarget | null;
}

function hasCurrentTarget(value: object): value is VideoMediaEventLike {
  return "currentTarget" in value;
}

function eventMedia(event: unknown): HTMLVideoElement | undefined {
  if (!event || typeof event !== "object") {
    return undefined;
  }
  if (!hasCurrentTarget(event)) {
    return undefined;
  }
  const currentTarget = event.currentTarget;
  return currentTarget instanceof HTMLVideoElement ? currentTarget : undefined;
}

export interface VideoPreviewStageBindings {
  videoRef: (element: HTMLVideoElement | null) => void;
  effectiveSource: string | undefined;
  streamSource: boolean;
  streamState: MediaStreamState;
  retryAttempt: number;
  maxRetries: number;
  autoplayBlocked: boolean;
  muted: boolean;
  onCanPlay: () => void;
  onError: () => void;
  onEnded: () => void;
  onPause: () => void;
  onPlay: () => void;
  onPlaying: () => void;
  onVolumeChange: () => void;
  onWaiting: () => void;
  startPlayback: () => void;
  retryStreamNow: () => void;
}

export interface VideoPreviewOverlayBindings {
  visible: boolean;
  playing: boolean;
  notifyActivity: () => void;
}

export interface VideoPreviewInteraction {
  stage: VideoPreviewStageBindings;
  overlay: VideoPreviewOverlayBindings;
}

export function useVideoPreviewInteraction({
  source,
  muted = false,
  onMediaPlaybackChange,
  onMutedChange,
  ports
}: VideoPreviewInteractionOptions): VideoPreviewInteraction {
  const [streamState, setStreamState] = useState<MediaStreamState>("idle");
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [mediaGeneration, setMediaGeneration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [overlayRevealed, setOverlayRevealed] = useState(true);

  const owner = useMemo<VideoOwner>(() => ({
    media: null,
    ports,
    retired: false
    // eslint-disable-next-line react-hooks/exhaustive-deps -- source fields intentionally re-create the owner
  }), [ports, source.blobUrl, source.enabled, source.filePath]);
  const activeOwnerRef = useRef<VideoOwner | undefined>();
  const activeStageTokenRef = useRef<object | undefined>();
  const mountedRef = useRef(false);

  const streamSource = source.enabled && isStreamingMediaSource(source.blobUrl);
  const effectiveSource = source.enabled && source.blobUrl
    ? streamSource
      ? buildMediaRetryUrl(source.blobUrl, retryKey, ports.getLocationHref())
      : source.blobUrl
    : undefined;
  const stageToken = useMemo(() => ({ effectiveSource, mediaGeneration }), [effectiveSource, mediaGeneration]);

  const clearRetryTimeout = useCallback((candidate: VideoOwner, expected?: RetryTimer) => {
    const timer = candidate.retryTimer;
    if (!timer || (expected && timer.token !== expected.token)) {
      return;
    }
    candidate.ports.clearTimeout(timer.id);
    candidate.retryTimer = undefined;
  }, []);

  const clearOverlayTimeout = useCallback((candidate: VideoOwner, expected?: RetryTimer) => {
    const timer = candidate.overlayTimer;
    if (!timer || (expected && timer.token !== expected.token)) {
      return;
    }
    candidate.ports.clearTimeout(timer.id);
    candidate.overlayTimer = undefined;
  }, []);

  const retireOwner = useCallback((candidate: VideoOwner) => {
    if (candidate.retired) {
      return;
    }
    candidate.retired = true;
    clearRetryTimeout(candidate);
    clearOverlayTimeout(candidate);
    const media = candidate.media;
    candidate.media = null;
    if (!media) {
      return;
    }
    try {
      media.pause();
    } catch {
      // Best-effort cleanup; media may already be detached.
    }
    candidate.playbackChange?.(false);
  }, [clearOverlayTimeout, clearRetryTimeout]);

  const retireMedia = useCallback((candidate: VideoOwner, media: HTMLVideoElement, resetState = true) => {
    if (candidate.retired || candidate.media !== media) {
      return;
    }
    candidate.media = null;
    clearRetryTimeout(candidate);
    clearOverlayTimeout(candidate);
    if (resetState) {
      setStreamState("idle");
      setRetryAttempt(0);
      setRetryKey(0);
      setAutoplayBlocked(false);
      setPlaying(false);
      setOverlayRevealed(true);
    }
    try {
      media.pause();
    } catch {
      // Best-effort cleanup; media may already be detached.
    }
    candidate.playbackChange?.(false);
  }, [clearOverlayTimeout, clearRetryTimeout]);

  const isCurrentOwner = useCallback((candidate: VideoOwner, media?: HTMLVideoElement) => {
    if (!mountedRef.current || candidate.retired || activeOwnerRef.current !== candidate) {
      return false;
    }
    if (!candidate.media || !candidate.media.isConnected) {
      return false;
    }
    return media === undefined || candidate.media === media;
  }, []);

  const scheduleOverlayHide = useCallback((candidate: VideoOwner) => {
    clearOverlayTimeout(candidate);
    const token = Symbol("video-overlay-hide");
    const timerId = candidate.ports.setTimeout(() => {
      if (!isCurrentOwner(candidate) || candidate.overlayTimer?.token !== token) {
        return;
      }
      candidate.overlayTimer = undefined;
      setOverlayRevealed(false);
    }, VIDEO_OVERLAY_AUTO_HIDE_DELAY_MS);
    candidate.overlayTimer = { id: timerId, token };
  }, [clearOverlayTimeout, isCurrentOwner]);

  const currentMediaFor = useCallback((candidate: VideoOwner, token: object, event?: unknown) => {
    const media = eventMedia(event) ?? candidate.media;
    if (activeStageTokenRef.current !== token || !media || !isCurrentOwner(candidate, media)) {
      return undefined;
    }
    return media;
  }, [isCurrentOwner]);

  useLayoutEffect(() => {
    activeStageTokenRef.current = stageToken;
  }, [stageToken]);

  useLayoutEffect(() => {
    owner.playbackChange = onMediaPlaybackChange;
    owner.mutedChange = onMutedChange;
  }, [onMediaPlaybackChange, onMutedChange, owner]);

  useLayoutEffect(() => {
    activeOwnerRef.current = owner;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, [owner]);

  const resetStreamState = useCallback(() => {
    setStreamState("idle");
    setRetryAttempt(0);
    setRetryKey(0);
    setAutoplayBlocked(false);
    setPlaying(false);
    setOverlayRevealed(true);
    clearRetryTimeout(owner);
    clearOverlayTimeout(owner);
  }, [clearOverlayTimeout, clearRetryTimeout, owner]);

  useEffect(() => {
    resetStreamState();
  }, [resetStreamState, source.blobUrl, source.enabled, source.filePath]);

  useEffect(() => {
    if (!source.enabled || !effectiveSource) {
      return;
    }

    const media = owner.media;
    if (!media) {
      return;
    }

    let cancelled = false;
    setAutoplayBlocked(false);
    const markAutoplayBlocked = () => {
      if (!cancelled && isCurrentOwner(owner, media)) {
        setAutoplayBlocked(true);
      }
    };
    try {
      void Promise.resolve(media.play()).catch(markAutoplayBlocked);
    } catch {
      markAutoplayBlocked();
    }

    return () => {
      cancelled = true;
      if (activeOwnerRef.current !== owner || !owner.media?.isConnected) {
        retireOwner(owner);
      } else if (!owner.retired && owner.media === media) {
        try {
          media.pause();
        } catch {
          // Best-effort cleanup; media may already be detached.
        }
        owner.playbackChange?.(false);
      }
    };
  }, [effectiveSource, isCurrentOwner, owner, retireOwner, source.enabled, source.filePath]);

  const handleMediaReady = useCallback((event?: unknown) => {
    if (!currentMediaFor(owner, stageToken, event)) {
      return;
    }
    if (streamSource) {
      setStreamState("idle");
    }
  }, [currentMediaFor, owner, stageToken, streamSource]);

  const handleMediaPlaying = useCallback((event?: unknown) => {
    if (!currentMediaFor(owner, stageToken, event)) {
      return;
    }
    handleMediaReady(event);
    setAutoplayBlocked(false);
    setPlaying(true);
    setOverlayRevealed(false);
    clearOverlayTimeout(owner);
    owner.playbackChange?.(true);
  }, [clearOverlayTimeout, currentMediaFor, handleMediaReady, owner, stageToken]);

  const handleMediaStopped = useCallback((event?: unknown) => {
    if (!currentMediaFor(owner, stageToken, event)) {
      return;
    }
    setPlaying(false);
    setOverlayRevealed(true);
    clearOverlayTimeout(owner);
    owner.playbackChange?.(false);
  }, [clearOverlayTimeout, currentMediaFor, owner, stageToken]);

  const handleMediaWaiting = useCallback((event?: unknown) => {
    if (!currentMediaFor(owner, stageToken, event)) {
      return;
    }
    if (shouldEnterBufferingOnWaiting(streamSource, streamState)) {
      setStreamState("buffering");
    }
  }, [currentMediaFor, owner, stageToken, streamSource, streamState]);

  const handleMediaVolumeChange = useCallback((event?: unknown) => {
    const media = currentMediaFor(owner, stageToken, event);
    if (!media) {
      return;
    }
    owner.mutedChange?.(media.muted);
  }, [currentMediaFor, owner, stageToken]);

  const startPlayback = useCallback(async () => {
    const media = currentMediaFor(owner, stageToken);
    if (!media) {
      return;
    }
    setAutoplayBlocked(false);
    try {
      await media.play();
    } catch {
      if (isCurrentOwner(owner, media)) {
        setAutoplayBlocked(true);
      }
    }
  }, [currentMediaFor, isCurrentOwner, owner, stageToken]);

  const retryStreamNow = useCallback(() => {
    if (!currentMediaFor(owner, stageToken)) {
      return;
    }
    clearRetryTimeout(owner);
    setRetryAttempt(0);
    setStreamState("buffering");
    setRetryKey((current) => current + 1);
  }, [clearRetryTimeout, currentMediaFor, owner, stageToken]);

  const handleMediaError = useCallback((event?: unknown) => {
    if (!currentMediaFor(owner, stageToken, event)) {
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
      clearRetryTimeout(owner);
      const delayMs = resolveStreamRetryDelayMs(nextAttempt);
      if (delayMs !== undefined) {
        const token = Symbol("video-retry");
        const timerId = owner.ports.setTimeout(() => {
          if (!isCurrentOwner(owner) || owner.retryTimer?.token !== token) {
            return;
          }
          owner.retryTimer = undefined;
          setStreamState("buffering");
          setRetryKey((current) => current + 1);
        }, delayMs);
        owner.retryTimer = { id: timerId, token };
      }
      return;
    }

    setStreamState("failed");
  }, [clearRetryTimeout, currentMediaFor, handleMediaStopped, isCurrentOwner, owner, retryAttempt, stageToken, streamSource]);

  const bindVideoRef = useCallback((element: HTMLVideoElement | null) => {
    if (owner.retired) {
      return;
    }
    if (!element) {
      return;
    }
    const previousMedia = owner.media;
    if (previousMedia && previousMedia !== element) {
      retireMedia(owner, previousMedia, owner.mediaSource === effectiveSource);
    }
    owner.media = element;
    owner.mediaSource = effectiveSource;
    if (previousMedia !== element) {
      setMediaGeneration((current) => current + 1);
    }
  }, [effectiveSource, owner, retireMedia]);

  const notifyOverlayActivity = useCallback(() => {
    if (!isCurrentOwner(owner)) {
      return;
    }
    setOverlayRevealed(true);
    if (playing) {
      scheduleOverlayHide(owner);
    } else {
      clearOverlayTimeout(owner);
    }
  }, [clearOverlayTimeout, isCurrentOwner, owner, playing, scheduleOverlayHide]);

  return {
    overlay: {
      visible: !playing || overlayRevealed,
      playing,
      notifyActivity: notifyOverlayActivity
    },
    stage: {
      videoRef: bindVideoRef,
      effectiveSource,
      streamSource,
      streamState,
      retryAttempt,
      maxRetries: MEDIA_STREAM_RETRY_DELAYS_MS.length,
      autoplayBlocked,
      muted,
      onCanPlay: handleMediaReady,
      onError: handleMediaError,
      onEnded: handleMediaStopped,
      onPause: handleMediaStopped,
      onPlay: handleMediaPlaying,
      onPlaying: handleMediaPlaying,
      onVolumeChange: handleMediaVolumeChange,
      onWaiting: handleMediaWaiting,
      startPlayback: () => {
        void startPlayback();
      },
      retryStreamNow
    }
  };
}
