import { StrictMode, type PropsWithChildren } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBrowserScreenWakeLockPort } from "../../../platform/wakeLock/browserScreenWakeLockPort";
import { useScreenWakeLock, type WakeLockReason } from "./index";

class TestWakeLockSentinel extends EventTarget {
  released = false;

  release = vi.fn(async () => {
    if (this.released) {
      return;
    }
    this.released = true;
    this.dispatchEvent(new Event("release"));
  });
}

describe("useScreenWakeLock", () => {
  let visibilityState: DocumentVisibilityState = "visible";

  beforeEach(() => {
    visibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, "wakeLock");
    vi.restoreAllMocks();
  });

  function createPorts() {
    return createBrowserScreenWakeLockPort(() => navigator, () => ({
      get visibilityState() {
        return visibilityState;
      },
      addEventListener: document.addEventListener.bind(document),
      removeEventListener: document.removeEventListener.bind(document)
    }));
  }

  it("reports disabled when keep-awake is turned off", () => {
    const ports = createPorts();
    const { result } = renderHook(() => useScreenWakeLock({
      enabled: false,
      reasons: ["download"],
      ports
    }));
    expect(result.current.state).toBe("disabled");
  });

  it("shares one lock across active reasons and releases it after all work stops", async () => {
    const sentinel = new TestWakeLockSentinel();
    const request = vi.fn(async () => sentinel);
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    const ports = createPorts();

    const { rerender, result } = renderHook(
      ({ reasons }: { reasons: WakeLockReason[] }) => useScreenWakeLock({
        enabled: true,
        reasons,
        ports
      }),
      { initialProps: { reasons: ["mediaPlayback"] as WakeLockReason[] } }
    );

    await waitFor(() => expect(result.current.state).toBe("active"));
    expect(request).toHaveBeenCalledTimes(1);

    rerender({ reasons: ["mediaPlayback", "download"] });
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.current.reasons).toEqual(["mediaPlayback", "download"]);

    rerender({ reasons: ["download"] });
    expect(sentinel.release).not.toHaveBeenCalled();

    rerender({ reasons: [] });
    await waitFor(() => expect(sentinel.release).toHaveBeenCalledTimes(1));
    expect(result.current.state).toBe("idle");
  });

  it("stays disabled after releasing when keep-awake is turned off", async () => {
    const sentinel = new TestWakeLockSentinel();
    const request = vi.fn(async () => sentinel);
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    const ports = createPorts();

    const { rerender, result } = renderHook(
      ({ enabled }: { enabled: boolean }) => useScreenWakeLock({
        enabled,
        reasons: ["download"],
        ports
      }),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => expect(result.current.state).toBe("active"));

    rerender({ enabled: false });
    await waitFor(() => expect(sentinel.release).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.state).toBe("disabled"));
  });

  it("keeps the acquired sentinel after the React Strict Mode mount probe", async () => {
    const sentinel = new TestWakeLockSentinel();
    const request = vi.fn(async () => sentinel);
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    const ports = createPorts();

    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(
      () => useScreenWakeLock({ enabled: true, reasons: ["mediaPlayback"], ports }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.state).toBe("active"));
    expect(request).toHaveBeenCalledTimes(1);
    expect(sentinel.release).not.toHaveBeenCalled();
  });

  it("re-acquires after the browser releases the lock while the page is hidden", async () => {
    const first = new TestWakeLockSentinel();
    const second = new TestWakeLockSentinel();
    const request = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    const ports = createPorts();

    const { result } = renderHook(() => useScreenWakeLock({
      enabled: true,
      reasons: ["offlineSync"],
      ports
    }));
    await waitFor(() => expect(result.current.state).toBe("active"));

    visibilityState = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(first.release).toHaveBeenCalledTimes(1));
    expect(result.current.state).toBe("idle");

    visibilityState = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.state).toBe("active"));
  });

  it("degrades gracefully when wake lock is unsupported or denied", async () => {
    const unsupportedPorts = createPorts();
    const unsupported = renderHook(() => useScreenWakeLock({
      enabled: true,
      reasons: ["download"],
      ports: unsupportedPorts
    }));
    expect(unsupported.result.current.state).toBe("unsupported");
    unsupported.unmount();

    const request = vi.fn(async () => {
      throw new DOMException("Wake lock denied", "NotAllowedError");
    });
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    const deniedPorts = createPorts();

    const denied = renderHook(() => useScreenWakeLock({
      enabled: true,
      reasons: ["download"],
      ports: deniedPorts
    }));
    await waitFor(() => expect(denied.result.current.state).toBe("denied"));
    expect(request).toHaveBeenCalledTimes(1);
  });
});
