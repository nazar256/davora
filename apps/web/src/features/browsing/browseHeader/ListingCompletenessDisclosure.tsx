import { Info } from "lucide-react";

export function ListingCompletenessDisclosure(props: {
  readonly completeness?: "complete" | "partial" | "unknown";
  readonly compact?: boolean;
}) {
  if (props.completeness !== "partial" && props.completeness !== "unknown") return null;
  const partial = props.completeness === "partial";
  const label = partial ? "Only part of this folder is listed" : "Saved listing has not been verified";
  return (
    <details className="listing-completeness-disclosure" key={props.completeness}>
      <summary role="button" aria-label={label} className={props.compact ? "icon-button quiet-button" : "operation-pill secondary"}>
        <Info aria-hidden="true" />
        {props.compact ? null : <span>{partial ? "Partial listing" : "Unverified listing"}</span>}
      </summary>
      <p className="listing-completeness-explanation">
        {partial ? "Some items may be missing. Open a smaller folder or select individual files." : "This saved listing predates completeness checks. Reconnect to verify it."}
      </p>
    </details>
  );
}
