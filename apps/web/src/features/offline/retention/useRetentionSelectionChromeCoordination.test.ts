import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  useRetentionSelectionChromeCoordination,
  type RetentionSelectionChromeCoordinationPorts
} from "./useRetentionSelectionChromeCoordination";

type PortSet = {
  readonly ports: {
    readonly clearFocusedSelection: ReturnType<typeof vi.fn>;
    readonly clearBatchSelection: ReturnType<typeof vi.fn>;
    readonly closeMobileDetails: ReturnType<typeof vi.fn>;
    readonly closePreviewAndNavigation: ReturnType<typeof vi.fn>;
  };
  readonly events: string[];
  readonly focused: ReturnType<typeof vi.fn>;
  readonly batch: ReturnType<typeof vi.fn>;
  readonly mobileDetails: ReturnType<typeof vi.fn>;
  readonly previewAndNavigation: ReturnType<typeof vi.fn>;
};

function createPortSet(prefix: string): PortSet {
  const events: string[] = [];
  const focused = vi.fn(() => { events.push(`${prefix}:focused`); });
  const batch = vi.fn(() => { events.push(`${prefix}:batch`); });
  const mobileDetails = vi.fn(() => { events.push(`${prefix}:mobile-details`); });
  const previewAndNavigation = vi.fn(() => {
    events.push(`${prefix}:preview`);
    events.push(`${prefix}:navigation`);
  });
  return {
    ports: {
      clearFocusedSelection: focused,
      clearBatchSelection: batch,
      closeMobileDetails: mobileDetails,
      closePreviewAndNavigation: previewAndNavigation
    },
    events,
    focused,
    batch,
    mobileDetails,
    previewAndNavigation
  };
}

function renderCoordinator(ports: RetentionSelectionChromeCoordinationPorts) {
  return renderHook(({ currentPorts }) => useRetentionSelectionChromeCoordination(currentPorts), {
    initialProps: { currentPorts: ports }
  });
}

describe("useRetentionSelectionChromeCoordination", () => {
  it("executes the exact synchronous four-port/five-effect order", () => {
    const current = createPortSet("current");
    const hook = renderCoordinator(current.ports);

    hook.result.current.clearSelectionChrome();

    expect(current.events).toEqual([
      "current:focused",
      "current:batch",
      "current:mobile-details",
      "current:preview",
      "current:navigation"
    ]);
  });

  it("calls each port exactly once per command invocation", () => {
    const current = createPortSet("current");
    const hook = renderCoordinator(current.ports);

    hook.result.current.clearSelectionChrome();
    hook.result.current.clearSelectionChrome();

    expect(current.focused).toHaveBeenCalledTimes(2);
    expect(current.batch).toHaveBeenCalledTimes(2);
    expect(current.mobileDetails).toHaveBeenCalledTimes(2);
    expect(current.previewAndNavigation).toHaveBeenCalledTimes(2);
    expect(current.events).toHaveLength(10);
  });

  it("stops synchronously at each throw point and preserves the prefix", () => {
    const points = [
      "clearFocusedSelection",
      "clearBatchSelection",
      "closeMobileDetails",
      "closePreviewAndNavigation"
    ] as const;
    const prefixes = [
      [],
      ["current:focused"],
      ["current:focused", "current:batch"],
      ["current:focused", "current:batch", "current:mobile-details"]
    ];

    points.forEach((point, index) => {
      const current = createPortSet("current");
      const error = new Error(point);
      const eventName = point === "clearFocusedSelection"
        ? "focused"
        : point === "clearBatchSelection"
          ? "batch"
          : point === "closeMobileDetails"
            ? "mobile-details"
            : "preview";
      current.ports[point].mockImplementationOnce(() => {
        current.events.push(`current:${eventName}`);
        throw error;
      });
      const hook = renderCoordinator(current.ports);

      expect(() => hook.result.current.clearSelectionChrome()).toThrow(error);
      expect(current.events).toEqual([...prefixes[index], `current:${eventName}`]);
      expect(current.focused).toHaveBeenCalledTimes(index >= 0 ? 1 : 0);
      expect(current.batch).toHaveBeenCalledTimes(index >= 1 ? 1 : 0);
      expect(current.mobileDetails).toHaveBeenCalledTimes(index >= 2 ? 1 : 0);
      expect(current.previewAndNavigation).toHaveBeenCalledTimes(index >= 3 ? 1 : 0);
    });
  });

  it("rethrows the exact collaborator error object", () => {
    const current = createPortSet("current");
    const error = new Error("identity");
    current.previewAndNavigation.mockImplementationOnce(() => { throw error; });
    const hook = renderCoordinator(current.ports);

    let thrown: unknown;
    try {
      hook.result.current.clearSelectionChrome();
    } catch (candidate) {
      thrown = candidate;
    }

    expect(thrown).toBe(error);
    expect(current.events).toEqual(["current:focused", "current:batch", "current:mobile-details"]);
  });

  it("keeps clearSelectionChrome identity stable across rerenders", () => {
    const first = createPortSet("first");
    const hook = renderHook(({ currentPorts }) => useRetentionSelectionChromeCoordination(currentPorts), {
      initialProps: { currentPorts: first.ports }
    });
    const command = hook.result.current.clearSelectionChrome;
    hook.rerender({ currentPorts: first.ports });

    expect(hook.result.current.clearSelectionChrome).toBe(command);
  });

  it("routes invocation-time calls to replacement ports and never stale ports", () => {
    const first = createPortSet("first");
    const second = createPortSet("second");
    const hook = renderHook(({ currentPorts }) => useRetentionSelectionChromeCoordination(currentPorts), {
      initialProps: { currentPorts: first.ports }
    });

    hook.rerender({ currentPorts: second.ports });
    hook.result.current.clearSelectionChrome();

    expect(first.events).toEqual([]);
    expect(second.events).toEqual([
      "second:focused",
      "second:batch",
      "second:mobile-details",
      "second:preview",
      "second:navigation"
    ]);
  });

  it("dispatches once under StrictMode and repeated renders", () => {
    const current = createPortSet("current");
    const hook = renderHook(({ currentPorts }) => useRetentionSelectionChromeCoordination(currentPorts), {
      initialProps: { currentPorts: current.ports },
      wrapper: StrictMode
    });
    hook.rerender({ currentPorts: current.ports });
    hook.result.current.clearSelectionChrome();

    expect(current.events).toEqual([
      "current:focused",
      "current:batch",
      "current:mobile-details",
      "current:preview",
      "current:navigation"
    ]);
  });

  it("has only the stable command and no asynchronous, effect, resource, or internal dependency surface", () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "useRetentionSelectionChromeCoordination.ts"), "utf8");
    const hook = renderCoordinator(createPortSet("current").ports);

    expect(Object.keys(hook.result.current)).toEqual(["clearSelectionChrome"]);
    expect(source).not.toMatch(/use(State|Effect|LayoutEffect|Memo|Reducer)|async|await|Promise|setTimeout|setInterval|clearTimeout|clearInterval|addEventListener|removeEventListener|fetch|XMLHttpRequest|indexedDB|localStorage|sessionStorage|document|window|storage|network|Worker/);
    expect((source.match(/from\s+["'][^"']+["']/g) ?? []).filter((statement) => !statement.includes('"react"'))).toEqual([]);
    expect(source).toContain("useRef");
    expect(source).toContain("useCallback");
  });
});
