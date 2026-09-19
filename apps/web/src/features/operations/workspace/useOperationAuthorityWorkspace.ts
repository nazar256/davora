import { useOperationContext } from "../context/useOperationContext";
import { isCurrentOperationContext, type OperationMode } from "../policy";
import type {
  OperationAuthority,
  OperationAuthorityWorkspaceInput
} from "./ports";

function operationMode(input: OperationAuthorityWorkspaceInput): OperationMode {
  if (input.context.explicitOffline) return "explicit-offline";
  if (input.context.browserOffline) return "browser-offline";
  if (input.context.workerUnavailable) return "server-unavailable";
  return "online";
}

export function useOperationAuthorityWorkspace(
  input: OperationAuthorityWorkspaceInput
): OperationAuthority {
  const operationContext = useOperationContext({
    accountId: input.context.accountId,
    operationMode: operationMode(input),
    token: input.context.token,
    capabilities: input.context.capabilities,
    currentPath: input.context.currentPath,
    ports: { createAbortHandle: input.createAbortHandle }
  });

  return {
    token: operationContext.token,
    environment: operationContext.environment,
    registry: operationContext.registry,
    isOperationAllowed: operationContext.isOperationAllowed,
    isOperationAllowedForRender: operationContext.isOperationAllowedForRender,
    isOperationContextAllowed: operationContext.isOperationContextAllowed,
    isCurrentOperationHandler: operationContext.isCurrentOperationHandler,
    isCurrentOperationContext: (context, expected) => expected
      ? isCurrentOperationContext(context, expected)
      : operationContext.isCurrentOperationContext(context),
    getCurrentOperationContextToken: () => operationContext.tokenRef.current,
    getCurrentCapabilities: () => operationContext.environmentRef.current.capabilities,
    capabilitiesMatch: (captured) => operationContext.environmentRef.current.capabilities === captured
  };
}
