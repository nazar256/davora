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

  it("renders an active copy task with item progress and a cancel action", () => {
    const events: TransferEvent[] = [
      {
        type: "enqueued",
        at: "2026-07-17T10:00:00Z",
        task: { id: "copy", accountId: "account-a", kind: "copy", label: "3 items", totalItems: 3 }
      },
      { type: "transferStarted", id: "copy" },
      { type: "itemsProgressed", id: "copy", settledItems: 1, totalItems: 3 }
    ];
    const state = events.reduce(reduceTransferLedger, createTransferLedger());
    const onCancel = vi.fn();

    render(<TransferTrayStage tasks={state.tasks} open onToggleOpen={vi.fn()} onClearFinished={vi.fn()} onCancelTransfer={onCancel} />);

    const trigger = screen.getByRole("button", { name: "Transfers" });
    expect(within(trigger).getByText("Copy: 3 items")).toBeInTheDocument();
    expect(screen.getByText("Copying")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 items")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel 3 items" }));
    expect(onCancel).toHaveBeenCalledWith(state.tasks[0]);
  });

  it("renders a canceled move task as terminal without a cancel action", () => {
    const events: TransferEvent[] = [
      {
        type: "enqueued",
        at: "2026-07-17T10:00:00Z",
        task: { id: "move", accountId: "account-a", kind: "move", label: "notes.txt", totalItems: 1 }
      },
      { type: "transferStarted", id: "move" },
      { type: "canceled", id: "move", at: "2026-07-17T10:01:00Z", message: "Move canceled after 0 of 1 items in Workspace." }
    ];
    const state = events.reduce(reduceTransferLedger, createTransferLedger());

    render(<TransferTrayStage tasks={state.tasks} open onToggleOpen={vi.fn()} onClearFinished={vi.fn()} onCancelTransfer={vi.fn()} />);

    expect(screen.getByText("Canceled")).toBeInTheDocument();
    expect(screen.getByText("Move canceled after 0 of 1 items in Workspace.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancel notes\.txt/i })).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Transfers" });
    expect(within(trigger).getByText("0")).toBeInTheDocument();
  });

  it("offers retry for canceled copy/move tasks and delegates the unchanged task", () => {
    const events: TransferEvent[] = [
      {
        type: "enqueued",
        at: "2026-07-17T10:00:00Z",
        task: { id: "move", accountId: "account-a", kind: "move", label: "2 items", totalItems: 2 }
      },
      { type: "transferStarted", id: "move" },
      { type: "canceled", id: "move", at: "2026-07-17T10:01:00Z", message: "Move canceled after 1 of 2 items in Workspace." }
    ];
    const state = events.reduce(reduceTransferLedger, createTransferLedger());
    const onRetry = vi.fn();

    render(<TransferTrayStage tasks={state.tasks} open onToggleOpen={vi.fn()} onClearFinished={vi.fn()} onRetryTransfer={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledWith(state.tasks[0]);
  });

  it("offers retry for partially completed copy tasks and delegates the unchanged task", () => {
    const events: TransferEvent[] = [
      {
        type: "enqueued",
        at: "2026-07-17T10:00:00Z",
        task: { id: "copy", accountId: "account-a", kind: "copy", label: "2 items", totalItems: 2 }
      },
      { type: "transferStarted", id: "copy" },
      {
        type: "partiallyCompleted",
        id: "copy",
        at: "2026-07-17T10:01:00Z",
        failures: [{ sourcePath: "b.txt", error: "Denied" }],
        message: "Copied 1 of 2 selected items; 1 failed in Workspace."
      }
    ];
    const state = events.reduce(reduceTransferLedger, createTransferLedger());
    const onRetry = vi.fn();

    render(<TransferTrayStage tasks={state.tasks} open onToggleOpen={vi.fn()} onClearFinished={vi.fn()} onRetryTransfer={onRetry} />);

    expect(screen.getByText("Partial")).toBeInTheDocument();
    expect(screen.getByText("b.txt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledWith(state.tasks[0]);
  });
});
