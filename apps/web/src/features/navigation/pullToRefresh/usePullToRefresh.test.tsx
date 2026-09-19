import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { OpenSurfacesSnapshot } from "../model";
import { usePullToRefresh, type PullToRefreshTouchEvent } from "./usePullToRefresh";

const closedSurfacesSnapshot = (): OpenSurfacesSnapshot => ({
  preview: false,
  action: false,
  destination: false,
  account: false,
  removeAccount: false,
  settings: false,
  search: false,
  navigation: false,
  mobileDetails: false,
  transfers: false,
  quickActions: false
});

const touchAt = (clientY: number): PullToRefreshTouchEvent => ({
  touches: [{ clientY }]
});

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

describe("usePullToRefresh", () => {
  const createInput = (overrides: Partial<Parameters<typeof usePullToRefresh>[0]> = {}) => {
    const onRefresh = vi.fn(async () => undefined);
    const scrollOrigin = {
      getWindowScrollY: vi.fn(() => 0),
      getFileListScrollTop: vi.fn(() => 0)
    };
    const input = {
      cacheOnlyMode: false,
      getCurrentPath: () => "Projects",
      getToken: () => "token-alpha",
      getOpenSurfaces: () => closedSurfacesSnapshot(),
      scrollOrigin,
      onRefresh,
      ...overrides
    };
    return { input, onRefresh, scrollOrigin };
  };

  it("ignores touch start when eligibility fails", () => {
    const { input } = createInput({
      getOpenSurfaces: () => ({ ...closedSurfacesSnapshot(), settings: true })
    });
    const { result } = renderHook(() => usePullToRefresh(input));

    act(() => {
      result.current.handlers.onTouchStart(touchAt(10));
    });

    expect(result.current.visible).toBe(false);
    expect(result.current.progress).toBe(0);
  });

  it.each([
    ["cache-only mode", { cacheOnlyMode: true }],
    ["root path", { getCurrentPath: () => "" }],
    ["missing token", { getToken: () => undefined }],
    ["window scroll", { scrollOrigin: { getWindowScrollY: () => 1, getFileListScrollTop: () => 0 } }],
    ["file-list scroll", { scrollOrigin: { getWindowScrollY: () => 0, getFileListScrollTop: () => 1 } }]
  ])("does not activate for %s", (_reason, override) => {
    const { input, onRefresh } = createInput(override);
    const { result } = renderHook(() => usePullToRefresh(input));

    act(() => {
      result.current.handlers.onTouchStart(touchAt(0));
      result.current.handlers.onTouchMove(touchAt(150));
      result.current.handlers.onTouchEnd();
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current.progress).toBe(0);
    expect(result.current.visible).toBe(false);
    expect(result.current.refreshing).toBe(false);
  });

  it("updates progress while pulling from the scroll origin", () => {
    const { input } = createInput();
    const { result } = renderHook(() => usePullToRefresh(input));

    act(() => {
      result.current.handlers.onTouchStart(touchAt(0));
      result.current.handlers.onTouchMove(touchAt(18));
    });

    expect(result.current.progress).toBe(0.15);
    expect(result.current.visible).toBe(true);
    expect(result.current.refreshing).toBe(false);
  });

  it("ignores move updates once scroll leaves the origin", () => {
    const { input, scrollOrigin } = createInput();
    const { result } = renderHook(() => usePullToRefresh(input));

    act(() => {
      result.current.handlers.onTouchStart(touchAt(0));
      result.current.handlers.onTouchMove(touchAt(18));
    });

    scrollOrigin.getFileListScrollTop.mockReturnValue(24);

    act(() => {
      result.current.handlers.onTouchMove(touchAt(150));
    });

    expect(result.current.progress).toBe(0.15);
  });

  it("resumes progress if both scroll origins return before release", () => {
    const { input, scrollOrigin } = createInput();
    const { result } = renderHook(() => usePullToRefresh(input));

    act(() => {
      result.current.handlers.onTouchStart(touchAt(0));
      result.current.handlers.onTouchMove(touchAt(18));
    });
    scrollOrigin.getWindowScrollY.mockReturnValue(12);
    act(() => {
      result.current.handlers.onTouchMove(touchAt(80));
    });
    expect(result.current.progress).toBe(0.15);

    scrollOrigin.getWindowScrollY.mockReturnValue(0);
    act(() => {
      result.current.handlers.onTouchMove(touchAt(120));
    });
    expect(result.current.progress).toBe(1);
  });

  it("does not create positive progress for upward or zero-distance moves", () => {
    const { input } = createInput();
    const { result } = renderHook(() => usePullToRefresh(input));

    act(() => {
      result.current.handlers.onTouchStart(touchAt(50));
      result.current.handlers.onTouchMove(touchAt(40));
      result.current.handlers.onTouchMove(touchAt(50));
    });

    expect(result.current.progress).toBe(0);
    expect(result.current.visible).toBe(false);
  });

  it("resets on release below threshold", () => {
    const { input, onRefresh } = createInput();
    const { result } = renderHook(() => usePullToRefresh(input));

    act(() => {
      result.current.handlers.onTouchStart(touchAt(0));
    });
    act(() => {
      result.current.handlers.onTouchMove(touchAt(60));
    });
    act(() => {
      result.current.handlers.onTouchEnd();
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current.visible).toBe(false);
    expect(result.current.progress).toBe(0);
  });

  it("refreshes and clears after a full pull release", async () => {
    const deferred = createDeferred();
    const onRefresh = vi.fn(() => deferred.promise);
    const { input } = createInput({ onRefresh });
    const { result } = renderHook(() => usePullToRefresh(input));

    act(() => {
      result.current.handlers.onTouchStart(touchAt(0));
    });
    act(() => {
      result.current.handlers.onTouchMove(touchAt(150));
    });
    act(() => {
      result.current.handlers.onTouchEnd();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.visible).toBe(true);
    expect(result.current.progress).toBe(1);

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });

    expect(result.current.refreshing).toBe(false);
    expect(result.current.visible).toBe(false);
    expect(result.current.progress).toBe(0);
  });

  it("ignores a second gesture while refresh is in flight", async () => {
    const deferred = createDeferred();
    const onRefresh = vi.fn(() => deferred.promise);
    const { input } = createInput({ onRefresh });
    const { result } = renderHook(() => usePullToRefresh(input));

    act(() => {
      result.current.handlers.onTouchStart(touchAt(0));
    });
    act(() => {
      result.current.handlers.onTouchMove(touchAt(150));
    });
    act(() => {
      result.current.handlers.onTouchEnd();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);

    act(() => {
      result.current.handlers.onTouchStart(touchAt(0));
      result.current.handlers.onTouchMove(touchAt(150));
      result.current.handlers.onTouchEnd();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.progress).toBe(1);

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });

    expect(result.current.refreshing).toBe(false);
  });

  it("does not re-check surfaces that open after an eligible gesture starts", async () => {
    const deferred = createDeferred();
    let surfaces = closedSurfacesSnapshot();
    const onRefresh = vi.fn(() => deferred.promise);
    const { input } = createInput({
      getOpenSurfaces: () => surfaces,
      onRefresh
    });
    const { result, rerender } = renderHook(
      (nextInput: Parameters<typeof usePullToRefresh>[0]) => usePullToRefresh(nextInput),
      { initialProps: input }
    );

    act(() => result.current.handlers.onTouchStart(touchAt(0)));
    surfaces = { ...closedSurfacesSnapshot(), settings: true };
    rerender({ ...input, getOpenSurfaces: () => surfaces, onRefresh });
    act(() => {
      result.current.handlers.onTouchMove(touchAt(150));
      result.current.handlers.onTouchEnd();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });
  });

  it("routes a committed gesture to the latest event-time path and token owner", async () => {
    let currentPath = "Projects";
    let currentToken: string | undefined = "token-alpha";
    const observed: Array<{ path: string; token: string | undefined }> = [];
    const onRefresh = vi.fn(async () => {
      observed.push({ path: currentPath, token: currentToken });
    });
    const initial = createInput({
      getCurrentPath: () => currentPath,
      getToken: () => currentToken,
      onRefresh
    });
    const { result, rerender } = renderHook(
      (input: Parameters<typeof usePullToRefresh>[0]) => usePullToRefresh(input),
      { initialProps: initial.input }
    );

    act(() => result.current.handlers.onTouchStart(touchAt(0)));
    currentPath = "Archive";
    currentToken = "token-beta";
    rerender({
      ...initial.input,
      getCurrentPath: () => currentPath,
      getToken: () => currentToken,
      onRefresh
    });
    act(() => {
      result.current.handlers.onTouchMove(touchAt(150));
      result.current.handlers.onTouchEnd();
    });
    await act(async () => await Promise.resolve());

    expect(observed).toEqual([{ path: "Archive", token: "token-beta" }]);
  });

  it("normalizes a rejected refresh without an unhandled rejection", async () => {
    const rejection = new Error("refresh failed");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const onRefresh = vi.fn(async () => { throw rejection; });
      const { input } = createInput({ onRefresh });
      const { result } = renderHook(() => usePullToRefresh(input));

      act(() => {
        result.current.handlers.onTouchStart(touchAt(0));
        result.current.handlers.onTouchMove(touchAt(150));
        result.current.handlers.onTouchEnd();
      });
      await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(result.current.refreshing).toBe(false);
      expect(result.current.progress).toBe(0);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("normalizes a synchronous refresh throw to idle without escaping the touch handler", () => {
    const onRefresh = vi.fn(() => { throw new Error("refresh threw"); });
    const { input } = createInput({ onRefresh });
    const { result } = renderHook(() => usePullToRefresh(input));

    act(() => {
      result.current.handlers.onTouchStart(touchAt(0));
      result.current.handlers.onTouchMove(touchAt(150));
    });
    expect(() => {
      act(() => result.current.handlers.onTouchEnd());
    }).not.toThrow();
    expect(result.current.refreshing).toBe(false);
    expect(result.current.progress).toBe(0);
  });

  it("ignores a pending refresh completion after unmount", async () => {
    const deferred = createDeferred();
    const onRefresh = vi.fn(() => deferred.promise);
    const { input } = createInput({ onRefresh });
    const { result, unmount } = renderHook(() => usePullToRefresh(input));

    act(() => {
      result.current.handlers.onTouchStart(touchAt(0));
      result.current.handlers.onTouchMove(touchAt(150));
      result.current.handlers.onTouchEnd();
    });
    unmount();

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps a StrictMode-retired pending refresh from starting another request", async () => {
    const deferred = createDeferred();
    const onRefresh = vi.fn(() => deferred.promise);
    const { input } = createInput({ onRefresh });
    const { result, unmount } = renderHook(() => usePullToRefresh(input), {
      wrapper: StrictMode
    });

    act(() => {
      result.current.handlers.onTouchStart(touchAt(0));
      result.current.handlers.onTouchMove(touchAt(150));
      result.current.handlers.onTouchEnd();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("uses the latest refresh owner and eligibility after rerender", async () => {
    const initialRefresh = vi.fn(async () => undefined);
    const latestRefresh = vi.fn(async () => undefined);
    const initial = createInput({ onRefresh: initialRefresh });
    const { result, rerender } = renderHook(
      (input: Parameters<typeof usePullToRefresh>[0]) => usePullToRefresh(input),
      { initialProps: initial.input }
    );

    act(() => {
      result.current.handlers.onTouchStart(touchAt(0));
    });

    rerender({
      ...initial.input,
      getCurrentPath: () => "Archive",
      getToken: () => "token-beta",
      getOpenSurfaces: () => closedSurfacesSnapshot(),
      onRefresh: latestRefresh
    });

    act(() => {
      result.current.handlers.onTouchMove(touchAt(150));
      result.current.handlers.onTouchEnd();
    });

    expect(initialRefresh).not.toHaveBeenCalled();
    expect(latestRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
    });

    rerender({
      ...initial.input,
      cacheOnlyMode: true,
      getOpenSurfaces: () => ({ ...closedSurfacesSnapshot(), settings: true }),
      onRefresh: latestRefresh
    });

    act(() => {
      result.current.handlers.onTouchStart(touchAt(0));
    });
    expect(latestRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.progress).toBe(0);
  });
});
