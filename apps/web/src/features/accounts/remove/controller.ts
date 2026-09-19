import type { ConnectedAccount } from "@davora/shared";

import { buildRemoveDegradedStatus, buildRemoveSuccessStatus, validateRemoveConfirmation } from "./model";
import type { RemoveAccountPorts } from "./ports";
import type { AccountRegistrySnapshot } from "../registry/model";

export type RemoveAccountOutcome =
  | { readonly kind: "validation-error"; readonly message: string }
  | { readonly kind: "success"; readonly statusMessage: string; readonly displayName: string; readonly snapshot: AccountRegistrySnapshot }
  | { readonly kind: "degraded-success"; readonly statusMessage: string; readonly displayName: string; readonly error?: string; readonly retryToken?: string }
  | { readonly kind: "failure"; readonly message: string };

export async function executeRemoveAccount(
  ports: RemoveAccountPorts,
  input: {
    readonly target: ConnectedAccount | undefined;
    readonly confirmation: string;
    readonly retryToken?: string;
  }
): Promise<RemoveAccountOutcome> {
  const validation = validateRemoveConfirmation(input.confirmation, input.target);
  if (validation.kind === "invalid") {
    return { kind: "validation-error", message: validation.message };
  }

  const target = input.target!;
  const outcome = await ports.removeAccount(target, input.retryToken);
  if (outcome.kind === "committed") {
    return {
      kind: "success",
      statusMessage: buildRemoveSuccessStatus(target.displayName),
      displayName: target.displayName,
      snapshot: outcome.snapshot
    };
  }
  if (outcome.kind === "degraded") {
    return {
      kind: "degraded-success",
      statusMessage: buildRemoveDegradedStatus(target.displayName),
      displayName: target.displayName,
      error: outcome.message,
      retryToken: outcome.retryToken
    };
  }
  return { kind: "failure", message: outcome.message };
}
