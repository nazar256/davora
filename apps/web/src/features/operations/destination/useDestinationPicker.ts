import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import type { OperationContextToken } from "../policy";
import {
  executeDestinationListing,
  shouldLoadDestinationListing
} from "./controller";
import type { DestinationOperation, DestinationPickerState, DestinationPlan } from "./model";
import {
  applyDestinationListingSuccess,
  buildDestinationPlanFromPicker,
  closeDestinationPickerIfCurrent,
  matchesDestinationListing,
  reloadDestinationPickerFolder,
  selectCurrentDestinationPicker,
  updateDestinationPickerFolder,
  updateDestinationPickerManualMode,
  updateDestinationPickerManualPath,
  updateDestinationPickerName
} from "./pickerState";
import { resolveDestinationListingPath } from "./planner";
import type { DestinationPickerPorts } from "./ports";

export interface UseDestinationPickerInput {
  cacheOnlyMode: boolean;
  token?: string;
  operationContextToken: OperationContextToken;
  isCurrentOperationContext(
    context: OperationContextToken,
    expected: OperationContextToken
  ): boolean;
  ports: DestinationPickerPorts;
  onClearActionError(): void;
  destinationPicker: DestinationPickerState | undefined;
  setDestinationPicker: Dispatch<SetStateAction<DestinationPickerState | undefined>>;
}

export function useDestinationPicker(input: UseDestinationPickerInput) {
  const destinationPicker = input.destinationPicker;
  const inputRef = useRef(input);
  inputRef.current = input;
  const setDestinationPicker = useCallback<Dispatch<SetStateAction<DestinationPickerState | undefined>>>(
    (updater) => inputRef.current.setDestinationPicker(updater),
    []
  );

  const operationContextToken = input.operationContextToken;
  const currentDestinationPicker = selectCurrentDestinationPicker(
    destinationPicker,
    operationContextToken,
    input.isCurrentOperationContext
  );

  const destinationPickerContext = destinationPicker?.context;
  const destinationPickerFolderPath = destinationPicker?.folderPath;
  const destinationPickerManualMode = destinationPicker?.manualMode;
  const destinationPickerManualPath = destinationPicker?.manualPath;
  const destinationPickerReloadKey = destinationPicker?.reloadKey;
  const destinationPickerBatch = destinationPicker?.batch;
  const destinationSourceEntry = destinationPicker?.sourceEntries[0];
  const destinationSourceEntryName = destinationSourceEntry?.name;
  const destinationSourceEntryPath = destinationSourceEntry?.path;

  useEffect(() => {
    const current = inputRef.current;
    const loadInput = {
      picker: destinationPicker,
      capturedContext: destinationPickerContext,
      currentContext: current.operationContextToken,
      token: current.token,
      cacheOnlyMode: current.cacheOnlyMode,
      isCurrentOperationContext: current.isCurrentOperationContext
    };
    if (!shouldLoadDestinationListing(loadInput)) {
      return;
    }

    const capturedContext = loadInput.capturedContext;
    const picker = loadInput.picker;
    let cancelled = false;
    const listingPath = resolveDestinationListingPath({
      batch: destinationPickerBatch!,
      manualMode: destinationPickerManualMode!,
      folderPath: destinationPickerFolderPath!,
      manualPath: destinationPickerManualPath!
    });
    if (listingPath.kind === "invalid") {
      setDestinationPicker((previous) => {
        if (!previous
          || !current.isCurrentOperationContext(previous.context, capturedContext)
          || !current.isCurrentOperationContext(capturedContext, inputRef.current.operationContextToken)) {
          return previous;
        }
        const previousListingPath = resolveDestinationListingPath(previous);
        return previousListingPath.kind === "invalid"
          ? { ...previous, entries: [], loading: false, error: undefined }
          : previous;
      });
      return;
    }
    const folderPath = listingPath.path;
    const request = {
      picker,
      capturedContext,
      currentContext: current.operationContextToken,
      folderPath,
      token: loadInput.token,
      isCurrentOperationContext: current.isCurrentOperationContext
    };
    const isStillCurrent = () => !cancelled
      && current.isCurrentOperationContext(capturedContext, inputRef.current.operationContextToken);
    const matchesDestination = (previous: DestinationPickerState) => matchesDestinationListing(
      previous,
      capturedContext,
      folderPath,
      current.isCurrentOperationContext,
      inputRef.current.operationContextToken
    );

    setDestinationPicker((previous) => previous
      ? { ...previous, loading: true, error: undefined }
      : previous);

    void executeDestinationListing(request, current.ports, isStillCurrent).then((outcome) => {
      if (cancelled) {
        return;
      }
      if (outcome.kind === "session-expired") {
        current.ports.session.resetSession("Session expired. Create a fresh session for this account.");
        setDestinationPicker(undefined);
        return;
      }
      if (outcome.kind === "reconnect-required") {
        current.ports.session.resetSession(
          "This account needs to be reconnected before choosing a destination.",
          true
        );
        setDestinationPicker(undefined);
        return;
      }
      if (outcome.kind === "superseded" || outcome.kind === "invalid-path-short-circuit") {
        return;
      }
      setDestinationPicker((previous) => {
        if (!previous || !matchesDestination(previous)) {
          return previous;
        }
        if (outcome.kind === "success") {
          return applyDestinationListingSuccess(previous, outcome.entries, outcome.completeness);
        }
        if (outcome.kind === "error") {
          return { ...previous, entries: [], loading: false, error: outcome.message };
        }
        return previous;
      });
    });

    return () => {
      cancelled = true;
    };
    // Intentionally keyed on listing-relevant fields, not the full picker object (entries/loading churn).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- destinationPicker field projection
  }, [
    input.cacheOnlyMode,
    destinationPickerBatch,
    destinationPickerContext,
    destinationPickerFolderPath,
    destinationPickerManualMode,
    destinationPickerManualPath,
    destinationPickerReloadKey,
    destinationSourceEntryName,
    destinationSourceEntryPath,
    operationContextToken,
    input.token,
    setDestinationPicker
  ]);

  const close = useCallback(() => {
    setDestinationPicker(undefined);
  }, [setDestinationPicker]);

  const closeIfCurrent = useCallback((context: OperationContextToken) => {
    setDestinationPicker((previous) => closeDestinationPickerIfCurrent(
      previous,
      context,
      inputRef.current.isCurrentOperationContext
    ));
  }, [setDestinationPicker]);

  const updateFolder = useCallback((folderPath: string) => {
    inputRef.current.onClearActionError();
    setDestinationPicker((previous) => previous ? updateDestinationPickerFolder(previous, folderPath) : previous);
  }, [setDestinationPicker]);

  const updateName = useCallback((name: string) => {
    inputRef.current.onClearActionError();
    setDestinationPicker((previous) => previous ? updateDestinationPickerName(previous, name) : previous);
  }, [setDestinationPicker]);

  const updateManualMode = useCallback((manualMode: boolean) => {
    inputRef.current.onClearActionError();
    setDestinationPicker((previous) => previous ? updateDestinationPickerManualMode(previous, manualMode) : previous);
  }, [setDestinationPicker]);

  const updateManualPath = useCallback((manualPath: string) => {
    inputRef.current.onClearActionError();
    setDestinationPicker((previous) => previous ? updateDestinationPickerManualPath(previous, manualPath) : previous);
  }, [setDestinationPicker]);

  const reload = useCallback(() => {
    inputRef.current.onClearActionError();
    setDestinationPicker((previous) => previous ? reloadDestinationPickerFolder(previous) : previous);
  }, [setDestinationPicker]);

  const getValidation = useCallback((operation?: DestinationOperation): DestinationPlan => {
    const picker = selectCurrentDestinationPicker(
      destinationPicker,
      inputRef.current.operationContextToken,
      inputRef.current.isCurrentOperationContext
    );
    if (!picker) {
      return { kind: "invalid", destinationPath: "", message: "No selected item." };
    }
    return buildDestinationPlanFromPicker(
      picker,
      operation ?? (picker.kind === "move" ? "move" : "copy")
    );
  }, [destinationPicker]);

  return {
    destinationPicker,
    currentDestinationPicker,
    setDestinationPicker,
    close,
    closeIfCurrent,
    updateFolder,
    updateName,
    updateManualMode,
    updateManualPath,
    reload,
    getValidation
  };
}
