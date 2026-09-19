/**
 * Bug-report bundle builder. Produces a portable ZIP containing a
 * human-readable summary plus machine-readable session logs. All content is
 * already redacted at record time; this module only assembles the archive.
 */

import JSZip from "jszip";

import {
  DIAGNOSTICS_SCHEMA_VERSION,
  eventCategories,
  type DiagnosticsSessionRecord
} from "../model";
import { type BugReportForm, type ReportBundlePreview } from "./reportModel";

export interface BugReportBundleInput {
  readonly form: BugReportForm;
  readonly sessions: readonly DiagnosticsSessionRecord[];
  readonly generatedAt: string;
  readonly appBuild: string;
}

export interface BugReportBundle {
  readonly blob: Blob;
  readonly filename: string;
  readonly preview: ReportBundlePreview;
}

export const estimateReportBundle = (
  sessions: readonly DiagnosticsSessionRecord[]
): ReportBundlePreview => {
  const serializedBytes = sessions.reduce(
    (total, session) => total + JSON.stringify(session).length,
    0
  );
  return {
    sessionCount: sessions.length,
    eventCount: sessions.reduce((total, session) => total + session.events.length, 0),
    estimatedBytes: serializedBytes,
    categories: eventCategories(sessions.flatMap((session) => session.events.map((event) => event.kind)))
  };
};

const sanitizeFilenameTimestamp = (iso: string): string =>
  iso.replace(/[^0-9]/g, "").slice(0, 14);

const environmentMarkdown = (session: DiagnosticsSessionRecord | undefined): string => {
  const environment = session?.environment;
  if (!environment) {
    return "_No environment snapshot recorded._";
  }
  const rows: Array<[string, string]> = [
    ["App build", environment.appBuild],
    ["User agent", environment.userAgent],
    ["Platform", environment.platform ?? "unknown"],
    ["Language", environment.language ?? "unknown"],
    ["Viewport", environment.viewport ? `${environment.viewport.width}x${environment.viewport.height}` : "unknown"],
    ["Theme", environment.colorScheme ?? "unknown"],
    ["Display mode", environment.displayMode ?? "unknown"],
    ["Connection", environment.connectionEffectiveType ?? "unknown"],
    ["Online at capture", environment.onLine === undefined ? "unknown" : String(environment.onLine)],
    ["Service worker", environment.serviceWorkerControlled === undefined ? "unknown" : environment.serviceWorkerControlled ? "controlled" : "not controlled"]
  ];
  return rows.map(([key, value]) => `| ${key} | ${value} |`).join("\n");
};

const notableEventsMarkdown = (session: DiagnosticsSessionRecord): string => {
  const notable = session.events.filter((event) =>
    event.kind === "error.uncaught" || event.kind === "error.rejection" || event.kind === "error.reported"
      || (event.kind === "action.result" && (event.outcome === "failure" || event.outcome === "partial"))
      || (event.kind === "network.request" && (event.result === "5xx" || event.result === "network-error" || event.durationMs > 5000)));
  if (notable.length === 0) {
    return "_No errors or failures recorded in this session._";
  }
  return notable
    .slice(0, 200)
    .map((event) => `- \`${event.at}\` ${event.kind} — ${JSON.stringify(event)}`)
    .join("\n");
};

const buildReportMarkdown = (input: BugReportBundleInput): string => {
  const lines: string[] = [
    "# Davora bug report",
    "",
    `Generated: ${input.generatedAt}`,
    `App build: ${input.appBuild}`,
    `Schema version: ${DIAGNOSTICS_SCHEMA_VERSION}`,
    "",
    "## User description",
    "",
    `**Summary:** ${input.form.summary || "(none)"}`,
    "",
    `**What happened:** ${input.form.whatHappened || "(none)"}`,
    "",
    `**Expected behavior:** ${input.form.expected || "(none)"}`,
    "",
    `**Reproduction steps:** ${input.form.reproductionSteps || "(none)"}`,
    "",
    "## Environment",
    "",
    "| Field | Value |",
    "| --- | --- |",
    environmentMarkdown(input.sessions.at(-1)),
    "",
    "## Included sessions",
    "",
    ...input.sessions.map((session) =>
      `- \`${session.meta.id}\` started ${session.meta.startedAt}${session.meta.endedAt ? `, ended ${session.meta.endedAt}` : " (in progress)"} — ${session.events.length} events`),
    ""
  ];
  for (const session of input.sessions) {
    lines.push(
      `## Notable events — session ${session.meta.id.slice(0, 8)}`,
      "",
      notableEventsMarkdown(session),
      ""
    );
  }
  lines.push(
    "## Data included",
    "",
    "This bundle contains structured diagnostic events only. Paths and account",
    "identifiers are redacted to stable placeholders. No file contents,",
    "credentials, tokens, cookies, or request/response bodies are included.",
    ""
  );
  return lines.join("\n");
};

export const buildBugReportBundle = async (
  input: BugReportBundleInput
): Promise<BugReportBundle> => {
  const zip = new JSZip();
  zip.file("report.md", buildReportMarkdown(input));
  zip.file("report.json", JSON.stringify({
    version: DIAGNOSTICS_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    appBuild: input.appBuild,
    form: input.form,
    sessionIds: input.sessions.map((session) => session.meta.id)
  }, null, 2));
  const newest = input.sessions.at(-1);
  if (newest?.environment) {
    zip.file("environment.json", JSON.stringify(newest.environment, null, 2));
  }
  for (const session of input.sessions) {
    zip.file(`sessions/${session.meta.id}.json`, JSON.stringify(session, null, 2));
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return {
    blob,
    filename: `davora-bug-report-${sanitizeFilenameTimestamp(input.generatedAt)}.zip`,
    preview: estimateReportBundle(input.sessions)
  };
};
