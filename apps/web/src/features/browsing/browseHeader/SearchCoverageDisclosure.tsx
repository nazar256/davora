import { Info, WifiOff } from "lucide-react";
import type { SearchCoverage } from "../search";

const explanations = {
  partial: { label: "Search incomplete", text: "Some folders or results were not searched. Open a narrower folder and search again." },
  saved: { label: "Saved search results", text: "Showing saved results. Search again online to check for other matches." },
  offline: { label: "Offline search", text: "Search includes only files saved on this device." }
};

export function SearchCoverageDisclosure({ coverage }: { readonly coverage?: SearchCoverage }) {
  if (coverage !== "partial" && coverage !== "saved" && coverage !== "offline") return null;
  const explanation = explanations[coverage];
  return (
    <details className="listing-completeness-disclosure search-coverage-disclosure" key={coverage}>
      <summary role="button" aria-label={explanation.label} className="icon-button quiet-button">
        {coverage === "offline" ? <WifiOff aria-hidden="true" /> : <Info aria-hidden="true" />}
      </summary>
      <p className="listing-completeness-explanation">{explanation.text}</p>
    </details>
  );
}
