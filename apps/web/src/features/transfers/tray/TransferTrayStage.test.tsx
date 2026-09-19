import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTransferLedger, reduceTransferLedger, type TransferEvent } from "../model";
import { TransferTrayStage } from "./TransferTrayStage";

afterEach(cleanup);

describe("TransferTrayStage", () => {
  it("summarizes active work from account-filtered tasks while rendering only the eight newest records", () => {
    const events: TransferEvent[] = [{
      type: "enqueued",
      at: "2026-07-17T10:00:00Z",
      task: { id: "active", accountId: "account-a", kind: "download", label: "Older active download" }
    }];
    for (let index = 0; index < 8; index += 1) {
      const id = `done-${index}`;
      events.push(
        { type: "enqueued", at: `2026-07-17T10:00:1${index}Z`, task: { id, accountId: "account-a", kind: "upload", label: id } },
        { type: "completed", id, at: `2026-07-17T10:01:1${index}Z` }
      );
    }
    const state = events.reduce(reduceTransferLedger, createTransferLedger());

    render(<TransferTrayStage tasks={state.tasks} open onToggleOpen={vi.fn()} onClearFinished={vi.fn()} />);

    expect(screen.getByText("Download: Older active download")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "Transfer status" });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(8);
    expect(within(dialog).queryByText("Older active download")).not.toBeInTheDocument();
  });

  it("renders active progress and count without owning transfer state", () => {
    const events: TransferEvent[] = [
      { type: "enqueued", at: "2026-07-17T10:00:00Z", task: { id: "upload", accountId: "account-a", kind: "upload", label: "photo.jpg", totalBytes: 100 } },
      { type: "progressReported", id: "upload", stage: "preparing", loadedBytes: 25, totalBytes: 100 }
    ];
    const state = events.reduce(reduceTransferLedger, createTransferLedger());

    render(<TransferTrayStage tasks={state.tasks} open onToggleOpen={vi.fn()} onClearFinished={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Transfers" });
    expect(within(trigger).getByText("1")).toBeInTheDocument();
    expect(within(trigger).getByText("Upload: photo.jpg (25%)")).toBeInTheDocument();
    expect(screen.getByText("Preparing • 25%")).toBeInTheDocument();
  });

  it("renders exact sync failures and delegates retry with the unchanged task", () => {
    const events: TransferEvent[] = [
      {
        type: "enqueued",
        at: "2026-07-17T10:00:00Z",
        task: {
          id: "sync",
          accountId: "account-a",
          kind: "sync",
          label: "Documents",
          dedupeKey: "sync:Documents",
          syncRootEntries: [{ path: "Documents", name: "Documents", isFolder: true }]
        }
      },
      {
        type: "partiallyCompleted",
        id: "sync",
        at: "2026-07-17T10:01:00Z",
        failures: [{ sourcePath: "Documents/private.txt", error: "Denied" }],
        message: "1 file failed to sync."
      }
    ];
    const state = events.reduce(reduceTransferLedger, createTransferLedger());
    const onRetry = vi.fn();

    render(<TransferTrayStage tasks={state.tasks} open onToggleOpen={vi.fn()} onClearFinished={vi.fn()} onRetryFailedSync={onRetry} />);

    expect(screen.getByText("Documents/private.txt")).toBeInTheDocument();
    expect(screen.getByText("Denied")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry failed sync" }));
    expect(onRetry).toHaveBeenCalledWith(state.tasks[0]);
  });
});
