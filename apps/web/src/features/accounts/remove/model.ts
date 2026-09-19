import type { ConnectedAccount } from "@davora/shared";

export const REMOVE_CONFIRMATION_MISMATCH_ERROR = "Type the active account label exactly to remove it.";

export type RemoveConfirmationValidation =
  | { readonly kind: "valid" }
  | { readonly kind: "invalid"; readonly message: string };

export function validateRemoveConfirmation(
  confirmation: string,
  target: ConnectedAccount | undefined
): RemoveConfirmationValidation {
  if (!target) {
    return { kind: "invalid", message: REMOVE_CONFIRMATION_MISMATCH_ERROR };
  }
  if (confirmation.trim() !== target.displayName) {
    return { kind: "invalid", message: REMOVE_CONFIRMATION_MISMATCH_ERROR };
  }
  return { kind: "valid" };
}

export function buildRemoveSuccessStatus(displayName: string): string {
  return `Removed account ${displayName}`;
}

export function buildRemoveDegradedStatus(displayName: string): string {
  return `Removed account ${displayName} from browser state.`;
}
