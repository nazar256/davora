import type { BrowserOwnershipKey } from "./ports";

export interface BrowserOwnershipIdentity {
  readonly browserId: string;
  readonly browserSecret: string;
}

export type BrowserOwnershipUnavailableReason =
  | "storage-read"
  | "storage-write"
  | "invalid-existing"
  | "secure-random-unavailable";

export class BrowserOwnershipUnavailableError extends Error {
  readonly name = "BrowserOwnershipUnavailableError";

  constructor(readonly reason: BrowserOwnershipUnavailableReason) {
    super(`BrowserOwnershipUnavailableError: ${reason}`);
  }
}

export const ownershipKeyToField = (key: BrowserOwnershipKey): keyof BrowserOwnershipIdentity =>
  key === "davora-browser-id" ? "browserId" : "browserSecret";
