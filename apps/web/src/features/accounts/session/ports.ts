import type { AppSession, HealthResponse } from "@davora/shared";
import type { AccountRegistrySnapshot, RegistryCommitOutcome } from "../registry";

export type AccountSessionState = AccountRegistrySnapshot;

export interface AccountSessionPorts {
  getHealth(): Promise<HealthResponse>;
  createSession(input: { accountId: string; unlockCode?: string }): Promise<AppSession>;
  commitSession(accountId: string, session: AppSession): RegistryCommitOutcome;
  markAccountReconnectRequired(accountId: string): RegistryCommitOutcome;
  clearAccountSession(accountId: string): RegistryCommitOutcome;
  delay(ms: number): Promise<void>;
}
