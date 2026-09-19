/**
 * Pure report-flow model: form contract, session-picker entries, and the
 * pre-export summary the user reviews before generating a bundle.
 */

import type { DiagnosticsSessionSummary } from "../model";

export interface BugReportForm {
  readonly summary: string;
  readonly whatHappened: string;
  readonly expected: string;
  readonly reproductionSteps: string;
}

export const emptyBugReportForm = (): BugReportForm => ({
  summary: "",
  whatHappened: "",
  expected: "",
  reproductionSteps: ""
});

export interface ReportSessionPickerEntry {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly selected: boolean;
  readonly isCurrent: boolean;
}

export interface ReportBundlePreview {
  readonly sessionCount: number;
  readonly eventCount: number;
  readonly estimatedBytes: number;
  readonly categories: readonly string[];
}

const formatSessionLabel = (summary: DiagnosticsSessionSummary, isCurrent: boolean): string => {
  const time = summary.startedAt.slice(11, 19);
  const date = summary.startedAt.slice(0, 10);
  return isCurrent ? `Current session (${date} ${time})` : `${date} ${time}`;
};

export const buildSessionPickerEntries = (
  sessions: readonly DiagnosticsSessionSummary[],
  currentSessionId: string | undefined,
  selectedIds: ReadonlySet<string>
): readonly ReportSessionPickerEntry[] =>
  sessions.map((summary) => {
    const isCurrent = summary.id === currentSessionId;
    return {
      id: summary.id,
      label: formatSessionLabel(summary, isCurrent),
      detail: `${summary.eventCount} event${summary.eventCount === 1 ? "" : "s"}, ${summary.endedAt ? "ended" : "in progress"}`,
      selected: selectedIds.has(summary.id),
      isCurrent
    };
  });
