import type { OperationContextToken } from "../policy";
import type { OperationAbortHandle } from "./ports";

export interface OperationAbortRequest {
  readonly context: OperationContextToken;
  readonly abort: OperationAbortHandle;
  readonly path?: string;
  readonly isValid?: () => boolean;
}

export function shouldAbortRequest(
  request: OperationAbortRequest,
  currentContext: OperationContextToken,
  currentPath: string
): boolean {
  return !request.context.isSame(currentContext)
    || (request.path !== undefined && request.path !== currentPath)
    || (request.isValid !== undefined && !request.isValid());
}

export function createOperationAbortRequest(input: {
  readonly context: OperationContextToken;
  readonly abort: OperationAbortHandle;
  readonly path?: string;
  readonly isValid?: () => boolean;
}): OperationAbortRequest {
  return {
    context: input.context,
    abort: input.abort,
    ...(input.path === undefined ? {} : { path: input.path }),
    ...(input.isValid === undefined ? {} : { isValid: input.isValid })
  };
}

export function isAbortRequestRegistered(
  requests: ReadonlySet<OperationAbortRequest>,
  request: OperationAbortRequest
): boolean {
  return requests.has(request);
}

export function releaseAbortRequest(
  requests: Set<OperationAbortRequest>,
  request: OperationAbortRequest
): void {
  requests.delete(request);
}
