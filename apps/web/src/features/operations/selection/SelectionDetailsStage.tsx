import { Copy, Download, HardDriveDownload, Trash2, X } from "lucide-react";

import type { SelectionDetailsContent } from "./presentation";

export type {
  SelectionDetailsBatchSummary,
  SelectionDetailsContent,
  SelectionDetailsSingleItem,
  SelectionDetailsWorkspaceSummary
} from "./presentation";

export interface SelectionDetailsStageProps {
  readonly visible: boolean;
  readonly content: SelectionDetailsContent;
  readonly showMobileBatchBar: boolean;
  readonly showMobileSelectionSheet: boolean;
  readonly mobileSheetDetailsExpanded: boolean;
  readonly offline: boolean;
  readonly mutationBusy: boolean;
  readonly canDownloadSelected: boolean;
  readonly canSyncSelectedOffline: boolean;
  readonly selectedIsFavourite: boolean;
  readonly selectedFavouriteActionLabel: string;
  readonly canMoveSelected: boolean;
  readonly canCopySelected: boolean;
  readonly canDeleteSelected: boolean;
  readonly canDownloadBatchSelection: boolean;
  readonly canSyncBatchOffline: boolean;
  readonly canCopyMoveBatchSelection: boolean;
  readonly canDeleteBatchSelection: boolean;
  readonly onOpenSelected: () => void;
  readonly onDownloadSelected: () => void;
  readonly onKeepOfflineSelected: () => void;
  readonly onToggleFavourite: () => void;
  readonly onFolderShortcut: () => void;
  readonly onToggleMobileSheetDetails: () => void;
  readonly onRenameSelected: () => void;
  readonly onCopyMoveSelected: () => void;
  readonly onDeleteSelected: () => void;
  readonly onDownloadBatchSelection: () => void;
  readonly onKeepOfflineBatchSelection: () => void;
  readonly onCopyMoveBatchSelection: () => void;
  readonly onDeleteBatchSelection: () => void;
  readonly onClearBatchSelection: () => void;
  readonly onCloseMobileSelectionSheet: () => void;
  readonly onCollapseMobileSheetDetails: () => void;
}

function panelHeading(content: SelectionDetailsContent): string {
  if (content.kind === "single") {
    return content.item.panelHeading;
  }
  if (content.kind === "batch") {
    return "Selection";
  }
  return "Workspace details";
}

function panelAriaLabel(content: SelectionDetailsContent): string {
  if (content.kind === "single") {
    return content.item.ariaLabel;
  }
  if (content.kind === "batch") {
    return content.batch.ariaLabel;
  }
  return "Workspace details";
}

function SingleItemDetails(props: SelectionDetailsStageProps) {
  if (props.content.kind !== "single") {
    return null;
  }
  const item = props.content.item;

  return (
    <>
      <p className="selection-name">{item.name}</p>
      <p className="status details-path">{item.displayPath}</p>
      <p className="status details-selection-note">
        {item.includedInSelection ? "Included in current selection." : "Not included in current selection."}
      </p>
      <dl className="metadata context-metadata">
        <div>
          <dt>Kind</dt>
          <dd>{item.typeLabel}</dd>
        </div>
        <div>
          <dt>Modified</dt>
          <dd>{item.modifiedLabel}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{item.sizeLabel}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{item.displayPath}</dd>
        </div>
      </dl>
      <div className="context-action-group">
        <span className="action-group-label">Actions</span>
        <div className="context-actions">
          {item.canOpen ? <button onClick={props.onOpenSelected} type="button">Open</button> : null}
          {props.canDownloadSelected ? <button onClick={props.onDownloadSelected} type="button">Download</button> : null}
          <button disabled={!props.canSyncSelectedOffline} onClick={props.onKeepOfflineSelected} type="button">Keep offline</button>
          <button aria-pressed={props.selectedIsFavourite} onClick={props.onToggleFavourite} type="button">{props.selectedFavouriteActionLabel}</button>
          {item.isFolder ? <button onClick={props.onFolderShortcut} type="button">Folder shortcut</button> : null}
          {props.showMobileSelectionSheet ? (
            <button
              aria-label={props.mobileSheetDetailsExpanded ? "Back to actions" : "View details"}
              aria-pressed={props.mobileSheetDetailsExpanded}
              className="details-mode-toggle"
              onClick={props.onToggleMobileSheetDetails}
              type="button"
            >
              {props.mobileSheetDetailsExpanded ? "Actions" : "Details"}
            </button>
          ) : null}
          <button aria-label="Rename or move" disabled={!props.canMoveSelected || props.mutationBusy} onClick={props.onRenameSelected} type="button">Rename</button>
          <button disabled={!props.canCopySelected || !props.canMoveSelected || props.mutationBusy} onClick={props.onCopyMoveSelected} type="button">Copy or move</button>
          <button className={props.canDeleteSelected ? "button-danger" : undefined} disabled={!props.canDeleteSelected || props.mutationBusy} onClick={props.onDeleteSelected} type="button">Delete</button>
        </div>
      </div>
    </>
  );
}

function BatchDetails(props: SelectionDetailsStageProps) {
  if (props.content.kind !== "batch") {
    return null;
  }
  const batch = props.content.batch;

  return (
    <div className="details-summary">
      <p className="selection-name">{batch.countLabel}</p>
      <p className="status details-path">{batch.selectionLabel}</p>
      <dl className="metadata context-metadata">
        <div>
          <dt>Files</dt>
          <dd>{batch.fileCount}</dd>
        </div>
        <div>
          <dt>Folders</dt>
          <dd>{batch.folderCount}</dd>
        </div>
        <div>
          <dt>Known size</dt>
          <dd>{batch.sizeLabel}</dd>
        </div>
      </dl>
      <div className="context-action-group">
        <span className="action-group-label">Selection actions</span>
        <div className="context-actions">
          <button disabled={!props.canDownloadBatchSelection} onClick={props.onDownloadBatchSelection} type="button">Download selected</button>
          <button disabled={!props.canSyncBatchOffline} onClick={props.onKeepOfflineBatchSelection} type="button">Keep offline</button>
          <button disabled={!props.canCopyMoveBatchSelection || props.mutationBusy} onClick={props.onCopyMoveBatchSelection} type="button">Copy or move selected</button>
          <button className={props.canDeleteBatchSelection ? "button-danger" : undefined} disabled={!props.canDeleteBatchSelection || props.mutationBusy} onClick={props.onDeleteBatchSelection} type="button">Delete selected</button>
          <button className="quiet-button" onClick={props.onClearBatchSelection} type="button">Clear selection</button>
        </div>
      </div>
    </div>
  );
}

function WorkspaceDetails(props: SelectionDetailsStageProps) {
  if (props.content.kind !== "workspace") {
    return null;
  }
  const workspace = props.content.workspace;

  return (
    <div className="details-summary">
      <p className="selection-name">{workspace.folderLabel}</p>
      <dl className="metadata context-metadata">
        <div>
          <dt>Location</dt>
          <dd>{workspace.locationLabel}</dd>
        </div>
        <div>
          <dt>{workspace.itemsHeading}</dt>
          <dd>{workspace.itemsLabel}</dd>
        </div>
        {workspace.searchActive ? (
          <div>
            <dt>Search</dt>
            <dd>{workspace.searchQuery}</dd>
          </div>
        ) : null}
        <div>
          <dt>Mode</dt>
          <dd>{workspace.modeLabel}</dd>
        </div>
        {workspace.staleInfo ? (
          <div>
            <dt>Cached</dt>
            <dd>{workspace.staleInfo}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function MobileBatchBar(props: SelectionDetailsStageProps) {
  if (!props.showMobileBatchBar || props.content.kind !== "batch") {
    return null;
  }

  return (
    <div aria-label="Selection actions" className="mobile-batch-bar" role="toolbar">
      <span className="mobile-batch-summary">{props.content.batch.countLabel}</span>
      <button className="mobile-batch-action" disabled={!props.canDownloadBatchSelection} onClick={props.onDownloadBatchSelection} type="button"><Download aria-hidden="true" /><span>Download</span></button>
      <button className="mobile-batch-action" disabled={!props.canSyncBatchOffline} onClick={props.onKeepOfflineBatchSelection} type="button"><HardDriveDownload aria-hidden="true" /><span>Keep offline</span></button>
      <button aria-label="Copy or move selected" className="mobile-batch-action" disabled={!props.canCopyMoveBatchSelection || props.mutationBusy} onClick={props.onCopyMoveBatchSelection} type="button"><Copy aria-hidden="true" /><span>Copy/move</span></button>
      <button className={props.canDeleteBatchSelection ? "button-danger mobile-batch-action" : "mobile-batch-action"} disabled={!props.canDeleteBatchSelection || props.mutationBusy} onClick={props.onDeleteBatchSelection} title="Delete selected items" type="button"><Trash2 aria-hidden="true" /><span>Delete</span></button>
      <button className="quiet-button mobile-batch-action" onClick={props.onClearBatchSelection} title="Clear selection" type="button"><X aria-hidden="true" /><span>Clear</span></button>
    </div>
  );
}

export function SelectionDetailsStage(props: SelectionDetailsStageProps) {
  if (!props.visible && !props.showMobileBatchBar && !props.showMobileSelectionSheet) {
    return null;
  }

  return (
    <>
      <MobileBatchBar {...props} />

      {props.showMobileSelectionSheet ? (
        <button
          aria-label="Dismiss item actions"
          className="mobile-sheet-backdrop"
          onClick={props.onCloseMobileSelectionSheet}
          type="button"
        />
      ) : null}

      {props.visible ? (
        <aside className="workspace-rail">
          <section
            aria-label={panelAriaLabel(props.content)}
            className={`details-panel panel panel-subtle${props.showMobileSelectionSheet ? " details-panel-sheet-open" : ""}${props.showMobileSelectionSheet && props.mobileSheetDetailsExpanded ? " details-panel-sheet-details-open" : ""}`}
            data-mobile-hidden={props.showMobileSelectionSheet ? "false" : "true"}
            role={props.showMobileSelectionSheet ? "region" : undefined}
          >
            <div className="panel-header">
              <div>
                <p className="eyebrow section-eyebrow">Details</p>
                <h2>{panelHeading(props.content)}</h2>
              </div>
              {props.content.kind === "single" ? (
                props.showMobileSelectionSheet ? (
                  <div className="panel-header-actions">
                    {props.mobileSheetDetailsExpanded ? (
                      <button className="mobile-sheet-back-button" onClick={props.onCollapseMobileSheetDetails} type="button">
                        Actions
                      </button>
                    ) : null}
                    <span className={`operation-pill ${props.offline ? "disabled" : "enabled"}`}>{props.offline ? "Read-only" : "Actions"}</span>
                    <button
                      aria-label="Close item actions"
                      className="mobile-sheet-close-button"
                      onClick={props.onCloseMobileSelectionSheet}
                      type="button"
                    >
                      Close
                    </button>
                  </div>
                ) : <span className={`operation-pill ${props.offline ? "disabled" : "enabled"}`}>{props.offline ? "Read-only" : "Actions"}</span>
              ) : null}
            </div>

            {props.content.kind === "single" ? <SingleItemDetails {...props} /> : null}
            {props.content.kind === "batch" ? <BatchDetails {...props} /> : null}
            {props.content.kind === "workspace" ? <WorkspaceDetails {...props} /> : null}
          </section>
        </aside>
      ) : null}
    </>
  );
}
