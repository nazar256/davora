// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBrowserPwaPorts } from "./browserPwaPorts";

function createMediaQueryList(initialMatches = false) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  return {
    get matches() {
      return matches;
    },
    addEventListener: vi.fn((_type: "change", listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: "change", listener: () => void) => listeners.delete(listener)),
    emit(nextMatches: boolean) {
      matches = nextMatches;
      for (const listener of [...listeners]) listener();
    },
    listeners
  };
}

function createServiceWorkerContainer() {
  const listeners = new Set<() => void>();
  return {
    addEventListener: vi.fn((_type: "controllerchange", listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: "controllerchange", listener: () => void) => listeners.delete(listener)),
    emitControllerChange() {
      for (const listener of [...listeners]) listener();
    },
    listeners
  };
}

describe("createBrowserPwaPorts", () => {
  const originalMatchMedia = window.matchMedia;
  const originalServiceWorker = Object.getOwnPropertyDescriptor(Navigator.prototype, "serviceWorker");

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    if (originalServiceWorker) {
      Object.defineProperty(Navigator.prototype, "serviceWorker", originalServiceWorker);
    } else {
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
    }
  });

  it("prevents the browser event and forwards only valid install prompts", () => {
    const media = createMediaQueryList();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => media) });
    const ports = createBrowserPwaPorts();
    const handler = vi.fn();
    const unsubscribe = ports.subscribeBeforeInstallPrompt(handler);
    const validEvent = Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn(async () => undefined),
      userChoice: Promise.resolve({ outcome: "accepted" as const })
    });
    const preventDefault = vi.spyOn(validEvent, "preventDefault");

    window.dispatchEvent(validEvent);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(validEvent);

    const invalidEvent = new Event("beforeinstallprompt");
    const invalidPreventDefault = vi.spyOn(invalidEvent, "preventDefault");
    window.dispatchEvent(invalidEvent);
    expect(invalidPreventDefault).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.dispatchEvent(validEvent);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("owns standalone media-query listeners and makes late events inert after unsubscribe", () => {
    const media = createMediaQueryList(false);
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => media) });
    const ports = createBrowserPwaPorts();
    const listener = vi.fn();
    const unsubscribe = ports.subscribeStandaloneChange(listener);

    expect(media.addEventListener).toHaveBeenCalledTimes(1);
    media.emit(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(media.removeEventListener).toHaveBeenCalledTimes(1);
    expect(media.listeners).toHaveLength(0);
    media.emit(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("waits for controllerchange once, clears the timeout, and removes its listener", () => {
    const media = createMediaQueryList();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => media) });
    const serviceWorker = createServiceWorkerContainer();
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
    const ports = createBrowserPwaPorts();
    const onReady = vi.fn();

    ports.waitForControllerChangeOrTimeout(1500, onReady);
    serviceWorker.emitControllerChange();
    serviceWorker.emitControllerChange();
    vi.advanceTimersByTime(1500);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(serviceWorker.removeEventListener).toHaveBeenCalledTimes(1);
    expect(serviceWorker.listeners).toHaveLength(0);
  });

  it("fires the timeout fallback once and cancellation prevents late readiness", () => {
    const media = createMediaQueryList();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => media) });
    const serviceWorker = createServiceWorkerContainer();
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
    const ports = createBrowserPwaPorts();
    const onReady = vi.fn();

    const cancel = ports.waitForControllerChangeOrTimeout(1500, onReady);
    vi.advanceTimersByTime(1499);
    expect(onReady).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onReady).toHaveBeenCalledTimes(1);

    const secondReady = vi.fn();
    const secondCancel = ports.waitForControllerChangeOrTimeout(1500, secondReady);
    secondCancel?.();
    serviceWorker.emitControllerChange();
    vi.advanceTimersByTime(1500);
    expect(secondReady).not.toHaveBeenCalled();
    expect(cancel).toBeTypeOf("function");
  });

  it("does not arm a waiter when the browser has no service-worker container", () => {
    const media = createMediaQueryList();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => media) });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
    const ports = createBrowserPwaPorts();

    expect(ports.waitForControllerChangeOrTimeout(1500, vi.fn())).toBeUndefined();
  });
});
