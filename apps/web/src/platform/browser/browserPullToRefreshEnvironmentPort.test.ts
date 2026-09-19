// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createBrowserPullToRefreshEnvironmentPort } from "./browserPullToRefreshEnvironmentPort";

describe("createBrowserPullToRefreshEnvironmentPort", () => {
  it("reads the current window scroll position at call time", () => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 18 });
    const port = createBrowserPullToRefreshEnvironmentPort();
    expect(port.getWindowScrollY()).toBe(18);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    expect(port.getWindowScrollY()).toBe(0);
  });
});
