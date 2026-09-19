import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { createHistoryState, type ChromeSurfaceKind, type ChromeSurfacesSnapshot } from "./model";
import type { HistoryPort } from "./ports";
import { useWorkspaceSurfaceCoordinator, type WorkflowSurfacePorts } from "./useWorkspaceSurfaceCoordinator";

const closedChrome = (): ChromeSurfacesSnapshot => ({
  navigation: false,
  search: false,
  mobileDetails: false,
  settings: false,
  transfers: false,
  quickActions: false
});

const createHistory = () => {
  let state: unknown;
  const listeners = new Set<(next: unknown) => void>();
  const port: HistoryPort & { emit(next: unknown): void; listenerCount(): number } = {
    pushState: (next) => { state = next; },
    replaceState: (next) => { state = next; },
    getState: () => state,
    getLocation: () => ({ href: "http://localhost/?path=Projects", search: "?path=Projects" }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (next) => {
      state = next;
      listeners.forEach((listener) => listener(next));
    },
    listenerCount: () => listeners.size
  };
  return port;
};

const createLeakyHistory = () => {
  const retained: Array<(next: unknown) => void> = [];
  const port: HistoryPort & {
    callback(index: number): (next: unknown) => void;
    listenerCount(): number;
  } = {
    pushState: vi.fn(),
    replaceState: vi.fn(),
    getState: () => undefined,
    getLocation: () => ({ href: "http://localhost/?path=Projects", search: "?path=Projects" }),
    subscribe: (listener) => {
      retained.push(listener);
      return () => undefined;
    },
    callback: (index) => {
      const callback = retained[index];
      if (!callback) {
        throw new Error(`Missing retained callback ${index}`);
      }
      return callback;
    },
    listenerCount: () => retained.length
  };
  return port;
};

const createPorts = (overrides: Partial<Record<keyof WorkflowSurfacePorts, boolean>> = {}) => {
  const state = {
    preview: overrides.preview ?? false,
    action: overrides.action ?? false,
    destination: overrides.destination ?? false,
    account: overrides.account ?? false,
    removeAccount: overrides.removeAccount ?? false
  };
  const dismiss = {
    preview: vi.fn(() => { state.preview = false; }),
    action: vi.fn(() => { state.action = false; }),
    destination: vi.fn(() => { state.destination = false; }),
    account: vi.fn(() => { state.account = false; }),
    removeAccount: vi.fn(() => { state.removeAccount = false; })
  };
  const workflow: WorkflowSurfacePorts = {
    preview: { isOpen: () => state.preview, dismiss: dismiss.preview },
    action: { isOpen: () => state.action, dismiss: dismiss.action },
    destination: { isOpen: () => state.destination, dismiss: dismiss.destination },
    account: { isOpen: () => state.account, dismiss: dismiss.account },
    removeAccount: { isOpen: () => state.removeAccount, dismiss: dismiss.removeAccount }
  };
  return { workflow, state, dismiss };
};

const createInput = (port: HistoryPort, workflow: WorkflowSurfacePorts, chrome = closedChrome()) => {
  let currentPath = "Projects";
  const chromeState = { ...chrome };
  const navigation = {
    getCurrentPath: () => currentPath,
    getChromeSnapshot: () => chromeState,
    dismissChrome: vi.fn((surface: ChromeSurfaceKind) => {
      const key = surface === "mobile-details"
        ? "mobileDetails"
        : surface === "quick-actions"
          ? "quickActions"
          : surface;
      chromeState[key] = false;
    }),
    applyHistoryPath: vi.fn((path: string) => { currentPath = path; })
  };
  return { input: { port, workflow, navigation }, navigation, chromeState };
};

describe("useWorkspaceSurfaceCoordinator", () => {
  it.each(["preview", "action", "destination", "account", "removeAccount"] as const)("dismisses %s before navigation", (surface) => {
    const port = createHistory();
    const { workflow, dismiss } = createPorts({ [surface]: true });
    const { input, navigation } = createInput(port, workflow);
    renderHook(() => useWorkspaceSurfaceCoordinator(input));

    act(() => port.emit(createHistoryState("alpha", "Archive")));

    expect(dismiss[surface]).toHaveBeenCalledTimes(1);
    expect(navigation.applyHistoryPath).toHaveBeenCalledWith("Archive");
  });

  it("uses the established workflow-over-chrome priority and keeps destination distinct", () => {
    const port = createHistory();
    const { workflow, dismiss } = createPorts({ action: true, destination: true });
    const { input, navigation } = createInput(port, workflow, { ...closedChrome(), settings: true });
    renderHook(() => useWorkspaceSurfaceCoordinator(input));

    act(() => port.emit(createHistoryState("alpha", "Projects")));
    expect(dismiss.action).toHaveBeenCalledTimes(1);
    expect(dismiss.destination).not.toHaveBeenCalled();
    expect(navigation.dismissChrome).not.toHaveBeenCalled();

    act(() => port.emit(createHistoryState("alpha", "Projects")));
    expect(dismiss.destination).toHaveBeenCalledTimes(1);
  });

  it("dismisses chrome when workflow surfaces are closed", () => {
    const port = createHistory();
    const { workflow } = createPorts();
    const { input, navigation } = createInput(port, workflow, { ...closedChrome(), settings: true });
    renderHook(() => useWorkspaceSurfaceCoordinator(input));

    act(() => port.emit(createHistoryState("alpha", "Projects")));

    expect(navigation.dismissChrome).toHaveBeenCalledWith("settings");
  });

  it("reads current ports after rerender and keeps one listener", () => {
    const port = createHistory();
    const first = createPorts({ preview: true });
    const second = createPorts({ account: true });
    const firstInput = createInput(port, first.workflow).input;
    const secondInput = createInput(port, second.workflow).input;
    const { result, rerender } = renderHook((input: typeof firstInput) => useWorkspaceSurfaceCoordinator(input), { initialProps: firstInput });
    const reader = result.current.getOpenSurfaces;

    expect(port.listenerCount()).toBe(1);
    rerender(secondInput);
    expect(result.current.getOpenSurfaces).toBe(reader);
    expect(result.current.getOpenSurfaces().account).toBe(true);
    act(() => port.emit(createHistoryState("alpha", "Projects")));
    expect(first.dismiss.preview).not.toHaveBeenCalled();
    expect(second.dismiss.account).toHaveBeenCalledTimes(1);
  });

  it("replaces the history port without allowing the retired listener to act", () => {
    const firstPort = createHistory();
    const secondPort = createHistory();
    const first = createPorts({ preview: true });
    const second = createPorts({ removeAccount: true });
    const firstInput = createInput(firstPort, first.workflow).input;
    const secondInput = createInput(secondPort, second.workflow).input;
    const { rerender, unmount } = renderHook((input: typeof firstInput) => useWorkspaceSurfaceCoordinator(input), { initialProps: firstInput });

    rerender(secondInput);
    expect(firstPort.listenerCount()).toBe(0);
    expect(secondPort.listenerCount()).toBe(1);
    act(() => firstPort.emit(createHistoryState("alpha", "Archive")));
    expect(first.dismiss.preview).not.toHaveBeenCalled();
    act(() => secondPort.emit(createHistoryState("alpha", "Archive")));
    expect(second.dismiss.removeAccount).toHaveBeenCalledTimes(1);

    unmount();
    expect(secondPort.listenerCount()).toBe(0);
  });

  it("ignores retained callbacks after port replacement and unmount", () => {
    const firstPort = createLeakyHistory();
    const secondPort = createLeakyHistory();
    const first = createPorts({ preview: true });
    const second = createPorts();
    const firstSetup = createInput(firstPort, first.workflow);
    const secondSetup = createInput(secondPort, second.workflow, { ...closedChrome(), settings: true });
    const { rerender, unmount } = renderHook(
      (input: typeof firstSetup.input) => useWorkspaceSurfaceCoordinator(input),
      { initialProps: firstSetup.input }
    );
    const firstCallback = firstPort.callback(0);

    rerender(secondSetup.input);
    firstCallback(createHistoryState("alpha", "Archive"));
    expect(first.dismiss.preview).not.toHaveBeenCalled();
    expect(firstSetup.navigation.applyHistoryPath).not.toHaveBeenCalled();
    expect(secondSetup.navigation.dismissChrome).not.toHaveBeenCalled();
    expect(secondSetup.navigation.applyHistoryPath).not.toHaveBeenCalled();

    const secondCallback = secondPort.callback(0);
    unmount();
    secondCallback(createHistoryState("alpha", "Archive"));
    expect(secondSetup.navigation.dismissChrome).not.toHaveBeenCalled();
    expect(secondSetup.navigation.applyHistoryPath).not.toHaveBeenCalled();
    expect(second.dismiss.preview).not.toHaveBeenCalled();
  });

  it("cleans up its sole listener through StrictMode replay", () => {
    const port = createHistory();
    const { workflow } = createPorts();
    const { input } = createInput(port, workflow);
    const { unmount } = renderHook(() => useWorkspaceSurfaceCoordinator(input), { wrapper: StrictMode });
    expect(port.listenerCount()).toBe(1);
    unmount();
    expect(port.listenerCount()).toBe(0);
  });

  it("combines all eleven surfaces for pull-to-refresh reads", () => {
    const port = createHistory();
    const { workflow } = createPorts({ preview: true, action: true, destination: true, account: true, removeAccount: true });
    const { input } = createInput(port, workflow, { navigation: true, search: true, mobileDetails: true, settings: true, transfers: true, quickActions: true });
    const { result } = renderHook(() => useWorkspaceSurfaceCoordinator(input));
    expect(result.current.getOpenSurfaces()).toEqual({
      preview: true,
      action: true,
      destination: true,
      account: true,
      removeAccount: true,
      navigation: true,
      search: true,
      mobileDetails: true,
      settings: true,
      transfers: true,
      quickActions: true
    });
  });

  it("dismisses quick actions before every other surface", () => {
    const port = createHistory();
    const { workflow } = createPorts({ preview: true });
    const { input, navigation } = createInput(port, workflow, { ...closedChrome(), quickActions: true });
    renderHook(() => useWorkspaceSurfaceCoordinator(input));

    act(() => port.emit(createHistoryState("alpha", "Projects")));

    expect(navigation.dismissChrome).toHaveBeenCalledWith("quick-actions");
  });
});
