import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserFavouritesPointerEnvironment } from "./browserFavouritesPointerEnvironment";

describe("browser favourites pointer environment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates hit testing and removes each window listener with matching options", () => {
    const elementFromPoint = vi.fn(() => document.body);
    const addWindowListener = vi.spyOn(window, "addEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: elementFromPoint });

    const environment = createBrowserFavouritesPointerEnvironment();
    const listener = vi.fn();
    const options = { passive: false };
    const remove = environment.addWindowListener("pointermove", listener, options);

    expect(environment.elementFromPoint(12, 34)).toBe(document.body);
    expect(elementFromPoint).toHaveBeenCalledWith(12, 34);
    expect(addWindowListener).toHaveBeenCalledWith("pointermove", listener, options);

    remove();
    expect(removeWindowListener).toHaveBeenCalledWith("pointermove", listener, options);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: originalElementFromPoint });
  });
});
