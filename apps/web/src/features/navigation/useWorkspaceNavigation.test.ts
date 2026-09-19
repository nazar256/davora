import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { createHistoryState } from "./model";
import type { HistoryPort } from "./ports";
import { useWorkspaceNavigation } from "./useWorkspaceNavigation";

const createHistory = (search = "?path=Projects&focus=1"): HistoryPort & {
  emit(state: unknown): void;
  listenerCount(): number;
  pushes: number;
  replacements: number;
  urls: (string | undefined)[];
} => {
  let state: unknown = null;
  const listeners = new Set<(next: unknown) => void>();
  return {
    urls: [],
    pushes: 0,
    replacements: 0,
    pushState(next, url) { state = next; this.pushes += 1; this.urls.push(url); },
    replaceState(next, url) { state = next; this.replacements += 1; this.urls.push(url); },
    getState: () => state,
    getLocation: () => ({ href: `http://localhost/${search}`, search }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listenerCount: () => listeners.size,
    emit(next) {
      state = next;
      listeners.forEach((listener) => listener(next));
    }
  };
};

const createInput = (port: HistoryPort) => {
  return {
    port,
    accountId: "alpha",
    path: {
      clearSelectedEntry: vi.fn(),
      clearBatchSelection: vi.fn(),
      clearForPathTransition: vi.fn()
    }
  };
};

describe("useWorkspaceNavigation", () => {
  it("restores the path from location while retaining unrelated query parameters", () => {
    const port = createHistory();
    const { result } = renderHook(() => useWorkspaceNavigation(createInput(port)));

    expect(result.current.currentPath).toBe("Projects");

    act(() => result.current.syncPathToUrl("Archive"));
    expect(port.urls.at(-1)).toBe("http://localhost/?path=Archive&focus=1&account=alpha");
  });

  it("suppresses the location path when the linked account differs from the active account", () => {
    const mismatched = renderHook(() => useWorkspaceNavigation({
      ...createInput(createHistory("?path=Projects&account=beta")),
      accountId: "alpha"
    }));
    expect(mismatched.result.current.currentPath).toBe("");

    const matched = renderHook(() => useWorkspaceNavigation({
      ...createInput(createHistory("?path=Projects&account=alpha")),
      accountId: "alpha"
    }));
    expect(matched.result.current.currentPath).toBe("Projects");
  });

  it("retains path cleanup as an explicit navigation operation without a history listener", () => {
    const port = createHistory();
    const input = createInput(port);
    const { unmount, result } = renderHook(() => useWorkspaceNavigation(input));

    expect(port.listenerCount()).toBe(0);
    act(() => result.current.applyHistoryPath("Archive"));
    expect(input.path.clearSelectedEntry).toHaveBeenCalledTimes(1);
    expect(input.path.clearBatchSelection).toHaveBeenCalledTimes(1);
    expect(input.path.clearForPathTransition).toHaveBeenCalledTimes(1);
    expect(result.current.currentPath).toBe("Archive");

    unmount();
    expect(port.listenerCount()).toBe(0);
    act(() => port.emit(createHistoryState("alpha", "Projects")));
    expect(input.path.clearSelectedEntry).toHaveBeenCalledTimes(1);
  });

  it("keeps one popstate listener through StrictMode replay and removes it on unmount", () => {
    const port = createHistory();
    const input = createInput(port);
    const { unmount } = renderHook(() => useWorkspaceNavigation(input), { wrapper: StrictMode });

    expect(port.listenerCount()).toBe(0);
    unmount();
    expect(port.listenerCount()).toBe(0);
  });

  it("uses latest path ports for explicit history-path application", () => {
    const port = createHistory();
    const first = createInput(port);
    const second = createInput(port);
    const { result, rerender } = renderHook((input: typeof first) => useWorkspaceNavigation(input), { initialProps: first });

    expect(port.listenerCount()).toBe(0);
    rerender(second);
    act(() => result.current.applyHistoryPath("Archive"));
    expect(second.path.clearSelectedEntry).toHaveBeenCalledTimes(1);
  });

  it("switches history ports while keeping only the active subscription", () => {
    const firstPort = createHistory();
    const secondPort = createHistory();
    const first = createInput(firstPort);
    const second = createInput(secondPort);
    const { rerender } = renderHook((input: typeof first) => useWorkspaceNavigation(input), { initialProps: first });

    expect(firstPort.listenerCount()).toBe(0);
    rerender({ ...second, accountId: "beta" });
    expect(firstPort.listenerCount()).toBe(0);
    expect(secondPort.listenerCount()).toBe(0);
  });

  it("pushes surface and path history entries through the port with URLs", () => {
    const port = createHistory();
    const { result } = renderHook(() => useWorkspaceNavigation(createInput(port)));

    act(() => result.current.pushSurface("transfers"));
    expect(port.getState()).toEqual(createHistoryState("alpha", "Projects", "transfers"));
    expect(port.urls.at(-1)).toBe("http://localhost/?path=Projects&focus=1&account=alpha");

    act(() => result.current.pushPath("Archive"));
    expect(port.getState()).toEqual(createHistoryState("alpha", "Archive"));
    expect(port.urls.at(-1)).toBe("http://localhost/?path=Archive&focus=1&account=alpha");

    act(() => result.current.replacePath());
    expect(port.getState()).toEqual(createHistoryState("alpha", "Projects"));
    expect(port.urls.at(-1)).toBe("http://localhost/?path=Projects&focus=1&account=alpha");
  });

  it("syncs path and account to the URL through the port", () => {
    const port = createHistory();
    const { result } = renderHook(() => useWorkspaceNavigation(createInput(port)));

    act(() => result.current.syncPathToUrl("Projects/roadmap.txt"));

    expect(port.getState()).toEqual(createHistoryState("alpha", "Projects/roadmap.txt"));
    expect(port.urls.at(-1)).toBe("http://localhost/?path=Projects%2Froadmap.txt&focus=1&account=alpha");
  });

  it("opens and dismisses chrome surfaces with if-closed history and path cleanup", () => {
    const port = createHistory();
    const { result } = renderHook(() => useWorkspaceNavigation(createInput(port)));

    act(() => result.current.openChrome("settings"));
    act(() => result.current.openChrome("settings"));
    expect(result.current.showSettingsDialog).toBe(true);
    expect(port.getState()).toEqual(createHistoryState("alpha", "Projects", "settings"));
    expect(port.pushes).toBe(1);

    act(() => result.current.dismissChrome("settings"));
    expect(result.current.showSettingsDialog).toBe(false);

    const pushesBeforeOverride = port.pushes;
    act(() => result.current.openChrome("settings", { pushHistory: true }));
    expect(port.pushes).toBe(pushesBeforeOverride + 1);
    act(() => result.current.openChrome("settings", { pushHistory: false }));
    expect(port.pushes).toBe(pushesBeforeOverride + 1);

    act(() => {
      result.current.openChrome("navigation", { pushHistory: false });
      result.current.openChrome("search", { pushHistory: false });
      result.current.openChrome("mobile-details", { pushHistory: false });
      result.current.openChrome("settings", { pushHistory: false });
      result.current.openChrome("quick-actions", { pushHistory: false });
      result.current.clearChromeForPathNavigate();
    });
    expect(result.current.snapshot).toEqual({
      navigation: false,
      search: true,
      mobileDetails: false,
      settings: true,
      transfers: false,
      quickActions: false
    });
  });

  it("opens and dismisses the quick-actions chrome surface with history", () => {
    const port = createHistory();
    const { result } = renderHook(() => useWorkspaceNavigation(createInput(port)));

    act(() => result.current.openChrome("quick-actions"));
    expect(result.current.quickActionsOpen).toBe(true);
    expect(port.getState()).toEqual(createHistoryState("alpha", "Projects", "quick-actions"));
    expect(port.pushes).toBe(1);

    act(() => result.current.dismissChrome("quick-actions"));
    expect(result.current.quickActionsOpen).toBe(false);
  });

  it("applies commands and navigates to a path with the stable workspace callbacks", () => {
    const port = createHistory();
    const input = createInput(port);
    const { result, rerender } = renderHook((props: typeof input) => useWorkspaceNavigation(props), { initialProps: input });
    const applyHistoryPath = result.current.applyHistoryPath;
    const navigateToPath = result.current.navigateToPath;
    const nextInput = createInput(port);

    rerender(nextInput);
    expect(result.current.applyHistoryPath).toBe(applyHistoryPath);
    expect(result.current.navigateToPath).toBe(navigateToPath);

    const urlsBeforeBackNavigation = port.urls.length;
    act(() => result.current.applyHistoryPath("Projects"));
    expect(port.urls.length).toBe(urlsBeforeBackNavigation);
    expect(nextInput.path.clearSelectedEntry).toHaveBeenCalledTimes(1);

    act(() => result.current.navigateToPath("Archive"));
    expect(port.getState()).toEqual(createHistoryState("alpha", "Archive"));
    expect(nextInput.path.clearSelectedEntry).toHaveBeenCalledTimes(2);
    expect(nextInput.path.clearBatchSelection).toHaveBeenCalledTimes(2);
    expect(nextInput.path.clearForPathTransition).toHaveBeenCalledTimes(2);
    expect(result.current.currentPath).toBe("Archive");
  });
});
