import type { FileEntry } from "@davora/shared";

import type { OperationContextToken } from "../policy";
import type { DestinationPickerState } from "./model";
import { resolveDestinationListingPath } from "./planner";
import type { DestinationPickerPorts } from "./ports";

export interface DestinationListingRequest {
  readonly picker: DestinationPickerState;
  readonly capturedContext: OperationContextToken;
  readonly currentContext: OperationContextToken;
  readonly folderPath: string;
  readonly token: string;
  isCurrentOperationContext(
    context: OperationContextToken,
    expected: OperationContextToken
  ): boolean;
}

export type DestinationListingOutcome =
  | { readonly kind: "invalid-path-short-circuit" }
  | { readonly kind: "success"; readonly entries: readonly FileEntry[]; readonly completeness: "complete" | "partial" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "session-expired" }
  | { readonly kind: "reconnect-required" }
  | { readonly kind: "superseded" };

export function shouldLoadDestinationListing(input: {
  picker: DestinationPickerState | undefined;
  capturedContext: OperationContextToken | undefined;
  currentContext: OperationContextToken;
  token: string | undefined;
  cacheOnlyMode: boolean;
  isCurrentOperationContext(
    context: OperationContextToken,
    expected: OperationContextToken
  ): boolean;
}): input is {
  picker: DestinationPickerState;
  capturedContext: OperationContextToken;
  currentContext: OperationContextToken;
  token: string;
  cacheOnlyMode: boolean;
  isCurrentOperationContext(
    context: OperationContextToken,
    expected: OperationContextToken
  ): boolean;
} {
  const { picker, capturedContext, token, cacheOnlyMode } = input;
  if (!picker || !capturedContext || !token || cacheOnlyMode) {
    return false;
  }
  return input.isCurrentOperationContext(capturedContext, input.currentContext);
}

export async function executeDestinationListing(
  request: DestinationListingRequest,
  ports: DestinationPickerPorts,
  isStillCurrent: () => boolean
): Promise<DestinationListingOutcome> {
  const listingPath = resolveDestinationListingPath(request.picker);
  if (listingPath.kind === "invalid") {
    return { kind: "invalid-path-short-circuit" };
  }

  const folderPath = listingPath.path;

  if (!isStillCurrent()) {
    return { kind: "superseded" };
  }

  try {
    const response = await ports.listing.listFiles(folderPath, request.token);
    if (!isStillCurrent()) {
      return { kind: "superseded" };
    }
    const nextEntries = Array.isArray(response.items) ? response.items : [];
    return { kind: "success", entries: nextEntries, completeness: response.completeness };
  } catch (error) {
    if (!isStillCurrent()) {
      return { kind: "superseded" };
    }
    if (ports.listing.isUnauthorized(error)) {
      return { kind: "session-expired" };
    }
    if (ports.listing.isReconnectRequired(error)) {
      return { kind: "reconnect-required" };
    }
    return {
      kind: "error",
      message: error instanceof Error ? error.message : "Unable to load destination folder."
    };
  }
}
