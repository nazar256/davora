import { describe, expect, it, vi } from "vitest";

import {
  applyNavigationCommands,
  applyNavigationDismiss,
  applyPathNavigateSideEffects,
  createNavigationCommandApplicationPorts
} from "./controller";
import { DISMISS_SURFACE_ORDER, type NavigationCommand } from "./model";
import type { NavigationCommandApplicationPorts, NavigationCommandApplicationSource } from "./ports";

const createPorts = (): NavigationCommandApplicationPorts => ({
  dismiss: {
    preview: vi.fn(),
    action: vi.fn(),
    destination: vi.fn(),
    account: vi.fn(),
    removeAccount: vi.fn(),
    chrome: vi.fn()
  },
  navigate: {
    clearSelectedEntry: vi.fn(),
    clearBatchSelection: vi.fn(),
    clearChromeForPathNavigate: vi.fn(),
    clearForPathTransition: vi.fn(),
    setCurrentPath: vi.fn()
  }
});

const createSource = (): NavigationCommandApplicationSource => ({
  closePreview: vi.fn(),
  dismissAction: vi.fn(),
  closeDestinationPicker: vi.fn(),
  setShowAccountDialog: vi.fn(),
  setRemoveAccountTarget: vi.fn(),
  dismissChrome: vi.fn(),
  clearSelectedEntry: vi.fn(),
  clearBatchSelection: vi.fn(),
  clearChromeForPathNavigate: vi.fn(),
  clearForPathTransition: vi.fn(),
  setCurrentPath: vi.fn()
});

describe("navigation command application", () => {
  it("fans out dismiss commands to the owning surface handlers", () => {
    const ports = createPorts();

    for (const surface of DISMISS_SURFACE_ORDER) {
      vi.mocked(ports.dismiss.preview).mockClear();
      vi.mocked(ports.dismiss.action).mockClear();
      vi.mocked(ports.dismiss.destination).mockClear();
      vi.mocked(ports.dismiss.account).mockClear();
      vi.mocked(ports.dismiss.removeAccount).mockClear();
      vi.mocked(ports.dismiss.chrome).mockClear();

      applyNavigationDismiss(ports, surface);

      switch (surface) {
        case "preview":
          expect(ports.dismiss.preview).toHaveBeenCalledTimes(1);
          break;
        case "action":
          expect(ports.dismiss.action).toHaveBeenCalledTimes(1);
          break;
        case "destination":
          expect(ports.dismiss.destination).toHaveBeenCalledTimes(1);
          break;
        case "account":
          expect(ports.dismiss.account).toHaveBeenCalledTimes(1);
          break;
        case "remove-account":
          expect(ports.dismiss.removeAccount).toHaveBeenCalledTimes(1);
          break;
        case "settings":
        case "search":
        case "navigation":
        case "mobile-details":
        case "transfers":
          expect(ports.dismiss.chrome).toHaveBeenCalledWith(surface);
          break;
      }
    }
  });

  it("clears entry, batch, chrome-for-path, and opened entry before setting path", () => {
    const ports = createPorts();
    const calls: string[] = [];

    vi.mocked(ports.navigate.clearSelectedEntry).mockImplementation(() => calls.push("clearSelectedEntry"));
    vi.mocked(ports.navigate.clearBatchSelection).mockImplementation(() => calls.push("clearBatchSelection"));
    vi.mocked(ports.navigate.clearChromeForPathNavigate).mockImplementation(() => calls.push("clearChromeForPathNavigate"));
    vi.mocked(ports.navigate.clearForPathTransition).mockImplementation(() => calls.push("clearForPathTransition"));
    vi.mocked(ports.navigate.setCurrentPath).mockImplementation(() => calls.push("setCurrentPath"));

    applyPathNavigateSideEffects(ports, "Archive/2026");

    expect(calls).toEqual([
      "clearSelectedEntry",
      "clearBatchSelection",
      "clearChromeForPathNavigate",
      "clearForPathTransition",
      "setCurrentPath"
    ]);
    expect(ports.navigate.setCurrentPath).toHaveBeenCalledWith("Archive/2026");
  });

  it("applies ordered dismiss and navigate commands from Back history", () => {
    const ports = createPorts();
    const commands: readonly NavigationCommand[] = [
      { kind: "dismiss", surface: "preview" },
      { kind: "navigate", path: "" }
    ];

    applyNavigationCommands(ports, commands);

    expect(ports.dismiss.preview).toHaveBeenCalledTimes(1);
    expect(ports.navigate.setCurrentPath).toHaveBeenCalledWith("");
  });

  it("applies exactly one dismiss before every navigation cleanup side effect", () => {
    const ports = createPorts();
    const calls: string[] = [];

    vi.mocked(ports.dismiss.preview).mockImplementation(() => calls.push("dismiss.preview"));
    vi.mocked(ports.navigate.clearSelectedEntry).mockImplementation(() => calls.push("clearSelectedEntry"));
    vi.mocked(ports.navigate.clearBatchSelection).mockImplementation(() => calls.push("clearBatchSelection"));
    vi.mocked(ports.navigate.clearChromeForPathNavigate).mockImplementation(() => calls.push("clearChromeForPathNavigate"));
    vi.mocked(ports.navigate.clearForPathTransition).mockImplementation(() => calls.push("clearForPathTransition"));
    vi.mocked(ports.navigate.setCurrentPath).mockImplementation(() => calls.push("setCurrentPath"));

    applyNavigationCommands(ports, [
      { kind: "dismiss", surface: "preview" },
      { kind: "navigate", path: "Archive" }
    ]);

    expect(calls).toEqual([
      "dismiss.preview",
      "clearSelectedEntry",
      "clearBatchSelection",
      "clearChromeForPathNavigate",
      "clearForPathTransition",
      "setCurrentPath"
    ]);
    expect(ports.dismiss.preview).toHaveBeenCalledTimes(1);
    expect(ports.dismiss.action).not.toHaveBeenCalled();
    expect(ports.dismiss.destination).not.toHaveBeenCalled();
    expect(ports.dismiss.account).not.toHaveBeenCalled();
    expect(ports.dismiss.removeAccount).not.toHaveBeenCalled();
    expect(ports.dismiss.chrome).not.toHaveBeenCalled();
  });

  it("maps source adapters to the same dismiss and navigate side effects", () => {
    const source = createSource();
    const ports = createNavigationCommandApplicationPorts(source);

    applyNavigationCommands(ports, [{ kind: "dismiss", surface: "settings" }]);
    expect(source.dismissChrome).toHaveBeenCalledWith("settings");

    applyPathNavigateSideEffects(ports, "Projects");
    expect(source.clearSelectedEntry).toHaveBeenCalled();
    expect(source.clearBatchSelection).toHaveBeenCalled();
    expect(source.clearChromeForPathNavigate).toHaveBeenCalled();
    expect(source.clearForPathTransition).toHaveBeenCalled();
    expect(source.setCurrentPath).toHaveBeenCalledWith("Projects");
  });
});
