import { describe, expect, it } from "vitest";

import {
  projectAccountBootstrapGate,
  projectBootstrapErrorFromSession,
  resolveBootstrapAppBarSupportText,
  resolveCachedShellStatus,
  shouldMountBootstrapNavDrawer,
  shouldShowBootstrapErrorBanner,
} from "./model";
import type { SessionState } from "../session/model";

describe("projectAccountBootstrapGate", () => {
  it("projects session state kinds onto the stable bootstrap gate union", () => {
    expect(projectAccountBootstrapGate({ kind: "checking" })).toEqual({ kind: "healthChecking" });
    expect(projectAccountBootstrapGate({ kind: "noAccounts" })).toEqual({ kind: "noAccounts" });
    expect(projectAccountBootstrapGate({ kind: "connecting" })).toEqual({ kind: "connect" });
    expect(projectAccountBootstrapGate({ kind: "reconnectRequired", accountId: "alpha" })).toEqual({ kind: "reconnect" });
    expect(projectAccountBootstrapGate({ kind: "unlockRequired" })).toEqual({ kind: "unlock" });
    expect(projectAccountBootstrapGate({ kind: "restoring" })).toEqual({ kind: "restore" });
    expect(projectAccountBootstrapGate({ kind: "failed", bootstrapError: "down", workerUnavailable: true })).toEqual({ kind: "restore" });
    expect(projectAccountBootstrapGate({ kind: "ready" })).toEqual({ kind: "continue" });
    expect(projectAccountBootstrapGate({ kind: "offlineShell" })).toEqual({ kind: "continue" });
  });

});

describe("SessionState bootstrap projection matrix", () => {
  it.each([
    [{ kind: "checking" }, "healthChecking", undefined, false, false],
    [{ kind: "noAccounts", bootstrapError: "health failed" }, "noAccounts", "health failed", false, true],
    [{ kind: "connecting", bootstrapError: "connect failed" }, "connect", "connect failed", true, true],
    [{ kind: "reconnectRequired", accountId: "alpha", bootstrapError: "reconnect failed" }, "reconnect", "reconnect failed", true, true],
    [{ kind: "unlockRequired", bootstrapError: "unlock failed" }, "unlock", "unlock failed", true, false],
    [{ kind: "restoring", accountId: "alpha", bootstrapError: "restore failed" }, "restore", "restore failed", true, false],
    [{ kind: "ready" }, "continue", undefined, false, false],
    [{ kind: "offlineShell" }, "continue", undefined, false, false],
    [{ kind: "failed", bootstrapError: "worker failed", workerUnavailable: true }, "restore", "worker failed", true, false]
  ] as const)("projects %s consistently", (state, gate, error, navDrawer, banner) => {
    const projected = projectAccountBootstrapGate(state);
    expect(projected.kind).toBe(gate);
    expect(projectBootstrapErrorFromSession(state as SessionState)).toBe(error);
    expect(shouldMountBootstrapNavDrawer(projected)).toBe(navDrawer);
    expect(shouldShowBootstrapErrorBanner(projected)).toBe(banner);
  });
});

describe("resolveCachedShellStatus", () => {
  it.each([
    ["explicit-offline", "Explicit offline mode for Alpha workspace. Only readable local files are shown."],
    ["offline", "Offline cache only for Alpha workspace. Live session restore resumes once the worker is reachable again."],
    ["worker-unavailable", "Cached shell only for Alpha workspace. Live session restore resumes once the local server is reachable again."]
  ] as const)("keeps the exact %s announcement", (mode, message) => {
    expect(resolveCachedShellStatus(mode, "Alpha workspace")).toBe(message);
  });
});

describe("resolveBootstrapAppBarSupportText", () => {
  it("maps gate kinds to the support text App uses today", () => {
    expect(resolveBootstrapAppBarSupportText({ kind: "unavailable" })).toBe("Account storage unavailable");
    expect(resolveBootstrapAppBarSupportText({ kind: "healthChecking" })).toBe("Checking connection");
    expect(resolveBootstrapAppBarSupportText({ kind: "noAccounts" })).toBe("No accounts connected");
    expect(resolveBootstrapAppBarSupportText({ kind: "connect" })).toBe("Connect account");
    expect(resolveBootstrapAppBarSupportText({ kind: "reconnect" })).toBe("Reconnect required");
    expect(resolveBootstrapAppBarSupportText({ kind: "unlock" }, "Alpha workspace")).toBe(
      "Unlock required for Alpha workspace"
    );
    expect(resolveBootstrapAppBarSupportText({ kind: "restore" }, "Alpha workspace")).toBe("Restoring Alpha workspace");
    expect(resolveBootstrapAppBarSupportText({ kind: "continue" })).toBe("");
  });
});

describe("shouldMountBootstrapNavDrawer", () => {
  it("mounts NavDrawer only for connect, reconnect, unlock, and restore gates", () => {
    expect(shouldMountBootstrapNavDrawer({ kind: "unavailable" })).toBe(false);
    expect(shouldMountBootstrapNavDrawer({ kind: "healthChecking" })).toBe(false);
    expect(shouldMountBootstrapNavDrawer({ kind: "noAccounts" })).toBe(false);
    expect(shouldMountBootstrapNavDrawer({ kind: "connect" })).toBe(true);
    expect(shouldMountBootstrapNavDrawer({ kind: "reconnect" })).toBe(true);
    expect(shouldMountBootstrapNavDrawer({ kind: "unlock" })).toBe(true);
    expect(shouldMountBootstrapNavDrawer({ kind: "restore" })).toBe(true);
    expect(shouldMountBootstrapNavDrawer({ kind: "continue" })).toBe(false);
  });
});
