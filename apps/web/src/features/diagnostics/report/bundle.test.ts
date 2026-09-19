import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { DIAGNOSTICS_SCHEMA_VERSION, isDiagnosticsSessionRecord, type DiagnosticsSessionRecord } from "../model";
import { buildBugReportBundle, estimateReportBundle } from "./bundle";
import { emptyBugReportForm } from "./reportModel";

const session = (id: string): DiagnosticsSessionRecord => ({
  version: DIAGNOSTICS_SCHEMA_VERSION,
  meta: { id, startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T01:00:00.000Z", endReason: "pagehide" },
  environment: {
    appBuild: "test-build",
    userAgent: "agent",
    viewport: { width: 1280, height: 800 },
    colorScheme: "dark",
    onLine: true
  },
  events: [
    { kind: "error.uncaught", at: "2026-01-01T00:10:00.000Z", message: "boom" },
    { kind: "network.request", at: "2026-01-01T00:11:00.000Z", category: "files", method: "GET", route: "/api/files", durationMs: 9000, result: "5xx" },
    { kind: "app.visibility", at: "2026-01-01T00:12:00.000Z", state: "visible" }
  ]
});

const unzip = async (blob: Blob) => JSZip.loadAsync(blob);

describe("bug report bundle", () => {
  it("estimates preview contents from selected sessions", () => {
    const preview = estimateReportBundle([session("a"), session("b")]);
    expect(preview.sessionCount).toBe(2);
    expect(preview.eventCount).toBe(6);
    expect(preview.estimatedBytes).toBeGreaterThan(0);
    expect(preview.categories).toContain("Errors and performance");
    expect(preview.categories).toContain("Network operations");
    expect(preview.categories).toContain("Session lifecycle");
  });

  it("assembles a zip with markdown, json metadata, environment, and per-session logs", async () => {
    const bundle = await buildBugReportBundle({
      form: { ...emptyBugReportForm(), summary: "Upload hangs", whatHappened: "Spinner forever" },
      sessions: [session("sess-1")],
      generatedAt: "2026-01-02T03:04:05.000Z",
      appBuild: "test-build"
    });

    expect(bundle.filename).toBe("davora-bug-report-20260102030405.zip");
    expect(bundle.preview.sessionCount).toBe(1);

    const zip = await unzip(bundle.blob);
    const reportMd = await zip.file("report.md")?.async("string");
    const reportJson = await zip.file("report.json")?.async("string");
    const environmentJson = await zip.file("environment.json")?.async("string");
    const sessionJson = await zip.file("sessions/sess-1.json")?.async("string");

    expect(reportMd).toContain("Upload hangs");
    expect(reportMd).toContain("Spinner forever");
    expect(reportMd).toContain("test-build");
    expect(reportMd).toContain("error.uncaught");
    expect(reportMd).toContain("No file contents,");
    expect(reportMd).not.toContain("app.visibility");

    const meta: unknown = JSON.parse(reportJson ?? "{}");
    expect(meta).toMatchObject({ version: DIAGNOSTICS_SCHEMA_VERSION, sessionIds: ["sess-1"] });
    expect(JSON.parse(environmentJson ?? "{}")).toMatchObject({ userAgent: "agent" });
    const parsedSession: unknown = JSON.parse(sessionJson ?? "{}");
    expect(isDiagnosticsSessionRecord(parsedSession)).toBe(true);
    if (isDiagnosticsSessionRecord(parsedSession)) {
      expect(parsedSession.events).toHaveLength(3);
    }
  });

  it("supports text-only reports when no sessions are selected", async () => {
    const bundle = await buildBugReportBundle({
      form: { ...emptyBugReportForm(), summary: "UI glitch" },
      sessions: [],
      generatedAt: "2026-01-02T00:00:00.000Z",
      appBuild: "test-build"
    });
    expect(bundle.preview.sessionCount).toBe(0);
    const zip = await unzip(bundle.blob);
    const reportMd = await zip.file("report.md")?.async("string");
    expect(reportMd).toContain("UI glitch");
    expect(reportMd).toContain("_No environment snapshot recorded._");
    expect(zip.file("environment.json")).toBeNull();
  });
});
