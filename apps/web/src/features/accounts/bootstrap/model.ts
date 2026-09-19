import { assertNever } from "@davora/shared";
import type { SessionState } from "../session/model";

export type AccountBootstrapGate =
  | { readonly kind: "unavailable" }
  | { readonly kind: "healthChecking" }
  | { readonly kind: "noAccounts" }
  | { readonly kind: "connect" }
  | { readonly kind: "reconnect" }
  | { readonly kind: "unlock" }
  | { readonly kind: "restore" }
  | { readonly kind: "continue" };

export function projectAccountBootstrapGate(sessionState: SessionState): AccountBootstrapGate {
  switch (sessionState.kind) {
    case "checking":
      return { kind: "healthChecking" };
    case "noAccounts":
      return { kind: "noAccounts" };
    case "connecting":
      return { kind: "connect" };
    case "reconnectRequired":
      return { kind: "reconnect" };
    case "unlockRequired":
      return { kind: "unlock" };
    case "restoring":
    case "failed":
      return { kind: "restore" };
    case "ready":
    case "offlineShell":
      return { kind: "continue" };
    default:
      return assertNever(sessionState, "session state bootstrap gate");
  }
}

export function projectBootstrapErrorFromSession(sessionState: SessionState): string | undefined {
  switch (sessionState.kind) {
    case "noAccounts":
    case "connecting":
    case "reconnectRequired":
    case "unlockRequired":
    case "restoring":
      return sessionState.bootstrapError;
    case "failed":
      return sessionState.bootstrapError;
    case "checking":
    case "ready":
    case "offlineShell":
      return undefined;
    default:
      return assertNever(sessionState, "session state bootstrap error");
  }
}

export type CachedShellMode = "explicit-offline" | "offline" | "worker-unavailable";

export function resolveCachedShellStatus(
  mode: CachedShellMode,
  accountName: string
): string {
  switch (mode) {
    case "explicit-offline":
      return `Explicit offline mode for ${accountName}. Only readable local files are shown.`;
    case "offline":
      return `Offline cache only for ${accountName}. Live session restore resumes once the worker is reachable again.`;
    case "worker-unavailable":
      return `Cached shell only for ${accountName}. Live session restore resumes once the local server is reachable again.`;
    default:
      return assertNever(mode, "cached shell status mode");
  }
}

export function resolveBootstrapAppBarSupportText(gate: AccountBootstrapGate, activeAccountName?: string): string {
  switch (gate.kind) {
    case "unavailable":
      return "Account storage unavailable";
    case "healthChecking":
      return "Checking connection";
    case "noAccounts":
      return "No accounts connected";
    case "connect":
      return "Connect account";
    case "reconnect":
      return "Reconnect required";
    case "unlock":
      return `Unlock required for ${activeAccountName ?? "current account"}`;
    case "restore":
      return `Restoring ${activeAccountName ?? "current account"}`;
    case "continue":
      return "";
    default:
      return assertNever(gate, "account bootstrap gate");
  }
}

export function shouldMountBootstrapNavDrawer(gate: AccountBootstrapGate): boolean {
  switch (gate.kind) {
    case "connect":
    case "reconnect":
    case "unlock":
    case "restore":
      return true;
    case "unavailable":
    case "healthChecking":
    case "noAccounts":
    case "continue":
      return false;
    default:
      return assertNever(gate, "account bootstrap nav drawer gate");
  }
}

export function shouldShowBootstrapErrorBanner(gate: AccountBootstrapGate): boolean {
  switch (gate.kind) {
    case "noAccounts":
    case "connect":
    case "reconnect":
      return true;
    case "healthChecking":
    case "unavailable":
    case "unlock":
    case "restore":
    case "continue":
      return false;
    default:
      return assertNever(gate, "account bootstrap error banner gate");
  }
}
