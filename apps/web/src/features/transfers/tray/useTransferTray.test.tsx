import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTransferLedger, reduceTransferLedger, type TransferEvent } from "../model";
import { TransferTrayStage } from "./TransferTrayStage";
import { useTransferTray } from "./useTransferTray";

function renderHookStage(input: Parameters<typeof useTransferTray>[0]) {
  let stage: ReturnType<typeof useTransferTray>["stage"] | undefined;
  function Probe() {
    stage = useTransferTray(input).stage;
    return stage ? <TransferTrayStage {...stage} /> : null;
  }
  render(<Probe />);
  if (!stage) {
    throw new Error("Expected transfer tray stage");
  }
  return stage;
}

afterEach(cleanup);

describe("useTransferTray", () => {
  const events: TransferEvent[] = [
    { type: "enqueued", at: "2026-07-17T10:00:00Z", task: { id: "active-a", accountId: "account-a", kind: "upload", label: "alpha.jpg" } },
    { type: "enqueued", at: "2026-07-17T10:00:01Z", task: { id: "active-b", accountId: "account-b", kind: "download", label: "beta.zip" } }
  ];
  const ledger = events.reduce(reduceTransferLedger, createTransferLedger());

  it("scopes visible tasks to the active account", () => {
    renderHookStage({
      ports: {
        chrome: { isOpen: true, open: vi.fn(), close: vi.fn() },
        transfers: { tasks: ledger.tasks, clearAccountHistory: vi.fn() },
        accountId: "account-a"
      }
    });

    expect(screen.getByText("Upload: alpha.jpg")).toBeInTheDocument();
    expect(screen.queryByText("beta.zip")).not.toBeInTheDocument();
  });

  it("delegates clear finished to the active account only", () => {
    const clearAccountHistory = vi.fn();
    const stage = renderHookStage({
      ports: {
        chrome: { isOpen: true, open: vi.fn(), close: vi.fn() },
        transfers: { tasks: ledger.tasks, clearAccountHistory },
        accountId: "account-a"
      }
    });

    stage.onClearFinished();
    expect(clearAccountHistory).toHaveBeenCalledWith("account-a");
  });
});
