import type { AppSession, ConnectAccountRequest, ConnectAccountTransportSuccess, HealthResponse, SessionRequest } from "@davora/shared";

export interface AccountTransport {
  getHealth(): Promise<HealthResponse>;
  connectAccount(request: ConnectAccountRequest): Promise<ConnectAccountTransportSuccess>;
  createSession(request: SessionRequest): Promise<AppSession>;
  deleteConnectedAccount(accountId: string): Promise<void>;
}
