import { Bug, Download, Send, Share2, X } from "lucide-react";
import type { DiagnosticReportReceipt } from "@davora/shared";
import { useState } from "react";

import { useModalFocusBoundary } from "../../../components/useModalFocusBoundary";
import type { FileSizeDisplayMode } from "../../../lib/fileSize";
import { formatFileSize } from "../../../lib/fileSize";
import {
  emptyBugReportForm,
  BUG_REPORT_FIELD_LIMITS,
  type BugReportForm,
  type ReportBundlePreview,
  type ReportSessionPickerEntry
} from "./reportModel";

export interface ReportBugStageProps {
  readonly open: boolean;
  readonly sessions: readonly ReportSessionPickerEntry[];
  readonly preview: ReportBundlePreview | undefined;
  readonly canShare: boolean;
  readonly canUpload: boolean;
  readonly exporting: boolean;
  readonly exportError?: string;
  readonly uploadReceipt?: DiagnosticReportReceipt;
  readonly fileSizeDisplayMode: FileSizeDisplayMode;
  readonly onClose: () => void;
  readonly onToggleSession: (sessionId: string) => void;
  readonly onExport: (form: BugReportForm, mode: "download" | "share") => void;
  readonly onUpload: (form: BugReportForm) => void;
}

const formatBytes = (bytes: number, mode: FileSizeDisplayMode): string =>
  formatFileSize(bytes, mode);

export function ReportBugStage(props: ReportBugStageProps) {
  const dialogRef = useModalFocusBoundary<HTMLElement>(props.open, props.onClose);
  const [form, setForm] = useState<BugReportForm>(emptyBugReportForm);
  if (!props.open) {
    return null;
  }

  const update = (patch: Partial<BugReportForm>) => {
    setForm((previous) => ({ ...previous, ...patch }));
  };

  const noLogs = props.sessions.length === 0;
  const nothingSelected = props.sessions.every((session) => !session.selected);
  const previewCategories = props.preview?.categories ?? [];

  return (
    <div
      className="modal-scrim report-bug-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
      role="presentation"
    >
      <section
        ref={dialogRef}
        aria-label="Report a bug"
        aria-modal="true"
        className="dialog-card panel report-bug-dialog"
        role="dialog"
        tabIndex={-1}
      >
        <div className="settings-dialog-header">
          <div className="settings-dialog-heading">
            <h2>
              <Bug aria-hidden="true" className="report-bug-heading-icon" />
              Report a bug
            </h2>
          </div>
          <button
            aria-label="Close bug report"
            className="quiet-button icon-button"
            onClick={props.onClose}
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="report-bug-body">
          <label className="stacked-field">
            <span className="summary-label">Summary</span>
            <input
              aria-label="Bug summary"
              maxLength={BUG_REPORT_FIELD_LIMITS.summary}
              onChange={(event) => update({ summary: event.currentTarget.value })}
              placeholder="Short description of the problem"
              type="text"
              value={form.summary}
            />
          </label>
          <label className="stacked-field">
            <span className="summary-label">What happened?</span>
            <textarea
              aria-label="What happened"
              maxLength={BUG_REPORT_FIELD_LIMITS.whatHappened}
              onChange={(event) => update({ whatHappened: event.currentTarget.value })}
              placeholder="Describe what you saw"
              rows={3}
              value={form.whatHappened}
            />
          </label>
          <label className="stacked-field">
            <span className="summary-label">What did you expect?</span>
            <textarea
              aria-label="Expected behavior"
              maxLength={BUG_REPORT_FIELD_LIMITS.expected}
              onChange={(event) => update({ expected: event.currentTarget.value })}
              placeholder="Describe what should have happened"
              rows={2}
              value={form.expected}
            />
          </label>
          <label className="stacked-field">
            <span className="summary-label">Reproduction steps (optional)</span>
            <textarea
              aria-label="Reproduction steps"
              maxLength={BUG_REPORT_FIELD_LIMITS.reproductionSteps}
              onChange={(event) => update({ reproductionSteps: event.currentTarget.value })}
              placeholder="Steps that trigger the problem"
              rows={2}
              value={form.reproductionSteps}
            />
          </label>

          <section className="report-bug-sessions">
            <p className="summary-label">Diagnostic logs to include</p>
            {noLogs ? (
              <p className="status">No diagnostic logs are available. Your report will include the text above only.</p>
            ) : (
              <ul className="report-bug-session-list">
                {props.sessions.map((session) => (
                  <li key={session.id}>
                    <label className="report-bug-session-row">
                      <input
                        aria-label={`Include ${session.label}`}
                        checked={session.selected}
                        onChange={() => props.onToggleSession(session.id)}
                        type="checkbox"
                      />
                      <span className="report-bug-session-label">{session.label}</span>
                      <span className="status">{session.detail}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="report-bug-preview" data-testid="report-bug-preview">
            <p className="summary-label">Report contents</p>
            {nothingSelected ? (
              <p className="status">No diagnostic logs selected — the report will contain your description only.</p>
            ) : props.preview ? (
              <dl className="metadata context-metadata">
                <div>
                  <dt>Sessions</dt>
                  <dd>{props.preview.sessionCount}</dd>
                </div>
                <div>
                  <dt>Events</dt>
                  <dd>{props.preview.eventCount}</dd>
                </div>
                <div>
                  <dt>Approx. size</dt>
                  <dd>{formatBytes(props.preview.estimatedBytes, props.fileSizeDisplayMode)}</dd>
                </div>
                <div>
                  <dt>Categories</dt>
                  <dd>{previewCategories.length > 0 ? previewCategories.join(", ") : "None recorded"}</dd>
                </div>
              </dl>
            ) : null}
            <p className="status">
              Logs stay on this device and contain no file contents, credentials, or request bodies.
              Paths are replaced with placeholders. Nothing is uploaded automatically.
            </p>
            <p className="status">
              Send report uploads this ZIP to Davora&apos;s secure diagnostic inbox for up to 30 days.
              Download and Share keep their existing local behavior.
            </p>
          </section>

          {props.uploadReceipt ? (
            <p className="status" role="status">
              Report sent. ID: {props.uploadReceipt.reportId}. It expires after {props.uploadReceipt.expiresAfterDays} days.
            </p>
          ) : null}

          {props.exportError ? (
            <p className="status report-bug-error" role="alert">
              The report could not be generated ({props.exportError}). Your logs were kept; try again.
            </p>
          ) : null}
        </div>

        <div className="context-actions report-bug-actions">
          <button className="quiet-button" onClick={props.onClose} type="button">Cancel</button>
          {props.canShare ? (
            <button
              disabled={props.exporting}
              onClick={() => props.onExport(form, "share")}
              type="button"
            >
              <Share2 aria-hidden="true" />
              Share report
            </button>
          ) : null}
          <button
            disabled={props.exporting || !props.canUpload}
            onClick={() => props.onUpload(form)}
            type="button"
          >
            <Send aria-hidden="true" />
            {props.exporting ? "Preparing…" : "Send report"}
          </button>
          <button
            disabled={props.exporting}
            onClick={() => props.onExport(form, "download")}
            type="button"
          >
            <Download aria-hidden="true" />
            {props.exporting ? "Preparing…" : "Download report"}
          </button>
        </div>
      </section>
    </div>
  );
}
