import { useMemo } from "react";

import type { OperationContextToken } from "../policy";
import {
  createMutationOrchestrationPorts,
  createMutationRunnerPorts,
  type CreateMutationWorkflowPortsInput,
  type MutationWorkflowOrchestrationPorts
} from "./createMutationWorkflowPorts";
import { useMutationRunner } from "./useMutationRunner";

export interface UseMutationWorkflowInput {
  readonly operationContextToken: OperationContextToken;
  readonly currentPath: string;
  readonly portsInput: CreateMutationWorkflowPortsInput;
}

export function useMutationWorkflow(input: UseMutationWorkflowInput) {
  const runnerPorts = useMemo(
    () => createMutationRunnerPorts(input.portsInput),
    [input.portsInput]
  );
  const {
    mutationBusy,
    beginMutation,
    finishMutation,
    executeMutation,
    syncSelectionWithMutation
  } = useMutationRunner({
    operationContextToken: input.operationContextToken,
    currentPath: input.currentPath,
    ports: runnerPorts
  });

  const orchestrationPorts = useMemo(
    (): MutationWorkflowOrchestrationPorts => createMutationOrchestrationPorts(input.portsInput, {
      beginMutation,
      finishMutation,
      executeMutation,
      syncSelectionWithMutation
    }),
    [input.portsInput, beginMutation, finishMutation, executeMutation, syncSelectionWithMutation]
  );

  return {
    mutationBusy,
    beginMutation,
    finishMutation,
    executeMutation,
    syncSelectionWithMutation,
    orchestrationPorts
  };
}
