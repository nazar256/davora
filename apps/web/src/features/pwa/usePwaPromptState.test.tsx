import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReloadPromptStage } from "./ReloadPromptStage";
import type { BeforeInstallPromptEvent, PwaRuntimePorts } from "./ports";
import { usePwaPromptState } from "./usePwaPromptState";

interface TestPwaPorts extends PwaRuntimePorts {
  emitBeforeInstallPrompt(event: BeforeInstallPromptEvent): void;
  emitAppInstalled(): void;
  setStandalone(next: boolean): void;
}

function createTestPwaPorts(overrides: Partial<PwaRuntimePorts> = {}): TestPwaPorts {
  let standalone = false;
  const standaloneListeners = new Set<() => void>();
  const beforeInstallListeners = new Set<(event: BeforeInstallPromptEvent) => void>();
  const appInstalledListeners = new Set<() => void>();
  let needRefresh = false;
  let offlineReady = false;
  const setNeedRefresh = vi.fn((value: boolean) => {
    needRefresh = value;
  });
  const setOfflineReady = vi.fn((value: boolean) => {
    offlineReady = value;
  });
  const updateServiceWorker = vi.fn(async () => undefined);

  const ports: TestPwaPorts = {
    get needRefresh() {
      return needRefresh;
    },
    get offlineReady() {
      return offlineReady;
    },
    setNeedRefresh,
    setOfflineReady,
    updateServiceWorker,
    isStandalone: () => standalone,
    setStandalone(next: boolean) {
      standalone = next;
      standaloneListeners.forEach((listener) => listener());
    },
    subscribeStandaloneChange: (listener) => {
      standaloneListeners.add(listener);
      return () => standaloneListeners.delete(listener);
    },
    subscribeBeforeInstallPrompt: (handler) => {
      beforeInstallListeners.add(handler);
      return () => beforeInstallListeners.delete(handler);
    },
    subscribeAppInstalled: (handler) => {
      appInstalledListeners.add(handler);
      return () => appInstalledListeners.delete(handler);
    },
    reloadWindow: vi.fn(),
    waitForControllerChangeOrTimeout: vi.fn(() => () => undefined),
    emitBeforeInstallPrompt(event) {
      beforeInstallListeners.forEach((listener) => listener(event));
    },
    emitAppInstalled() {
      appInstalledListeners.forEach((listener) => listener());
    },
    ...overrides
  };

  return ports;
}

describe("usePwaPromptState", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("exposes install availability from beforeinstallprompt and suppresses standalone installs", () => {
    const ports = createTestPwaPorts();
    const prompt = vi.fn(async () => undefined);
    const { result } = renderHook(() => usePwaPromptState(ports));

    expect(result.current.installAvailable).toBe(false);

    act(() => {
      ports.emitBeforeInstallPrompt({
        preventDefault: vi.fn(),
        prompt,
        userChoice: Promise.resolve({ outcome: "dismissed" })
      });
    });

    expect(result.current.installAvailable).toBe(true);

    act(() => {
      ports.setStandalone(true);
      ports.emitAppInstalled();
    });

    expect(result.current.installAvailable).toBe(false);
  });

  it("hides a dismissed install affordance until a new browser install event arrives", async () => {
    const ports = createTestPwaPorts();
    const prompt = vi.fn(async () => undefined);
    const { result } = renderHook(() => usePwaPromptState(ports));

    act(() => {
      ports.emitBeforeInstallPrompt({
        preventDefault: vi.fn(),
        prompt,
        userChoice: Promise.resolve({ outcome: "dismissed" })
      });
    });

    await act(async () => {
      await result.current.installApp();
    });

    expect(result.current.installAvailable).toBe(false);

    act(() => {
      ports.emitBeforeInstallPrompt({
        preventDefault: vi.fn(),
        prompt,
        userChoice: Promise.resolve({ outcome: "accepted" })
      });
    });

    expect(result.current.installAvailable).toBe(true);
  });

  it("preserves non-development update prompts and reload wiring", async () => {
    const updateServiceWorker = vi.fn(async () => undefined);
    const ports = createTestPwaPorts({
      needRefresh: true,
      updateServiceWorker,
      waitForControllerChangeOrTimeout: vi.fn(() => undefined)
    });
    const { result } = renderHook(() => usePwaPromptState(ports));

    expect(result.current.needRefresh).toBe(true);

    await act(async () => {
      await result.current.reloadApp();
    });

    expect(updateServiceWorker).toHaveBeenCalledWith(true);
    expect(ports.reloadWindow).toHaveBeenCalled();
  });

  it("reloads via the scheduled timeout when controllerchange never fires", async () => {
    vi.useFakeTimers();
    const updateServiceWorker = vi.fn(async () => undefined);
    const ports = createTestPwaPorts({
      needRefresh: true,
      updateServiceWorker,
      waitForControllerChangeOrTimeout: (delayMs, onReady) => {
        const timeoutId = window.setTimeout(onReady, delayMs);
        return () => window.clearTimeout(timeoutId);
      }
    });
    const { result } = renderHook(() => usePwaPromptState(ports));

    await act(async () => {
      void result.current.reloadApp();
      await Promise.resolve();
    });

    expect(updateServiceWorker).toHaveBeenCalledWith(true);
    expect(ports.reloadWindow).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(ports.reloadWindow).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("reloads once when controllerchange fires during updateServiceWorker", async () => {
    let onReady: (() => void) | undefined;
    const updateServiceWorker = vi.fn(async () => {
      onReady?.();
    });
    const ports = createTestPwaPorts({
      needRefresh: true,
      updateServiceWorker,
      waitForControllerChangeOrTimeout: (_delayMs, ready) => {
        onReady = ready;
        return () => undefined;
      }
    });
    const { result } = renderHook(() => usePwaPromptState(ports));

    await act(async () => {
      await result.current.reloadApp();
    });

    expect(updateServiceWorker).toHaveBeenCalledWith(true);
    expect(ports.reloadWindow).toHaveBeenCalledTimes(1);
  });

  it("guards synchronous duplicate reload commands to one active update and waiter", async () => {
    let resolveUpdate: (() => void) | undefined;
    const updateServiceWorker = vi.fn(() => new Promise<void>((resolve) => {
      resolveUpdate = resolve;
    }));
    const cancelWait = vi.fn();
    const ports = createTestPwaPorts({
      needRefresh: true,
      updateServiceWorker,
      waitForControllerChangeOrTimeout: vi.fn(() => cancelWait)
    });
    const { result } = renderHook(() => usePwaPromptState(ports));

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = result.current.reloadApp();
      second = result.current.reloadApp();
    });

    expect(updateServiceWorker).toHaveBeenCalledTimes(1);
    expect(ports.waitForControllerChangeOrTimeout).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveUpdate?.();
      await Promise.all([first, second]);
    });
  });

  it("cancels a pending waiter when updateServiceWorker rejects and ignores a late callback", async () => {
    const failure = new Error("update failed");
    let onReady: (() => void) | undefined;
    const cancelWait = vi.fn();
    const ports = createTestPwaPorts({
      needRefresh: true,
      updateServiceWorker: vi.fn(async () => {
        throw failure;
      }),
      waitForControllerChangeOrTimeout: vi.fn((_delayMs: number, ready: () => void) => {
        onReady = ready;
        return cancelWait;
      })
    });
    const { result } = renderHook(() => usePwaPromptState(ports));

    await expect(result.current.reloadApp()).rejects.toBe(failure);
    expect(cancelWait).toHaveBeenCalledTimes(1);

    act(() => onReady?.());
    expect(ports.reloadWindow).not.toHaveBeenCalled();
  });

  it("cancels the active waiter on unmount and keeps late callbacks inert", async () => {
    let resolveUpdate: (() => void) | undefined;
    let onReady: (() => void) | undefined;
    const cancelWait = vi.fn();
    const updateServiceWorker = vi.fn(() => new Promise<void>((resolve) => {
      resolveUpdate = resolve;
    }));
    const ports = createTestPwaPorts({
      needRefresh: true,
      updateServiceWorker,
      waitForControllerChangeOrTimeout: vi.fn((_delayMs: number, ready: () => void) => {
        onReady = ready;
        return cancelWait;
      })
    });
    const { result, unmount } = renderHook(() => usePwaPromptState(ports));

    let reloadPromise: Promise<void> | undefined;
    act(() => {
      reloadPromise = result.current.reloadApp();
    });
    unmount();

    expect(cancelWait).toHaveBeenCalledTimes(1);
    act(() => onReady?.());
    expect(ports.reloadWindow).not.toHaveBeenCalled();

    await act(async () => {
      resolveUpdate?.();
      await reloadPromise;
    });
  });

  it("cancels an old waiter before a later reload attempt replaces it", async () => {
    const firstCancel = vi.fn();
    const secondCancel = vi.fn();
    const waiters = [firstCancel, secondCancel];
    let updateCall = 0;
    const updateServiceWorker = vi.fn(async () => undefined);
    const ports = createTestPwaPorts({
      needRefresh: true,
      updateServiceWorker,
      waitForControllerChangeOrTimeout: vi.fn(() => waiters[updateCall++] ?? vi.fn())
    });
    const { result } = renderHook(() => usePwaPromptState(ports));

    await act(async () => {
      await result.current.reloadApp();
    });
    await act(async () => {
      await result.current.reloadApp();
    });

    expect(updateServiceWorker).toHaveBeenCalledTimes(2);
    expect(firstCancel).toHaveBeenCalledTimes(1);
    expect(secondCancel).not.toHaveBeenCalled();
  });

  it("cancels and invalidates an active attempt when runtime ports are replaced", async () => {
    let resolveA: (() => void) | undefined;
    let onReadyA: (() => void) | undefined;
    const cancelA = vi.fn();
    const portsA = createTestPwaPorts({
      needRefresh: true,
      updateServiceWorker: vi.fn(() => new Promise<void>((resolve) => {
        resolveA = resolve;
      })),
      waitForControllerChangeOrTimeout: vi.fn((_delayMs: number, ready: () => void) => {
        onReadyA = ready;
        return cancelA;
      })
    });
    const portsB = createTestPwaPorts();
    const { result, rerender } = renderHook(
      ({ ports }: { ports: TestPwaPorts }) => usePwaPromptState(ports),
      { initialProps: { ports: portsA } }
    );

    let reloadPromise: Promise<void> | undefined;
    act(() => {
      reloadPromise = result.current.reloadApp();
    });
    expect(result.current.reloading).toBe(true);

    rerender({ ports: portsB });
    expect(cancelA).toHaveBeenCalledTimes(1);
    expect(result.current.reloading).toBe(false);

    act(() => onReadyA?.());
    expect(portsA.reloadWindow).not.toHaveBeenCalled();

    await act(async () => {
      resolveA?.();
      await reloadPromise;
    });
    expect(result.current.reloading).toBe(false);
    expect(portsA.reloadWindow).not.toHaveBeenCalled();
  });

  it("does not cancel a waiter twice when unmount precedes update rejection", async () => {
    let rejectUpdate: ((error: unknown) => void) | undefined;
    const failure = new Error("update failed after unmount");
    const cancelWait = vi.fn();
    const ports = createTestPwaPorts({
      needRefresh: true,
      updateServiceWorker: vi.fn(() => new Promise<void>((_resolve, reject) => {
        rejectUpdate = reject;
      })),
      waitForControllerChangeOrTimeout: vi.fn(() => cancelWait)
    });
    const { result, unmount } = renderHook(() => usePwaPromptState(ports));

    let reloadPromise: Promise<void> | undefined;
    act(() => {
      reloadPromise = result.current.reloadApp();
    });
    expect(result.current.reloading).toBe(true);
    unmount();
    expect(cancelWait).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectUpdate?.(failure);
      await expect(reloadPromise).rejects.toBe(failure);
    });
    expect(cancelWait).toHaveBeenCalledTimes(1);
    expect(ports.reloadWindow).not.toHaveBeenCalled();
    expect(result.current.reloading).toBe(true);
  });

  it("makes controller readiness one-shot even when the adapter calls back late", async () => {
    let onReady: (() => void) | undefined;
    const ports = createTestPwaPorts({
      needRefresh: true,
      updateServiceWorker: vi.fn(async () => undefined),
      waitForControllerChangeOrTimeout: vi.fn((_delayMs: number, ready: () => void) => {
        onReady = ready;
        return () => undefined;
      })
    });
    const { result } = renderHook(() => usePwaPromptState(ports));

    await act(async () => {
      await result.current.reloadApp();
    });
    act(() => {
      onReady?.();
      onReady?.();
    });

    expect(ports.reloadWindow).toHaveBeenCalledTimes(1);
  });

  it("cleans the active reload waiter through StrictMode replay and final unmount", async () => {
    let resolveUpdate: (() => void) | undefined;
    const cancelWait = vi.fn();
    const ports = createTestPwaPorts({
      needRefresh: true,
      updateServiceWorker: vi.fn(() => new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      })),
      waitForControllerChangeOrTimeout: vi.fn(() => cancelWait)
    });
    const { result, unmount } = renderHook(() => usePwaPromptState(ports), { wrapper: StrictMode });

    let reloadPromise: Promise<void> | undefined;
    act(() => {
      reloadPromise = result.current.reloadApp();
    });
    unmount();
    expect(cancelWait).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveUpdate?.();
      await reloadPromise;
    });
  });

  it("does not resubscribe install listeners when only update ports change", () => {
    const unsubscribeStandalone = vi.fn();
    const unsubscribeBeforeInstall = vi.fn();
    const unsubscribeAppInstalled = vi.fn();
    const isStandalone = vi.fn(() => false);
    const subscribeStandaloneChange = vi.fn(() => unsubscribeStandalone);
    const subscribeBeforeInstallPrompt = vi.fn(() => unsubscribeBeforeInstall);
    const subscribeAppInstalled = vi.fn(() => unsubscribeAppInstalled);

    const { rerender } = renderHook(
      ({ needRefresh }) => usePwaPromptState(createTestPwaPorts({
        needRefresh,
        isStandalone,
        subscribeStandaloneChange,
        subscribeBeforeInstallPrompt,
        subscribeAppInstalled
      })),
      { initialProps: { needRefresh: false } }
    );

    expect(subscribeStandaloneChange).toHaveBeenCalledTimes(1);
    expect(subscribeBeforeInstallPrompt).toHaveBeenCalledTimes(1);
    expect(subscribeAppInstalled).toHaveBeenCalledTimes(1);

    rerender({ needRefresh: true });

    expect(subscribeStandaloneChange).toHaveBeenCalledTimes(1);
    expect(subscribeBeforeInstallPrompt).toHaveBeenCalledTimes(1);
    expect(subscribeAppInstalled).toHaveBeenCalledTimes(1);
    expect(unsubscribeStandalone).not.toHaveBeenCalled();
    expect(unsubscribeBeforeInstall).not.toHaveBeenCalled();
    expect(unsubscribeAppInstalled).not.toHaveBeenCalled();
  });

  it("clears offline-ready state without surfacing a toast", async () => {
    const setOfflineReady = vi.fn();
    renderHook(() => usePwaPromptState(createTestPwaPorts({ offlineReady: true, setOfflineReady })));

    await waitFor(() => expect(setOfflineReady).toHaveBeenCalledWith(false));
  });

  it("cleans up install and standalone listeners on unmount", () => {
    const unsubscribeStandalone = vi.fn();
    const unsubscribeBeforeInstall = vi.fn();
    const unsubscribeAppInstalled = vi.fn();
    const ports = createTestPwaPorts();
    const portsWithSpies: TestPwaPorts = {
      ...ports,
      subscribeStandaloneChange: () => unsubscribeStandalone,
      subscribeBeforeInstallPrompt: () => unsubscribeBeforeInstall,
      subscribeAppInstalled: () => unsubscribeAppInstalled
    };

    const { unmount } = renderHook(() => usePwaPromptState(portsWithSpies));
    unmount();

    expect(unsubscribeStandalone).toHaveBeenCalledTimes(1);
    expect(unsubscribeBeforeInstall).toHaveBeenCalledTimes(1);
    expect(unsubscribeAppInstalled).toHaveBeenCalledTimes(1);
  });
});

describe("ReloadPromptStage", () => {
  it("renders reload and dismiss actions only when refresh is needed", () => {
    const onDismiss = vi.fn();
    const onReload = vi.fn(async () => undefined);

    const { container, rerender } = render(
      <ReloadPromptStage needRefresh={false} onDismiss={onDismiss} onReload={onReload} reloading={false} />
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<ReloadPromptStage needRefresh onDismiss={onDismiss} onReload={onReload} reloading={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^Reload$/i }));
    expect(onReload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss$/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
