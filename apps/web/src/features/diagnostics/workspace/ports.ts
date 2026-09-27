import type { ChromeSurfacesSnapshot } from "../../navigation";
import type { TransferTask } from "../../transfers";
import type { DiagnosticActionName, RedactedPathRef } from "../model";
import type { DiagnosticEventInput, DiagnosticsRuntimePorts } from "../ports";
import type { BugReportForm, ReportBundlePreview, ReportSessionPickerEntry } from "../report/reportModel";
import type { DiagnosticReportReceipt } from "@davora/shared";

/** Context values the diagnostics recorder observes and diffs into events. */
export interface DiagnosticsObservedContext {
  readonly accountId?: string;
  readonly sessionState?: string;
  readonly backendKind?: string;
  readonly currentPath: string;
  readonly searchActive: boolean;
  readonly searchResultCount?: number;
  readonly browserOffline: boolean;
  readonly explicitOfflineMode: boolean;
  readonly workerUnavailable: boolean;
  readonly themeMode: string;
  readonly chrome: ChromeSurfacesSnapshot;
  readonly transferTasks: readonly TransferTask[];
}

export interface DiagnosticsNavigationPort {
  readonly reportBugOpen: boolean;
  readonly openReportBugSurface: () => void;
  readonly closeReportBugSurface: () => void;
}

export interface DiagnosticsWorkspaceInput {
  readonly enabled: boolean;
  readonly appBuild: string;
  readonly sessionToken?: string;
  /**
   * Live context accessor: the composition root assigns the current snapshot
   * every render, so the recorder always diffs the freshest values even for
   * workspaces created after this hook.
   */
  readonly getContext: () => DiagnosticsObservedContext;
  readonly ports: DiagnosticsRuntimePorts;
  readonly navigation: DiagnosticsNavigationPort;
  readonly announce: (message: string) => void;
}

export interface DiagnosticsSettingsSectionProps {
  readonly active: boolean;
  readonly storageSummary?: string;
  readonly onClearData: () => void;
  readonly onOpenReport: () => void;
}

/** Ready-to-render descriptor the future quick-action menu (PER-85) consumes. */
export interface ReportBugQuickActionItem {
  readonly id: "report-bug";
  readonly label: "Report bug";
  readonly icon: "bug";
  readonly visible: boolean;
  readonly onSelect: () => void;
}

export interface ReportBugStageBinding {
  readonly open: boolean;
  readonly sessions: readonly ReportSessionPickerEntry[];
  readonly preview: ReportBundlePreview | undefined;
  readonly canShare: boolean;
  readonly canUpload: boolean;
  readonly exporting: boolean;
  readonly exportError?: string;
  readonly uploadReceipt?: DiagnosticReportReceipt;
  readonly onClose: () => void;
  readonly onToggleSession: (sessionId: string) => void;
  readonly onExport: (form: BugReportForm, mode: "download" | "share") => void;
  readonly onUpload: (form: BugReportForm) => void;
}

export interface DiagnosticsWorkspaceCommands {
  readonly openReport: () => void;
  readonly closeReport: () => void;
  readonly clearData: () => void;
  readonly exportReport: (form: BugReportForm, mode: "download" | "share") => Promise<void>;
  readonly uploadReport: (form: BugReportForm) => Promise<void>;
  /** Emit an action event through the live recorder (no-op when disabled). */
  readonly recordAction: (action: DiagnosticActionName, detail?: Record<string, string | number | boolean>) => void;
  readonly recordActionResult: (
    action: DiagnosticActionName,
    outcome: "success" | "failure" | "cancelled" | "partial",
    durationMs?: number,
    errorKind?: string
  ) => void;
  /** Emit an arbitrary schema event (no-op when disabled). */
  readonly record: (event: DiagnosticEventInput) => void;
  /** Stable per-session path redaction; falls back to a plain alias when disabled. */
  readonly redactPath: (path: string, kind?: "file" | "folder") => RedactedPathRef;
}

export interface DiagnosticsWorkspace {
  readonly settingsSection: DiagnosticsSettingsSectionProps;
  readonly reportStage: ReportBugStageBinding;
  readonly reportBugQuickAction: ReportBugQuickActionItem;
  readonly commands: DiagnosticsWorkspaceCommands;
  readonly refreshStorageSummary: () => void;
}
