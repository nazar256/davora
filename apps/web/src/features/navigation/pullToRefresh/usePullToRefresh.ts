import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { OpenSurfacesSnapshot } from "../model";
import type { PullToRefreshGestureState } from "./model";
import {
  beginPullToRefreshGesture,
  cancelPullToRefreshGesture,
  commitPullToRefreshGesture,
  completePullToRefreshGesture,
  computePullToRefreshProgress,
  initialPullToRefreshGestureState,
  isPullToRefreshEligible,
  isScrollAtOrigin,
  shouldCommitPullToRefresh,
  updatePullToRefreshGesture
} from "./model";
import type { PullToRefreshScrollOriginPort } from "./ports";

/** Minimal touch shape so tests and React.TouchEvent both satisfy without casts. */
export interface PullToRefreshTouchEvent {
  readonly touches: ArrayLike<{ readonly clientY: number }>;
}

export interface UsePullToRefreshInput {
  readonly cacheOnlyMode: boolean;
  readonly getCurrentPath: () => string;
  readonly getToken: () => string | undefined;
  readonly getOpenSurfaces: () => OpenSurfacesSnapshot;
  readonly scrollOrigin: PullToRefreshScrollOriginPort;
  readonly onRefresh: () => Promise<void>;
}

export const usePullToRefresh = (input: UsePullToRefreshInput) => {
  const inputRef = useRef(input);
  useLayoutEffect(() => {
    inputRef.current = input;
  }, [input]);

  const [gesture, setGesture] = useState<PullToRefreshGestureState>(initialPullToRefreshGestureState);
  const pullStartYRef = useRef(0);
  const pullActiveRef = useRef(false);
  const progressRef = useRef(0);
  const refreshingRef = useRef(false);
  const mountedRef = useRef(false);
  const refreshGenerationRef = useRef(0);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshGenerationRef.current += 1;
    };
  }, []);

  const readScrollOrigin = useCallback(() => {
    const { scrollOrigin } = inputRef.current;
    return {
      windowScrollY: scrollOrigin.getWindowScrollY(),
      fileListScrollTop: scrollOrigin.getFileListScrollTop()
    };
  }, []);

  const readEligibility = useCallback(() => {
    const current = inputRef.current;
    return isPullToRefreshEligible({
      cacheOnlyMode: current.cacheOnlyMode,
      currentPath: current.getCurrentPath(),
      token: current.getToken(),
      openSurfaces: current.getOpenSurfaces(),
      scrollOrigin: readScrollOrigin()
    });
  }, [readScrollOrigin]);

  const onTouchStart = useCallback((event: PullToRefreshTouchEvent) => {
    if (refreshingRef.current || !readEligibility()) {
      return;
    }
    pullStartYRef.current = event.touches[0]?.clientY ?? 0;
    pullActiveRef.current = true;
    progressRef.current = 0;
    setGesture(beginPullToRefreshGesture());
  }, [readEligibility]);

  const onTouchMove = useCallback((event: PullToRefreshTouchEvent) => {
    if (!pullActiveRef.current || !isScrollAtOrigin(readScrollOrigin())) {
      return;
    }
    const diff = (event.touches[0]?.clientY ?? 0) - pullStartYRef.current;
    if (diff > 0) {
      progressRef.current = computePullToRefreshProgress(diff);
      setGesture((state) => updatePullToRefreshGesture(state, diff));
    }
  }, [readScrollOrigin]);

  const onTouchEnd = useCallback(() => {
    if (!pullActiveRef.current) {
      return;
    }
    pullActiveRef.current = false;
    const shouldRefresh = shouldCommitPullToRefresh(progressRef.current);
    if (shouldRefresh) {
      refreshingRef.current = true;
      setGesture(commitPullToRefreshGesture());
      const generation = ++refreshGenerationRef.current;
      const complete = () => {
        if (!mountedRef.current || refreshGenerationRef.current !== generation) {
          return;
        }
        progressRef.current = 0;
        refreshingRef.current = false;
        setGesture(completePullToRefreshGesture());
      };
      try {
        void Promise.resolve(inputRef.current.onRefresh()).then(complete, complete);
      } catch {
        complete();
      }
      return;
    }
    progressRef.current = 0;
    setGesture(cancelPullToRefreshGesture());
  }, []);

  return {
    progress: gesture.progress,
    visible: gesture.visible,
    refreshing: gesture.refreshing,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd
    }
  } as const;
};
