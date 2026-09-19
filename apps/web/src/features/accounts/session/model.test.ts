import type { ConnectedAccount, HealthResponse } from "@davora/shared";
import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../../../lib/api";
import { buildAccount } from "../../../test/accounts";
import { buildHealthResponse } from "../../../test/api";
import {
  buildEnsureSessionSuccessMessage,
  canAttemptAutoRestore,
  getBootstrapErrorMessage,
  getHealthConfigErrorMessage,
  initialSessionLifecycle,
  isTransientBootstrapError,
  projectAutoRestorePausedForAccountId,
  projectEnsureSessionFailure,
  projectHealthLoadFailure,
  projectHealthLoadSuccess,
  projectWorkerUnavailable,
  resolveSessionState,
  retryTransientBootstrap,
  shouldAttemptAutoRestore,
  shouldSkipHealthLoad,
  transitionEnsureSessionFailure,
  transitionEnsureSessionStart,
  transitionEnsureSessionSuccess,
  transitionHealthLoadFailure,
  transitionHealthLoadStart,
  transitionHealthLoadSuccess,
  type SessionLifecycleState
} from "./model";

const connectedAccount = (overrides: Partial<ConnectedAccount> = {}): ConnectedAccount =>
  buildAccount("alpha", { displayName: "Alpha workspace", ...overrides });

describe("account session model", () => {
  describe("isTransientBootstrapError", () => {
    it("treats 5xx api errors as transient except config_error", () => {
      expect(isTransientBootstrapError(new ApiRequestError("down", 503))).toBe(true);
      expect(isTransientBootstrapError(new ApiRequestError("config", 500, "config_error"))).toBe(false);
    });

    it("treats fetch and network errors as transient", () => {
      expect(isTransientBootstrapError(new TypeError("fetch failed"))).toBe(true);
      expect(isTransientBootstrapError(new Error("socket hang up"))).toBe(true);
    });

    it("does not treat auth or reconnect failures as transient", () => {
      expect(isTransientBootstrapError(new ApiRequestError("expired", 401, "session_invalid"))).toBe(false);
      expect(isTransientBootstrapError(new ApiRequestError("reconnect", 409, "account_reconnect_required"))).toBe(false);
    });
  });

  describe("getBootstrapErrorMessage", () => {
    it("maps unlock, config, reconnect, and server failures without echoing secrets", () => {
      expect(getBootstrapErrorMessage(new ApiRequestError("bad code", 401, "invalid_unlock_code"), true))
        .toMatch(/unlock code is invalid/i);
      expect(getBootstrapErrorMessage(new ApiRequestError("sentinel api detail", 500, "config_error"), true))
        .toBe("Unable to unlock this deployment. Confirm the unlock code and retry.");
      expect(getBootstrapErrorMessage(new Error("sentinel unknown detail"), true))
        .toBe("Unable to unlock this deployment. Confirm the unlock code and retry.");
      expect(getBootstrapErrorMessage(new ApiRequestError("missing secret", 500, "config_error"), false))
        .toBe("missing secret");
      expect(getBootstrapErrorMessage(new ApiRequestError("reconnect", 409, "account_reconnect_required"), false))
        .toMatch(/reconnected/i);
      expect(getBootstrapErrorMessage(new ApiRequestError("down", 503), false))
        .toMatch(/unable to reach the worker/i);
    });
  });

  describe("getHealthConfigErrorMessage", () => {
    it("returns undefined when config is loaded", () => {
      expect(getHealthConfigErrorMessage(buildHealthResponse())).toBeUndefined();
    });

    it("surfaces SESSION_SECRET guidance when missing", () => {
      const health: HealthResponse = {
        ...buildHealthResponse(),
        configLoaded: false,
        backend: "nextcloud",
        missing: ["SESSION_SECRET"]
      };

      expect(getHealthConfigErrorMessage(health)).toMatch(/SESSION_SECRET is missing/i);
    });
  });

  describe("health load projection", () => {
    it("projects unlockRequired and config errors on success", () => {
      const health = buildHealthResponse({ unlockRequired: true, configLoaded: false, missing: ["SESSION_SECRET"] });

      const projection = projectHealthLoadSuccess(health);
      expect(projection).toMatchObject({
        unlockRequired: true,
        rootPath: health.rootPath,
        workerUnavailable: false
      });
      expect(projection.bootstrapError).toMatch(/SESSION_SECRET is missing/i);
    });

    it("projects workerUnavailable and bootstrap error on transient failure", () => {
      const projection = projectHealthLoadFailure(new TypeError("fetch failed"));
      expect(projection).toMatchObject({
        workerUnavailable: true
      });
      expect(projection.bootstrapError).toMatch(/could not restore the local worker/i);
    });
  });

  describe("ensure session projection", () => {
    it("builds a success status message from the restored account name", () => {
      expect(buildEnsureSessionSuccessMessage("Alpha workspace")).toBe("Restored workspace access for Alpha workspace");
    });

    it("maps reconnect_required and 401 mutations", () => {
      expect(projectEnsureSessionFailure(new ApiRequestError("reconnect", 409, "account_reconnect_required"), {
        accountId: "alpha",
        source: "auto",
        unlockFlow: false
      })).toMatchObject({
        mutation: { kind: "reconnect-required", accountId: "alpha" },
        pauseAutoRestore: true
      });

      expect(projectEnsureSessionFailure(new ApiRequestError("expired", 401, "session_invalid"), {
        accountId: "alpha",
        source: "manual",
        unlockFlow: false
      })).toMatchObject({
        mutation: { kind: "clear-session", accountId: "alpha" },
        pauseAutoRestore: false
      });
    });

    it("pauses auto-restore only for auto source failures", () => {
      const error = new ApiRequestError("expired", 401, "session_invalid");

      expect(projectEnsureSessionFailure(error, { accountId: "alpha", source: "auto", unlockFlow: false }).pauseAutoRestore).toBe(true);
      expect(projectEnsureSessionFailure(error, { accountId: "alpha", source: "manual", unlockFlow: false }).pauseAutoRestore).toBe(false);
    });
  });

  describe("canAttemptAutoRestore", () => {
    it("allows connected and reconnect_required accounts", () => {
      expect(canAttemptAutoRestore(connectedAccount())).toBe(true);
      expect(canAttemptAutoRestore(connectedAccount({ connectionState: "reconnect_required" }))).toBe(true);
      expect(canAttemptAutoRestore(undefined)).toBe(false);
    });
  });

  describe("shouldSkipHealthLoad", () => {
    it("skips health when explicit offline mode is active", () => {
      expect(shouldSkipHealthLoad(true)).toBe(true);
      expect(shouldSkipHealthLoad(false)).toBe(false);
    });
  });

  describe("shouldAttemptAutoRestore", () => {
    const base = {
      activeAccount: connectedAccount(),
      unlockRequired: false,
      healthLoading: false,
      healthReady: true,
      sessionBusy: false,
      offline: false,
      explicitOfflineMode: false
    };

    it("attempts restore only when all gates are open", () => {
      expect(shouldAttemptAutoRestore({ ...base, token: undefined })).toBe(true);
    });

    it("does not attempt restore when token, unlock, health, busy, offline, explicit offline, or paused", () => {
      expect(shouldAttemptAutoRestore({ ...base, token: "token-alpha" })).toBe(false);
      expect(shouldAttemptAutoRestore({ ...base, unlockRequired: true })).toBe(false);
      expect(shouldAttemptAutoRestore({ ...base, healthLoading: true })).toBe(false);
      expect(shouldAttemptAutoRestore({ ...base, healthReady: false })).toBe(false);
      expect(shouldAttemptAutoRestore({ ...base, sessionBusy: true })).toBe(false);
      expect(shouldAttemptAutoRestore({ ...base, offline: true })).toBe(false);
      expect(shouldAttemptAutoRestore({ ...base, explicitOfflineMode: true })).toBe(false);
      expect(shouldAttemptAutoRestore({ ...base, autoRestorePausedForAccountId: "alpha" })).toBe(false);
    });
  });

  describe("retryTransientBootstrap", () => {
    it("retries transient failures with bounded backoff and succeeds", async () => {
      const delay = vi.fn(async () => undefined);
      const runner = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce("ok");

      await expect(retryTransientBootstrap(runner, delay, 3)).resolves.toBe("ok");
      expect(runner).toHaveBeenCalledTimes(2);
      expect(delay).toHaveBeenCalledWith(250);
    });

    it("stops retrying terminal failures immediately", async () => {
      const delay = vi.fn(async () => undefined);
      const runner = vi.fn(async () => {
        throw new ApiRequestError("expired", 401, "session_invalid");
      });

      await expect(retryTransientBootstrap(runner, delay, 3)).rejects.toMatchObject({ status: 401 });
      expect(runner).toHaveBeenCalledTimes(1);
      expect(delay).not.toHaveBeenCalled();
    });
  });

  describe("session lifecycle transitions", () => {
    it("starts skipped in explicit offline mode and checking otherwise", () => {
      expect(initialSessionLifecycle(true)).toEqual({ kind: "skipped" });
      expect(initialSessionLifecycle(false)).toEqual({ kind: "checking" });
    });

    it("projects health success and failure into lifecycle states", () => {
      const health = buildHealthResponse({ unlockRequired: true, rootPath: "workspace-root" });
      const ready = transitionHealthLoadSuccess({ kind: "checking" }, projectHealthLoadSuccess(health));
      expect(ready).toMatchObject({
        kind: "healthReady",
        unlockRequired: true,
        healthRootPath: "workspace-root"
      });

      const failed = transitionHealthLoadFailure(
        { kind: "checking" },
        projectHealthLoadFailure(new TypeError("fetch failed"))
      );
      expect(failed).toMatchObject({
        kind: "healthFailed",
        workerUnavailable: true
      });
    });

    it("tracks restore busy and pause transitions", () => {
      const ready: SessionLifecycleState = {
        kind: "healthReady",
        unlockRequired: false,
        healthRootPath: ".davora-agent-test"
      };
      const restoring = transitionEnsureSessionStart(ready, "alpha");
      expect(restoring).toMatchObject({ kind: "restoring", accountId: "alpha" });

      const success = transitionEnsureSessionSuccess(restoring);
      expect(success).toMatchObject({ kind: "awaitingRestore", workerUnavailable: false });

      const paused = transitionEnsureSessionFailure(
        restoring,
        projectEnsureSessionFailure(new ApiRequestError("reconnect", 409, "account_reconnect_required"), {
          accountId: "alpha",
          source: "auto",
          unlockFlow: false
        }),
        "alpha"
      );
      expect(paused).toMatchObject({
        kind: "awaitingRestore",
        autoRestorePausedForAccountId: "alpha"
      });
    });

    it("preserves auto-restore pause across a failed manual retry", () => {
      const paused: SessionLifecycleState = {
        kind: "awaitingRestore",
        unlockRequired: false,
        healthRootPath: ".davora-agent-test",
        workerUnavailable: false,
        autoRestorePausedForAccountId: "alpha"
      };
      const restoring = transitionEnsureSessionStart(paused, "alpha");
      expect(projectAutoRestorePausedForAccountId(restoring)).toBe("alpha");

      const afterManualFailure = transitionEnsureSessionFailure(
        restoring,
        projectEnsureSessionFailure(new ApiRequestError("expired", 401, "session_invalid"), {
          accountId: "alpha",
          source: "manual",
          unlockFlow: false
        }),
        "alpha"
      );
      expect(projectAutoRestorePausedForAccountId(afterManualFailure)).toBe("alpha");
    });

    it("projects retained workerUnavailable while health is reloading", () => {
      const failed: SessionLifecycleState = {
        kind: "healthFailed",
        bootstrapError: "down",
        workerUnavailable: true
      };
      const checking = transitionHealthLoadStart(failed, false);
      expect(checking).toMatchObject({
        kind: "checking",
        retained: { workerUnavailable: true }
      });
      expect(projectWorkerUnavailable(checking)).toBe(true);
    });
  });

  describe("resolveSessionState", () => {
    const readyLifecycle: SessionLifecycleState = {
      kind: "healthReady",
      unlockRequired: false,
      healthRootPath: ".davora-agent-test"
    };

    it("projects checking only when health is loading and there are no accounts", () => {
      expect(resolveSessionState({
        lifecycle: { kind: "checking" },
        accountCount: 0,
        allowOfflineCachedShell: false
      })).toEqual({ kind: "checking" });

      expect(resolveSessionState({
        lifecycle: { kind: "checking" },
        accountCount: 1,
        activeAccount: connectedAccount(),
        allowOfflineCachedShell: false
      })).toEqual({ kind: "restoring", accountId: "alpha" });
    });

    it("mirrors bootstrap gate order for connect, reconnect, unlock, restore, and continue", () => {
      expect(resolveSessionState({
        lifecycle: readyLifecycle,
        accountCount: 0,
        allowOfflineCachedShell: false
      })).toEqual({ kind: "noAccounts" });

      expect(resolveSessionState({
        lifecycle: readyLifecycle,
        accountCount: 2,
        allowOfflineCachedShell: false
      })).toEqual({ kind: "connecting" });

      const reconnectAccount = connectedAccount({ connectionState: "reconnect_required" });
      expect(resolveSessionState({
        lifecycle: {
          kind: "awaitingRestore",
          unlockRequired: false,
          healthRootPath: ".davora-agent-test",
          workerUnavailable: false,
          autoRestorePausedForAccountId: reconnectAccount.id
        },
        accountCount: 1,
        activeAccount: reconnectAccount,
        allowOfflineCachedShell: false
      })).toEqual({ kind: "reconnectRequired", accountId: reconnectAccount.id });

      const account = connectedAccount();
      expect(resolveSessionState({
        lifecycle: {
          kind: "healthReady",
          unlockRequired: true,
          healthRootPath: ".davora-agent-test"
        },
        accountCount: 1,
        activeAccount: account,
        allowOfflineCachedShell: false
      })).toEqual({ kind: "unlockRequired" });

      expect(resolveSessionState({
        lifecycle: readyLifecycle,
        accountCount: 1,
        activeAccount: account,
        allowOfflineCachedShell: false
      })).toEqual({ kind: "restoring", accountId: account.id });

      expect(resolveSessionState({
        lifecycle: readyLifecycle,
        accountCount: 1,
        activeAccount: account,
        token: "session-token",
        allowOfflineCachedShell: false
      })).toEqual({ kind: "ready" });

      expect(resolveSessionState({
        lifecycle: readyLifecycle,
        accountCount: 1,
        activeAccount: account,
        allowOfflineCachedShell: true
      })).toEqual({ kind: "offlineShell" });
    });
  });
});
