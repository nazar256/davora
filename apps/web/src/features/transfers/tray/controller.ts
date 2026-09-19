import type { TransferTrayChromePort, TransferTrayTransferPort } from "./ports";

export function toggleTransferTray(chrome: Pick<TransferTrayChromePort, "isOpen" | "open" | "close">): void {
  if (chrome.isOpen) {
    chrome.close();
    return;
  }
  chrome.open();
}

export function clearFinishedTransfers(
  accountId: string | undefined,
  transfers: Pick<TransferTrayTransferPort, "clearAccountHistory">
): void {
  if (accountId) {
    transfers.clearAccountHistory(accountId);
  }
}
