import type { FileEntry } from "@davora/shared";

export interface DestinationListingPorts {
  listFiles(path: string, token: string): Promise<{ items: FileEntry[] }>;
  isUnauthorized(error: unknown): boolean;
  isReconnectRequired(error: unknown): boolean;
}

export interface DestinationSessionPorts {
  resetSession(message: string, reconnectRequired?: boolean): void;
}

export interface DestinationPickerPorts {
  readonly listing: DestinationListingPorts;
  readonly session: DestinationSessionPorts;
}
