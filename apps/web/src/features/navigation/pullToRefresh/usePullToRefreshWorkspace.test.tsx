import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OpenSurfacesSnapshot } from "../model";
import { usePullToRefreshWorkspace } from "./usePullToRefreshWorkspace";

const closedSurfaces = (): OpenSurfacesSnapshot => ({
  preview: false,
  action: false,
  destination: false,
  account: false,
  removeAccount: false,
  folderShortcut: false,
  reportBug: false,
  settings: false,
  search: false,
  navigation: false,
  mobileDetails: false,
  transfers: false,
  quickActions: false
});

const touchAt = (clientY: number) => ({ touches: [{ clientY }] });

function invoke(handler: ((...args: never[]) => unknown) | undefined, event: unknown = {}) {
  if (handler) {
    Reflect.apply(handler, undefined, [event]);
  }
}

describe("usePullToRefreshWorkspace", () => {
  it("owns the FileList ref and adapts both scroll origins", () => {
    const getWindowScrollY = vi.fn(() => 0);
    const refreshPath = vi.fn(async (_path: string, _options?: { readonly preferCache?: boolean }) => undefined);
    const { result } = renderHook(() => usePullToRefreshWorkspace({
      cacheOnlyMode: false,
      getCurrentPath: () => "Projects",
      getToken: () => "token-alpha",
      getOpenSurfaces: closedSurfaces,
      environment: { getWindowScrollY },
      refreshPath
    }));

    Object.defineProperty(result.current.fileListRef, "current", { configurable: true, writable: true, value: { scrollTop: 4 } });
    act(() => {
      invoke(result.current.shell.handlers.onTouchStart, touchAt(0));
      invoke(result.current.shell.handlers.onTouchMove, touchAt(150));
      invoke(result.current.shell.handlers.onTouchEnd);
    });
    expect(refreshPath).not.toHaveBeenCalled();

    Object.defineProperty(result.current.fileListRef, "current", { configurable: true, writable: true, value: { scrollTop: 0 } });
    act(() => {
      invoke(result.current.shell.handlers.onTouchStart, touchAt(0));
      invoke(result.current.shell.handlers.onTouchMove, touchAt(150));
      invoke(result.current.shell.handlers.onTouchEnd);
    });
    expect(refreshPath).toHaveBeenCalledWith("Projects", { preferCache: false });
    expect(getWindowScrollY).toHaveBeenCalled();
  });

  it("passes only the invocation-time path and forced no-cache intent", async () => {
    let path = "Projects";
    const refreshPath = vi.fn(async (_path: string, _options?: { readonly preferCache?: boolean }) => undefined);
    const { result, rerender } = renderHook(() => usePullToRefreshWorkspace({
      cacheOnlyMode: false,
      getCurrentPath: () => path,
      getToken: () => "token-alpha",
      getOpenSurfaces: closedSurfaces,
      environment: { getWindowScrollY: () => 0 },
      refreshPath
    }));

    act(() => invoke(result.current.shell.handlers.onTouchStart, touchAt(0)));
    path = "Archive";
    rerender();
    act(() => {
      invoke(result.current.shell.handlers.onTouchMove, touchAt(150));
      invoke(result.current.shell.handlers.onTouchEnd);
    });

    expect(refreshPath).toHaveBeenCalledTimes(1);
    expect(refreshPath).toHaveBeenCalledWith("Archive", { preferCache: false });
    expect(refreshPath.mock.calls[0]?.[1]).not.toEqual({});
    expect(refreshPath.mock.calls[0]?.[1]).not.toEqual({ preferCache: true });
  });

  it("reads the current path when a committed gesture releases", () => {
    let path = "Projects";
    const refreshPath = vi.fn(async (_path: string, _options?: { readonly preferCache?: boolean }) => undefined);
    const { result, rerender } = renderHook(() => usePullToRefreshWorkspace({
      cacheOnlyMode: false,
      getCurrentPath: () => path,
      getToken: () => "token-alpha",
      getOpenSurfaces: closedSurfaces,
      environment: { getWindowScrollY: () => 0 },
      refreshPath
    }));

    act(() => invoke(result.current.shell.handlers.onTouchStart, touchAt(0)));
    path = "Archive";
    rerender();
    act(() => {
      invoke(result.current.shell.handlers.onTouchMove, touchAt(150));
      invoke(result.current.shell.handlers.onTouchEnd);
    });
    expect(refreshPath).toHaveBeenCalledWith("Archive", { preferCache: false });
  });
});
