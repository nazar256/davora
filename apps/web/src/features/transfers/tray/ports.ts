import type { TransferTask } from "../model";

export interface TransferTrayChromePort {
  readonly isOpen: boolean;
  readonly open: () => void;
  readonly close: () => void;
}

export interface TransferTrayTransferPort {
  readonly tasks: readonly TransferTask[];
  readonly clearAccountHistory: (accountId: string) => void;
}

export interface TransferTrayPorts {
  readonly chrome: TransferTrayChromePort;
  readonly transfers: TransferTrayTransferPort;
  readonly accountId: string | undefined;
  readonly onRetryFailedSync?: (task: TransferTask) => void;
}
