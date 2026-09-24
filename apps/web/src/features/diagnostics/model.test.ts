import { describe, expect, it } from "vitest";

import {
  DIAGNOSTICS_SCHEMA_VERSION,
  eventCategories,
  eventCategory,
  isDiagnosticEvent,
  isDiagnosticsSessionRecord,
  summarizeSessionRecord,
  summaryCategories,
  type DiagnosticsSessionRecord
} from "./model";

const baseRecord = (): DiagnosticsSessionRecord => ({
  version: DIAGNOSTICS_SCHEMA_VERSION,
  meta: { id: "session-1", startedAt: "2026-01-01T00:00:00.000Z" },
  events: []
});

const validRejectedEvent = () => ({
  kind: "folder.response.rejected",
  at: "2026-01-01T00:00:00.000Z",
  path: { alias: "path-1", depth: 1, kind: "folder" },
  rejection: {
    phase: "basename-mismatch",
    itemShape: {
      presentKeys: ["isFolder", "name", "path"],
      fieldTypes: { path: "string", name: "string", isFolder: "boolean" },
      pathDepth: 2,
      nameLength: 8,
      basenameComparison: {
        basenameLength: 8,
        equalAfterTrim: false,
        equalAfterNfc: false,
        equalIgnoringCase: true,
        firstDifferenceIndex: 0,
        basenameDifferenceCategory: "letter",
        nameDifferenceCategory: "letter"
      },
      flags: { hasControl: false, hasEdgeWhitespace: false, nonNfc: false }
    }
  }
});

describe("diagnostics model", () => {
  it("writes schema v2 while continuing to accept persisted v1 sessions", () => {
    expect(DIAGNOSTICS_SCHEMA_VERSION).toBe(2);
    expect(isDiagnosticsSessionRecord({ ...baseRecord(), version: 1 })).toBe(true);
  });

  it("accepts a well-formed empty session record", () => {
    expect(isDiagnosticsSessionRecord(baseRecord())).toBe(true);
  });

  it("rejects records with a foreign schema version", () => {
    expect(isDiagnosticsSessionRecord({ ...baseRecord(), version: 3 })).toBe(false);
    expect(isDiagnosticsSessionRecord({ ...baseRecord(), version: "1" })).toBe(false);
  });

  it("rejects non-objects, missing meta, and non-array event lists", () => {
    expect(isDiagnosticsSessionRecord(null)).toBe(false);
    expect(isDiagnosticsSessionRecord("record")).toBe(false);
    expect(isDiagnosticsSessionRecord({ ...baseRecord(), meta: undefined })).toBe(false);
    expect(isDiagnosticsSessionRecord({ ...baseRecord(), meta: { id: 7 } })).toBe(false);
    expect(isDiagnosticsSessionRecord({ ...baseRecord(), events: {} })).toBe(false);
  });

  it("rejects a record when any single event fails validation", () => {
    const record = {
      ...baseRecord(),
      events: [
        { kind: "app.visibility", at: "2026-01-01T00:00:00.000Z", state: "visible" },
        { kind: "navigation.folder", at: "2026-01-01T00:00:00.000Z", path: "raw-path" }
      ]
    };
    expect(isDiagnosticsSessionRecord(record)).toBe(false);
  });

  it("validates each event kind against its own shape", () => {
    const at = "2026-01-01T00:00:00.000Z";
    expect(isDiagnosticEvent({ kind: "app.visibility", at, state: "hidden" })).toBe(true);
    expect(isDiagnosticEvent({ kind: "app.visibility", at, state: "peeked" })).toBe(false);
    expect(isDiagnosticEvent({
      kind: "network.request", at, category: "files", method: "GET", route: "/api/files",
      durationMs: 12, result: "2xx"
    })).toBe(true);
    expect(isDiagnosticEvent({
      kind: "network.request", at, category: "files", method: "GET", route: "/api/files",
      durationMs: 12, result: "200"
    })).toBe(false);
    expect(isDiagnosticEvent({
      kind: "navigation.folder", at,
      path: { alias: "path-1", depth: 2, extension: "txt", kind: "file" }
    })).toBe(true);
    expect(isDiagnosticEvent({ kind: "unknown.kind", at })).toBe(false);
    expect(isDiagnosticEvent({ kind: "session.ended", at, reason: "crash", durationMs: 1 })).toBe(false);
    expect(isDiagnosticEvent({
      kind: "folder.response.rejected",
      at,
      path: { alias: "path-1", depth: 1, kind: "folder" },
      rejection: {
        phase: "item-schema",
        status: 200,
        contentType: "json",
        payloadBytes: 120,
        workerBuild: "abc123",
        apiContract: "2",
        itemIndex: 0,
        issues: [{ path: ["size"], code: "invalid_type", expectedType: "number", actualType: "string" }],
        itemShape: {
          presentKeys: ["isFolder", "name", "path", "size"],
          fieldTypes: { path: "string", name: "string", isFolder: "boolean", size: "string" },
          isFolder: false,
          pathDepth: 2,
          nameLength: 8,
          basenameComparison: {
            basenameLength: 8,
            equalAfterTrim: false,
            equalAfterNfc: false,
            equalIgnoringCase: true,
            firstDifferenceIndex: 0,
            basenameDifferenceCategory: "letter",
            nameDifferenceCategory: "letter"
          },
          flags: { hasControl: false, hasEdgeWhitespace: false, nonNfc: false }
        }
      }
    })).toBe(true);
    expect(isDiagnosticEvent({
      kind: "folder.response.rejected",
      at,
      path: { alias: "path-1", depth: 1, kind: "folder" },
      rejection: {
        phase: "basename-mismatch",
        itemShape: {
          presentKeys: ["isFolder", "name", "path"],
          fieldTypes: { path: "string", name: "string", isFolder: "boolean" },
          basenameComparison: { basenameLength: "8" },
          flags: { hasControl: false, hasEdgeWhitespace: false, nonNfc: false }
        }
      }
    })).toBe(false);
  });

  it.each([
    ["raw present key", (event: ReturnType<typeof validRejectedEvent>) => {
      event.rejection.itemShape.presentKeys.push("Docs/private-name.txt");
    }],
    ["raw field-type key", (event: ReturnType<typeof validRejectedEvent>) => {
      Object.assign(event.rejection.itemShape.fieldTypes, { "Docs/private-name.txt": "string" });
    }],
    ["extra item-shape field", (event: ReturnType<typeof validRejectedEvent>) => {
      Object.assign(event.rejection.itemShape, { rawPath: "Docs/private-name.txt" });
    }],
    ["extra comparison field", (event: ReturnType<typeof validRejectedEvent>) => {
      Object.assign(event.rejection.itemShape.basenameComparison, { rawName: "private-name.txt" });
    }],
    ["extra flags field", (event: ReturnType<typeof validRejectedEvent>) => {
      Object.assign(event.rejection.itemShape.flags, { rawName: "private-name.txt" });
    }],
    ["extra redacted-path field", (event: ReturnType<typeof validRejectedEvent>) => {
      Object.assign(event.path, { rawPath: "Docs/private-name.txt" });
    }],
    ["extra rejection field", (event: ReturnType<typeof validRejectedEvent>) => {
      Object.assign(event.rejection, { rawPath: "Docs/private-name.txt" });
    }],
    ["extra event field", (event: ReturnType<typeof validRejectedEvent>) => {
      Object.assign(event, { rawPath: "Docs/private-name.txt" });
    }]
  ])("rejects %s in folder rejection evidence", (_case, mutate) => {
    const event = validRejectedEvent();
    mutate(event);
    expect(isDiagnosticEvent(event)).toBe(false);
  });

  it.each([
    ["negative path depth", "pathDepth", -1],
    ["fractional name length", "nameLength", 1.5]
  ])("rejects %s", (_case, field, value) => {
    const event = validRejectedEvent();
    Object.assign(event.rejection.itemShape, { [field]: value });
    expect(isDiagnosticEvent(event)).toBe(false);
  });

  it("summarizes records with event kinds for report previews", () => {
    const record: DiagnosticsSessionRecord = {
      ...baseRecord(),
      events: [
        { kind: "app.visibility", at: "2026-01-01T00:00:00.000Z", state: "visible" },
        { kind: "app.visibility", at: "2026-01-01T00:00:01.000Z", state: "hidden" },
        { kind: "error.rejection", at: "2026-01-01T00:00:02.000Z", reasonKind: "unhandledrejection", message: "x" }
      ]
    };
    const summary = summarizeSessionRecord(record, 128);
    expect(summary).toEqual({
      id: "session-1",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: undefined,
      eventCount: 3,
      byteSize: 128,
      eventKinds: ["app.visibility", "error.rejection"]
    });
  });

  it("maps event kinds to stable display categories", () => {
    expect(eventCategory("network.request")).toBe("Network operations");
    expect(eventCategory("error.uncaught")).toBe("Errors and performance");
    expect(eventCategory("not-a-kind")).toBe("Other");
    expect(eventCategories(["network.request", "app.visibility", "error.uncaught", "network.request"]))
      .toEqual(["Errors and performance", "Network operations", "Session lifecycle"]);
    expect(summaryCategories([
      { id: "a", startedAt: "x", eventCount: 1, byteSize: 1, eventKinds: ["cache.event"] }
    ])).toEqual(["Cache, storage, and sync"]);
  });
});
