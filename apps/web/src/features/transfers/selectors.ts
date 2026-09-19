import { isActiveTransferTask, type TransferTask } from "./model";

export type TransferWakeLockReason = "download" | "transferQueue" | "offlineSync";

export function selectAccountTransfers(tasks: readonly TransferTask[], accountId: string | undefined): readonly TransferTask[] {
  return accountId ? tasks.filter((task) => task.accountId === accountId) : [];
}

export function selectActiveTransfers(tasks: readonly TransferTask[]): readonly TransferTask[] {
  return tasks.filter(isActiveTransferTask);
}

export function selectRecentTransfers(tasks: readonly TransferTask[], limit = 8): readonly TransferTask[] {
  return tasks.slice(0, limit);
}

export function selectActiveSyncByDedupeKey(
  tasks: readonly TransferTask[],
  accountId: string,
  dedupeKey: string
): TransferTask | undefined {
  return tasks.find((task) => task.kind === "sync"
    && task.accountId === accountId
    && task.dedupeKey === dedupeKey
    && isActiveTransferTask(task));
}

export function selectTransferWakeLockReasons(tasks: readonly TransferTask[]): readonly TransferWakeLockReason[] {
  const reasons = new Set<TransferWakeLockReason>();
  for (const task of tasks) {
    if (!isActiveTransferTask(task)) {
      continue;
    }
    reasons.add(task.kind === "download" ? "download" : task.kind === "sync" ? "offlineSync" : "transferQueue");
  }
  return (["download", "transferQueue", "offlineSync"] as const).filter((reason) => reasons.has(reason));
}
