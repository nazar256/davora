import type { ConnectedAccount } from "@davora/shared";
import type { RegistryRemovalOutcome } from "../registry";

export interface RemoveAccountPorts {
  removeAccount(account: ConnectedAccount, retryToken?: string): Promise<RegistryRemovalOutcome>;
}
