import type { FormEvent } from "react";
import { Folder, House, RotateCw, X } from "lucide-react";
import type { FileEntry } from "@davora/shared";

import { buildBreadcrumbs, getLocationLabel, sortAndGroupEntries } from "../../browsing";
import { useModalFocusBoundary } from "../../../components/useModalFocusBoundary";
import type { DestinationActionKind, DestinationOperation } from "./model";

export interface DestinationPickerStageProps {
  readonly open: boolean;
  readonly kind: DestinationActionKind;
  readonly sourceEntries: readonly FileEntry[];
  readonly batch: boolean;
  readonly folderPath: string;
  readonly entries: readonly FileEntry[];
  readonly name: string;
  readonly manualPath: string;
  readonly manualMode: boolean;
  readonly busy: boolean;
  readonly copyAllowed: boolean;
  readonly moveAllowed: boolean;
  readonly loading: boolean;
  readonly error?: string;
  readonly actionError?: string;
  readonly validationMessage?: string;
  readonly onClose: () => void;
  readonly onSubmit: (operation: DestinationOperation, event?: FormEvent<HTMLFormElement>) => void;
  readonly onFolderChange: (path: string) => void;
  readonly onNameChange: (value: string) => void;
  readonly onManualModeChange: (value: boolean) => void;
  readonly onManualPathChange: (value: string) => void;
  readonly onReload: () => void;
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

function destinationPickerTitle(kind: DestinationActionKind, batch: boolean, sourceCount: number): string {
  if (batch) {
    return `Copy or move ${pluralize(sourceCount, "item")}`;
  }
  if (kind === "copyMove") {
    return "Copy or move item";
  }
  if (kind === "copy") {
    return "Copy item";
  }
  return "Move item";
}

function destinationPickerSubmitLabel(kind: DestinationActionKind): string {
  return kind === "move" ? "Move here" : "Copy here";
}

function ErrorBanner(props: { readonly message: string }) {
  return <p className="banner-state error">{props.message}</p>;
}

export function DestinationPickerStage(props: DestinationPickerStageProps) {
  const dialogRef = useModalFocusBoundary<HTMLElement>(props.open);
  if (!props.open) {
    return null;
  }

  const title = destinationPickerTitle(props.kind, props.batch, props.sourceEntries.length);
  const submitLabel = destinationPickerSubmitLabel(props.kind);
  const defaultOperation: DestinationOperation = props.kind === "move" ? "move" : "copy";
  const folders = sortAndGroupEntries(props.entries.filter((entry) => entry.isFolder), "name-asc");
  const submitDisabled = props.busy || props.loading || Boolean(props.validationMessage) || Boolean(props.error);
  const operationDisabled = (operation: DestinationOperation) => submitDisabled
    || (operation === "copy" ? !props.copyAllowed : !props.moveAllowed);

  return (
    <div className="modal-scrim" onClick={(event) => dismissOnScrimClick(event, props.onClose)} role="presentation">
      <section ref={dialogRef} aria-label={title} aria-modal="true" className="dialog-card panel destination-picker-dialog" role="dialog" tabIndex={-1}>
        <div className="dialog-header destination-picker-header">
          <h2>{title}</h2>
          <div className="dialog-header-actions">
            <button aria-label="Refresh destination folders" className="icon-button quiet-button" disabled={props.busy || props.loading} onClick={props.onReload} title="Refresh folders" type="button"><RotateCw aria-hidden="true" /></button>
            <button aria-label="Close destination picker" className="icon-button quiet-button" onClick={props.onClose} title="Close" type="button"><X aria-hidden="true" /></button>
          </div>
        </div>
        <form className="destination-picker-form" onSubmit={(event) => props.onSubmit(defaultOperation, event)}>
          <div className="destination-picker-scroll">
            <div className="destination-summary">
              <p><span className="summary-label">From</span> {props.batch ? `${pluralize(props.sourceEntries.length, "selected item")}` : props.sourceEntries[0]?.path}</p>
              {props.batch ? <p className="destination-source-paths">{props.sourceEntries.map((entry) => entry.path).join(", ")}</p> : null}
              <p><span className="summary-label">To</span> {getLocationLabel(props.folderPath)}</p>
            </div>
            {props.actionError ? <ErrorBanner message={props.actionError} /> : null}
            {props.error ? <ErrorBanner message={props.error} /> : null}
            {props.validationMessage ? <ErrorBanner message={props.validationMessage} /> : null}
          {!props.batch ? (
            <label>
              Destination name
              <input
                aria-label="Destination name"
                disabled={props.busy || props.manualMode}
                onChange={(event) => props.onNameChange(event.target.value)}
                value={props.name}
              />
            </label>
          ) : null}
          <nav aria-label="Destination folder path" className="breadcrumbs destination-breadcrumbs">
            {buildBreadcrumbs(props.folderPath).map((item) => (
              <span className="breadcrumb-segment" key={item.value || "home"}>
                <button
                  aria-label={item.ariaLabel}
                  aria-current={item.value === props.folderPath ? "page" : undefined}
                  disabled={props.busy || props.loading || item.value === props.folderPath}
                  onClick={() => props.onFolderChange(item.value)}
                  type="button"
                >
                  {item.value ? item.label : <House aria-hidden="true" />}
                </button>
                {item.value !== props.folderPath ? <span aria-hidden="true" className="breadcrumb-separator">/</span> : null}
              </span>
            ))}
          </nav>
          <div className="destination-folder-list" role="group" aria-label="Destination folders">
            {props.loading ? <p className="status">Loading folders...</p> : null}
            {!props.loading && folders.length === 0 ? <p className="status">No folders in this destination.</p> : null}
            {folders.map((folder) => (
              <button
                aria-label={`Open destination folder ${folder.name}`}
                disabled={props.busy}
                key={folder.path}
                onClick={() => props.onFolderChange(folder.path)}
                type="button"
              >
                <span aria-hidden="true" className="item-icon"><Folder /></span>
                <span>{folder.name}</span>
              </button>
            ))}
          </div>
          <div className="destination-manual-path">
            <button
              aria-expanded={props.manualMode}
              className="quiet-button"
              disabled={props.busy}
              onClick={() => props.onManualModeChange(!props.manualMode)}
              type="button"
            >
              Manual path
            </button>
            {props.manualMode ? (
              <label>
                {props.batch ? "Full destination folder path" : "Full destination path"}
                <input
                  aria-label={props.batch ? "Full destination folder path" : "Full destination path"}
                  disabled={props.busy}
                  onChange={(event) => props.onManualPathChange(event.target.value)}
                  value={props.manualPath}
                />
              </label>
            ) : null}
          </div>
          </div>
          <div className="dialog-actions destination-picker-actions">
            <button className="quiet-button" onClick={props.onClose} type="button">Cancel</button>
            {props.kind === "copyMove" ? (
              <>
                <button className="ui-button primary" disabled={operationDisabled("copy")} onClick={() => props.onSubmit("copy")} type="button">Copy here</button>
                <button className="ui-button primary destination-move-button" disabled={operationDisabled("move")} onClick={() => props.onSubmit("move")} type="button">Move here</button>
              </>
            ) : <button className="ui-button primary" disabled={operationDisabled(defaultOperation)} onClick={() => props.onSubmit(defaultOperation)} type="button">{submitLabel}</button>}
          </div>
        </form>
      </section>
    </div>
  );
}
