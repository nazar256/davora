import React from "react";

export type TransferKind = "upload" | "download";
export type TransferPhase = "queued" | "preparing" | "transferring" | "done" | "error";

export interface TransferTask {
  id: string;
  kind: TransferKind;
  label: string;
  phase: TransferPhase;
  loadedBytes: number;
  totalBytes?: number;
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
}

function formatPercent(loaded: number, total?: number): string | undefined {
  if (!total || !Number.isFinite(total) || total <= 0) {
    return undefined;
  }
  const ratio = Math.max(0, Math.min(1, loaded / total));
  return `${Math.round(ratio * 100)}%`;
}

function kindLabel(kind: TransferKind): string {
  return kind === "upload" ? "Upload" : "Download";
}

export function TransferTray(props: {
  tasks: TransferTask[];
  open: boolean;
  onToggleOpen: () => void;
  onClearFinished: () => void;
}) {
  const active = props.tasks.filter((t) => t.phase !== "done" && t.phase !== "error");
  const recent = props.tasks.slice(0, 8);
  const primary = active[0] ?? recent[0];
  const percent = primary ? formatPercent(primary.loadedBytes, primary.totalBytes) : undefined;
  const summary = primary
    ? `${kindLabel(primary.kind)}: ${primary.label}${percent ? ` (${percent})` : ""}`
    : "No transfers";

  return (
    <div className="transfer-tray">
      <button
        aria-expanded={props.open}
        aria-label="Transfers"
        className={`transfer-tray-button ${active.length > 0 ? "active" : ""}`}
        onClick={props.onToggleOpen}
        type="button"
      >
        <span className="transfer-tray-title">Transfers</span>
        <span className="transfer-tray-count">{active.length}</span>
        <span className="transfer-tray-summary">{summary}</span>
      </button>

      {props.open ? (
        <div aria-label="Transfer status" className="transfer-tray-popover" role="dialog">
          <div className="transfer-tray-popover-header">
            <div>
              <p className="eyebrow section-eyebrow">Transfers</p>
              <h2>Background transfers</h2>
            </div>
            <div className="panel-header-actions">
              <button onClick={props.onClearFinished} type="button">Clear finished</button>
              <button onClick={props.onToggleOpen} type="button">Close</button>
            </div>
          </div>

          {recent.length === 0 ? <p className="status">No transfers yet.</p> : null}
          {recent.length > 0 ? (
            <ul className="transfer-tray-list">
              {recent.map((task) => {
                const taskPercent = formatPercent(task.loadedBytes, task.totalBytes);
                const phaseLabel = task.phase === "transferring"
                  ? kindLabel(task.kind)
                  : task.phase === "preparing"
                    ? "Preparing"
                    : task.phase === "queued"
                      ? "Queued"
                      : task.phase === "done"
                        ? "Done"
                        : "Error";
                return (
                  <li key={task.id} className={`transfer-tray-item transfer-tray-item-${task.phase}`}>
                    <div className="transfer-tray-item-row">
                      <span className="transfer-tray-item-kind">{task.kind === "upload" ? "↑" : "↓"}</span>
                      <div className="transfer-tray-item-body">
                        <div className="transfer-tray-item-title">
                          <strong>{task.label}</strong>
                          <span className="status transfer-tray-item-phase">{phaseLabel}{taskPercent ? ` • ${taskPercent}` : ""}</span>
                        </div>
                        {task.totalBytes ? (
                          <div className="transfer-tray-meter">
                            <div className="transfer-tray-meter-bar" style={{ width: `${Math.max(0, Math.min(100, (task.loadedBytes / task.totalBytes) * 100))}%` }} />
                          </div>
                        ) : task.phase === "transferring" || task.phase === "preparing" ? (
                          <div className="transfer-tray-meter transfer-tray-meter-indeterminate">
                            <div className="transfer-tray-meter-bar" />
                          </div>
                        ) : null}
                        {task.errorMessage ? <p className="status transfer-tray-item-error">{task.errorMessage}</p> : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

