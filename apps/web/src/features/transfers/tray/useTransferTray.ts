import { useCallback, useMemo } from "react";

import { selectAccountTransfers } from "../selectors";
import { clearFinishedTransfers, toggleTransferTray } from "./controller";
import type { TransferTrayPorts } from "./ports";
import type { TransferTrayStageProps } from "./TransferTrayStage";

export interface UseTransferTrayInput {
  readonly ports: TransferTrayPorts;
}

export function useTransferTray({ ports }: UseTransferTrayInput) {
  const tasks = useMemo(
    () => selectAccountTransfers(ports.transfers.tasks, ports.accountId),
    [ports.transfers.tasks, ports.accountId]
  );

  const toggleOpen = useCallback(() => {
    toggleTransferTray(ports.chrome);
  }, [ports.chrome]);

  const onClearFinished = useCallback(() => {
    clearFinishedTransfers(ports.accountId, ports.transfers);
  }, [ports.accountId, ports.transfers]);

  const stage = useMemo((): TransferTrayStageProps => ({
    tasks,
    open: ports.chrome.isOpen,
    onToggleOpen: toggleOpen,
    onClearFinished,
    ...(ports.onRetryFailedSync ? { onRetryFailedSync: ports.onRetryFailedSync } : {}),
    ...(ports.onCancelTransfer ? { onCancelTransfer: ports.onCancelTransfer } : {}),
    ...(ports.onRetryTransfer ? { onRetryTransfer: ports.onRetryTransfer } : {})
  }), [tasks, ports.chrome.isOpen, toggleOpen, onClearFinished, ports.onRetryFailedSync, ports.onCancelTransfer, ports.onRetryTransfer]);

  return { stage } as const;
}
