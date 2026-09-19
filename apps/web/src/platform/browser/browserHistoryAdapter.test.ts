import { describe, expect, it, vi } from "vitest";

import { createHistoryState } from "../../features/navigation/model";
import { createBrowserHistoryPort } from "./browserHistoryAdapter";

describe("browser history adapter", () => {
  it("wraps history push/replace/get and popstate subscription", () => {
    const listeners = new Map<string, EventListener>();
    const history = {
      state: null as unknown,
      pushState: vi.fn((state: unknown, _unused: string, url?: string) => {
        history.state = state;
        history.lastUrl = url;
      }),
      replaceState: vi.fn((state: unknown, _unused: string, url?: string) => {
        history.state = state;
        history.lastUrl = url;
      }),
      lastUrl: undefined as string | undefined
    };
    const win = {
      location: { href: "http://localhost/?theme=dark", search: "?theme=dark" },
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn((type: string) => {
        listeners.delete(type);
      })
    };

    const port = createBrowserHistoryPort(() => history, () => win);
    const state = createHistoryState("alpha", "Projects", "preview");
    const received: unknown[] = [];
    const unsubscribe = port.subscribe((next) => received.push(next));

    port.replaceState(createHistoryState("alpha", ""), "http://localhost/?path=");
    port.pushState(state, "http://localhost/?path=Projects&account=alpha");
    expect(history.replaceState).toHaveBeenCalledWith(createHistoryState("alpha", ""), "", "http://localhost/?path=");
    expect(history.pushState).toHaveBeenCalledWith(state, "", "http://localhost/?path=Projects&account=alpha");
    expect(port.getState()).toEqual(state);
    expect(port.getLocation()).toEqual({ href: "http://localhost/?theme=dark", search: "?theme=dark" });

    const handler = listeners.get("popstate");
    expect(handler).toBeTypeOf("function");
    handler?.(new PopStateEvent("popstate", { state: createHistoryState("alpha", "Archive") }));
    expect(received).toEqual([createHistoryState("alpha", "Archive")]);

    unsubscribe();
    expect(win.removeEventListener).toHaveBeenCalledWith("popstate", handler);
  });

  it("omits URL when adapter callers do not provide one", () => {
    const history = {
      state: null as unknown,
      pushState: vi.fn((state: unknown, _unused: string, url?: string) => {
        history.state = state;
        history.lastUrl = url;
      }),
      replaceState: vi.fn((state: unknown, _unused: string, url?: string) => {
        history.state = state;
        history.lastUrl = url;
      }),
      lastUrl: undefined as string | undefined
    };

    const port = createBrowserHistoryPort(() => history, () => ({
      location: { href: "http://localhost/", search: "" },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));

    port.replaceState(createHistoryState("alpha", "Projects"));
    expect(history.replaceState).toHaveBeenCalledWith(createHistoryState("alpha", "Projects"), "", undefined);
    expect(port.getLocation()).toEqual({ href: "http://localhost/", search: "" });
  });
});
