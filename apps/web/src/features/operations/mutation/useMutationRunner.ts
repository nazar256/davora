import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { MutationResult } from "@davora/shared";

import type { OperationContextToken } from "../policy";
import {
  buildDefaultMutationSuccessStatus,
  evaluateMutationPreconditions,
  isMutationOperationStillCurrent,
  planSelectionSyncWithMutation,
  shouldNavigateAfterMutation
} from "./model";
import type { MutationExecuteOptions, MutationRunnerPorts } from "./ports";

export interface UseMutationRunnerInput {
  readonly operationContextToken: OperationContextToken;
  readonly currentPath?: string;
  readonly ports: MutationRunnerPorts;
}

export function useMutationRunner(input: UseMutationRunnerInput) {
  const [mutationBusy, setMutationBusy] = useState(false);
  const mutationBusyContextRef = useRef<{ readonly context: OperationContextToken; readonly owner: object; readonly path?: string }>();
  const selectionSnapshotRef = useRef<{
    readonly selected: ReturnType<MutationRunnerPorts["selection"]["currentFocusedSelection"]>;
    readonly capture: ReturnType<MutationRunnerPorts["selection"]["captureFocusedSelection"]>;
  }>();
  const inputRef = useRef(input);
  inputRef.current = input;

  const beginMutation = useCallback((context: OperationContextToken, owner: object = context) => {
    mutationBusyContextRef.current = { context, owner, path: inputRef.current.currentPath };
    setMutationBusy(true);
  }, []);

  const finishMutation = useCallback((context: OperationContextToken, owner: object = context) => {
    if (mutationBusyContextRef.current?.context.isSame(context) && mutationBusyContextRef.current.owner === owner) {
      mutationBusyContextRef.current = undefined;
      setMutationBusy(false);
    }
  }, []);

  useLayoutEffect(() => {
    if (mutationBusyContextRef.current && (!mutationBusyContextRef.current.context.isSame(input.operationContextToken)
      || mutationBusyContextRef.current.path !== input.currentPath)) {
      mutationBusyContextRef.current = undefined;
      setMutationBusy(false);
    }
  }, [input.currentPath, input.operationContextToken]);

  const syncSelectionWithMutation = useCallback((result: MutationResult) => {
    const current = inputRef.current.ports;
    const snapshot = selectionSnapshotRef.current ?? {
      selected: current.selection.currentFocusedSelection(),
      capture: current.selection.captureFocusedSelection()
    };
    const effect = planSelectionSyncWithMutation(
      result,
      snapshot.selected,
      current.selection.getSelectedPreview()
    );
    current.selection.applySelectionSync(effect, snapshot.capture);
  }, []);

  const executeMutation = useCallback(async (
    runner: () => Promise<MutationResult>,
    options: MutationExecuteOptions = {}
  ) => {
    const current = inputRef.current.ports;
    selectionSnapshotRef.current = {
      selected: current.selection.currentFocusedSelection(),
      capture: current.selection.captureFocusedSelection()
    };
    const precondition = evaluateMutationPreconditions({
      hasSession: current.session.hasSession(),
      cacheOnlyMode: current.environment.isCacheOnlyBlocked(),
      isOffline: current.environment.isOffline()
    });
    if (precondition.kind === "denied") {
      throw new Error(precondition.message);
    }

    const resolvedContext = options.context ?? inputRef.current.ports.context.getOperationContextToken();
    const operationStillCurrent = () => (options.isAttemptCurrent?.() ?? true) && isMutationOperationStillCurrent({
      context: options.context,
      intent: options.intent,
      isContextAllowed: current.context.isContextAllowed
    });

    if (options.manageBusy ?? true) {
      beginMutation(resolvedContext, options.busyOwner);
    }
    current.presentation.clearListError();
    try {
      const result = await runner();
      if (!operationStillCurrent()) {
        return result;
      }
      if (options.syncSelection ?? true) {
        syncSelectionWithMutation(result);
      }
      if (!operationStillCurrent()) return result;
      if (options.refreshFolder ?? true) {
        if (shouldNavigateAfterMutation(result, current.folder.getCurrentPath())) {
          current.folder.navigateToPath(result.parentPath);
        } else {
          await current.folder.refreshFolder(result.parentPath);
        }
      }
      if (!operationStillCurrent()) return result;
      if (options.successStatus !== false) {
        current.presentation.setStatus(options.successStatus ?? buildDefaultMutationSuccessStatus(
          result,
          current.presentation.getAccountName(),
          current.presentation.toDisplayPath
        ));
      }
      return result;
    } catch (error) {
      if (operationStillCurrent() && current.session.isUnauthorized(error)) {
        current.session.resetExpired("Session expired. Create a fresh session for this account.");
      }
      if (operationStillCurrent() && current.session.isReconnectRequired(error)) {
        current.session.resetReconnectRequired("This account needs to be reconnected before completing mutations.");
      }
      throw error instanceof Error ? error : new Error("Mutation failed.");
    } finally {
      selectionSnapshotRef.current = undefined;
      if (options.manageBusy ?? true) {
        finishMutation(resolvedContext, options.busyOwner);
      }
    }
  }, [beginMutation, finishMutation, syncSelectionWithMutation]);

  return {
    mutationBusy,
    beginMutation,
    finishMutation,
    executeMutation,
    syncSelectionWithMutation
  };
}
