import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  createHistoryState,
  DISMISS_SURFACE_ORDER,
  resolvePopStateCommands,
  type ChromeSurfaceKind,
  type OpenSurfacesSnapshot
} from "./model";
import type { HistoryPort } from "./ports";
import { useWorkspaceSurfaceCoordinator, type WorkflowSurfacePorts } from "./useWorkspaceSurfaceCoordinator";

const navigationDir = dirname(fileURLToPath(import.meta.url));
const sourcePaths = {
  model: resolve(navigationDir, "model.ts"),
  controller: resolve(navigationDir, "workspaceSurfaceController.ts"),
  coordinator: resolve(navigationDir, "useWorkspaceSurfaceCoordinator.ts")
} as const;

const sourceDigest = (path: string): string => createHash("sha256").update(readFileSync(path, "utf8")).digest("hex");
const lockedSourceDigests = {
  model: "77e3f9c4c6d306696dcd6fcd94658a9f7f03cad7658c7515f631f0853471c9da",
  controller: "f74bb071fb804711800f6781ef8260eb35d9476d8d5fd4ed41151066ed43cbff",
  coordinator: "3ba508e1ccddf50e80f404b8a3f8541c0337f79c043b1cad84fd7420da3d4280"
} as const;

const surfaceKeys: Record<string, keyof OpenSurfacesSnapshot> = {
  preview: "preview",
  action: "action",
  destination: "destination",
  account: "account",
  "remove-account": "removeAccount",
  "report-bug": "reportBug",
  settings: "settings",
  search: "search",
  navigation: "navigation",
  "mobile-details": "mobileDetails",
  transfers: "transfers"
};

const closedSurfaces = (): OpenSurfacesSnapshot => ({
  preview: false,
  action: false,
  destination: false,
  account: false,
  removeAccount: false,
  reportBug: false,
  settings: false,
  search: false,
  navigation: false,
  mobileDetails: false,
  transfers: false
});

type MutableOpenSurfacesSnapshot = {
  -readonly [Key in keyof OpenSurfacesSnapshot]: OpenSurfacesSnapshot[Key]
};

const withSurfaces = (...open: readonly (keyof typeof surfaceKeys)[]): OpenSurfacesSnapshot => {
  const surfaces: MutableOpenSurfacesSnapshot = { ...closedSurfaces() };
  for (const surface of open) surfaces[surfaceKeys[surface]] = true;
  return surfaces;
};

const createLeakyHistory = (): HistoryPort & {
  readonly callback: (index: number) => (state: unknown) => void;
  readonly listenerCount: () => number;
} => {
  const callbacks: Array<(state: unknown) => void> = [];
  return {
    pushState: vi.fn(),
    replaceState: vi.fn(),
    getState: () => undefined,
    getLocation: () => ({ href: "http://localhost/?path=Projects", search: "?path=Projects" }),
    subscribe: (listener) => {
      callbacks.push(listener);
      return () => undefined;
    },
    callback: (index) => {
      const callback = callbacks[index];
      if (!callback) throw new Error(`Missing retained callback ${index}`);
      return callback;
    },
    listenerCount: () => callbacks.length
  };
};

const createWorkflow = (open: readonly string[] = [], events: string[] = []) => {
  const state = {
    preview: open.includes("preview"),
    action: open.includes("action"),
    destination: open.includes("destination"),
    account: open.includes("account"),
    removeAccount: open.includes("remove-account"),
    reportBug: open.includes("report-bug")
  };
  const dismiss = {
    preview: vi.fn(() => { state.preview = false; events.push("dismiss:preview"); }),
    action: vi.fn(() => { state.action = false; events.push("dismiss:action"); }),
    destination: vi.fn(() => { state.destination = false; events.push("dismiss:destination"); }),
    account: vi.fn(() => { state.account = false; events.push("dismiss:account"); }),
    removeAccount: vi.fn(() => { state.removeAccount = false; events.push("dismiss:remove-account"); }),
    reportBug: vi.fn(() => { state.reportBug = false; events.push("dismiss:report-bug"); })
  };
  const workflow: WorkflowSurfacePorts = {
    preview: { isOpen: () => state.preview, dismiss: dismiss.preview },
    action: { isOpen: () => state.action, dismiss: dismiss.action },
    destination: { isOpen: () => state.destination, dismiss: dismiss.destination },
    account: { isOpen: () => state.account, dismiss: dismiss.account },
    removeAccount: { isOpen: () => state.removeAccount, dismiss: dismiss.removeAccount },
    reportBug: { isOpen: () => state.reportBug, dismiss: dismiss.reportBug }
  };
  return { state, dismiss, workflow };
};

const createCoordinatorInput = (
  port: HistoryPort,
  workflow: WorkflowSurfacePorts,
  openChrome: readonly ChromeSurfaceKind[] = [],
  eventLog: string[] = []
) => {
  const chrome = {
    navigation: openChrome.includes("navigation"),
    search: openChrome.includes("search"),
    mobileDetails: openChrome.includes("mobile-details"),
    settings: openChrome.includes("settings"),
    transfers: openChrome.includes("transfers")
  };
  let currentPath = "Projects";
  const navigation = {
    getCurrentPath: () => currentPath,
    getChromeSnapshot: () => chrome,
    dismissChrome: vi.fn((surface: ChromeSurfaceKind) => {
      eventLog.push(`dismiss:${surface}`);
      const key = surface === "mobile-details" ? "mobileDetails" : surface;
      chrome[key] = false;
    }),
    applyHistoryPath: vi.fn((path: string) => {
      currentPath = path;
      eventLog.push(`navigate:${path}`);
    })
  };
  return {
    input: { port, workflow, navigation },
    navigation,
    events: eventLog,
    getCurrentPath: navigation.getCurrentPath
  };
};

describe("navigation surface and Back characterization", () => {
  it("drives every open surface through the live coordinator in priority order", () => {
    const eventLog: string[] = [];
    const port = createLeakyHistory();
    const workflow = createWorkflow([
      "preview", "action", "destination", "account", "remove-account", "report-bug"
    ], eventLog);
    const setup = createCoordinatorInput(
      port,
      workflow.workflow,
      ["settings", "search", "navigation", "mobile-details", "transfers"],
      eventLog
    );
    const hook = renderHook(() => useWorkspaceSurfaceCoordinator(setup.input));
    const callback = port.callback(0);

    for (const [index] of DISMISS_SURFACE_ORDER.entries()) {
      act(() => callback(createHistoryState("alpha", `Archive-${index}`)));
    }

    const expectedEvents = DISMISS_SURFACE_ORDER.flatMap((surface, index) => [
      `dismiss:${surface}`,
      `navigate:Archive-${index}`
    ]);
    expect(eventLog).toEqual(expectedEvents);
    expect(eventLog.filter((event) => event.startsWith("dismiss:"))).toHaveLength(11);
    expect(new Set(eventLog.filter((event) => event.startsWith("dismiss:")))).toEqual(
      new Set(DISMISS_SURFACE_ORDER.map((surface) => `dismiss:${surface}`))
    );
    for (let index = 0; index < expectedEvents.length; index += 2) {
      expect(eventLog[index]?.startsWith("dismiss:")).toBe(true);
      expect(eventLog[index + 1]?.startsWith("navigate:")).toBe(true);
    }
    hook.unmount();
  });

  it("uses current inputs while rejecting retired ports and stale generations", () => {
    const firstEvents: string[] = [];
    const secondEvents: string[] = [];
    const firstPort = createLeakyHistory();
    const secondPort = createLeakyHistory();
    const first = createCoordinatorInput(firstPort, createWorkflow(["preview"], firstEvents).workflow);
    const second = createCoordinatorInput(secondPort, createWorkflow(["remove-account"], secondEvents).workflow, ["settings"], secondEvents);
    const hook = renderHook(
      (input: typeof first.input) => useWorkspaceSurfaceCoordinator(input),
      { initialProps: first.input }
    );
    const firstCallback = firstPort.callback(0);

    hook.rerender(second.input);
    expect(firstPort.listenerCount()).toBe(1);
    expect(secondPort.listenerCount()).toBe(1);
    act(() => firstCallback(createHistoryState("alpha", "Archive")));
    expect(firstEvents).toEqual([]);
    expect(secondEvents).toEqual([]);

    const secondCallback = secondPort.callback(0);
    act(() => secondCallback(createHistoryState("alpha", "Archive")));
    expect(secondEvents).toEqual(["dismiss:remove-account", "navigate:Archive"]);

    hook.unmount();
    act(() => secondCallback(createHistoryState("alpha", "Archive-2")));
    expect(secondEvents).toEqual(["dismiss:remove-account", "navigate:Archive"]);
  });

  it("locks the live Gate-1 source inputs", () => {
    expect(Object.fromEntries(Object.entries(sourcePaths).map(([key, path]) => [key, sourceDigest(path)]))).toEqual(
      lockedSourceDigests
    );
    expect(DISMISS_SURFACE_ORDER).toEqual([
      "preview", "action", "destination", "account", "remove-account", "report-bug",
      "settings", "search", "navigation", "mobile-details", "transfers"
    ]);
  });

  if (process.env.DAVORA_NAVIGATION_SURFACE_FAILING_FIRST === "1") {
    it("failing-first sentinel rejects a deliberately wrong surface priority", () => {
      expect(resolvePopStateCommands({
        historyState: createHistoryState("alpha", "Archive"),
        currentPath: "Projects",
        openSurfaces: withSurfaces("preview", "transfers")
      })).toEqual([
        { kind: "dismiss", surface: "transfers" },
        { kind: "navigate", path: "Archive" }
      ]);
    });
  }
});
