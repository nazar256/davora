import { describe, expect, it, vi } from "vitest";

import { clearFinishedTransfers, toggleTransferTray } from "./controller";

describe("transfer tray controller", () => {
  it("opens the transfers chrome when closed and closes it when open", () => {
    const open = vi.fn();
    const close = vi.fn();

    toggleTransferTray({ isOpen: false, open, close });
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();

    open.mockClear();
    close.mockClear();

    toggleTransferTray({ isOpen: true, open, close });
    expect(close).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("clears finished transfers only for the active account", () => {
    const clearAccountHistory = vi.fn();

    clearFinishedTransfers(undefined, { clearAccountHistory });
    expect(clearAccountHistory).not.toHaveBeenCalled();

    clearFinishedTransfers("account-a", { clearAccountHistory });
    expect(clearAccountHistory).toHaveBeenCalledWith("account-a");
  });
});
