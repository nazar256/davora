import type { AppSession, ConnectAccountRequest } from "@davora/shared";
import type { RegistryConnectOutcome } from "../registry";

export interface ConnectAccountPorts {
  connectAccount(request: ConnectAccountRequest): Promise<RegistryConnectOutcome>;
  ensureSessionForAccount(accountId: string): Promise<AppSession | undefined>;
}
