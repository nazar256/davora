import { describe, expect, it } from "vitest";

import {
  buildActiveAccountStatusMessage,
  defaultPreviewCacheState,
  planAccountSwitchPathReset,
  resolveSessionTerminalMutation
} from "./model";

describe("account reset model", () => {
  describe("defaultPreviewCacheState", () => {
    it("returns the idle preview cache shape", () => {
      expect(defaultPreviewCacheState()).toEqual({
        source: "none",
        refreshing: false,
        stale: false,
        updateReady: false
      });
    });
  });

  describe("planAccountSwitchPathReset", () => {
    it("restores a nested folder path from the location search on first mount", () => {
      expect(planAccountSwitchPathReset({
        isFirstAccountEffect: true,
        locationSearch: "?path=Projects&account=alpha",
        hasActiveAccount: true,
        accountId: "alpha"
      })).toEqual({
        kind: "first-mount-restore",
        path: "Projects",
        linkedAccountUnavailable: false
      });
    });

    it("suppresses a url path when the linked account does not match the active account", () => {
      expect(planAccountSwitchPathReset({
        isFirstAccountEffect: true,
        locationSearch: "?path=Projects&account=beta",
        hasActiveAccount: true,
        accountId: "alpha"
      })).toEqual({
        kind: "first-mount-restore",
        path: "",
        linkedAccountUnavailable: true
      });
    });

    it("restores a url path without a linked account under the active account", () => {
      expect(planAccountSwitchPathReset({
        isFirstAccountEffect: true,
        locationSearch: "?path=Projects",
        hasActiveAccount: true,
        accountId: "alpha"
      })).toEqual({
        kind: "first-mount-restore",
        path: "Projects",
        linkedAccountUnavailable: false
      });
    });

    it("keeps the root path when first mount has no url path", () => {
      expect(planAccountSwitchPathReset({
        isFirstAccountEffect: true,
        locationSearch: "",
        hasActiveAccount: true,
        accountId: "alpha"
      })).toEqual({
        kind: "first-mount-restore",
        path: "",
        linkedAccountUnavailable: false
      });
    });

    it("does not restore a url path when there is no active account on first mount", () => {
      expect(planAccountSwitchPathReset({
        isFirstAccountEffect: true,
        locationSearch: "?path=Projects&account=alpha",
        hasActiveAccount: false
      })).toEqual({
        kind: "first-mount-restore",
        path: "",
        linkedAccountUnavailable: true
      });
    });

    it("clears the path and scopes url sync to the next account after the first effect", () => {
      expect(planAccountSwitchPathReset({
        isFirstAccountEffect: false,
        locationSearch: "?path=Projects&account=alpha",
        hasActiveAccount: true,
        accountId: "beta"
      })).toEqual({
        kind: "switch-clear",
        path: "",
        syncAccountId: "beta"
      });
    });
  });

  describe("resolveSessionTerminalMutation", () => {
    it("maps reconnect-required to reconnect-required", () => {
      expect(resolveSessionTerminalMutation("alpha", true)).toBe("reconnect-required");
    });

    it("maps session expiry to clear-session", () => {
      expect(resolveSessionTerminalMutation("alpha", false)).toBe("clear-session");
    });
  });

  describe("buildActiveAccountStatusMessage", () => {
    it("names the active account without secrets", () => {
      expect(buildActiveAccountStatusMessage("Alpha workspace")).toBe("Active account: Alpha workspace");
    });
  });
});
