import { describe, expect, it } from "vitest";

import type { DiagnosticsSessionSummary } from "../model";
import { buildSessionPickerEntries, emptyBugReportForm } from "./reportModel";

const summary = (id: string, startedAt: string, eventCount = 3, endedAt?: string): DiagnosticsSessionSummary => ({
  id,
  startedAt,
  endedAt,
  eventCount,
  byteSize: 128,
  eventKinds: []
});

describe("bug report model", () => {
  it("produces an empty form", () => {
    expect(emptyBugReportForm()).toEqual({
      summary: "",
      whatHappened: "",
      expected: "",
      reproductionSteps: ""
    });
  });

  it("builds picker entries with labels, selection, and the current-session marker", () => {
    const entries = buildSessionPickerEntries(
      [
        summary("s-new", "2026-01-02T10:20:30.000Z", 5),
        summary("s-old", "2026-01-01T08:00:00.000Z", 1, "2026-01-01T09:00:00.000Z")
      ],
      "s-new",
      new Set(["s-old"])
    );

    expect(entries).toEqual([
      {
        id: "s-new",
        label: "Current session (2026-01-02 10:20:30)",
        detail: "5 events, in progress",
        selected: false,
        isCurrent: true
      },
      {
        id: "s-old",
        label: "2026-01-01 08:00:00",
        detail: "1 event, ended",
        selected: true,
        isCurrent: false
      }
    ]);
  });
});
