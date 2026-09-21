import type { TransferKind, TransferPhase, TransferTask } from "../model";
import { selectActiveTransfers, selectRecentTransfers } from "../selectors";

export function formatTransferPercent(loaded: number, total?: number): string | undefined {
  if (!total || !Number.isFinite(total) || total <= 0) {
    return undefined;
  }
  const ratio = Math.max(0, Math.min(1, loaded / total));
  return `${Math.round(ratio * 100)}%`;
}

export function transferKindLabel(kind: TransferKind): string {
  if (kind === "upload") {
    return "Upload";
  }
  if (kind === "copy") {
    return "Copy";
  }
  if (kind === "move") {
    return "Move";
  }
  return kind === "sync" ? "Offline sync" : "Download";
}

export function transferPhaseLabel(phase: TransferPhase, kind: TransferKind): string {
  if (phase === "transferring") {
    if (kind === "copy") {
      return "Copying";
    }
    if (kind === "move") {
      return "Moving";
    }
    return transferKindLabel(kind);
  }
  if (phase === "preparing") {
    return "Preparing";
  }
  if (phase === "queued") {
    return "Queued";
  }
  if (phase === "done") {
    return "Done";
  }
  if (phase === "partial") {
    return "Partial";
  }
  if (phase === "canceled") {
    return "Canceled";
  }
  return "Error";
}

export function formatTransferItemProgress(task: Pick<TransferTask, "settledItems" | "totalItems">): string | undefined {
  if (task.settledItems === undefined && task.totalItems === undefined) {
    return undefined;
  }
  const settled = task.settledItems ?? 0;
  return task.totalItems === undefined
    ? `${settled} items settled`
    : `${settled} of ${task.totalItems} items`;
}

export interface TransferTraySummary {
  readonly activeCount: number;
  readonly summary: string;
  readonly percent: string | undefined;
}

export function buildTransferTraySummary(tasks: readonly TransferTask[]): TransferTraySummary {
  const active = selectActiveTransfers(tasks);
  const recent = selectRecentTransfers(tasks);
  const primary = active[0] ?? recent[0];
  const percent = primary ? formatTransferPercent(primary.loadedBytes, primary.totalBytes) : undefined;
  const summary = primary
    ? `${transferKindLabel(primary.kind)}: ${primary.label}${percent ? ` (${percent})` : ""}`
    : "No transfers";

  return {
    activeCount: active.length,
    summary,
    percent
  };
}
