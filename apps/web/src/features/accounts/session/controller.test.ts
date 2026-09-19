import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../../../lib/api";
import { buildAccount, buildSession } from "../../../test/accounts";
import { buildHealthResponse } from "../../../test/api";
import { applyAccountSessionMutation, executeEnsureSession, executeHealthLoad } from "./controller";
import type { AccountSessionPorts } from "./ports";

const createPorts = (overrides: Partial<AccountSessionPorts> = {}): AccountSessionPorts => ({
  getHealth: vi.fn(async () => buildHealthResponse()),
  createSession: vi.fn(async ({ accountId }: { accountId: string; unlockCode?: string }) => buildSession(buildAccount(accountId))),
  commitSession: vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: undefined } })),
  markAccountReconnectRequired: vi.fn((accountId: string) => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: accountId } })),
  clearAccountSession: vi.fn((accountId: string) => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: accountId } })),
  delay: vi.fn(async () => undefined),
  ...overrides
});

describe("account session controller", () => {
  it("projects unlockRequired and config errors on health success", async () => {
    const ports = createPorts({
      getHealth: vi.fn(async () => buildHealthResponse({ unlockRequired: true, configLoaded: false, missing: ["SESSION_SECRET"] }))
    });

    const outcome = await executeHealthLoad(ports, { isCancelled: () => false });

    expect(outcome).toMatchObject({
      kind: "success",
      projection: {
        unlockRequired: true,
        rootPath: ".davora-agent-test",
        workerUnavailable: false
      }
    });
    if (outcome.kind === "success") {
      expect(outcome.projection.bootstrapError).toMatch(/SESSION_SECRET is missing/i);
    }
  });

  it("projects workerUnavailable and bootstrap error on transient health failure", async () => {
    const ports = createPorts({
      getHealth: vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    });

    const outcome = await executeHealthLoad(ports, { isCancelled: () => false });

    expect(outcome).toMatchObject({
      kind: "failure",
      projection: {
        workerUnavailable: true
      }
    });
    if (outcome.kind === "failure") {
      expect(outcome.projection.bootstrapError).toMatch(/could not restore the local worker/i);
    }
  });

  it("returns cancelled when health load is superseded", async () => {
    const ports = createPorts({
      getHealth: vi.fn(async () => buildHealthResponse())
    });

    const outcome = await executeHealthLoad(ports, { isCancelled: () => true });

    expect(outcome).toEqual({ kind: "cancelled" });
  });

  it("returns a success outcome that refreshes through the session account name", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace" });
    const ports = createPorts({
      createSession: vi.fn(async () => buildSession(account))
    });

    const outcome = await executeEnsureSession(ports, { accountId: account.id, source: "manual" });

    expect(outcome).toMatchObject({
      kind: "success",
      statusMessage: "Restored workspace access for Alpha workspace"
    });
    if (outcome.kind === "success") {
      expect(outcome.session.account).toEqual(account);
      expect(outcome.persistedState).toEqual({ accounts: [], activeAccountId: undefined });
    }
  });

  it("retries transport failures and commits exactly once after the final response", async () => {
    const account = buildAccount("alpha");
    const createSession = vi.fn()
      .mockRejectedValueOnce(new ApiRequestError("temporary", 503))
      .mockResolvedValueOnce(buildSession(account));
    const commitSession = vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: account.id } }));
    const ports = createPorts({ createSession, commitSession });

    const outcome = await executeEnsureSession(ports, { accountId: account.id, source: "manual" });

    expect(outcome.kind).toBe("success");
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(commitSession).toHaveBeenCalledTimes(1);
    expect(commitSession).toHaveBeenCalledWith(account.id, expect.objectContaining({ account }));
  });

  it("does not retry transport when synchronous session commit fails", async () => {
    const account = buildAccount("alpha");
    const createSession = vi.fn(async () => buildSession(account));
    const commitSession = vi.fn(() => {
      throw new Error("commit failed");
    });
    const ports = createPorts({ createSession, commitSession });

    const outcome = await executeEnsureSession(ports, { accountId: account.id, source: "manual" });

    expect(outcome).toMatchObject({ kind: "failure", statusMessage: "Workspace restore paused" });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(commitSession).toHaveBeenCalledTimes(1);
  });

  it("maps reconnect_required and 401 account mutations", async () => {
    const reconnectPorts = createPorts({
      createSession: vi.fn(async () => {
        throw new ApiRequestError("reconnect", 409, "account_reconnect_required");
      })
    });
    const unauthorizedPorts = createPorts({
      createSession: vi.fn(async () => {
        throw new ApiRequestError("expired", 401, "session_invalid");
      })
    });

    const reconnect = await executeEnsureSession(reconnectPorts, { accountId: "alpha", source: "auto" });
    const unauthorized = await executeEnsureSession(unauthorizedPorts, { accountId: "alpha", source: "manual" });

    expect(reconnect).toMatchObject({
      kind: "failure",
      mutation: { kind: "reconnect-required", accountId: "alpha" },
      pauseAutoRestore: true
    });
    expect(unauthorized).toMatchObject({
      kind: "failure",
      mutation: { kind: "clear-session", accountId: "alpha" },
      pauseAutoRestore: false
    });
  });

  it("applies account mutations through ports", () => {
    const ports = createPorts();

    applyAccountSessionMutation(ports, { kind: "reconnect-required", accountId: "alpha" });
    applyAccountSessionMutation(ports, { kind: "clear-session", accountId: "beta" });

    expect(ports.markAccountReconnectRequired).toHaveBeenCalledWith("alpha");
    expect(ports.clearAccountSession).toHaveBeenCalledWith("beta");
  });
});
