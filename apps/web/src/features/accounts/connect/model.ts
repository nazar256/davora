import type { ConnectAccountRequest } from "@davora/shared";

export interface AccountFormState {
  mode: "add" | "reconnect";
  accountId?: string;
  cacheNamespace?: string;
  baseUrl: string;
  username: string;
  appPassword: string;
  rootPath: string;
  label: string;
}

export interface AccountReconnectSource {
  account: {
    id: string;
    cacheNamespace: string;
    connectionState?: "connected" | "reconnect_required";
    displayName?: string;
    baseUrl: string;
    username: string;
    rootPath: string;
    label?: string;
  };
  pendingReconnect?: {
    baseUrl: string;
    username: string;
    label?: string;
  };
}

export function createEmptyAccountForm(mode: "add" | "reconnect" = "add", rootPath = ""): AccountFormState {
  return {
    mode,
    baseUrl: "",
    username: "",
    appPassword: "",
    rootPath,
    label: ""
  };
}

export function buildReconnectForm(record: AccountReconnectSource): AccountFormState {
  return {
    mode: "reconnect",
    accountId: record.account.id,
    cacheNamespace: record.account.cacheNamespace,
    baseUrl: record.pendingReconnect?.baseUrl ?? record.account.baseUrl,
    username: record.pendingReconnect?.username ?? record.account.username,
    appPassword: "",
    rootPath: record.account.rootPath,
    label: record.pendingReconnect?.label ?? record.account.label ?? ""
  };
}

export const MISSING_CONNECT_FIELDS_ERROR = "Base URL, username, and app password are required.";

export type ConnectFormValidation =
  | { readonly kind: "valid"; readonly request: ConnectAccountRequest }
  | { readonly kind: "invalid"; readonly message: string };

export function validateConnectForm(form: AccountFormState): ConnectFormValidation {
  const trimmedBaseUrl = form.baseUrl.trim();
  const trimmedUsername = form.username.trim();
  const trimmedPassword = form.appPassword.trim();
  if (!trimmedBaseUrl || !trimmedUsername || !trimmedPassword) {
    return { kind: "invalid", message: MISSING_CONNECT_FIELDS_ERROR };
  }

  const trimmedRootPath = form.rootPath.trim();
  return {
    kind: "valid",
    request: {
      type: "nextcloud",
      accountId: form.accountId,
      cacheNamespace: form.cacheNamespace,
      baseUrl: trimmedBaseUrl,
      username: trimmedUsername,
      appPassword: trimmedPassword,
      ...(trimmedRootPath ? { rootPath: trimmedRootPath } : {}),
      ...(form.label.trim() ? { label: form.label.trim() } : {})
    }
  };
}

export function buildConnectSuccessStatus(displayName: string): string {
  return `Connected account ${displayName}`;
}

export const CONNECT_FAILURE_ERROR = "Unable to connect account.";

export function shouldEnsureSessionAfterConnect(unlockRequired: boolean): boolean {
  return !unlockRequired;
}
