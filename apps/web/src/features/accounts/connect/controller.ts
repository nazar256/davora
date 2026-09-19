import type { ConnectedAccount } from "@davora/shared";

import {
  buildConnectSuccessStatus,
  CONNECT_FAILURE_ERROR,
  validateConnectForm
} from "./model";
import type { AccountFormState } from "./model";
import type { ConnectAccountPorts } from "./ports";

export type ConnectAccountOutcome =
  | { readonly kind: "validation-error"; readonly message: string }
  | { readonly kind: "success"; readonly statusMessage: string; readonly account: ConnectedAccount }
  | { readonly kind: "partial"; readonly message: string; readonly clearCredential: true }
  | { readonly kind: "failure"; readonly message: string; readonly clearCredential: boolean };

export async function executeConnectAccount(
  ports: ConnectAccountPorts,
  input: {
    readonly form: AccountFormState;
  }
): Promise<ConnectAccountOutcome> {
  const validation = validateConnectForm(input.form);
  if (validation.kind === "invalid") {
    return { kind: "validation-error", message: validation.message };
  }

  try {
    const result = await ports.connectAccount(validation.request);
    if (result.kind !== "committed") {
      return result.kind === "partial"
        ? { kind: "partial", message: result.message, clearCredential: true }
        : { kind: "failure", message: result.message, clearCredential: result.clearCredential };
    }
    return {
      kind: "success",
      statusMessage: buildConnectSuccessStatus(result.account.displayName),
      account: result.account
    };
  } catch {
    return { kind: "failure", message: CONNECT_FAILURE_ERROR, clearCredential: false };
  }
}
