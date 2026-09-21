import { useEffect, useState } from "react";
import { File as FileIcon, Folder, X } from "lucide-react";
import type { FileEntry } from "@davora/shared";
import { getViewerKind } from "@davora/shared";

import { useModalFocusBoundary } from "../../../components/useModalFocusBoundary";
import { formatFileSize } from "../../../lib/fileSize";
import { effectiveConflictDecision } from "./conflicts";
import type {
  DestinationConflictDecision,
  DestinationConflictReview,
  DestinationOperation
} from "./model";

export interface ConflictResolutionStageProps {
  readonly open: boolean;
  readonly review: DestinationConflictReview;
  readonly busy: boolean;
  readonly resolvePreviewUrl?: (entry: FileEntry) => Promise<string | undefined>;
  readonly onDecisionChange: (sourcePath: string, decision: DestinationConflictDecision) => void;
  readonly onApplyToAll: (decision: DestinationConflictDecision) => void;
  readonly onApplySizeRuleChange: (checked: boolean) => void;
  readonly onConfirm: () => void;
  readonly onBack: () => void;
  readonly onClose: () => void;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function dismissOnScrimClick(
  event: { currentTarget: EventTarget & Element; target: EventTarget | null },
  onDismiss: () => void
) {
  if (event.target === event.currentTarget) {
    onDismiss();
  }
}

function formatFileTimestamp(value: string | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const DECISION_ORDER: readonly DestinationConflictDecision[] = ["replace", "merge", "keepBoth", "skip"];

function decisionLabel(decision: DestinationConflictDecision): string {
  switch (decision) {
    case "replace": return "Replace";
    case "merge": return "Merge";
    case "keepBoth": return "Keep both";
    case "skip": return "Skip";
  }
}

function bulkDecisionLabel(decision: DestinationConflictDecision): string {
  switch (decision) {
    case "replace": return "Replace all";
    case "merge": return "Merge all";
    case "keepBoth": return "Keep both for all";
    case "skip": return "Skip all";
  }
}

function resultHint(
  effective: DestinationConflictDecision,
  operation: DestinationOperation
): string {
  switch (effective) {
    case "replace":
      return "The incoming item replaces the existing one.";
    case "merge":
      return "Folder contents are combined; nested conflicts follow the bulk rule below.";
    case "keepBoth":
      return "The incoming item is saved with a new name.";
    case "skip":
      return operation === "move"
        ? "The existing item is kept; the incoming item stays in its current folder."
        : "The existing item is kept; the incoming item is not copied.";
  }
}

function ConflictFilePreview(props: {
  readonly entry: FileEntry;
  readonly label: string;
  readonly showImage: boolean;
  readonly resolvePreviewUrl?: (entry: FileEntry) => Promise<string | undefined>;
}) {
  const { entry, showImage, resolvePreviewUrl } = props;
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    setUrl(undefined);
    if (!showImage || !resolvePreviewUrl) {
      return;
    }
    let live = true;
    void resolvePreviewUrl(entry)
      .then((resolved) => { if (live) setUrl(resolved); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [entry, showImage, resolvePreviewUrl]);

  return (
    <div className="conflict-preview">
      <div className="conflict-preview-thumb" aria-hidden="true">
        {url ? <img alt="" src={url} /> : props.entry.isFolder ? <Folder /> : <FileIcon />}
      </div>
      <div className="conflict-preview-meta">
        <span className="conflict-preview-label">{props.label}</span>
        <strong className="conflict-preview-name">{props.entry.name}</strong>
        <span className="conflict-preview-detail">{props.entry.isFolder ? "Folder" : `${formatFileSize(props.entry.size)} · ${formatFileTimestamp(props.entry.lastModified)}`}</span>
      </div>
    </div>
  );
}

export function ConflictResolutionStage(props: ConflictResolutionStageProps) {
  const dialogRef = useModalFocusBoundary<HTMLElement>(props.open, props.onClose);
  if (!props.open) {
    return null;
  }

  const { review } = props;
  const operationLabel = review.operation === "move" ? "Move" : "Copy";
  const bulkDecisions = DECISION_ORDER.filter((decision) => review.items.some((item) => item.allowedDecisions.includes(decision)));
  const decisionCounts = new Map<DestinationConflictDecision, number>();
  for (const item of review.items) {
    const decision = effectiveConflictDecision(item, review.applySizeRule);
    decisionCounts.set(decision, (decisionCounts.get(decision) ?? 0) + 1);
  }
  const summary = DECISION_ORDER
    .filter((decision) => decisionCounts.get(decision))
    .map((decision) => `${decisionCounts.get(decision)} ${decisionLabel(decision).toLowerCase()}`)
    .join(" · ");

  return (
    <div className="modal-scrim" onClick={(event) => dismissOnScrimClick(event, props.onClose)} role="presentation">
      <section ref={dialogRef} aria-label="Resolve destination conflicts" aria-modal="true" className="dialog-card panel conflict-dialog" role="dialog" tabIndex={-1}>
        <div className="dialog-header destination-picker-header">
          <h2>Resolve {pluralize(review.items.length, "conflict")}</h2>
          <div className="dialog-header-actions">
            <button aria-label="Close conflict resolution" className="icon-button quiet-button" onClick={props.onClose} title="Close" type="button"><X aria-hidden="true" /></button>
          </div>
        </div>
        <div className="conflict-form">
          <div className="destination-summary">
            <p><span className="summary-label">{operationLabel}</span> {pluralize(review.targets.length, "item")} to {review.destinationPath || "/"}</p>
            <p>{pluralize(review.items.length, "item")} already {review.items.length === 1 ? "exists" : "exist"} at the destination.</p>
          </div>

          <div className="conflict-bulk">
            <label className="conflict-size-rule">
              <input
                aria-label="Replace files when the incoming file is the same size or larger"
                checked={review.applySizeRule}
                disabled={props.busy}
                onChange={(event) => props.onApplySizeRuleChange(event.target.checked)}
                type="checkbox"
              />
              Replace files when the incoming file is the same size or larger
            </label>
            {bulkDecisions.length > 0 ? (
              <div className="conflict-bulk-actions" role="group" aria-label="Apply a decision to every conflict">
                {bulkDecisions.map((decision) => (
                  <button className="quiet-button" disabled={props.busy} key={decision} onClick={() => props.onApplyToAll(decision)} type="button">
                    {bulkDecisionLabel(decision)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <ul className="conflict-list" aria-label="Conflicting items">
            {review.items.map((item) => {
              const effective = effectiveConflictDecision(item, review.applySizeRule);
              const showImage = getViewerKind(item.source.mimeType) === "image" && getViewerKind(item.existing.mimeType) === "image";
              const radioName = `conflict-${item.source.path}`;
              return (
                <li className="conflict-item" key={item.source.path}>
                  <div className="conflict-item-header">
                    <strong className="conflict-item-name">{item.source.name}</strong>
                    {item.isSelfCollision ? <span className="status">Same item at the destination</span> : null}
                  </div>
                  <div className="conflict-files">
                    <ConflictFilePreview entry={item.source} label="Incoming" resolvePreviewUrl={props.resolvePreviewUrl} showImage={showImage} />
                    <ConflictFilePreview entry={item.existing} label="Existing" resolvePreviewUrl={props.resolvePreviewUrl} showImage={showImage} />
                  </div>
                  <p className="conflict-paths"><span className="summary-label">From</span> {item.source.path} <span className="summary-label">to</span> {item.destinationPath}</p>
                  <div className="conflict-decisions" role="radiogroup" aria-label={`Decision for ${item.source.name}`}>
                    {item.allowedDecisions.map((decision) => (
                      <label className="conflict-decision" key={decision}>
                        <input
                          aria-label={`${decisionLabel(decision)} ${item.source.name}`}
                          checked={effective === decision}
                          disabled={props.busy}
                          name={radioName}
                          onChange={() => props.onDecisionChange(item.source.path, decision)}
                          type="radio"
                        />
                        {decisionLabel(decision)}
                      </label>
                    ))}
                  </div>
                  <p className="conflict-result status">{resultHint(effective, review.operation)}</p>
                </li>
              );
            })}
          </ul>

          <div className="dialog-actions conflict-actions">
            <button className="quiet-button" disabled={props.busy} onClick={props.onBack} type="button">Back</button>
            <button className="ui-button primary" disabled={props.busy} onClick={props.onConfirm} type="button">
              {operationLabel} with these choices{summary ? ` (${summary})` : ""}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
