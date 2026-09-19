// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccountSessionPorts } from "../session";
import { ApiRequestError } from "../../../lib/api";
import { buildAccount, buildSession } from "../../../test/accounts";
import { buildHealthResponse } from "../../../test/api";
import { createDeferred } from "../../../test/primitives";
import { useAccountBootstrap, type AccountBootstrapController } from "./useAccountBootstrap";
import type { AccountBootstrapInput } from "./ports";

function createPorts(overrides: Partial<AccountSessionPorts> = {}): AccountSessionPorts {
  return {
    getHealth: vi.fn(async () => buildHealthResponse()),
    createSession: vi.fn(async ({ accountId }: { accountId: string; unlockCode?: string }) => buildSession(buildAccount(accountId))),
    commitSession: vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: undefined } })),
    markAccountReconnectRequired: vi.fn((accountId: string) => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: accountId } })),
    clearAccountSession: vi.fn((accountId: string) => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: accountId } })),
    delay: vi.fn(async () => undefined),
    ...overrides
  };
}

function buildInput(overrides: Partial<AccountBootstrapInput> = {}): AccountBootstrapInput {
  const account = buildAccount("alpha", { displayName: "Alpha workspace" });
  return {
    accountCount: 1,
    accountHost: "cloud.example.com",
    activeAccount: account,
    cacheNamespace: account.cacheNamespace,
    explicitOfflineMode: false,
    offline: false,
    ports: {
      session: createPorts(),
      onStatusChange: vi.fn()
    },
    ...overrides
  };
}

function renderBootstrap(initialProps: AccountBootstrapInput) {
  return renderHook<AccountBootstrapController, AccountBootstrapInput>(
    (input) => useAccountBootstrap(input),
    { initialProps }
  );
}

describe("useAccountBootstrap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("projects registry unavailability ahead of the ordinary no-account gate", async () => {
    const ports = createPorts();
    const { result } = renderBootstrap(buildInput({
      registryUnavailable: true,
      accountCount: 0,
      activeAccount: undefined,
      cacheNamespace: undefined,
      ports: { session: ports, onStatusChange: vi.fn() }
    }));

    expect(result.current.gate).toEqual({ kind: "unavailable" });
    await act(async () => undefined);
    expect(result.current.gate).toEqual({ kind: "unavailable" });
    expect(ports.createSession).not.toHaveBeenCalled();
  });

  it("projects the checking, no-account, connect, unlock, restore, and continue gates from SessionState", async () => {
    const ports = createPorts({ getHealth: vi.fn(async () => buildHealthResponse({ unlockRequired: true })) });
    const { result, rerender } = renderBootstrap(buildInput({
      accountCount: 0,
      activeAccount: undefined,
      cacheNamespace: undefined,
      ports: { session: ports, onStatusChange: vi.fn() }
    }));
    expect(result.current.gate).toEqual({ kind: "healthChecking" });
    await waitFor(() => expect(result.current.gate).toEqual({ kind: "noAccounts" }));

    rerender(buildInput({ accountCount: 1, activeAccount: undefined, cacheNamespace: undefined, ports: { session: ports, onStatusChange: vi.fn() } }));
    expect(result.current.gate).toEqual({ kind: "connect" });

    const reconnect = buildAccount("alpha", { connectionState: "reconnect_required" });
    const reconnectPorts = createPorts({
      createSession: vi.fn(async () => {
        throw new ApiRequestError("reconnect", 409, "account_reconnect_required");
      })
    });
    rerender(buildInput({ activeAccount: reconnect, accountHost: "cloud.example.com", ports: { session: reconnectPorts, onStatusChange: vi.fn() } }));
    await waitFor(() => expect(result.current.gate).toEqual({ kind: "reconnect" }));

    const connected = buildAccount("alpha");
    rerender(buildInput({ activeAccount: connected, ports: { session: ports, onStatusChange: vi.fn() } }));
    await waitFor(() => expect(result.current.gate).toEqual({ kind: "unlock" }));

    const restorePorts = createPorts({ getHealth: vi.fn(async () => buildHealthResponse()) });
    rerender(buildInput({ activeAccount: connected, ports: { session: restorePorts, onStatusChange: vi.fn() } }));
    await waitFor(() => expect(result.current.gate).toEqual({ kind: "restore" }));

    rerender(buildInput({ token: "token-alpha", ports: { session: restorePorts, onStatusChange: vi.fn() } }));
    expect(result.current.gate).toEqual({ kind: "continue" });
  });

  it("keeps explicit offline startup at zero session/health requests and exposes a cached shell", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace" });
    const ports = createPorts();
    const onStatusChange = vi.fn();
    const { result, rerender } = renderBootstrap(buildInput({
      activeAccount: account,
      explicitOfflineMode: true,
      ports: { session: ports, onStatusChange }
    }));

    await waitFor(() => expect(result.current.gate).toEqual({ kind: "continue" }));
    expect(result.current.sessionState).toEqual({ kind: "offlineShell" });
    expect(ports.getHealth).not.toHaveBeenCalled();
    expect(ports.createSession).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledWith("Explicit offline mode for Alpha workspace. Only readable local files are shown.");

    rerender(buildInput({
      activeAccount: account,
      explicitOfflineMode: true,
      ports: { session: ports, onStatusChange }
    }));
    await act(async () => undefined);
    expect(onStatusChange).toHaveBeenCalledTimes(1);
  });

  it("drops a queued cached-shell announcement when the same account becomes online", async () => {
    const queued: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (callback: () => void) => queued.push(callback));
    const account = buildAccount("alpha", { displayName: "Alpha workspace" });
    const onStatusChange = vi.fn();
    const ports = createPorts();
    const input = buildInput({
      activeAccount: account,
      offline: true,
      ports: { session: ports, onStatusChange }
    });
    const { result, rerender } = renderBootstrap(input);
    await waitFor(() => expect(result.current.gate).toEqual({ kind: "continue" }));
    expect(queued).toHaveLength(1);

    rerender({ ...input, offline: false });
    queued.shift()?.();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("publishes only the current mode when a queued cached-shell context changes", async () => {
    const queued: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (callback: () => void) => queued.push(callback));
    const account = buildAccount("alpha", { displayName: "Alpha workspace" });
    const onStatusChange = vi.fn();
    const ports = createPorts();
    const input = buildInput({
      activeAccount: account,
      offline: true,
      ports: { session: ports, onStatusChange }
    });
    const { result, rerender } = renderBootstrap(input);
    await waitFor(() => expect(result.current.gate).toEqual({ kind: "continue" }));
    rerender({ ...input, offline: false, explicitOfflineMode: true });
    expect(queued).toHaveLength(2);
    queued.shift()?.();
    expect(onStatusChange).not.toHaveBeenCalled();
    queued.shift()?.();
    expect(onStatusChange).toHaveBeenCalledWith("Explicit offline mode for Alpha workspace. Only readable local files are shown.");
  });

  it("invalidates a queued cached-shell announcement on unmount", async () => {
    const queued: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (callback: () => void) => queued.push(callback));
    const account = buildAccount("alpha");
    const onStatusChange = vi.fn();
    const ports = createPorts();
    const { result, unmount } = renderBootstrap(buildInput({
      activeAccount: account,
      explicitOfflineMode: true,
      ports: { session: ports, onStatusChange }
    }));
    await waitFor(() => expect(result.current.gate).toEqual({ kind: "continue" }));
    unmount();
    queued.shift()?.();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("announces an eligible cached shell exactly once through StrictMode replay", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace" });
    const onStatusChange = vi.fn();
    const ports = createPorts();
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook((input: AccountBootstrapInput) => useAccountBootstrap(input), {
      initialProps: buildInput({
        activeAccount: account,
        explicitOfflineMode: true,
        ports: { session: ports, onStatusChange }
      }),
      wrapper
    });

    await waitFor(() => expect(result.current.gate).toEqual({ kind: "continue" }));
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1));
    expect(onStatusChange).toHaveBeenCalledWith("Explicit offline mode for Alpha workspace. Only readable local files are shown.");
  });

  it("validates unlock input, trims the candidate, and clears it after success", async () => {
    const account = buildAccount("alpha");
    const session = buildSession(account);
    const createSession = vi.fn(async (input: { accountId: string; unlockCode?: string }) => {
      expect(input.unlockCode).toBe("sentinel-unlock");
      return session;
    });
    const ports = createPorts({
      getHealth: vi.fn(async () => buildHealthResponse({ unlockRequired: true })),
      createSession
    });
    const { result } = renderBootstrap(buildInput({ ports: { session: ports, onStatusChange: vi.fn() } }));
    await waitFor(() => expect(result.current.gate).toEqual({ kind: "unlock" }));

    await act(async () => result.current.submitUnlockCode());
    expect(result.current.bootstrapError).toBe("Enter the deployment unlock code to create a session.");
    expect(createSession).not.toHaveBeenCalled();

    act(() => result.current.setUnlockCode("  sentinel-unlock  "));
    await act(async () => result.current.submitUnlockCode());
    expect(createSession).toHaveBeenCalledWith({ accountId: account.id, unlockCode: "sentinel-unlock" });
    expect(result.current.unlockCode).toBe("");
  });

  it("retains a failed unlock for retry while keeping a replacement account's secret empty", async () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const createSession = vi.fn()
      .mockRejectedValueOnce(new ApiRequestError("bad unlock", 401, "invalid_unlock_code"))
      .mockResolvedValueOnce(buildSession(beta));
    const ports = createPorts({
      getHealth: vi.fn(async () => buildHealthResponse({ unlockRequired: true })),
      createSession
    });
    const input = buildInput({ activeAccount: alpha, ports: { session: ports, onStatusChange: vi.fn() } });
    const { result, rerender } = renderBootstrap(input);
    await waitFor(() => expect(result.current.gate).toEqual({ kind: "unlock" }));
    act(() => result.current.setUnlockCode("alpha-secret"));
    await act(async () => result.current.submitUnlockCode());
    expect(result.current.unlockCode).toBe("alpha-secret");
    act(() => result.current.restoreStage.onRetryRestore());
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));
    expect(createSession).toHaveBeenLastCalledWith({ accountId: alpha.id });

    rerender({ ...input, activeAccount: beta, accountHost: "beta.example.com" });
    expect(result.current.unlockCode).toBe("");
    await waitFor(() => expect(result.current.unlockCode).toBe(""));
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it("drops a late Alpha unlock completion after switching to Beta", async () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    let resolveAlpha!: (session: ReturnType<typeof buildSession>) => void;
    const alphaSession = new Promise<ReturnType<typeof buildSession>>((resolve) => {
      resolveAlpha = resolve;
    });
    const createSession = vi.fn(() => alphaSession);
    const commitSession = vi.fn(() => ({ kind: "committed" as const, snapshot: { accounts: [], activeAccountId: alpha.id } }));
    const onStatusChange = vi.fn();
    const ports = createPorts({
      getHealth: vi.fn(async () => buildHealthResponse({ unlockRequired: true })),
      createSession,
      commitSession
    });
    const input = buildInput({
      activeAccount: alpha,
      ports: { session: ports,  onStatusChange }
    });
    const { result, rerender } = renderBootstrap(input);
    await waitFor(() => expect(result.current.gate).toEqual({ kind: "unlock" }));
    act(() => result.current.setUnlockCode("alpha-secret"));
    act(() => { void result.current.submitUnlockCode(); });
    await waitFor(() => expect(createSession).toHaveBeenCalledWith({ accountId: alpha.id, unlockCode: "alpha-secret" }));

    rerender({ ...input, activeAccount: beta, accountHost: "beta.example.com" });
    resolveAlpha(buildSession(alpha));
    await act(async () => undefined);

    expect(commitSession).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(result.current.unlockCode).toBe("");
  });

  it("keeps Alpha→Beta→Alpha restore generations account-bound", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    const alphaRestore = createDeferred<ReturnType<typeof buildSession>>();
    const betaRestore = createDeferred<ReturnType<typeof buildSession>>();
    const alphaReturn = createDeferred<ReturnType<typeof buildSession>>();
    const createSession = vi.fn()
      .mockImplementationOnce(() => alphaRestore.promise)
      .mockImplementationOnce(() => betaRestore.promise)
      .mockImplementationOnce(() => alphaReturn.promise);
    const commitSession = vi.fn((accountId: string, session: ReturnType<typeof buildSession>) => ({
      kind: "committed" as const,
      snapshot: { accounts: [{ account: session.account, session }], activeAccountId: accountId }
    }));
    const ports = createPorts({
      getHealth: vi.fn(async () => buildHealthResponse({ unlockRequired: true })),
      createSession,
      commitSession
    });
    const alphaInput = buildInput({ activeAccount: alpha, ports: { session: ports, onStatusChange: vi.fn() } });
    const { result, rerender } = renderBootstrap(alphaInput);

    await waitFor(() => expect(result.current.gate).toEqual({ kind: "unlock" }));
    act(() => result.current.setUnlockCode("alpha-first"));
    act(() => { void result.current.submitUnlockCode(); });
    await waitFor(() => expect(createSession).toHaveBeenCalledWith({ accountId: alpha.id, unlockCode: "alpha-first" }));

    rerender({ ...alphaInput, activeAccount: beta, accountHost: "beta.example.com" });
    await waitFor(() => expect(result.current.gate).toEqual({ kind: "unlock" }));
    act(() => result.current.setUnlockCode("beta-code"));
    act(() => { void result.current.submitUnlockCode(); });
    await waitFor(() => expect(createSession).toHaveBeenCalledWith({ accountId: beta.id, unlockCode: "beta-code" }));
    betaRestore.resolve(buildSession(beta));
    await waitFor(() => expect(commitSession).toHaveBeenCalledWith(beta.id, expect.objectContaining({ account: beta })));

    rerender({ ...alphaInput, activeAccount: alpha, accountHost: "alpha.example.com" });
    await waitFor(() => expect(result.current.gate).toEqual({ kind: "unlock" }));
    alphaRestore.resolve(buildSession(alpha));
    await act(async () => undefined);
    expect(commitSession).not.toHaveBeenCalledWith(alpha.id, expect.objectContaining({ account: alpha }));

    act(() => result.current.setUnlockCode("alpha-second"));
    act(() => { void result.current.submitUnlockCode(); });
    await waitFor(() => expect(createSession).toHaveBeenCalledWith({ accountId: alpha.id, unlockCode: "alpha-second" }));
    alphaReturn.resolve(buildSession(alpha));
    await waitFor(() => expect(commitSession).toHaveBeenCalledWith(alpha.id, expect.objectContaining({ account: alpha })));
    expect(createSession).toHaveBeenCalledTimes(3);
  });
});
