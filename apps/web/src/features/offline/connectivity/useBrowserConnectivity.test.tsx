// @vitest-environment jsdom

import { StrictMode } from "react";

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  OFFLINE_CONNECTIVITY_SNAPSHOT,
  ONLINE_CONNECTIVITY_SNAPSHOT,
  type ConnectivityListener,
  type ConnectivityPort,
  type ConnectivitySnapshot
} from "./ports";
import { useBrowserConnectivity } from "./useBrowserConnectivity";

function createFakePort(initial: ConnectivitySnapshot) {
  let snapshot = initial;
  const listeners = new Set<ConnectivityListener>();
  const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
  const read = vi.fn(() => snapshot);
  const subscribe = vi.fn((listener: ConnectivityListener) => {
    listeners.add(listener);
    const unsubscribe = vi.fn(() => listeners.delete(listener));
    unsubscribes.push(unsubscribe);
    return unsubscribe;
  });
  return {
    port: { read, subscribe } satisfies ConnectivityPort,
    emit(next: ConnectivitySnapshot) {
      snapshot = next;
      for (const listener of [...listeners]) {
        listener(next);
      }
    },
    listeners,
    unsubscribes
  };
}

describe("useBrowserConnectivity", () => {
  it.each([
    [ONLINE_CONNECTIVITY_SNAPSHOT, false],
    [OFFLINE_CONNECTIVITY_SNAPSHOT, true]
  ])("reads the initial %s snapshot during render", (initial, offline) => {
    const fake = createFakePort(initial);
    const { result } = renderHook(() => useBrowserConnectivity({ port: fake.port }));

    expect(fake.port.read).toHaveBeenCalled();
    expect(result.current).toEqual({ snapshot: initial, offline });
  });

  it("publishes transitions and ignores duplicate notifications", () => {
    const fake = createFakePort(ONLINE_CONNECTIVITY_SNAPSHOT);
    const { result } = renderHook(() => useBrowserConnectivity({ port: fake.port }));
    const first = result.current;

    act(() => fake.emit(OFFLINE_CONNECTIVITY_SNAPSHOT));
    expect(result.current).toEqual({ snapshot: OFFLINE_CONNECTIVITY_SNAPSHOT, offline: true });
    const afterTransition = result.current;

    act(() => fake.emit(OFFLINE_CONNECTIVITY_SNAPSHOT));
    expect(result.current).toBe(afterTransition);
    expect(result.current).not.toBe(first);
  });

  it("replaces the subscription and makes the retired port inert", () => {
    const first = createFakePort(ONLINE_CONNECTIVITY_SNAPSHOT);
    const second = createFakePort(OFFLINE_CONNECTIVITY_SNAPSHOT);
    const { result, rerender } = renderHook(
      ({ port }) => useBrowserConnectivity({ port }),
      { initialProps: { port: first.port } }
    );
    const retiredListener = [...first.listeners][0];

    rerender({ port: second.port });
    expect(result.current).toEqual({ snapshot: OFFLINE_CONNECTIVITY_SNAPSHOT, offline: true });
    expect(first.listeners).toHaveLength(0);
    expect(second.listeners).toHaveLength(1);
    expect(first.port.subscribe).toHaveBeenCalledTimes(1);
    expect(second.port.subscribe).toHaveBeenCalledTimes(1);
    expect(first.unsubscribes).toHaveLength(1);
    expect(first.unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(second.unsubscribes).toHaveLength(1);
    expect(second.unsubscribes[0]).not.toHaveBeenCalled();

    act(() => retiredListener?.(ONLINE_CONNECTIVITY_SNAPSHOT));
    expect(result.current).toEqual({ snapshot: OFFLINE_CONNECTIVITY_SNAPSHOT, offline: true });
    act(() => first.emit(ONLINE_CONNECTIVITY_SNAPSHOT));
    expect(result.current).toEqual({ snapshot: OFFLINE_CONNECTIVITY_SNAPSHOT, offline: true });
    act(() => second.emit(ONLINE_CONNECTIVITY_SNAPSHOT));
    expect(result.current).toEqual({ snapshot: ONLINE_CONNECTIVITY_SNAPSHOT, offline: false });
  });

  it("unsubscribes on unmount and leaves late callbacks inert", () => {
    const fake = createFakePort(ONLINE_CONNECTIVITY_SNAPSHOT);
    const { result, unmount } = renderHook(() => useBrowserConnectivity({ port: fake.port }));
    const listener = [...fake.listeners][0];

    unmount();
    expect(fake.listeners).toHaveLength(0);
    act(() => listener?.(OFFLINE_CONNECTIVITY_SNAPSHOT));
    expect(result.current).toEqual({ snapshot: ONLINE_CONNECTIVITY_SNAPSHOT, offline: false });
  });

  it("keeps exactly one active subscription through StrictMode replay", () => {
    const fake = createFakePort(ONLINE_CONNECTIVITY_SNAPSHOT);
    const { unmount } = renderHook(() => useBrowserConnectivity({ port: fake.port }), {
      wrapper: StrictMode
    });

    expect(fake.port.subscribe).toHaveBeenCalledTimes(2);
    expect(fake.listeners).toHaveLength(1);
    unmount();
    expect(fake.listeners).toHaveLength(0);
    expect(fake.port.subscribe).toHaveBeenCalledTimes(2);
    expect(fake.unsubscribes).toHaveLength(2);
    expect(fake.unsubscribes.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true);
  });
});
