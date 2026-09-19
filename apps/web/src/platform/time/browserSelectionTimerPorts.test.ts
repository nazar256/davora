import { describe, expect, it, vi } from "vitest";

import { createBrowserSelectionTimerPorts } from "./browserSelectionTimerPorts";

describe("browser selection timer ports", () => {
  it("forwards scheduling and cancellation to injected browser primitives", () => {
    const setTimeout = vi.fn(() => 17);
    const clearTimeout = vi.fn();
    const callback = vi.fn();
    const ports = createBrowserSelectionTimerPorts({ setTimeout, clearTimeout });

    expect(ports.setTimeout(callback, 450)).toBe(17);
    ports.clearTimeout(17);
    ports.clearTimeout(undefined);

    expect(setTimeout).toHaveBeenCalledExactlyOnceWith(callback, 450);
    expect(clearTimeout).toHaveBeenCalledExactlyOnceWith(17);
  });

  it("uses the window timer primitives by default", () => {
    vi.useFakeTimers();
    try {
      const ports = createBrowserSelectionTimerPorts();
      const callback = vi.fn();

      const timeoutId = ports.setTimeout(callback, 450);
      expect(callback).not.toHaveBeenCalled();
      vi.advanceTimersByTime(449);
      expect(callback).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledExactlyOnceWith();

      const cancelledCallback = vi.fn();
      const cancelledId = ports.setTimeout(cancelledCallback, 450);
      ports.clearTimeout(cancelledId);
      vi.advanceTimersByTime(450);
      expect(cancelledCallback).not.toHaveBeenCalled();

      ports.clearTimeout(timeoutId);
    } finally {
      vi.useRealTimers();
    }
  });
});
