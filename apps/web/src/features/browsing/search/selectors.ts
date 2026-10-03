import type { SearchResult } from "@davora/shared";
import type { SearchState } from "./model";

export const selectSearchResults = (state: SearchState): SearchResult[] =>
  state.kind === "ready" || state.kind === "fallback" || state.kind === "offline" ? state.items : [];

export type SearchCoverage = "complete" | "partial" | "saved" | "offline" | "searching" | "failed";

export const selectSearchCoverage = (state: SearchState): SearchCoverage | undefined => {
  switch (state.kind) {
    case "ready": return state.completeness;
    case "fallback": return "saved";
    case "offline": return "offline";
    case "searching": return "searching";
    case "failed": return "failed";
    case "inactive": return undefined;
  }
};
