import type { AppSession, ConnectAccountRequest, ConnectAccountTransportSuccess, HealthResponse, SessionRequest, SessionResponse } from "@davora/shared";
import { connectAccountEndpoint, deleteAccountEndpoint, healthEndpoint, sessionEndpoint } from "@davora/shared";

import { ApiRequestError, backendApiUrl, request, throwHttpRequestError } from "../../lib/api";
import { withBackendResponse } from "../../lib/networkPolicy";

interface BrowserOwnershipIdentityReader {
  read(): { readonly browserId: string; readonly browserSecret: string };
}

export interface BrowserAccountTransportAdapter {
  getHealth(): Promise<HealthResponse>;
  connectAccount(request: ConnectAccountRequest): Promise<ConnectAccountTransportSuccess>;
  createSession(request: SessionRequest): Promise<AppSession>;
  deleteConnectedAccount(accountId: string): Promise<void>;
}

export function createBrowserAccountTransport(identity: BrowserOwnershipIdentityReader): BrowserAccountTransportAdapter {
  const ownershipHeaders = () => {
    const { browserId, browserSecret } = identity.read();
    return {
      "x-davora-browser-id": browserId,
      "x-davora-browser-secret": browserSecret
    };
  };

  return {
    getHealth: () => request<HealthResponse>(healthEndpoint.path, { method: healthEndpoint.method }, undefined, healthEndpoint.successSchema),
    async connectAccount(requestBody: ConnectAccountRequest): Promise<ConnectAccountTransportSuccess> {
      return withBackendResponse(backendApiUrl(connectAccountEndpoint.path), {
        method: connectAccountEndpoint.method,
        headers: { "content-type": "application/json", ...ownershipHeaders() },
        body: JSON.stringify(connectAccountEndpoint.requestSchema.parse(requestBody))
      }, async (response) => {
        if (!response.ok) {
          return throwHttpRequestError(response);
        }
        const envelope: unknown = await response.json().catch(() => undefined);
        const parsed = connectAccountEndpoint.successSchema.safeParse(envelope);
        if (!parsed.success) {
          return { kind: "invalid-http-success" };
        }
        return { kind: "http-success", data: parsed.data.data };
      });
    },
    async createSession(requestBody: SessionRequest) {
      const data = await request<SessionResponse>(`${sessionEndpoint.path}`, {
        method: sessionEndpoint.method,
        headers: ownershipHeaders(),
        body: JSON.stringify(sessionEndpoint.requestSchema.parse(requestBody))
      }, undefined, sessionEndpoint.successSchema);
      return data.session;
    },
    async deleteConnectedAccount(accountId: string) {
      return withBackendResponse(backendApiUrl(deleteAccountEndpoint.buildPath(accountId)), {
        method: deleteAccountEndpoint.method,
        headers: ownershipHeaders()
      }, async (response) => {
        if (!response.ok) {
          return throwHttpRequestError(response);
        }
        if (response.status !== 204) {
          throw new ApiRequestError("The server returned an invalid response.", response.status, "invalid_response");
        }
      });
    }
  };
}
