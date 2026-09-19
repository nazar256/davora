import type { CapabilitySet } from "@davora/shared";

export type OperationMode = "online" | "browser-offline" | "server-unavailable" | "explicit-offline";

export interface OperationEnvironment {
  mode: OperationMode;
  hasSession: boolean;
  capabilities?: CapabilitySet;
}

export type OperationIntent =
  | { kind: "createFolder" }
  | { kind: "upload"; requiresFolderCreation: boolean }
  | { kind: "move"; count: number }
  | { kind: "copy"; count: number }
  | { kind: "copyOrMove"; count: number }
  | { kind: "delete"; count: number }
  | { kind: "downloadFocused"; present: boolean; isFolder: boolean }
  | { kind: "downloadBatch"; count: number }
  | { kind: "keepOffline"; count: number }
  | { kind: "markBatch" };

export type OperationDenial =
  | "session-unavailable"
  | "mode-unavailable"
  | "capability-unavailable"
  | "subject-required"
  | "file-required";

export type OperationAvailability =
  | { kind: "allowed" }
  | { kind: "denied"; reason: OperationDenial };

export class OperationContextToken {
  readonly #identity = Symbol("operation-context");

  private constructor() {}

  static create(): OperationContextToken {
    return new OperationContextToken();
  }

  isSame(other: OperationContextToken): boolean {
    return this.#identity === other.#identity;
  }
}
