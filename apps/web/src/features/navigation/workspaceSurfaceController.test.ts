import { describe, expect, it, vi } from "vitest";

import { createHistoryState, type ChromeSurfaceKind, type OpenSurfacesSnapshot } from "./model";
import {
  applyWorkspacePopState,
  getWorkspaceOpenSurfaces,
  type WorkflowSurfacePorts,
  type WorkspaceSurfaceControllerPorts
} from "./workspaceSurfaceController";

const createPorts = (
  openWorkflow: readonly (keyof Pick<OpenSurfacesSnapshot, "preview" | "action" | "destination" | "account" | "removeAccount">)[] = [],
  openChrome: readonly ChromeSurfaceKind[] = [],
  events: string[] = []
) => {
  const workflowState = {
    preview: openWorkflow.includes("preview"),
    action: openWorkflow.includes("action"),
    destination: openWorkflow.includes("destination"),
    account: openWorkflow.includes("account"),
    removeAccount: openWorkflow.includes("removeAccount")
  };
  const dismiss = {
    preview: vi.fn(() => { workflowState.preview = false; events.push("dismiss:preview"); }),
    action: vi.fn(() => { workflowState.action = false; events.push("dismiss:action"); }),
    destination: vi.fn(() => { workflowState.destination = false; events.push("dismiss:destination"); }),
    account: vi.fn(() => { workflowState.account = false; events.push("dismiss:account"); }),
    removeAccount: vi.fn(() => { workflowState.removeAccount = false; events.push("dismiss:remove-account"); })
  };
  const workflow: WorkflowSurfacePorts = {
    preview: { isOpen: () => workflowState.preview, dismiss: dismiss.preview },
    action: { isOpen: () => workflowState.action, dismiss: dismiss.action },
    destination: { isOpen: () => workflowState.destination, dismiss: dismiss.destination },
    account: { isOpen: () => workflowState.account, dismiss: dismiss.account },
    removeAccount: { isOpen: () => workflowState.removeAccount, dismiss: dismiss.removeAccount }
  };
  const chromeState = {
    navigation: openChrome.includes("navigation"),
    search: openChrome.includes("search"),
    mobileDetails: openChrome.includes("mobile-details"),
    settings: openChrome.includes("settings"),
    transfers: openChrome.includes("transfers")
  };
  let currentPath = "Projects";
  const navigation = {
    getCurrentPath: () => currentPath,
    getChromeSnapshot: () => chromeState,
    dismissChrome: vi.fn((surface: ChromeSurfaceKind) => {
      const key = surface === "mobile-details" ? "mobileDetails" : surface;
      chromeState[key] = false;
      events.push(`dismiss:${surface}`);
    }),
    applyHistoryPath: vi.fn((path: string) => {
      currentPath = path;
      events.push(`navigate:${path}`);
    })
  };
  return { ports: { workflow, navigation } satisfies WorkspaceSurfaceControllerPorts, dismiss, navigation };
};

describe("workspaceSurfaceController", () => {
  it("dismisses every surface in order before applying a different path", () => {
    const cases = [
      { surface: "preview", workflow: ["preview"], chrome: [] },
      { surface: "action", workflow: ["action"], chrome: [] },
      { surface: "destination", workflow: ["destination"], chrome: [] },
      { surface: "account", workflow: ["account"], chrome: [] },
      { surface: "remove-account", workflow: ["removeAccount"], chrome: [] },
      { surface: "settings", workflow: [], chrome: ["settings"] },
      { surface: "search", workflow: [], chrome: ["search"] },
      { surface: "navigation", workflow: [], chrome: ["navigation"] },
      { surface: "mobile-details", workflow: [], chrome: ["mobile-details"] },
      { surface: "transfers", workflow: [], chrome: ["transfers"] }
    ] as const;
    for (const testCase of cases) {
      const events: string[] = [];
      const setup = createPorts(testCase.workflow, testCase.chrome, events);

      applyWorkspacePopState(createHistoryState("alpha", "Archive"), setup.ports);

      if (testCase.workflow.length > 0) {
        const key = testCase.workflow[0];
        if (!key) throw new Error(`Missing workflow surface for ${testCase.surface}`);
        expect(setup.dismiss[key]).toHaveBeenCalledTimes(1);
      } else {
        expect(setup.navigation.dismissChrome).toHaveBeenCalledWith(testCase.surface);
      }
      expect(setup.navigation.applyHistoryPath).toHaveBeenCalledWith("Archive");
      expect(events).toEqual([`dismiss:${testCase.surface}`, "navigate:Archive"]);
    }
  });

  it("projects all ten live surfaces and returns a frozen snapshot", () => {
    const setup = createPorts(
      ["preview", "action", "destination", "account", "removeAccount"],
      ["settings", "search", "navigation", "mobile-details", "transfers"]
    );

    const snapshot = getWorkspaceOpenSurfaces(setup.ports);

    expect(snapshot).toEqual({
      preview: true,
      action: true,
      destination: true,
      account: true,
      removeAccount: true,
      navigation: true,
      search: true,
      mobileDetails: true,
      settings: true,
      transfers: true
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("does not dismiss or navigate when no surface is open and ignores invalid or same-path history", () => {
    const setup = createPorts();

    applyWorkspacePopState(undefined, setup.ports);
    applyWorkspacePopState(createHistoryState("alpha", "Projects"), setup.ports);

    expect(setup.navigation.dismissChrome).not.toHaveBeenCalled();
    expect(setup.navigation.applyHistoryPath).not.toHaveBeenCalled();
    expect(Object.values(setup.dismiss).every((dismiss) => dismiss.mock.calls.length === 0)).toBe(true);
  });

  it("short-circuits navigation and preserves the thrown dismiss error", () => {
    const error = new Error("dismiss failed");
    const setup = createPorts(["preview"]);
    setup.dismiss.preview.mockImplementationOnce(() => { throw error; });

    let caught: unknown;
    try {
      applyWorkspacePopState(createHistoryState("alpha", "Archive"), setup.ports);
    } catch (caughtError) {
      caught = caughtError;
    }
    expect(caught).toBe(error);
    expect(setup.navigation.applyHistoryPath).not.toHaveBeenCalled();
  });
});
