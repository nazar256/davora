// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildAccount, buildSession } from "../../../test/accounts";
import { createAccountRegistryService, type AccountRegistryStorage } from "../registry";
import type { AccountSessionPorts } from "../session";
import { useAccountStateWorkspace } from "./useAccountStateWorkspace";

function setup() {
  const account = buildAccount("alpha");
  const storage: AccountRegistryStorage = {
    readItem: vi.fn(() => ({ ok: true as const, value: JSON.stringify({ activeAccountId: account.id, accounts: [{ account }] }) })),
    writeItem: vi.fn(() => ({ ok: true as const, value: undefined })),
    deleteItem: vi.fn(() => ({ ok: true as const, value: undefined }))
  };
  const registry = createAccountRegistryService(storage);
  const session = {
    markAccountReconnectRequired: vi.fn(() => ({ kind: "committed" as const, snapshot: registry.getSnapshot() })),
    clearAccountSession: vi.fn(() => ({ kind: "committed" as const, snapshot: registry.getSnapshot() }))
  } satisfies Pick<AccountSessionPorts, "markAccountReconnectRequired" | "clearAccountSession">;
  const transport = { connectAccount: vi.fn(async () => ({ kind: "invalid-http-success" as const })) };
  return { registry, session, transport, account };
}

describe("useAccountStateWorkspace", () => {
  it("publishes coherent replacements and semantic switch/terminal commands", () => {
    const setupState = setup();
    const { result } = renderHook(() => useAccountStateWorkspace({
      registry: setupState.registry,
      transport: setupState.transport,
      session: setupState.session
    }));
    expect(result.current.snapshot.operationalActiveAccount?.id).toBe("alpha");

    const beta = buildAccount("beta");
    act(() => { setupState.registry.commitConnectedAccount(beta); });
    expect(result.current.snapshot.operationalActiveAccount?.id).toBe("beta");
    expect(result.current.sessionAuthority.capture().token).toBeUndefined();

    const failed = result.current.commands.switchActive("missing");
    expect(failed.kind).toBe("invalid");
    act(() => { result.current.commands.applyTerminal("beta", true); });
    expect(setupState.session.markAccountReconnectRequired).toHaveBeenCalledWith("beta");
  });

  it("keeps detached authority captures tied to their immutable registry generation", () => {
    const setupState = setup();
    const { result, rerender } = renderHook(({ registry }: { registry: typeof setupState.registry }) => useAccountStateWorkspace({
      registry,
      transport: setupState.transport,
      session: setupState.session
    }), { initialProps: { registry: setupState.registry } });

    act(() => { setupState.registry.commitSession("alpha", buildSession(setupState.account, { token: "alpha-1" })); });
    const alphaOne = result.current.sessionAuthority.capture();
    act(() => { setupState.registry.commitSession("alpha", buildSession(setupState.account, { token: "alpha-2" })); });
    const alphaTwo = result.current.sessionAuthority.capture();
    expect(alphaOne.token).toBe("alpha-1");
    expect(alphaTwo.token).toBe("alpha-2");
    expect(alphaTwo.revision).not.toBe(alphaOne.revision);

    const beta = buildAccount("beta");
    act(() => {
      setupState.registry.commitConnectedAccount(beta);
      setupState.registry.commitSession("beta", buildSession(beta, { token: "beta-1" }));
    });
    const betaCapture = result.current.sessionAuthority.capture();
    act(() => { setupState.registry.switchAccount("alpha"); });
    expect(betaCapture.token).toBe("beta-1");
    expect(result.current.sessionAuthority.capture().token).toBe("alpha-2");

    const replacement = setup();
    replacement.registry.commitSession("alpha", buildSession(replacement.account, { token: "replacement-alpha" }));
    const detached = result.current.sessionAuthority.capture();
    rerender({ registry: replacement.registry });
    expect(detached.token).toBe("alpha-2");
    expect(result.current.sessionAuthority.capture().token).toBe("replacement-alpha");
  });
});
