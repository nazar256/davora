import type { ConnectedAccount } from "@davora/shared";

import type { AccountSessionPorts } from "../session";

export interface AccountBootstrapPorts {
  readonly session: AccountSessionPorts;
  readonly onStatusChange: (message: string) => void;
}

export interface AccountBootstrapInput {
  readonly registryUnavailable?: boolean;
  readonly explicitOfflineMode: boolean;
  readonly offline: boolean;
  readonly accountCount: number;
  readonly activeAccount?: ConnectedAccount;
  readonly token?: string;
  readonly cacheNamespace?: string;
  readonly accountHost?: string;
  readonly ports: AccountBootstrapPorts;
}
