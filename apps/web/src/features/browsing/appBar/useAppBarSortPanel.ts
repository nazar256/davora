import { useCallback, useMemo, useState } from "react";

import type { FolderSortController, FolderSortResetBinding } from "../folderSort";
import type { SortMode } from "../model";

export interface AppBarSortPanelBinding {
  readonly open: boolean;
  readonly toggle: () => void;
  readonly select: (mode: SortMode) => void;
  readonly reset: FolderSortResetBinding;
}

export interface AppBarSortPanelInput {
  readonly sort: Pick<FolderSortController, "select" | "reset">;
}

export function useAppBarSortPanel(input: AppBarSortPanelInput): AppBarSortPanelBinding {
  const [open, setOpen] = useState(false);
  const { sort } = input;

  const toggle = useCallback(() => {
    setOpen((previous) => !previous);
  }, []);

  const select = useCallback((mode: SortMode) => {
    sort.select(mode);
    setOpen(false);
  }, [sort]);

  const confirmReset = useCallback(() => {
    sort.reset.confirm();
    setOpen(false);
  }, [sort]);

  const reset = useMemo((): FolderSortResetBinding => ({
    confirming: sort.reset.confirming,
    count: sort.reset.count,
    request: sort.reset.request,
    confirm: confirmReset,
    cancel: sort.reset.cancel
  }), [confirmReset, sort]);

  return useMemo(() => ({ open, toggle, select, reset }), [open, reset, select, toggle]);
}
