import { describe, expect, it } from "vitest";

import { pushPath, pushSurface, readCurrentHistoryState, replacePath, syncPathToUrl } from "./controller";
import { createHistoryState } from "./model";
import type { HistoryPort } from "./ports";

const BASE_HREF = "http://localhost/?theme=dark";

const createFakeHistoryPort = (): HistoryPort & { states: unknown[]; urls: (string | undefined)[] } => {
  let current: unknown = null;
  return {
    states: [],
    urls: [],
    pushState(state, url) {
      current = state;
      this.states.push(state);
      this.urls.push(url);
    },
    replaceState(state, url) {
      current = state;
      this.states.push(state);
      this.urls.push(url);
    },
    getState() {
      return current;
    },
    getLocation() {
      return { href: BASE_HREF, search: "?theme=dark" };
    },
    subscribe() {
      return () => undefined;
    }
  };
};

describe("navigation controller", () => {
  it("pushes and replaces typed history states with coupled URLs", () => {
    const port = createFakeHistoryPort();

    replacePath(port, "alpha", "Projects", BASE_HREF);
    expect(port.states.at(-1)).toEqual(createHistoryState("alpha", "Projects"));
    expect(port.urls.at(-1)).toBe("http://localhost/?theme=dark&path=Projects&account=alpha");

    pushSurface(port, "alpha", "Projects", "settings", BASE_HREF);
    expect(port.states.at(-1)).toEqual(createHistoryState("alpha", "Projects", "settings"));
    expect(port.urls.at(-1)).toBe("http://localhost/?theme=dark&path=Projects&account=alpha");

    pushPath(port, "alpha", "Archive", BASE_HREF);
    expect(port.states.at(-1)).toEqual(createHistoryState("alpha", "Archive"));
    expect(port.urls.at(-1)).toBe("http://localhost/?theme=dark&path=Archive&account=alpha");
    expect(readCurrentHistoryState(port)).toEqual(createHistoryState("alpha", "Archive"));
  });

  it("syncs path to URL while preserving typed surface state", () => {
    const port = createFakeHistoryPort();
    pushSurface(port, "alpha", "Projects", "preview", BASE_HREF);

    syncPathToUrl(port, {
      path: "Projects/roadmap.txt",
      accountId: "alpha",
      baseHref: BASE_HREF
    });

    expect(port.states.at(-1)).toEqual(createHistoryState("alpha", "Projects/roadmap.txt", "preview"));
    expect(port.urls.at(-1)).toBe("http://localhost/?theme=dark&path=Projects%2Froadmap.txt&account=alpha");
  });

  it("syncs URL account from history when accountId input is omitted", () => {
    const port = createFakeHistoryPort();
    replacePath(port, "alpha", "Projects", BASE_HREF);

    syncPathToUrl(port, {
      path: "Archive",
      baseHref: "http://localhost/?theme=dark&path=Projects&account=stale"
    });

    expect(port.states.at(-1)).toEqual(createHistoryState("alpha", "Archive"));
    expect(port.urls.at(-1)).toBe("http://localhost/?theme=dark&path=Archive&account=alpha");
  });

  it("clears path and account URL params when syncing an empty path", () => {
    const port = createFakeHistoryPort();
    replacePath(port, "alpha", "Projects", BASE_HREF);

    syncPathToUrl(port, {
      path: "",
      accountId: "alpha",
      baseHref: "http://localhost/?path=Projects&account=alpha&theme=dark"
    });

    expect(port.states.at(-1)).toEqual(createHistoryState("alpha", ""));
    expect(port.urls.at(-1)).toBe("http://localhost/?theme=dark");
  });
});
