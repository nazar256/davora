import { useCallback, useMemo, useState } from "react";

import type { SortMode } from "../model";

export interface AppBarSortPanelBinding {
  readonly open: boolean;
  readonly toggle: () => void;
  readonly select: (mode: SortMode) => void;
}

export interface AppBarSortPanelInput {
  readonly onSortModeChange: (mode: SortMode) => void;
}

export function useAppBarSortPanel(input: AppBarSortPanelInput): AppBarSortPanelBinding {
  const [open, setOpen] = useState(false);
  const { onSortModeChange } = input;

  const toggle = useCallback(() => {
    setOpen((previous) => !previous);
  }, []);

  const select = useCallback((mode: SortMode) => {
    onSortModeChange(mode);
    setOpen(false);
  }, [onSortModeChange]);

  return useMemo(() => ({ open, toggle, select }), [open, select, toggle]);
}
