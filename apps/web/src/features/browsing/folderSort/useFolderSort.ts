import { useCallback, useMemo, useState } from "react";

import type { SortMode } from "../model";
import {
  buildFolderSortClearedMessage,
  FOLDER_SORT_CLEAR_FAILED_MESSAGE,
  FOLDER_SORT_SAVE_FAILED_MESSAGE
} from "./policy";
import type { FolderSortService } from "./ports";

export interface FolderSortResetBinding {
  readonly confirming: boolean;
  readonly count: number;
  request(): void;
  confirm(): void;
  cancel(): void;
}

export interface FolderSortController {
  readonly mode: SortMode;
  readonly saved: boolean;
  select(mode: SortMode): void;
  readonly reset: FolderSortResetBinding;
}

export interface UseFolderSortInput {
  readonly namespace?: string;
  readonly path: string;
  readonly baseline: SortMode;
  readonly service: FolderSortService;
  readonly persistBaseline: (mode: SortMode) => void;
  readonly announceStatus: (message: string) => void;
}

interface FolderSortHookState {
  readonly namespace?: string;
  readonly overrides: ReadonlyMap<string, SortMode>;
  readonly contextSort: SortMode;
  readonly resetConfirming: boolean;
}

const EMPTY_OVERRIDES: ReadonlyMap<string, SortMode> = new Map();

const loadNamespaceOverrides = (service: FolderSortService, namespace: string): ReadonlyMap<string, SortMode> => {
  const listed = service.listNamespace(namespace);
  return listed.kind === "listed" ? listed.entries : EMPTY_OVERRIDES;
};

/**
 * Owns the effective sort for the current folder.
 *
 * `contextSort` is the sort the user was last looking at: it follows the
 * browsing session, is promoted to a folder's saved sort when one exists, and
 * is only persisted for a folder when the user explicitly selects an option.
 */
export function useFolderSort(input: UseFolderSortInput): FolderSortController {
  const { namespace, path, baseline, service, persistBaseline, announceStatus } = input;
  const [state, setState] = useState<FolderSortHookState>(() => ({
    namespace,
    overrides: namespace ? loadNamespaceOverrides(service, namespace) : EMPTY_OVERRIDES,
    contextSort: baseline,
    resetConfirming: false
  }));

  if (state.namespace !== namespace) {
    setState({
      namespace,
      overrides: namespace ? loadNamespaceOverrides(service, namespace) : EMPTY_OVERRIDES,
      contextSort: state.contextSort,
      resetConfirming: false
    });
  }

  const overrides = state.namespace === namespace ? state.overrides : EMPTY_OVERRIDES;
  const mode = overrides.get(path) ?? state.contextSort;
  if (mode !== state.contextSort && state.namespace === namespace) {
    setState({ ...state, contextSort: mode });
  }

  const select = useCallback((nextMode: SortMode) => {
    if (!namespace) {
      setState((previous) => ({ ...previous, contextSort: nextMode }));
      persistBaseline(nextMode);
      return;
    }
    const written = service.write(namespace, path, nextMode);
    if (written.kind !== "saved") {
      setState((previous) => ({ ...previous, contextSort: nextMode }));
      announceStatus(FOLDER_SORT_SAVE_FAILED_MESSAGE);
      return;
    }
    setState((previous) => {
      if (previous.namespace !== namespace) {
        return { ...previous, contextSort: nextMode };
      }
      const nextOverrides = new Map(previous.overrides);
      nextOverrides.set(path, nextMode);
      return { ...previous, overrides: nextOverrides, contextSort: nextMode };
    });
    persistBaseline(nextMode);
  }, [announceStatus, namespace, path, persistBaseline, service]);

  const request = useCallback(() => {
    setState((previous) => ({ ...previous, resetConfirming: true }));
  }, []);

  const cancel = useCallback(() => {
    setState((previous) => ({ ...previous, resetConfirming: false }));
  }, []);

  const confirm = useCallback(() => {
    if (!namespace) {
      setState((previous) => ({ ...previous, resetConfirming: false }));
      return;
    }
    const cleared = service.clearNamespace(namespace);
    setState((previous) => previous.namespace === namespace && cleared.kind === "cleared"
      ? { ...previous, overrides: EMPTY_OVERRIDES, resetConfirming: false }
      : { ...previous, resetConfirming: false });
    announceStatus(cleared.kind === "cleared"
      ? buildFolderSortClearedMessage(cleared.removedCount)
      : FOLDER_SORT_CLEAR_FAILED_MESSAGE);
  }, [announceStatus, namespace, service]);

  return useMemo(() => ({
    mode,
    saved: overrides.has(path),
    select,
    reset: {
      confirming: state.resetConfirming,
      count: overrides.size,
      request,
      confirm,
      cancel
    }
  }), [cancel, confirm, mode, overrides, path, request, select, state.resetConfirming]);
}
