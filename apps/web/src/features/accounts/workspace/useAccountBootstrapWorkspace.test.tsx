// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { buildAccount, buildSession } from "../../../test/accounts";
import { buildHealthResponse } from "../../../test/api";
import { projectAccountStateWorkspaceSnapshot } from "./model";
import { useAccountBootstrapWorkspace } from "./useAccountBootstrapWorkspace";

function buildInput(snapshot: ReturnType<typeof projectAccountStateWorkspaceSnapshot>, onStatusChange = vi.fn()) {
  const account = snapshot.operationalActiveAccount;
  const session = account ? buildSession(account) : undefined;
  const ports = {
    getHealth: vi.fn(async () => buildHealthResponse()),
    createSession: vi.fn(async () => session!),
    commitSession: vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [] } })),
    markAccountReconnectRequired: vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [] } })),
    clearAccountSession: vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [] } })),
    delay: vi.fn(async () => undefined)
  };
  return {
    account: snapshot,
    sessionAuthority: { capture: () => ({ accountId: account?.id, token: session?.token, capabilities: session?.capabilities, revision: snapshot.sessionRevision }) },
    accountCommands: {
      switchActive: vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [] } })),
      connectAccount: vi.fn(async () => ({ kind: "failed" as const, message: "failed", clearCredential: false as const })),
      removeAccount: vi.fn(async () => ({ kind: "failed" as const, message: "failed" })),
      retryRemovalCommit: vi.fn(() => ({ kind: "failed" as const, message: "failed" })),
      applyTerminal: vi.fn()
    },
    explicitOfflineMode: false,
    offline: false,
    ports: { session: ports, onStatusChange }
  } as const;
}

describe("useAccountBootstrapWorkspace", () => {
  it("uses the redacted account projection plus private authority for bootstrap", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha" });
    const session = buildSession(account);
    const snapshot = projectAccountStateWorkspaceSnapshot({
      kind: "ready",
      snapshot: { activeAccountId: account.id, accounts: [{ account, session }] }
    });
    const onStatusChange = vi.fn();
    const ports = {
      getHealth: vi.fn(async () => buildHealthResponse()),
      createSession: vi.fn(async () => session),
      commitSession: vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [] } })),
      markAccountReconnectRequired: vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [] } })),
      clearAccountSession: vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [] } })),
      delay: vi.fn(async () => undefined)
    };
    const { result } = renderHook(() => useAccountBootstrapWorkspace({
      account: snapshot,
      sessionAuthority: { capture: () => ({ accountId: account.id, token: session.token, capabilities: session.capabilities, revision: snapshot.sessionRevision }) },
      accountCommands: {
        switchActive: vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [] } })),
        connectAccount: vi.fn(async () => ({ kind: "failed" as const, message: "failed", clearCredential: false as const })),
        removeAccount: vi.fn(async () => ({ kind: "failed" as const, message: "failed" })),
        retryRemovalCommit: vi.fn(() => ({ kind: "failed" as const, message: "failed" })),
        applyTerminal: vi.fn()
      },
      explicitOfflineMode: false,
      offline: false,
      ports: { session: ports, onStatusChange }
    }));

    await waitFor(() => expect(result.current.gate.kind).toBe("continue"));
    expect(ports.getHealth).toHaveBeenCalled();
    expect(result.current.account).toBe(snapshot);
    expect(JSON.stringify(snapshot)).not.toContain(session.token);
  });

  it("publishes unavailable and warning notices once, then repeats after a clear", async () => {
    const onStatusChange = vi.fn();
    const unavailable = projectAccountStateWorkspaceSnapshot({ kind: "unavailable", snapshot: { accounts: [] }, message: "storage unavailable" });
    const unavailableInput = buildInput(unavailable, onStatusChange);
    const { result, rerender, unmount } = renderHook((input) => useAccountBootstrapWorkspace(input), { initialProps: unavailableInput });
    expect(result.current.gate).toEqual({ kind: "unavailable" });
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith("storage unavailable"));
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    const account = buildAccount("alpha");
    const session = buildSession(account);
    const warning = projectAccountStateWorkspaceSnapshot({ kind: "ready", warning: "repaired", snapshot: { activeAccountId: account.id, accounts: [{ account, session }] } });
    rerender(buildInput(warning, onStatusChange));
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith("repaired"));
    rerender(buildInput({ ...warning, registryNotice: undefined }, onStatusChange));
    rerender(buildInput(warning, onStatusChange));
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.gate.kind).toBe("continue"));
    unmount();
    expect(onStatusChange).toHaveBeenCalledTimes(3);
  });

  it("does not duplicate the notice through StrictMode replay", async () => {
    const account = buildAccount("alpha");
    const session = buildSession(account);
    const warning = projectAccountStateWorkspaceSnapshot({ kind: "ready", warning: "repaired", snapshot: { activeAccountId: account.id, accounts: [{ account, session }] } });
    const onStatusChange = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result, unmount } = renderHook(() => useAccountBootstrapWorkspace(buildInput(warning, onStatusChange)), { wrapper });
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith("repaired"));
    await waitFor(() => expect(result.current.gate.kind).toBe("continue"));
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    unmount();
  });
});
