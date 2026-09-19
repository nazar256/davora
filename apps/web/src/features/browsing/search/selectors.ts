import type { SearchResult } from "@davora/shared";
import type { SearchState } from "./model";

export const selectSearchResults = (state: SearchState): SearchResult[] =>
  state.kind === "ready" || state.kind === "fallback" || state.kind === "offline" ? state.items : [];
