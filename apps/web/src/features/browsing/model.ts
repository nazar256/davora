import { assertNever } from "@davora/shared";

export const SORT_MODES = [
  { value: "name-asc", label: "Name A-Z" },
  { value: "name-desc", label: "Name Z-A" },
  { value: "modified-desc", label: "Modified newest" },
  { value: "modified-asc", label: "Modified oldest" },
  { value: "size-desc", label: "Size largest" },
  { value: "size-asc", label: "Size smallest" }
] as const;

export type SortMode = (typeof SORT_MODES)[number]["value"];

export const SORT_MODE_OPTIONS: readonly (typeof SORT_MODES)[number][] = SORT_MODES;

export const isSortMode = (value: unknown): value is SortMode => {
  switch (value) {
    case "name-asc":
    case "name-desc":
    case "modified-desc":
    case "modified-asc":
    case "size-desc":
    case "size-asc":
      return true;
    default:
      return false;
  }
};

const getSortModeDefinition = (mode: SortMode): (typeof SORT_MODES)[number] => {
  switch (mode) {
    case "name-asc":
      return SORT_MODES[0];
    case "name-desc":
      return SORT_MODES[1];
    case "modified-desc":
      return SORT_MODES[2];
    case "modified-asc":
      return SORT_MODES[3];
    case "size-desc":
      return SORT_MODES[4];
    case "size-asc":
      return SORT_MODES[5];
    default:
      return assertNever(mode, "sort mode definition");
  }
};

export const getSortModeLabel = (mode: SortMode): string => getSortModeDefinition(mode).label;
