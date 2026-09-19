import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import type { CapabilitySet } from "@davora/shared";

import {
  createOperationContextToken,
  evaluateOperationAvailability,
  isCurrentOperationContext,
  type OperationContextToken,
  type OperationEnvironment,
  type OperationIntent,
  type OperationMode
} from "../policy";
import {
  createOperationAbortRequest,
  isAbortRequestRegistered,
  releaseAbortRequest,
  shouldAbortRequest,
  type OperationAbortRequest
} from "./model";
import type { OperationContextPorts } from "./ports";

export interface OperationAbortAcquireInput {
  readonly context: OperationContextToken;
  readonly intent?: OperationIntent;
  readonly path?: string;
  readonly isValid?: () => boolean;
  readonly rejectUnlessImmediateOwner?: boolean;
  readonly ownership?: {
    readonly checkAborted?: boolean;
    readonly checkPath?: string;
  };
}

export interface OperationAbortScope {
  readonly signal: AbortSignal;
  readonly request: OperationAbortRequest;
  isRegistered(): boolean;
  isOwned(): boolean;
  isCurrent(): boolean;
  release(): void;
}

export interface OperationAbortRegistry {
  acquire(input: OperationAbortAcquireInput): OperationAbortScope | undefined;
}

export interface UseOperationContextInput {
  readonly accountId?: string;
  readonly operationMode: OperationMode;
  readonly token?: string;
  readonly capabilities?: CapabilitySet;
  readonly currentPath: string;
  readonly ports: OperationContextPorts;
}

export interface UseOperationContextResult {
  readonly token: OperationContextToken;
  readonly environment: OperationEnvironment;
  readonly environmentRef: { readonly current: OperationEnvironment };
  readonly tokenRef: { readonly current: OperationContextToken };
  readonly registry: OperationAbortRegistry;
  isOperationAllowed(intent: OperationIntent): boolean;
  isOperationAllowedForRender(intent: OperationIntent): boolean;
  isOperationContextAllowed(context: OperationContextToken, intent: OperationIntent): boolean;
  isCurrentOperationHandler(): boolean;
  isCurrentOperationContext(context: OperationContextToken): boolean;
}

function buildOperationEnvironment(
  operationMode: OperationMode,
  token: string | undefined,
  capabilities: CapabilitySet | undefined
): OperationEnvironment {
  return {
    mode: operationMode,
    hasSession: Boolean(token),
    capabilities
  };
}

function isRequestOwned(
  requests: ReadonlySet<OperationAbortRequest>,
  request: OperationAbortRequest,
  currentContext: OperationContextToken,
  currentPath: string,
  isOperationContextAllowed: (context: OperationContextToken, intent: OperationIntent) => boolean,
  input: OperationAbortAcquireInput
): boolean {
  if (!isAbortRequestRegistered(requests, request)) {
    return false;
  }
  if (input.ownership?.checkAborted && request.abort.signal.aborted) {
    return false;
  }
  if (!isCurrentOperationContext(request.context, currentContext)) {
    return false;
  }
  if (input.intent && !isOperationContextAllowed(request.context, input.intent)) {
    return false;
  }
  if (input.ownership?.checkPath !== undefined && currentPath !== input.ownership.checkPath) {
    return false;
  }
  if (request.isValid && !request.isValid()) {
    return false;
  }
  return true;
}

export function useOperationContext(input: UseOperationContextInput): UseOperationContextResult {
  const inputRef = useRef(input);
  inputRef.current = input;
  const operationEnvironment = useMemo(
    () => buildOperationEnvironment(input.operationMode, input.token, input.capabilities),
    [input.capabilities, input.operationMode, input.token]
  );
  const token = useMemo(
    createOperationContextToken,
    [input.accountId, input.operationMode, input.token]
  );
  const requestsRef = useRef(new Set<OperationAbortRequest>());
  const tokenRef = useRef(token);
  const environmentRef = useRef(operationEnvironment);
  const currentPathRef = useRef(input.currentPath);

  useLayoutEffect(() => {
    tokenRef.current = token;
    environmentRef.current = buildOperationEnvironment(input.operationMode, input.token, input.capabilities);
    currentPathRef.current = input.currentPath;
    for (const request of requestsRef.current) {
      if (shouldAbortRequest(request, token, input.currentPath)) {
        request.abort.abort();
      }
    }
  }, [input.capabilities, input.currentPath, input.operationMode, input.token, token]);

  useLayoutEffect(() => () => {
    for (const request of requestsRef.current) {
      request.abort.abort();
    }
    requestsRef.current.clear();
  }, []);

  const isOperationAllowed = useCallback((intent: OperationIntent) =>
    evaluateOperationAvailability(environmentRef.current, intent).kind === "allowed", []);
  const isOperationAllowedForRender = useCallback((intent: OperationIntent) =>
    evaluateOperationAvailability(operationEnvironment, intent).kind === "allowed", [operationEnvironment]);
  const isOperationContextAllowed = useCallback((context: OperationContextToken, intent: OperationIntent) =>
    isCurrentOperationContext(context, tokenRef.current) && isOperationAllowed(intent), [isOperationAllowed]);
  const isCurrentOperationHandler = useCallback(() =>
    isCurrentOperationContext(token, tokenRef.current), [token]);
  const isBoundCurrentOperationContext = useCallback((context: OperationContextToken) =>
    isCurrentOperationContext(context, tokenRef.current), []);

  const registry = useMemo<OperationAbortRegistry>(() => ({
    acquire: (acquireInput) => {
      const request = createOperationAbortRequest({
        context: acquireInput.context,
        abort: inputRef.current.ports.createAbortHandle(),
        ...(acquireInput.path === undefined ? {} : { path: acquireInput.path }),
        ...(acquireInput.isValid === undefined ? {} : { isValid: acquireInput.isValid })
      });
      requestsRef.current.add(request);
      const owned = () => isRequestOwned(
        requestsRef.current,
        request,
        tokenRef.current,
        currentPathRef.current,
        (context, intent) => isCurrentOperationContext(context, tokenRef.current)
          && evaluateOperationAvailability(environmentRef.current, intent).kind === "allowed",
        acquireInput
      );
      if (acquireInput.rejectUnlessImmediateOwner && !owned()) {
        releaseAbortRequest(requestsRef.current, request);
        return undefined;
      }
      return {
        signal: request.abort.signal,
        request,
        isRegistered: () => isAbortRequestRegistered(requestsRef.current, request),
        isOwned: owned,
        isCurrent: owned,
        release: () => {
          releaseAbortRequest(requestsRef.current, request);
        }
      };
    }
  }), []);

  return {
    token,
    environment: operationEnvironment,
    environmentRef,
    tokenRef,
    registry,
    isOperationAllowed,
    isOperationAllowedForRender,
    isOperationContextAllowed,
    isCurrentOperationHandler,
    isCurrentOperationContext: isBoundCurrentOperationContext
  };
}
