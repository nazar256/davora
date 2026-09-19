import type { AccountSessionPorts } from "../features/accounts/session/ports";
import type { AccountRegistryService } from "../features/accounts/registry";
import type { AccountTransport } from "../features/accounts";
import { createBrowserDelay } from "../platform/time/browserDelay";

export const createBrowserAccountSessionPorts = (registry: AccountRegistryService, accountTransport: AccountTransport): AccountSessionPorts => ({
  getHealth: accountTransport.getHealth,
  createSession: accountTransport.createSession,
  commitSession: registry.commitSession,
  markAccountReconnectRequired: registry.markAccountReconnectRequired,
  clearAccountSession: registry.clearAccountSession,
  delay: createBrowserDelay()
});
