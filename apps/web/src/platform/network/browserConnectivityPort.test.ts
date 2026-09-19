// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserConnectivityPort } from "./browserConnectivityPort";

const setBrowserOnline = (online: boolean) => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: online
  });
};

afterEach(() => {
  setBrowserOnline(true);
});

describe("createBrowserConnectivityPort", () => {
  it("reads navigator.onLine as a typed snapshot", () => {
    const port = createBrowserConnectivityPort();
    setBrowserOnline(false);
    expect(port.read()).toEqual({ kind: "offline" });
    setBrowserOnline(true);
    expect(port.read()).toEqual({ kind: "online" });
  });

  it("owns online/offline listeners and removes both on unsubscribe", () => {
    const port = createBrowserConnectivityPort();
    const listener = vi.fn();
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const unsubscribe = port.subscribe(listener);
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    expect(listener).toHaveBeenNthCalledWith(1, { kind: "offline" });
    expect(listener).toHaveBeenNthCalledWith(2, { kind: "online" });
    expect(addSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("offline", expect.any(Function));

    unsubscribe();
    window.dispatchEvent(new Event("offline"));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("offline", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
