import { describe, expect, it, vi } from "vitest";

import { createEmptyAccountForm } from "./model";
import { buildAccount } from "../../../test/accounts";
import { executeConnectAccount } from "./controller";
import type { ConnectAccountPorts } from "./ports";

const createPorts = (overrides: Partial<ConnectAccountPorts> = {}): ConnectAccountPorts => ({
  connectAccount: vi.fn(async () => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: "alpha" }, account: buildAccount("alpha", { displayName: "Alpha workspace" }) })),
  ensureSessionForAccount: vi.fn(async () => undefined),
  ...overrides
});

describe("connect account controller", () => {
  it("returns validation errors without calling connect", async () => {
    const ports = createPorts();

    const outcome = await executeConnectAccount(ports, {
      form: createEmptyAccountForm("add")
    });

    expect(outcome).toEqual({
      kind: "validation-error",
      message: "Base URL, username, and app password are required."
    });
    expect(ports.connectAccount).not.toHaveBeenCalled();
    expect(ports.ensureSessionForAccount).not.toHaveBeenCalled();
  });

  it("returns success after connect without ensuring session", async () => {
    const ports = createPorts();

    const outcome = await executeConnectAccount(ports, {
      form: {
        ...createEmptyAccountForm("add"),
        baseUrl: "https://cloud.example.com",
        username: "alice",
        appPassword: "secret"
      }
    });

    expect(outcome).toEqual({
      kind: "success",
      statusMessage: "Connected account Alpha workspace",
      account: buildAccount("alpha", { displayName: "Alpha workspace" })
    });
    expect(ports.ensureSessionForAccount).not.toHaveBeenCalled();
  });

  it("returns sanitized connect failures without leaking the app password", async () => {
    const password = "super-secret-password";
    const ports = createPorts({
      connectAccount: vi.fn(async () => {
        throw new Error(`Rejected request containing appPassword=${password}`);
      })
    });

    const outcome = await executeConnectAccount(ports, {
      form: {
        ...createEmptyAccountForm("add"),
        baseUrl: "https://cloud.example.com",
        username: "alice",
        appPassword: password
      }
    });

    expect(outcome).toEqual({ kind: "failure", message: "Unable to connect account.", clearCredential: false });
    expect(JSON.stringify(outcome)).not.toContain(password);
  });

  it("reports remote success with local persistence failure as a partial outcome", async () => {
    const ports = createPorts({
      connectAccount: vi.fn(async () => ({
        kind: "partial" as const,
        message: "The account connected remotely, but could not be saved in this browser.",
        clearCredential: true as const
      }))
    });

    const outcome = await executeConnectAccount(ports, {
      form: {
        ...createEmptyAccountForm("add"),
        baseUrl: "https://cloud.example.com",
        username: "alice",
        appPassword: "secret"
      }
    });

    expect(outcome).toEqual({
      kind: "partial",
      message: "The account connected remotely, but could not be saved in this browser.",
      clearCredential: true
    });
  });
});
