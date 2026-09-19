import type { CapabilitySet } from "@davora/shared";

import {
  OperationContextToken,
  type OperationAvailability,
  type OperationEnvironment,
  type OperationIntent
} from "./model";

const ALLOWED = { kind: "allowed" } as const;

function denied(reason: Extract<OperationAvailability, { kind: "denied" }>["reason"]): OperationAvailability {
  return { kind: "denied", reason };
}

function hasRequiredSubject(intent: OperationIntent): OperationAvailability | undefined {
  switch (intent.kind) {
    case "createFolder":
    case "upload":
    case "markBatch":
      return undefined;
    case "downloadFocused":
      if (!intent.present) {
        return denied("subject-required");
      }
      return intent.isFolder ? denied("file-required") : undefined;
    case "move":
    case "copy":
    case "copyOrMove":
    case "delete":
    case "downloadBatch":
    case "keepOffline":
      return intent.count > 0 ? undefined : denied("subject-required");
  }
}

function hasCapability(capabilities: CapabilitySet, intent: OperationIntent): boolean {
  switch (intent.kind) {
    case "createFolder":
      return capabilities.createFolder;
    case "upload":
      return capabilities.upload && (!intent.requiresFolderCreation || capabilities.createFolder);
    case "move":
      return capabilities.move;
    case "copy":
      return capabilities.copy;
    case "copyOrMove":
      return capabilities.copy && capabilities.move;
    case "delete":
      return capabilities.delete;
    case "downloadFocused":
    case "downloadBatch":
    case "keepOffline":
    case "markBatch":
      return capabilities.download;
  }
}

export function evaluateOperationAvailability(
  environment: OperationEnvironment,
  intent: OperationIntent
): OperationAvailability {
  if (environment.mode !== "online") {
    return denied("mode-unavailable");
  }
  if (!environment.hasSession) {
    return denied("session-unavailable");
  }
  if (!environment.capabilities) {
    return denied("capability-unavailable");
  }

  const subjectDenial = hasRequiredSubject(intent);
  if (subjectDenial) {
    return subjectDenial;
  }
  return hasCapability(environment.capabilities, intent)
    ? ALLOWED
    : denied("capability-unavailable");
}

export function createOperationContextToken(): OperationContextToken {
  return OperationContextToken.create();
}

export function isCurrentOperationContext(
  captured: OperationContextToken,
  current: OperationContextToken
): boolean {
  return captured.isSame(current);
}
