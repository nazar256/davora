import { StrictMode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAccountReset, type UseAccountResetInput } from "./useAccountReset";
import type { SemanticAccountResetPorts } from "./ports";

const createPorts = (): SemanticAccountResetPorts => ({
  preview: { clearAccountContext: vi.fn() },
  selection: { clearFocused: vi.fn(), clearBatch: vi.fn() },
  browsing: { clearQuery: vi.fn(), clearListError: vi.fn() },
  navigation: { getLocationSearch: vi.fn(() => "?path=Projects&account=alpha"), setPath: vi.fn(), syncPath: vi.fn(), closeMobileDetails: vi.fn() },
  transfers: { failActiveForAccount: vi.fn() },
  session: { applyTerminal: vi.fn() },
  bootstrap: { setError: vi.fn() },
  presentation: { setStatus: vi.fn() }
});

const renderAccountReset = (input: UseAccountResetInput) => renderHook(
  (props) => useAccountReset(props),
  { initialProps: input }
);

describe("useAccountReset", () => {
  it("restores and resets account-scoped state through semantic ports", async () => {
    const ports = createPorts();
    const input = { activeAccountId: "alpha", activeAccountDisplayName: "Alpha workspace", hasActiveAccount: true, ports };
    const { rerender } = renderAccountReset(input);

    await waitFor(() => expect(ports.navigation.setPath).toHaveBeenCalledWith("Projects"));
    expect(ports.navigation.syncPath).not.toHaveBeenCalled();
    expect(ports.presentation.setStatus).toHaveBeenCalledWith("Active account: Alpha workspace");

    rerender({ ...input, activeAccountId: "beta", activeAccountDisplayName: "Beta workspace" });
    await waitFor(() => expect(ports.navigation.syncPath).toHaveBeenCalledWith("", "beta"));
    expect(ports.preview.clearAccountContext).toHaveBeenCalledTimes(2);
    expect(ports.selection.clearFocused).toHaveBeenCalledTimes(2);
    expect(ports.selection.clearBatch).toHaveBeenCalledTimes(2);
    expect(ports.browsing.clearQuery).toHaveBeenCalledTimes(2);
    expect(ports.presentation.setStatus).toHaveBeenLastCalledWith("Active account: Beta workspace");
  });

  it("routes detached terminal callbacks to the current account", async () => {
    const ports = createPorts();
    const input: UseAccountResetInput = { activeAccountId: "alpha", activeAccountDisplayName: "Alpha", hasActiveAccount: true, ports };
    const { result, rerender } = renderAccountReset(input);
    await waitFor(() => expect(ports.navigation.setPath).toHaveBeenCalled());
    const detachedReset = result.current.resetActiveSessionRef.current;
    rerender({ ...input, activeAccountId: "beta", activeAccountDisplayName: "Beta" });
    await waitFor(() => expect(ports.presentation.setStatus).toHaveBeenLastCalledWith("Active account: Beta"));
    detachedReset("Session expired. Create a fresh session for this account.");
    expect(ports.session.applyTerminal).toHaveBeenLastCalledWith("beta", false);
    expect(ports.transfers.failActiveForAccount).toHaveBeenLastCalledWith("beta", expect.any(String));
  });

  it("keeps a restored deep link when StrictMode replays the mount effect with the same account", async () => {
    const ports = createPorts();
    const input = { activeAccountId: "alpha", activeAccountDisplayName: "Alpha workspace", hasActiveAccount: true, ports };

    renderHook((props) => useAccountReset(props), {
      initialProps: input,
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>
    });

    await waitFor(() => expect(ports.navigation.setPath).toHaveBeenCalledWith("Projects"));
    // The replayed mount effect must not be mistaken for an account switch.
    expect(ports.navigation.setPath).toHaveBeenCalledTimes(1);
    expect(ports.navigation.syncPath).not.toHaveBeenCalled();
    expect(ports.selection.clearFocused).toHaveBeenCalledTimes(1);
  });

  it("no-ops terminal reset without an active account", async () => {
    const ports = createPorts();
    const { result } = renderAccountReset({ activeAccountId: undefined, hasActiveAccount: false, ports });
    await waitFor(() => expect(ports.navigation.setPath).toHaveBeenCalledWith(""));
    result.current.resetActiveSession("Session expired.");
    expect(ports.session.applyTerminal).not.toHaveBeenCalled();
    expect(ports.transfers.failActiveForAccount).not.toHaveBeenCalled();
  });
});
