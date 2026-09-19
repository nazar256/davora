// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT,
  WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT
} from "../../features/navigation/viewport";
import { createBrowserResponsiveViewportPort } from "./browserResponsiveViewportPort";

function createMediaQueryList(initialMatches: boolean) {
  let matches = initialMatches;
  type MediaQueryListener = () => void;
  const listeners = new Set<MediaQueryListener>();
  const addEventListener = vi.fn((_type: "change", listener: MediaQueryListener) => {
    listeners.add(listener);
  });
  const removeEventListener = vi.fn((_type: "change", listener: MediaQueryListener) => {
    listeners.delete(listener);
  });
  return {
    get matches() {
      return matches;
    },
    addEventListener,
    removeEventListener,
    emit(nextMatches: boolean) {
      matches = nextMatches;
      for (const listener of [...listeners]) listener();
    },
    listeners
  };
}

describe("createBrowserResponsiveViewportPort", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });

  it.each([
    [320, true, NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT],
    [768, true, NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT],
    [900, true, NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT],
    [901, false, WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT],
    [1440, false, WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT]
  ])("creates one inclusive narrow-query media service at %spx", (width, matches, expectedSnapshot) => {
    const mediaQuery = createMediaQueryList(matches);
    const matchMedia = vi.fn(() => mediaQuery);
    Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });

    const port = createBrowserResponsiveViewportPort();

    expect(matches).toBe(width <= 900);
    expect(matchMedia).toHaveBeenCalledOnce();
    expect(matchMedia).toHaveBeenCalledWith("(max-width: 900px)");
    expect(port.getSnapshot()).toEqual(expectedSnapshot);
    const narrowSnapshot = port.getSnapshot();
    expect(port.getSnapshot()).toBe(narrowSnapshot);

    mediaQuery.emit(!matches);
    expect(port.getSnapshot()).toEqual(matches ? WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT : NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT);
  });

  it("notifies changes with an owned listener and ignores late callbacks after unsubscribe", () => {
    const mediaQuery = createMediaQueryList(false);
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => mediaQuery) });
    const listener = vi.fn();
    const port = createBrowserResponsiveViewportPort();
    const unsubscribe = port.subscribe(listener);

    expect(mediaQuery.addEventListener).toHaveBeenCalledTimes(1);
    const registeredListener = mediaQuery.addEventListener.mock.calls[0]?.[1];
    mediaQuery.emit(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(port.getSnapshot()).toEqual(NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT);

    unsubscribe();
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith("change", registeredListener);
    expect(mediaQuery.listeners).toHaveLength(0);
    registeredListener?.();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(mediaQuery.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
