import { assertNever, type HealthResponse } from "@davora/shared";

import {
  buildEnsureSessionSuccessMessage,
  BootstrapSupersededError,
  projectEnsureSessionFailure,
  projectHealthLoadFailure,
  projectHealthLoadSuccess,
  retryTransientBootstrap,
  type AccountSessionMutation,
  type EnsureSessionOutcome,
  type EnsureSessionRequest
} from "./model";
import type { AccountSessionPorts, AccountSessionState } from "./ports";

export type HealthLoadOutcome =
  | { readonly kind: "success"; readonly projection: ReturnType<typeof projectHealthLoadSuccess> }
  | { readonly kind: "failure"; readonly projection: ReturnType<typeof projectHealthLoadFailure> }
  | { readonly kind: "cancelled" };

export async function executeHealthLoad(
  ports: Pick<AccountSessionPorts, "getHealth" | "delay">,
  options: { readonly isCancelled: () => boolean }
): Promise<HealthLoadOutcome> {
  try {
    const health = await retryTransientBootstrap(() => ports.getHealth(), (ms) => ports.delay(ms), 6, () => !options.isCancelled());
    if (options.isCancelled()) {
      return { kind: "cancelled" };
    }
    return { kind: "success", projection: projectHealthLoadSuccess(health) };
  } catch (error) {
    if (options.isCancelled()) {
      return { kind: "cancelled" };
    }
    return { kind: "failure", projection: projectHealthLoadFailure(error) };
  }
}

export function applyAccountSessionMutation(
  ports: Pick<AccountSessionPorts, "markAccountReconnectRequired" | "clearAccountSession">,
  mutation: AccountSessionMutation
): AccountSessionState | undefined {
  let outcome;
  switch (mutation.kind) {
    case "reconnect-required":
      outcome = ports.markAccountReconnectRequired(mutation.accountId);
      break;
    case "clear-session":
      outcome = ports.clearAccountSession(mutation.accountId);
      break;
    case "none":
      return undefined;
    default:
      return assertNever(mutation, "account session mutation");
  }
  return outcome.kind === "committed" ? outcome.snapshot : undefined;
}

export async function executeEnsureSession(
  ports: AccountSessionPorts,
  request: EnsureSessionRequest,
  options: { readonly isCurrent?: () => boolean } = {}
): Promise<EnsureSessionOutcome | { readonly kind: "cancelled" }> {
  const unlockFlow = Boolean(request.unlockCode);
  try {
    const session = await retryTransientBootstrap(
      () => ports.createSession(request.unlockCode ? { accountId: request.accountId, unlockCode: request.unlockCode } : { accountId: request.accountId }),
      (ms) => ports.delay(ms),
      6,
      options.isCurrent
    );
    if (options.isCurrent && !options.isCurrent()) {
      return { kind: "cancelled" };
    }
    const commit = ports.commitSession(request.accountId, session);
    if (commit.kind !== "committed") {
      throw new Error(commit.message);
    }
    const persistedState = commit.snapshot;
    return {
      kind: "success",
      session,
      persistedState,
      statusMessage: buildEnsureSessionSuccessMessage(session.account.displayName)
    };
  } catch (error) {
    if (error instanceof BootstrapSupersededError || (options.isCurrent && !options.isCurrent())) {
      return { kind: "cancelled" };
    }
    return {
      kind: "failure",
      ...projectEnsureSessionFailure(error, {
        accountId: request.accountId,
        source: request.source,
        unlockFlow
      })
    };
  }
}

export type { HealthResponse };
