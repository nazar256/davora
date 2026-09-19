import { assertNever, type AppSession, type ConnectedAccount, type HealthResponse } from "@davora/shared";

import { ApiRequestError } from "../../../lib/api";

export function isTransientBootstrapError(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    return error.status >= 500 && error.code !== "config_error";
  }

  return error instanceof TypeError || (error instanceof Error && /fetch|network|proxy|socket|connection/i.test(error.message));
}

export function getBootstrapErrorMessage(error: unknown, unlockFlow: boolean): string {
  if (error instanceof ApiRequestError && error.code === "invalid_unlock_code") {
    return "Unlock code is invalid. Ask the deployment operator for the current APP_UNLOCK_CODE and try again.";
  }
  if (unlockFlow) {
    return "Unable to unlock this deployment. Confirm the unlock code and retry.";
  }
  if (error instanceof ApiRequestError && error.code === "config_error") {
    return error.message;
  }
  if (error instanceof ApiRequestError && error.code === "account_reconnect_required") {
    return "This account needs to be reconnected before a session can be created.";
  }
  if (error instanceof ApiRequestError && error.status >= 500) {
    return "Unable to reach the Worker successfully. Confirm the local worker is running and retry.";
  }
  if (isTransientBootstrapError(error)) {
    return "Davora could not restore the local worker yet. The app will keep retrying during startup; if it still fails, retry restore once the worker finishes launching.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unable to create a session. Confirm the Worker is running and retry.";
}

export function getHealthConfigErrorMessage(health: HealthResponse): string | undefined {
  if (health.configLoaded) {
    return undefined;
  }

  if (health.missing?.includes("SESSION_SECRET")) {
    return "Worker configuration is incomplete: SESSION_SECRET is missing. Provision it in the Worker runtime before release.";
  }

  if (health.missing && health.missing.length > 0) {
    return `Worker configuration is incomplete. Missing: ${health.missing.join(", ")}.`;
  }

  return "Worker configuration is incomplete. Check the required environment variables and retry.";
}

export function canAttemptAutoRestore(account: ConnectedAccount | undefined): boolean {
  return Boolean(account && (account.connectionState === "connected" || account.connectionState === "reconnect_required"));
}

export interface HealthLoadSuccessProjection {
  readonly unlockRequired: boolean;
  readonly rootPath: string;
  readonly bootstrapError?: string;
  readonly workerUnavailable: false;
}

export interface HealthLoadFailureProjection {
  readonly bootstrapError: string;
  readonly workerUnavailable: boolean;
}

export function projectHealthLoadSuccess(health: HealthResponse): HealthLoadSuccessProjection {
  return {
    unlockRequired: health.unlockRequired,
    rootPath: health.rootPath,
    bootstrapError: getHealthConfigErrorMessage(health),
    workerUnavailable: false
  };
}

export function projectHealthLoadFailure(error: unknown): HealthLoadFailureProjection {
  return {
    bootstrapError: getBootstrapErrorMessage(error, false),
    workerUnavailable: isTransientBootstrapError(error)
  };
}

export function buildEnsureSessionSuccessMessage(displayName: string): string {
  return `Restored workspace access for ${displayName}`;
}

export type AccountSessionMutation =
  | { readonly kind: "reconnect-required"; readonly accountId: string }
  | { readonly kind: "clear-session"; readonly accountId: string }
  | { readonly kind: "none" };

export interface EnsureSessionFailureProjection {
  readonly bootstrapError: string;
  readonly statusMessage: string;
  readonly workerUnavailable: boolean;
  readonly pauseAutoRestore: boolean;
  readonly mutation: AccountSessionMutation;
}

export function projectEnsureSessionFailure(
  error: unknown,
  input: { readonly accountId: string; readonly source: "auto" | "manual"; readonly unlockFlow: boolean }
): EnsureSessionFailureProjection {
  let mutation: AccountSessionMutation = { kind: "none" };
  if (error instanceof ApiRequestError && error.code === "account_reconnect_required") {
    mutation = { kind: "reconnect-required", accountId: input.accountId };
  } else if (error instanceof ApiRequestError && error.status === 401) {
    mutation = { kind: "clear-session", accountId: input.accountId };
  }

  return {
    bootstrapError: getBootstrapErrorMessage(error, input.unlockFlow),
    statusMessage: input.unlockFlow ? "Unlock failed" : "Workspace restore paused",
    workerUnavailable: isTransientBootstrapError(error),
    pauseAutoRestore: input.source === "auto",
    mutation
  };
}

export function shouldSkipHealthLoad(explicitOfflineMode: boolean): boolean {
  return explicitOfflineMode;
}

export interface AutoRestoreGateInput {
  readonly activeAccount?: ConnectedAccount;
  readonly token?: string;
  readonly unlockRequired: boolean;
  readonly healthLoading: boolean;
  readonly healthReady: boolean;
  readonly sessionBusy: boolean;
  readonly offline: boolean;
  readonly explicitOfflineMode: boolean;
  readonly autoRestorePausedForAccountId?: string;
}

export function shouldAttemptAutoRestore(input: AutoRestoreGateInput): boolean {
  if (
    !canAttemptAutoRestore(input.activeAccount)
    || input.token
    || input.unlockRequired
    || input.healthLoading
    || !input.healthReady
    || input.sessionBusy
    || input.offline
    || input.explicitOfflineMode
  ) {
    return false;
  }
  return input.autoRestorePausedForAccountId !== input.activeAccount?.id;
}

export async function retryTransientBootstrap<T>(
  runner: () => Promise<T>,
  delay: (ms: number) => Promise<void>,
  attempts = 6,
  isCurrent: () => boolean = () => true
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!isCurrent()) {
      throw new BootstrapSupersededError();
    }
    try {
      return await runner();
    } catch (error) {
      lastError = error;
      if (!isTransientBootstrapError(error) || attempt === attempts) {
        throw error;
      }
      await delay(attempt * 250);
      if (!isCurrent()) {
        throw new BootstrapSupersededError();
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Bootstrap retry failed.");
}

export class BootstrapSupersededError extends Error {
  constructor() {
    super("Bootstrap work was superseded by a newer account or mode context.");
    this.name = "BootstrapSupersededError";
  }
}

export type EnsureSessionSource = "auto" | "manual";

export interface EnsureSessionRequest {
  readonly accountId: string;
  readonly unlockCode?: string;
  readonly source: EnsureSessionSource;
}

export interface EnsureSessionSuccessOutcome {
  readonly kind: "success";
  readonly session: AppSession;
  readonly persistedState: import("./ports").AccountSessionState;
  readonly statusMessage: string;
}

export interface EnsureSessionFailureOutcome extends EnsureSessionFailureProjection {
  readonly kind: "failure";
}

export type EnsureSessionOutcome = EnsureSessionSuccessOutcome | EnsureSessionFailureOutcome;

export const DEFAULT_HEALTH_ROOT_PATH = ".davora-agent-test";

export type SessionState =
  | { readonly kind: "checking" }
  | { readonly kind: "noAccounts"; readonly bootstrapError?: string }
  | { readonly kind: "connecting"; readonly bootstrapError?: string }
  | { readonly kind: "reconnectRequired"; readonly accountId: string; readonly bootstrapError?: string }
  | { readonly kind: "unlockRequired"; readonly bootstrapError?: string }
  | { readonly kind: "restoring"; readonly accountId?: string; readonly bootstrapError?: string }
  | { readonly kind: "ready" }
  | { readonly kind: "offlineShell" }
  | { readonly kind: "failed"; readonly bootstrapError: string; readonly workerUnavailable: boolean };

export type SessionLifecycleState =
  | { readonly kind: "skipped" }
  | {
      readonly kind: "checking";
      readonly retained?: {
        readonly unlockRequired: boolean;
        readonly healthRootPath: string;
        readonly bootstrapError?: string;
        readonly workerUnavailable: boolean;
      };
    }
  | {
      readonly kind: "healthReady";
      readonly unlockRequired: boolean;
      readonly healthRootPath: string;
      readonly bootstrapError?: string;
    }
  | {
      readonly kind: "healthFailed";
      readonly bootstrapError: string;
      readonly workerUnavailable: boolean;
    }
  | {
      readonly kind: "awaitingRestore";
      readonly unlockRequired: boolean;
      readonly healthRootPath: string;
      readonly bootstrapError?: string;
      readonly workerUnavailable: boolean;
      readonly autoRestorePausedForAccountId?: string;
    }
  | {
      readonly kind: "restoring";
      readonly accountId: string;
      readonly unlockRequired: boolean;
      readonly healthRootPath: string;
      readonly workerUnavailable: boolean;
      readonly autoRestorePausedForAccountId?: string;
    };

export interface SessionStateInput {
  readonly lifecycle: SessionLifecycleState;
  readonly accountCount: number;
  readonly activeAccount?: ConnectedAccount;
  readonly token?: string;
  readonly allowOfflineCachedShell: boolean;
}

export function initialSessionLifecycle(explicitOfflineMode: boolean): SessionLifecycleState {
  return explicitOfflineMode ? { kind: "skipped" } : { kind: "checking" };
}

export function transitionHealthLoadStart(
  lifecycle: SessionLifecycleState,
  explicitOfflineMode: boolean
): SessionLifecycleState {
  if (shouldSkipHealthLoad(explicitOfflineMode)) {
    return { kind: "skipped" };
  }

  if (lifecycle.kind === "checking") {
    return lifecycle;
  }

  const retained = lifecycle.kind === "skipped"
    ? undefined
    : readSessionHealthContext(lifecycle);

  return retained === undefined
    ? { kind: "checking" }
    : {
        kind: "checking",
        retained: {
          unlockRequired: retained.unlockRequired,
          healthRootPath: retained.healthRootPath,
          workerUnavailable: retained.workerUnavailable,
          ...(retained.bootstrapError === undefined ? {} : { bootstrapError: retained.bootstrapError })
        }
      };
}

export function transitionHealthLoadSuccess(
  _lifecycle: SessionLifecycleState,
  projection: HealthLoadSuccessProjection
): SessionLifecycleState {
  return {
    kind: "healthReady",
    unlockRequired: projection.unlockRequired,
    healthRootPath: projection.rootPath,
    ...(projection.bootstrapError === undefined ? {} : { bootstrapError: projection.bootstrapError })
  };
}

export function transitionHealthLoadFailure(
  _lifecycle: SessionLifecycleState,
  projection: HealthLoadFailureProjection
): SessionLifecycleState {
  return {
    kind: "healthFailed",
    bootstrapError: projection.bootstrapError,
    workerUnavailable: projection.workerUnavailable
  };
}

export function transitionEnsureSessionStart(
  lifecycle: SessionLifecycleState,
  accountId: string
): SessionLifecycleState {
  const context = readSessionHealthContext(lifecycle);
  return {
    kind: "restoring",
    accountId,
    unlockRequired: context.unlockRequired,
    healthRootPath: context.healthRootPath,
    workerUnavailable: context.workerUnavailable,
    ...(context.autoRestorePausedForAccountId === undefined
      ? {}
      : { autoRestorePausedForAccountId: context.autoRestorePausedForAccountId })
  };
}

export function transitionEnsureSessionSuccess(lifecycle: SessionLifecycleState): SessionLifecycleState {
  const context = readSessionHealthContext(lifecycle);
  return {
    kind: "awaitingRestore",
    unlockRequired: context.unlockRequired,
    healthRootPath: context.healthRootPath,
    workerUnavailable: false
  };
}

export function transitionEnsureSessionFailure(
  lifecycle: SessionLifecycleState,
  outcome: EnsureSessionFailureProjection,
  accountId: string
): SessionLifecycleState {
  const context = readSessionHealthContext(lifecycle);
  const autoRestorePausedForAccountId = outcome.pauseAutoRestore
    ? accountId
    : context.autoRestorePausedForAccountId;
  return {
    kind: "awaitingRestore",
    unlockRequired: context.unlockRequired,
    healthRootPath: context.healthRootPath,
    workerUnavailable: outcome.workerUnavailable || context.workerUnavailable,
    ...(outcome.bootstrapError === undefined ? {} : { bootstrapError: outcome.bootstrapError }),
    ...(autoRestorePausedForAccountId === undefined
      ? {}
      : { autoRestorePausedForAccountId })
  };
}

export function transitionActiveAccountChange(lifecycle: SessionLifecycleState): SessionLifecycleState {
  if (lifecycle.kind === "restoring") {
    return {
      kind: "awaitingRestore",
      unlockRequired: lifecycle.unlockRequired,
      healthRootPath: lifecycle.healthRootPath,
      workerUnavailable: lifecycle.workerUnavailable,
      ...(lifecycle.autoRestorePausedForAccountId === undefined
        ? {}
        : { autoRestorePausedForAccountId: lifecycle.autoRestorePausedForAccountId })
    };
  }
  if (lifecycle.kind !== "awaitingRestore") {
    return lifecycle;
  }

  return {
    kind: "awaitingRestore",
    unlockRequired: lifecycle.unlockRequired,
    healthRootPath: lifecycle.healthRootPath,
    workerUnavailable: lifecycle.workerUnavailable,
    ...(lifecycle.bootstrapError === undefined ? {} : { bootstrapError: lifecycle.bootstrapError })
  };
}

export function transitionClearBootstrapError(lifecycle: SessionLifecycleState): SessionLifecycleState {
  switch (lifecycle.kind) {
    case "skipped":
    case "checking":
    case "restoring":
      return lifecycle;
    case "healthReady":
      return {
        kind: "healthReady",
        unlockRequired: lifecycle.unlockRequired,
        healthRootPath: lifecycle.healthRootPath
      };
    case "healthFailed":
      return lifecycle;
    case "awaitingRestore":
      return {
        kind: "awaitingRestore",
        unlockRequired: lifecycle.unlockRequired,
        healthRootPath: lifecycle.healthRootPath,
        workerUnavailable: lifecycle.workerUnavailable,
        ...(lifecycle.autoRestorePausedForAccountId === undefined
          ? {}
          : { autoRestorePausedForAccountId: lifecycle.autoRestorePausedForAccountId })
      };
    default:
      return assertNever(lifecycle, "session lifecycle clear bootstrap error");
  }
}

export function transitionSetWorkerUnavailable(
  lifecycle: SessionLifecycleState,
  workerUnavailable: boolean
): SessionLifecycleState {
  if (lifecycle.kind === "awaitingRestore") {
    return { ...lifecycle, workerUnavailable };
  }
  if (lifecycle.kind === "healthFailed") {
    return { ...lifecycle, workerUnavailable };
  }
  return lifecycle;
}

function readSessionHealthContext(lifecycle: SessionLifecycleState): {
  readonly unlockRequired: boolean;
  readonly healthRootPath: string;
  readonly workerUnavailable: boolean;
  readonly bootstrapError?: string;
  readonly autoRestorePausedForAccountId?: string;
} {
  switch (lifecycle.kind) {
    case "skipped":
      return { unlockRequired: false, healthRootPath: DEFAULT_HEALTH_ROOT_PATH, workerUnavailable: false };
    case "checking":
      return lifecycle.retained ?? {
        unlockRequired: false,
        healthRootPath: DEFAULT_HEALTH_ROOT_PATH,
        workerUnavailable: false
      };
    case "healthReady":
      return {
        unlockRequired: lifecycle.unlockRequired,
        healthRootPath: lifecycle.healthRootPath,
        workerUnavailable: false,
        ...(lifecycle.bootstrapError === undefined ? {} : { bootstrapError: lifecycle.bootstrapError })
      };
    case "healthFailed":
      return {
        unlockRequired: false,
        healthRootPath: DEFAULT_HEALTH_ROOT_PATH,
        workerUnavailable: lifecycle.workerUnavailable,
        bootstrapError: lifecycle.bootstrapError
      };
    case "awaitingRestore":
      return {
        unlockRequired: lifecycle.unlockRequired,
        healthRootPath: lifecycle.healthRootPath,
        workerUnavailable: lifecycle.workerUnavailable,
        ...(lifecycle.bootstrapError === undefined ? {} : { bootstrapError: lifecycle.bootstrapError }),
        ...(lifecycle.autoRestorePausedForAccountId === undefined
          ? {}
          : { autoRestorePausedForAccountId: lifecycle.autoRestorePausedForAccountId })
      };
    case "restoring":
      return {
        unlockRequired: lifecycle.unlockRequired,
        healthRootPath: lifecycle.healthRootPath,
        workerUnavailable: lifecycle.workerUnavailable,
        ...(lifecycle.autoRestorePausedForAccountId === undefined
          ? {}
          : { autoRestorePausedForAccountId: lifecycle.autoRestorePausedForAccountId })
      };
    default:
      return assertNever(lifecycle, "session lifecycle health context");
  }
}

function lifecycleBootstrapError(lifecycle: SessionLifecycleState): string | undefined {
  switch (lifecycle.kind) {
    case "checking":
      return lifecycle.retained?.bootstrapError;
    case "healthReady":
    case "awaitingRestore":
    case "healthFailed":
      return lifecycle.bootstrapError;
    case "skipped":
    case "restoring":
      return undefined;
    default:
      return assertNever(lifecycle, "session lifecycle bootstrap error");
  }
}

function lifecycleUnlockRequired(lifecycle: SessionLifecycleState): boolean {
  switch (lifecycle.kind) {
    case "checking":
      return lifecycle.retained?.unlockRequired ?? false;
    case "healthReady":
    case "awaitingRestore":
    case "restoring":
      return lifecycle.unlockRequired;
    case "skipped":
    case "healthFailed":
      return false;
    default:
      return assertNever(lifecycle, "session lifecycle unlock required");
  }
}

function showAccountConnectPanel(
  input: SessionStateInput,
  autoRestorePausedForAccountId?: string
): boolean {
  if (!input.activeAccount) {
    return true;
  }

  return (
    input.activeAccount.connectionState === "reconnect_required"
    && autoRestorePausedForAccountId === input.activeAccount.id
  );
}

function showUnlockPanel(input: SessionStateInput, healthLoading: boolean): boolean {
  return Boolean(
    input.activeAccount
      && !input.token
      && input.activeAccount.connectionState === "connected"
      && lifecycleUnlockRequired(input.lifecycle)
      && !healthLoading
  );
}

export function resolveSessionState(input: SessionStateInput): SessionState {
  const healthLoading = projectHealthLoading(input.lifecycle);
  const bootstrapError = lifecycleBootstrapError(input.lifecycle);

  if (healthLoading && input.accountCount === 0) {
    return { kind: "checking" };
  }

  if (input.accountCount === 0) {
    return bootstrapError === undefined ? { kind: "noAccounts" } : { kind: "noAccounts", bootstrapError };
  }

  const autoRestorePausedForAccountId = projectAutoRestorePausedForAccountId(input.lifecycle);

  if (showAccountConnectPanel(input, autoRestorePausedForAccountId)) {
    if (input.activeAccount?.connectionState === "reconnect_required") {
      return {
        kind: "reconnectRequired",
        accountId: input.activeAccount.id,
        ...(bootstrapError === undefined ? {} : { bootstrapError })
      };
    }

    return bootstrapError === undefined ? { kind: "connecting" } : { kind: "connecting", bootstrapError };
  }

  if (showUnlockPanel(input, healthLoading)) {
    return bootstrapError === undefined ? { kind: "unlockRequired" } : { kind: "unlockRequired", bootstrapError };
  }

  if (!input.token && !input.allowOfflineCachedShell) {
    if (input.lifecycle.kind === "healthFailed") {
      return {
        kind: "failed",
        bootstrapError: input.lifecycle.bootstrapError,
        workerUnavailable: input.lifecycle.workerUnavailable
      };
    }

    const accountId = input.lifecycle.kind === "restoring" ? input.lifecycle.accountId : input.activeAccount?.id;
    return {
      kind: "restoring",
      ...(accountId === undefined ? {} : { accountId }),
      ...(bootstrapError === undefined ? {} : { bootstrapError })
    };
  }

  if (!input.token && input.allowOfflineCachedShell) {
    return { kind: "offlineShell" };
  }

  return { kind: "ready" };
}

export function projectHealthLoading(lifecycle: SessionLifecycleState): boolean {
  return lifecycle.kind === "checking";
}

export function projectUnlockRequired(lifecycle: SessionLifecycleState): boolean {
  return lifecycleUnlockRequired(lifecycle);
}

export function projectHealthRootPath(lifecycle: SessionLifecycleState): string {
  return readSessionHealthContext(lifecycle).healthRootPath;
}

export function projectWorkerUnavailable(lifecycle: SessionLifecycleState): boolean {
  switch (lifecycle.kind) {
    case "checking":
      return lifecycle.retained?.workerUnavailable ?? false;
    case "healthFailed":
    case "awaitingRestore":
    case "restoring":
      return lifecycle.workerUnavailable;
    case "skipped":
    case "healthReady":
      return false;
    default:
      return assertNever(lifecycle, "session lifecycle worker unavailable");
  }
}

export function projectBootstrapError(lifecycle: SessionLifecycleState): string | undefined {
  return lifecycleBootstrapError(lifecycle);
}

export function projectSessionBusy(lifecycle: SessionLifecycleState): boolean {
  return lifecycle.kind === "restoring";
}

export function projectAutoRestorePausedForAccountId(lifecycle: SessionLifecycleState): string | undefined {
  switch (lifecycle.kind) {
    case "awaitingRestore":
    case "restoring":
      return lifecycle.autoRestorePausedForAccountId;
    case "skipped":
    case "checking":
    case "healthReady":
    case "healthFailed":
      return undefined;
    default:
      return assertNever(lifecycle, "session lifecycle auto-restore pause");
  }
}

export function projectHealthReady(lifecycle: SessionLifecycleState): boolean {
  return lifecycle.kind === "healthReady" || lifecycle.kind === "awaitingRestore" || lifecycle.kind === "restoring";
}
