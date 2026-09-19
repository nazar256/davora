import { describe, expect, it } from "vitest";

import {
  beginPullToRefreshGesture,
  cancelPullToRefreshGesture,
  commitPullToRefreshGesture,
  completePullToRefreshGesture,
  computePullToRefreshProgress,
  initialPullToRefreshGestureState,
  isPullToRefreshEligible,
  isPullToRefreshIndicatorVisible,
  isScrollAtOrigin,
  shouldCommitPullToRefresh,
  updatePullToRefreshGesture
} from "./model";
import type { OpenSurfacesSnapshot } from "../model";

const closedSurfaces = (): OpenSurfacesSnapshot => ({
  preview: false,
  action: false,
  destination: false,
  account: false,
  removeAccount: false,
  folderShortcut: false,
  settings: false,
  search: false,
  navigation: false,
  mobileDetails: false,
  transfers: false,
  quickActions: false
});

const onlyOpen = (surface: keyof OpenSurfacesSnapshot): OpenSurfacesSnapshot => ({
  ...closedSurfaces(),
  [surface]: true
});

describe("pull-to-refresh model", () => {
  const eligibleInput = () => ({
    cacheOnlyMode: false,
    currentPath: "Projects",
    token: "token-alpha",
    openSurfaces: closedSurfaces(),
    scrollOrigin: { windowScrollY: 0, fileListScrollTop: 0 }
  });

  it("allows refresh when path, token, scroll origin, and surfaces are ready", () => {
    expect(isPullToRefreshEligible(eligibleInput())).toBe(true);
  });

  it("blocks cache-only mode", () => {
    expect(isPullToRefreshEligible({ ...eligibleInput(), cacheOnlyMode: true })).toBe(false);
  });

  it("blocks when window or file-list scroll is away from origin", () => {
    expect(isPullToRefreshEligible({ ...eligibleInput(), scrollOrigin: { windowScrollY: 1, fileListScrollTop: 0 } })).toBe(false);
    expect(isPullToRefreshEligible({ ...eligibleInput(), scrollOrigin: { windowScrollY: 0, fileListScrollTop: 12 } })).toBe(false);
  });

  it("accepts either scroll origin at or below zero only when both are at origin", () => {
    expect(isPullToRefreshEligible({ ...eligibleInput(), scrollOrigin: { windowScrollY: -1, fileListScrollTop: 0 } })).toBe(true);
    expect(isPullToRefreshEligible({ ...eligibleInput(), scrollOrigin: { windowScrollY: 0, fileListScrollTop: -1 } })).toBe(true);
  });

  it("blocks without a current path or token", () => {
    expect(isPullToRefreshEligible({ ...eligibleInput(), currentPath: "" })).toBe(false);
    expect(isPullToRefreshEligible({ ...eligibleInput(), token: undefined })).toBe(false);
  });

  it("blocks while any open surface is present", () => {
    const surfaces: Array<keyof OpenSurfacesSnapshot> = [
      "preview", "action", "destination", "account", "removeAccount", "folderShortcut",
      "settings", "search", "navigation", "mobileDetails", "transfers", "quickActions"
    ];
    for (const surface of surfaces) {
      expect(isPullToRefreshEligible({ ...eligibleInput(), openSurfaces: onlyOpen(surface) })).toBe(false);
    }
  });

  it("maps pull distance to clamped progress and visibility threshold", () => {
    expect(computePullToRefreshProgress(-1)).toBe(0);
    expect(computePullToRefreshProgress(0)).toBe(0);
    expect(computePullToRefreshProgress(12)).toBe(0.1);
    expect(computePullToRefreshProgress(13)).toBeCloseTo(13 / 120);
    expect(computePullToRefreshProgress(60)).toBe(0.5);
    expect(computePullToRefreshProgress(120)).toBe(1);
    expect(computePullToRefreshProgress(240)).toBe(1);
    expect(isPullToRefreshIndicatorVisible(0.1)).toBe(false);
    expect(isPullToRefreshIndicatorVisible(0.1001)).toBe(true);
  });

  it("tracks scroll-origin readiness for move/end gating", () => {
    expect(isScrollAtOrigin({ windowScrollY: 0, fileListScrollTop: 0 })).toBe(true);
    expect(isScrollAtOrigin({ windowScrollY: 0, fileListScrollTop: 1 })).toBe(false);
  });

  it("transitions through begin, update, commit, complete, and cancel", () => {
    const pulling = beginPullToRefreshGesture();
    expect(pulling).toEqual({ phase: "pulling", progress: 0, visible: false, refreshing: false });
    const midPull = updatePullToRefreshGesture(pulling, 18);
    expect(midPull.progress).toBe(0.15);
    expect(midPull.visible).toBe(true);
    const releaseReady = updatePullToRefreshGesture(pulling, 120);
    expect(shouldCommitPullToRefresh(releaseReady.progress)).toBe(true);
    expect(commitPullToRefreshGesture()).toEqual({ phase: "refreshing", progress: 1, visible: true, refreshing: true });
    expect(completePullToRefreshGesture()).toEqual(initialPullToRefreshGestureState());
    expect(cancelPullToRefreshGesture()).toEqual(initialPullToRefreshGestureState());
  });
});
