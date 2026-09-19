import type { OperationContextToken, OperationIntent } from "../policy";

export interface MutationAttemptFacts {
  readonly workflowIdentity: number;
  readonly context: OperationContextToken;
  readonly path: string;
  readonly pathGeneration: number;
  readonly ownershipGeneration: number;
  readonly mountGeneration: number;
  readonly domainIdentity: string;
  readonly intent: OperationIntent;
}

class OwnedMutationAttempt {
  constructor(readonly facts: MutationAttemptFacts) {}
}

/** Opaque ownership proof. Only the lifecycle module can issue one. */
export type MutationAttemptToken = OwnedMutationAttempt;

export function issueMutationAttemptToken(facts: MutationAttemptFacts): MutationAttemptToken {
  return new OwnedMutationAttempt(facts);
}

export function readMutationAttemptFacts(token: MutationAttemptToken): MutationAttemptFacts {
  return token.facts;
}
