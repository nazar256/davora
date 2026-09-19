// @vitest-environment jsdom

import { StrictMode } from "react";

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT,
  WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT,
  type ResponsiveViewportListener,
  type ResponsiveViewportPort,
  type ResponsiveViewportSnapshot
} from "./ports";
import { useResponsiveViewport } from "./useResponsiveViewport";

function createFakePort(initial: ResponsiveViewportSnapshot) {
  let snapshot = initial;
  const listeners = new Set<ResponsiveViewportListener>();
  const getSnapshot = vi.fn(() => snapshot);
  const subscribe = vi.fn((listener: ResponsiveViewportListener) => {
    listeners.add(listener);
    return vi.fn(() => listeners.delete(listener));
  });
  return {
    port: { getSnapshot, subscribe } satisfies ResponsiveViewportPort,
    emit(next: ResponsiveViewportSnapshot) {
      snapshot = next;
      for (const listener of [...listeners]) listener();
    },
    listeners
  };
}

describe("useResponsiveViewport", () => {
  it.each([
    [NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT, true],
    [WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT, false]
  ])("reads the initial %s snapshot during render", (initial, isNarrowScreen) => {
    const fake = createFakePort(initial);
    const { result } = renderHook(() => useResponsiveViewport({ port: fake.port }));

    expect(fake.port.getSnapshot).toHaveBeenCalled();
    expect(result.current).toEqual({ snapshot: initial, isNarrowScreen });
  });

  it("publishes transitions while keeping duplicate snapshots referentially stable", () => {
    const fake = createFakePort(WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT);
    const { result } = renderHook(() => useResponsiveViewport({ port: fake.port }));
    const first = result.current;

    act(() => fake.emit(NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT));
    const afterTransition = result.current;
    expect(afterTransition).toEqual({ snapshot: NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT, isNarrowScreen: true });
    expect(afterTransition).not.toBe(first);

    act(() => fake.emit(NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT));
    expect(result.current).toBe(afterTransition);
  });

  it("replaces the subscription and makes the retired port inert", () => {
    const first = createFakePort(WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT);
    const second = createFakePort(NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT);
    const { result, rerender } = renderHook(
      ({ port }) => useResponsiveViewport({ port }),
      { initialProps: { port: first.port } }
    );
    const retiredListener = [...first.listeners][0];

    rerender({ port: second.port });
    expect(result.current.isNarrowScreen).toBe(true);
    expect(first.listeners).toHaveLength(0);
    expect(second.listeners).toHaveLength(1);

    act(() => retiredListener?.());
    expect(result.current.isNarrowScreen).toBe(true);
    act(() => second.emit(WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT));
    expect(result.current.isNarrowScreen).toBe(false);
  });

  it("unsubscribes on unmount and keeps late callbacks inert", () => {
    const fake = createFakePort(WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT);
    const { result, unmount } = renderHook(() => useResponsiveViewport({ port: fake.port }));
    const listener = [...fake.listeners][0];

    unmount();
    expect(fake.listeners).toHaveLength(0);
    act(() => listener?.());
    expect(result.current.isNarrowScreen).toBe(false);
  });

  it("keeps one active subscription through StrictMode replay", () => {
    const fake = createFakePort(WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT);
    const { unmount } = renderHook(() => useResponsiveViewport({ port: fake.port }), { wrapper: StrictMode });

    expect(fake.port.subscribe).toHaveBeenCalledTimes(2);
    expect(fake.listeners).toHaveLength(1);
    unmount();
    expect(fake.listeners).toHaveLength(0);
  });
});
