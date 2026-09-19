import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import type { FormEvent } from "react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { buildAccount } from "../../../test/accounts";
import type { RemoveAccountPorts } from "./ports";
import { useRemoveAccount, type UseRemoveAccountInput } from "./useRemoveAccount";
import { createDeferred } from "../../../test/primitives";

const target = buildAccount("alpha", {
  displayName: "Alpha workspace",
  label: "Alpha workspace",
  cacheNamespace: "ns-alpha"
});

const createPorts = (overrides: Partial<RemoveAccountPorts> = {}): RemoveAccountPorts => ({
  removeAccount: vi.fn(async () => ({ kind: "committed" as const, snapshot: { accounts: [] } })),
  ...overrides
});

async function runSubmit(handler: (event: FormEvent<HTMLFormElement>) => void | Promise<void>) {
  const view = render(<form data-testid="submit-form" onSubmit={(event) => { void handler(event); }} />);
  const form = view.container.querySelector("form");
  if (!form) {
    throw new Error("submit form is unavailable");
  }
  await act(async () => {
    fireEvent.submit(form);
  });
  view.unmount();
}

function startSubmit(handler: (event: FormEvent<HTMLFormElement>) => void | Promise<void>) {
  const view = render(<form data-testid="submit-form" onSubmit={(event) => { void handler(event); }} />);
  const form = view.container.querySelector("form");
  if (!form) {
    throw new Error("submit form is unavailable");
  }
  act(() => {
    fireEvent.submit(form);
  });
  return view;
}

const renderRemoveAccount = (input: UseRemoveAccountInput) => renderHook(
  (props) => useRemoveAccount(props),
  { initialProps: input }
);

describe("useRemoveAccount", () => {
  it("opens remove flow from settings after closing settings", async () => {
    const closeSettings = vi.fn();
    const pushRemoveAccountSurface = vi.fn();
    const { result } = renderRemoveAccount({
      activeAccount: target,
      ports: createPorts(),
      openerPorts: {
        closeSettings,
        pushRemoveAccountSurface
      },
      onStatusChange: vi.fn()
    });

    act(() => {
      result.current.openRemoveFromSettings();
    });

    expect(closeSettings).toHaveBeenCalledTimes(1);
    expect(pushRemoveAccountSurface).toHaveBeenCalledTimes(1);
    expect(result.current.target).toEqual(target);
    expect(result.current.confirmation).toBe("");
    expect(result.current.error).toBeUndefined();
  });

  it("confirms removal, reloads account state, and clears dialog state", async () => {
    const onStatusChange = vi.fn();
    const { result } = renderRemoveAccount({
      activeAccount: target,
      ports: createPorts(),
      openerPorts: {
        closeSettings: vi.fn(),
        pushRemoveAccountSurface: vi.fn()
      },
      onStatusChange
    });

    act(() => {
      result.current.setTarget(target);
      result.current.setConfirmation("Alpha workspace");
    });

    await runSubmit((event) => result.current.confirmRemoveAccount(event));

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1));
    expect(onStatusChange).toHaveBeenCalledWith("Removed account Alpha workspace");
    expect(result.current.target).toBeUndefined();
    expect(result.current.confirmation).toBe("");
  });

  it("makes a replaced removal attempt inert, including StrictMode replay", async () => {
    const pending = createDeferred<Awaited<ReturnType<RemoveAccountPorts["removeAccount"]>>>();
    const removeAccount = vi.fn(() => pending.promise);
    const onStatusChange = vi.fn();
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    const input: UseRemoveAccountInput = {
      activeAccount: target,
      ports: createPorts({ removeAccount }),
      openerPorts: { closeSettings: vi.fn(), pushRemoveAccountSurface: vi.fn() },
      onStatusChange
    };
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result, rerender } = renderHook((props: UseRemoveAccountInput) => useRemoveAccount(props), {
      initialProps: input,
      wrapper
    });

    act(() => {
      result.current.setTarget(target);
      result.current.setConfirmation("Alpha workspace");
    });
    const submitView = startSubmit((event) => result.current.confirmRemoveAccount(event));
    await waitFor(() => expect(removeAccount).toHaveBeenCalledTimes(1));

    rerender({ ...input, activeAccount: beta });
    expect(result.current.busy).toBe(false);
    pending.resolve({ kind: "committed", snapshot: { accounts: [{ account: target }] } });
    await act(async () => { await pending.promise; });

    expect(onStatusChange).not.toHaveBeenCalled();
    expect(result.current.target).toEqual(target);
    submitView.unmount();
  });

  it("keeps a local-only retry publishable when removal clears the active account", async () => {
    const pending = createDeferred<Awaited<ReturnType<RemoveAccountPorts["removeAccount"]>>>();
    const removeAccount = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce({ kind: "committed" as const, snapshot: { accounts: [] } });
    const input: UseRemoveAccountInput = {
      activeAccount: target,
      ports: createPorts({ removeAccount }),
      openerPorts: { closeSettings: vi.fn(), pushRemoveAccountSurface: vi.fn() },
      onStatusChange: vi.fn()
    };
    const { result, rerender } = renderRemoveAccount(input);

    act(() => {
      result.current.setTarget(target);
      result.current.setConfirmation("Alpha workspace");
    });
    const submitView = startSubmit((event) => result.current.confirmRemoveAccount(event));
    await waitFor(() => expect(removeAccount).toHaveBeenCalledTimes(1));

    rerender({ ...input, activeAccount: undefined });
    pending.resolve({
      kind: "degraded" as const,
      snapshot: { accounts: [] },
      message: "Retry to finish local cleanup.",
      retryLocalCommit: true,
      retryToken: "account-removal-retry"
    });
    await act(async () => { await pending.promise; });

    expect(result.current.target).toEqual(target);
    expect(result.current.confirmation).toBe("Alpha workspace");
    expect(result.current.error).toBe("Retry to finish local cleanup.");
    expect(result.current.retryToken).toBe("account-removal-retry");

    await runSubmit((event) => result.current.confirmRemoveAccount(event));
    expect(removeAccount).toHaveBeenNthCalledWith(2, target, "account-removal-retry");
    expect(result.current.target).toBeUndefined();
    submitView.unmount();
  });

  it("does not publish a removal completion after unmount", async () => {
    const pending = createDeferred<Awaited<ReturnType<RemoveAccountPorts["removeAccount"]>>>();
    const removeAccount = vi.fn(() => pending.promise);
    const onStatusChange = vi.fn();
    const input: UseRemoveAccountInput = {
      activeAccount: target,
      ports: createPorts({ removeAccount }),
      openerPorts: { closeSettings: vi.fn(), pushRemoveAccountSurface: vi.fn() },
      onStatusChange
    };
    const { result, unmount } = renderRemoveAccount(input);

    act(() => {
      result.current.setTarget(target);
      result.current.setConfirmation("Alpha workspace");
    });
    const submitView = startSubmit((event) => result.current.confirmRemoveAccount(event));
    await waitFor(() => expect(removeAccount).toHaveBeenCalledTimes(1));
    unmount();

    pending.resolve({ kind: "committed", snapshot: { accounts: [] } });
    await act(async () => { await pending.promise; });
    expect(onStatusChange).not.toHaveBeenCalled();
    submitView.unmount();
  });

  it("closes remove dialog and surfaces error on degraded-success", async () => {
    const onStatusChange = vi.fn();
    const { result } = renderRemoveAccount({
      activeAccount: target,
      ports: createPorts({
        removeAccount: vi.fn(async () => ({
          kind: "degraded" as const,
          snapshot: { accounts: [] },
          message: "Account removal could not be completed normally.",
          retryLocalCommit: false
        }))
      }),
      openerPorts: {
        closeSettings: vi.fn(),
        pushRemoveAccountSurface: vi.fn()
      },
      onStatusChange
    });

    act(() => {
      result.current.setTarget(target);
      result.current.setConfirmation("Alpha workspace");
    });

    await runSubmit((event) => result.current.confirmRemoveAccount(event));

    await waitFor(() => expect(result.current.target).toBeUndefined());
    expect(onStatusChange).toHaveBeenCalledWith("Removed account Alpha workspace from browser state.");
    expect(result.current.error).toBe("Account removal could not be completed normally.");
    expect(result.current.confirmation).toBe("");
  });

  it("surfaces confirmation mismatch errors without removing the account", async () => {
    const removeAccount = vi.fn();
    const { result } = renderRemoveAccount({
      activeAccount: target,
      ports: createPorts({ removeAccount }),
      openerPorts: {
        closeSettings: vi.fn(),
        pushRemoveAccountSurface: vi.fn()
      },
      onStatusChange: vi.fn()
    });

    act(() => {
      result.current.setTarget(target);
      result.current.setConfirmation("wrong label");
    });

    await runSubmit((event) => result.current.confirmRemoveAccount(event));

    expect(result.current.error).toBe("Type the active account label exactly to remove it.");
    expect(removeAccount).not.toHaveBeenCalled();
    expect(result.current.target).toEqual(target);
  });

  it("keeps confirmation open for a local-only retry after remote removal", async () => {
    const removeAccount = vi.fn()
      .mockResolvedValueOnce({
        kind: "degraded" as const,
        snapshot: { accounts: [] },
        message: "The account was removed remotely, but browser storage could not be updated. Retry to finish local cleanup.",
        retryLocalCommit: true,
        retryToken: "account-removal-1"
      })
      .mockResolvedValueOnce({ kind: "committed" as const, snapshot: { accounts: [] } });
    const { result } = renderRemoveAccount({
      activeAccount: target,
      ports: createPorts({ removeAccount }),
      openerPorts: { closeSettings: vi.fn(), pushRemoveAccountSurface: vi.fn() },
      onStatusChange: vi.fn()
    });
    act(() => {
      result.current.setTarget(target);
      result.current.setConfirmation("Alpha workspace");
    });

    await runSubmit((event) => result.current.confirmRemoveAccount(event));
    await waitFor(() => expect(result.current.error).toMatch(/Retry to finish local cleanup/i));
    expect(result.current.target).toEqual(target);

    await runSubmit((event) => result.current.confirmRemoveAccount(event));
    await waitFor(() => expect(result.current.target).toBeUndefined());
    expect(removeAccount).toHaveBeenCalledTimes(2);
    expect(removeAccount).toHaveBeenNthCalledWith(2, target, "account-removal-1");
  });

  it("keeps confirmation open and publishes no removal status after a failed removal", async () => {
    const onStatusChange = vi.fn();
    const { result } = renderRemoveAccount({
      activeAccount: target,
      ports: createPorts({ removeAccount: vi.fn(async () => ({ kind: "failed" as const, message: "Unable to remove the account." })) }),
      openerPorts: { closeSettings: vi.fn(), pushRemoveAccountSurface: vi.fn() },
      onStatusChange
    });
    act(() => {
      result.current.setTarget(target);
      result.current.setConfirmation("Alpha workspace");
    });

    await runSubmit((event) => result.current.confirmRemoveAccount(event));

    expect(result.current.target).toEqual(target);
    expect(result.current.confirmation).toBe("Alpha workspace");
    expect(result.current.error).toBe("Unable to remove the account.");
    expect(onStatusChange).not.toHaveBeenCalled();
  });
});
