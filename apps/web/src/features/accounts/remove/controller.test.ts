import { describe, expect, it, vi } from "vitest";
import { buildAccount } from "../../../test/accounts";
import { executeRemoveAccount } from "./controller";
import type { RemoveAccountPorts } from "./ports";

const target = buildAccount("alpha", {
  displayName: "Alpha workspace",
  label: "Alpha workspace",
  cacheNamespace: "ns-alpha"
});

const createPorts = (overrides: Partial<RemoveAccountPorts> = {}): RemoveAccountPorts => ({
  removeAccount: vi.fn(async () => ({ kind: "committed" as const, snapshot: { accounts: [] } })),
  ...overrides
});

describe("remove account controller", () => {
  it("returns validation errors without mutating account state", async () => {
    const ports = createPorts();

    const outcome = await executeRemoveAccount(ports, {
      target,
      confirmation: "wrong label"
    });

    expect(outcome).toEqual({
      kind: "validation-error",
      message: "Type the active account label exactly to remove it."
    });
    expect(ports.removeAccount).not.toHaveBeenCalled();
  });

  it("delegates the validated target to the registry-owned removal policy", async () => {
    const ports = createPorts();

    const outcome = await executeRemoveAccount(ports, {
      target,
      confirmation: "Alpha workspace"
    });

    expect(outcome).toEqual({
      kind: "success",
      statusMessage: "Removed account Alpha workspace",
      displayName: "Alpha workspace",
      snapshot: { accounts: [] }
    });
    expect(ports.removeAccount).toHaveBeenCalledWith(target, undefined);
  });

  it("projects a redacted degraded registry outcome", async () => {
    const ports = createPorts({
      removeAccount: vi.fn(async () => ({
        kind: "degraded" as const,
        snapshot: { accounts: [] },
        message: "Account removal could not be completed normally.",
        retryLocalCommit: false
      }))
    });

    const outcome = await executeRemoveAccount(ports, {
      target,
      confirmation: "Alpha workspace"
    });

    expect(outcome).toEqual({
      kind: "degraded-success",
      statusMessage: "Removed account Alpha workspace from browser state.",
      displayName: "Alpha workspace",
      error: "Account removal could not be completed normally.",
      retryToken: undefined
    });
  });

  it("projects failed outcomes without raw adapter errors", async () => {
    const ports = createPorts({
      removeAccount: vi.fn(async () => ({ kind: "failed" as const, message: "Unable to remove the account." }))
    });

    const outcome = await executeRemoveAccount(ports, {
      target,
      confirmation: "Alpha workspace"
    });

    expect(outcome).toEqual({ kind: "failure", message: "Unable to remove the account." });
  });
});
