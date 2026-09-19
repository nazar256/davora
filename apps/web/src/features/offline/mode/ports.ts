export interface ExplicitOfflineModeStorage {
  read(accountId: string | undefined): ExplicitOfflineModeStorageRead;
  commit(accountId: string, enabled: boolean): ExplicitOfflineModeStorageCommit;
  reset(): ExplicitOfflineModeStorageCommit;
  repair(repair: ExplicitOfflineModeStorageRepair): ExplicitOfflineModeStorageRepairResult;
}

export type ExplicitOfflineModeStorageRepair =
  | { readonly kind: "delete" }
  | { readonly kind: "write"; readonly value: string };

export type ExplicitOfflineModeStorageRead =
  | {
      readonly kind: "ready";
      readonly enabled: boolean;
      readonly repair?: ExplicitOfflineModeStorageRepair;
    }
  | { readonly kind: "failed"; readonly reason: "corrupt" | "unavailable"; readonly error: Error };

export type ExplicitOfflineModeStorageCommit =
  | { readonly kind: "committed" }
  | { readonly kind: "failed"; readonly reason?: "corrupt" | "unavailable"; readonly error: Error };

export type ExplicitOfflineModeStorageRepairResult =
  | { readonly kind: "repaired" }
  | { readonly kind: "failed"; readonly error: Error };

export interface ExplicitOfflineNetworkGate {
  setBlocked(blocked: boolean): void;
}

export interface ExplicitOfflineModeRuntimePort {
  readonly storage: ExplicitOfflineModeStorage;
  readonly network: ExplicitOfflineNetworkGate;
}

export interface ExplicitOfflineTransferTerminalMessage {
  readonly download: string;
  readonly sync: string;
  readonly upload: string;
}

export interface ExplicitOfflineModeEntryPorts {
  pauseFolderAudio(): void;
  closeDestinationPicker(): void;
  clearActionDialog(): void;
  closePreview(): void;
  setWorkerUnavailable(unavailable: boolean): void;
  failActiveTransfers(accountId: string, message: ExplicitOfflineTransferTerminalMessage): void;
  setStatus(message: string): void;
}

export interface ExplicitOfflineModePorts {
  readonly storage: ExplicitOfflineModeStorage;
  readonly network: ExplicitOfflineNetworkGate;
  readonly entry: ExplicitOfflineModeEntryPorts;
}
