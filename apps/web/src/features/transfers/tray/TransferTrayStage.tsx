import { ArrowDownToLine, ArrowUpFromLine, Copy, FolderInput, HardDriveDownload, RefreshCw, Trash2, X, XCircle } from "lucide-react";

import type { TransferTask } from "../model";
import { isActiveTransferTask } from "../model";
import { selectRecentTransfers } from "../selectors";
import {
  buildTransferTraySummary,
  formatTransferItemProgress,
  formatTransferPercent,
  transferPhaseLabel
} from "./presentation";

export interface TransferTrayStageProps {
  readonly tasks: readonly TransferTask[];
  readonly open: boolean;
  readonly onToggleOpen: () => void;
  readonly onClearFinished: () => void;
  readonly onRetryFailedSync?: (task: TransferTask) => void;
  readonly onCancelTransfer?: (task: TransferTask) => void;
  readonly onRetryTransfer?: (task: TransferTask) => void;
}

export function TransferTrayStage(props: TransferTrayStageProps) {
  const { activeCount, summary } = buildTransferTraySummary(props.tasks);
  const recent = selectRecentTransfers(props.tasks);
  const hasActive = activeCount > 0;

  return (
    <div className="transfer-tray">
      <button
        aria-expanded={props.open}
        aria-label="Transfers"
        className={`transfer-tray-button ${hasActive ? "active" : ""}`}
        onClick={props.onToggleOpen}
        type="button"
      >
        <ArrowDownToLine aria-hidden="true" className="transfer-tray-icon" />
        <span className="transfer-tray-title">Transfers</span>
        <span className="transfer-tray-count">{activeCount}</span>
        <span className="transfer-tray-summary">{summary}</span>
      </button>

      {props.open ? (
        <div aria-label="Transfer status" className="transfer-tray-popover" role="dialog">
          <div className="transfer-tray-popover-header">
            <h2>Transfers</h2>
            <div className="panel-header-actions">
              <button aria-label="Clear finished transfers" className="icon-button quiet-button" onClick={props.onClearFinished} title="Clear finished" type="button"><Trash2 aria-hidden="true" /></button>
              <button aria-label="Close transfer status" className="icon-button quiet-button" onClick={props.onToggleOpen} title="Close transfer status" type="button"><X aria-hidden="true" /></button>
            </div>
          </div>

          {recent.length === 0 ? <p className="status">No transfers yet.</p> : null}
          {recent.length > 0 ? (
            <ul className="transfer-tray-list">
              {recent.map((task) => {
                const taskPercent = formatTransferPercent(task.loadedBytes, task.totalBytes);
                const itemProgress = formatTransferItemProgress(task);
                const phaseLabel = transferPhaseLabel(task.phase, task.kind);
                const cancellable = isActiveTransferTask(task)
                  && (task.kind === "copy" || task.kind === "move")
                  && Boolean(props.onCancelTransfer);
                return (
                  <li key={task.id} className={`transfer-tray-item transfer-tray-item-${task.phase}`}>
                    <div className="transfer-tray-item-row">
                      <span className="transfer-tray-item-kind">{task.kind === "upload" ? <ArrowUpFromLine aria-hidden="true" /> : task.kind === "sync" ? <HardDriveDownload aria-hidden="true" /> : task.kind === "copy" ? <Copy aria-hidden="true" /> : task.kind === "move" ? <FolderInput aria-hidden="true" /> : <ArrowDownToLine aria-hidden="true" />}</span>
                      <div className="transfer-tray-item-body">
                        <div className="transfer-tray-item-title">
                          <strong>{task.label}</strong>
                          <span className="status transfer-tray-item-phase">{phaseLabel}{taskPercent ? ` • ${taskPercent}` : ""}</span>
                          {cancellable ? (
                            <button
                              aria-label={`Cancel ${task.label}`}
                              className="icon-button quiet-button transfer-tray-item-cancel"
                              onClick={() => props.onCancelTransfer?.(task)}
                              title="Cancel"
                              type="button"
                            >
                              <XCircle aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                        {itemProgress ? (
                          <p className="status transfer-tray-item-progress">{itemProgress}</p>
                        ) : null}
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
                        {task.failedFiles && task.failedFiles.length > 0 ? (
                          <>
                            <ul aria-label={`Failed files for ${task.label}`} className="transfer-tray-failure-list">
                              {task.failedFiles.map((failure) => (
                                <li key={`${failure.sourcePath}:${failure.error}`}>
                                  <code>{failure.sourcePath}</code>
                                  <span>{failure.error}</span>
                                </li>
                              ))}
                            </ul>
                            {task.kind === "sync" && props.onRetryFailedSync ? (
                              <button className="quiet-button button-with-icon" onClick={() => props.onRetryFailedSync?.(task)} type="button">
                                <RefreshCw aria-hidden="true" />Retry failed sync
                              </button>
                            ) : null}
                          </>
                        ) : null}
                        {(task.kind === "copy" || task.kind === "move")
                          && (task.phase === "error" || task.phase === "partial" || task.phase === "canceled")
                          && props.onRetryTransfer ? (
                            <button className="quiet-button button-with-icon" onClick={() => props.onRetryTransfer?.(task)} type="button">
                              <RefreshCw aria-hidden="true" />Retry
                            </button>
                          ) : null}
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
