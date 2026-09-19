import { parseLocationSearch } from "../../navigation";

export interface PreviewCacheResetState {
  readonly source: "none";
  readonly refreshing: false;
  readonly stale: false;
  readonly updateReady: false;
}

export const defaultPreviewCacheState = (): PreviewCacheResetState => ({
  source: "none",
  refreshing: false,
  stale: false,
  updateReady: false
});

export type AccountSwitchPathReset =
  | { readonly kind: "first-mount-restore"; readonly path: string }
  | { readonly kind: "switch-clear"; readonly path: ""; readonly syncAccountId?: string };

export interface SessionTerminalResetRequest {
  readonly accountId: string;
  readonly message: string;
  readonly reconnectRequired: boolean;
}

export function planAccountSwitchPathReset(input: {
  readonly isFirstAccountEffect: boolean;
  readonly locationSearch: string;
  readonly hasActiveAccount: boolean;
  readonly accountId?: string;
}): AccountSwitchPathReset {
  if (!input.isFirstAccountEffect) {
    return {
      kind: "switch-clear",
      path: "",
      syncAccountId: input.accountId
    };
  }

  const { path: urlPath } = parseLocationSearch(input.locationSearch);
  if (urlPath && input.hasActiveAccount) {
    return { kind: "first-mount-restore", path: urlPath };
  }

  return { kind: "first-mount-restore", path: "" };
}

export function resolveSessionTerminalMutation(
  _accountId: string,
  reconnectRequired: boolean
): "reconnect-required" | "clear-session" {
  return reconnectRequired ? "reconnect-required" : "clear-session";
}

export function buildActiveAccountStatusMessage(displayName: string): string {
  return `Active account: ${displayName}`;
}
