import { describe, expect, it, vi } from "vitest";

import {
  applyAccountSwitchPathReset,
  clearAccountScopedUi,
  executeAccountSwitchReset,
  executeSessionTerminalReset
} from "./controller";
import type { SemanticAccountResetPorts } from "./ports";

const createPorts = (overrides: Partial<SemanticAccountResetPorts> = {}): SemanticAccountResetPorts => ({
  preview: { clearAccountContext: vi.fn() },
  selection: { clearFocused: vi.fn(), clearBatch: vi.fn() },
  browsing: { clearQuery: vi.fn(), clearListError: vi.fn() },
  navigation: { getLocationSearch: vi.fn(() => ""), setPath: vi.fn(), syncPath: vi.fn(), closeMobileDetails: vi.fn() },
  transfers: { failActiveForAccount: vi.fn() },
  session: { applyTerminal: vi.fn() },
  bootstrap: { setError: vi.fn() },
  presentation: { setStatus: vi.fn() },
  ...overrides
});

describe("account reset controller", () => {
  it("clears shared account-scoped ui state", () => {
    const ports = createPorts();

    clearAccountScopedUi(ports);

    expect(ports.preview.clearAccountContext).toHaveBeenCalledTimes(1);
    expect(ports.selection.clearFocused).toHaveBeenCalledTimes(1);
    expect(ports.selection.clearBatch).toHaveBeenCalledTimes(1);
    expect(ports.navigation.closeMobileDetails).toHaveBeenCalledTimes(1);
    expect(ports.browsing.clearListError).toHaveBeenCalledTimes(1);
  });

  it("restores first-mount path without syncing the url", () => {
    const ports = createPorts();

    applyAccountSwitchPathReset(ports, { kind: "first-mount-restore", path: "Projects", linkedAccountUnavailable: false });

    expect(ports.navigation.setPath).toHaveBeenCalledWith("Projects");
    expect(ports.navigation.syncPath).not.toHaveBeenCalled();
  });

  it("clears path and syncs url on account switch", () => {
    const ports = createPorts();

    applyAccountSwitchPathReset(ports, { kind: "switch-clear", path: "", syncAccountId: "beta" });

    expect(ports.navigation.setPath).toHaveBeenCalledWith("");
    expect(ports.navigation.syncPath).toHaveBeenCalledWith("", "beta");
  });

  it("resets account-scoped ui and search on account switch", () => {
    const ports = createPorts();

    executeAccountSwitchReset(ports, {
      isFirstAccountEffect: false,
      locationSearch: "?path=Projects&account=alpha",
      hasActiveAccount: true,
      accountId: "beta",
      accountDisplayName: "Beta workspace"
    });

    expect(ports.browsing.clearQuery).toHaveBeenCalledTimes(1);
    expect(ports.navigation.syncPath).toHaveBeenCalledWith("", "beta");
    expect(ports.presentation.setStatus).toHaveBeenCalledWith("Active account: Beta workspace");
    expect(ports.session.applyTerminal).not.toHaveBeenCalled();
    expect(ports.transfers.failActiveForAccount).not.toHaveBeenCalled();
  });

  it("announces the linked-account warning instead of the active account on a first-mount mismatch", () => {
    const ports = createPorts();

    executeAccountSwitchReset(ports, {
      isFirstAccountEffect: true,
      locationSearch: "?path=Projects&account=beta",
      hasActiveAccount: true,
      accountId: "alpha",
      accountDisplayName: "Alpha workspace"
    });

    expect(ports.navigation.setPath).toHaveBeenCalledWith("");
    expect(ports.presentation.setStatus).toHaveBeenCalledWith("The linked account is unavailable; showing Alpha workspace.");
  });

  it("invokes session terminal reset without clearing search or path", () => {
    const ports = createPorts();

    executeSessionTerminalReset(ports, {
      accountId: "alpha",
      message: "Session expired. Create a fresh session for this account.",
      reconnectRequired: false
    });

    expect(ports.session.applyTerminal).toHaveBeenCalledWith("alpha", false);
    expect(ports.transfers.failActiveForAccount).toHaveBeenCalledWith(
      "alpha",
      "Session expired. Create a fresh session for this account."
    );
    expect(ports.bootstrap.setError).toHaveBeenCalledWith("Session expired. Create a fresh session for this account.");
    expect(ports.presentation.setStatus).toHaveBeenCalledWith("Session expired. Create a fresh session for this account.");
    expect(ports.browsing.clearQuery).not.toHaveBeenCalled();
    expect(ports.navigation.setPath).not.toHaveBeenCalled();
    expect(ports.navigation.syncPath).not.toHaveBeenCalled();
  });

  it("marks reconnect-required accounts through the session terminal path", () => {
    const ports = createPorts();

    executeSessionTerminalReset(ports, {
      accountId: "beta",
      message: "This account needs to be reconnected before browsing files.",
      reconnectRequired: true
    });

    expect(ports.session.applyTerminal).toHaveBeenCalledWith("beta", true);
  });
});
