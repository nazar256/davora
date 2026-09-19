import { describe, expect, it } from "vitest";

import {
  evaluateFocusedSuiteTiming,
  evaluateWebRuntimeDominance,
  extractVitestFileDurations
} from "./test-timing";

describe("test timing quality gate", () => {
  it("accepts a focused suite only when its measured median and every repetition meet the limits", () => {
    expect(evaluateFocusedSuiteTiming([2_900, 2_100, 2_500])).toEqual({
      accepted: true,
      medianMs: 2_500,
      maximumMs: 2_900
    });
    expect(evaluateFocusedSuiteTiming([2_900, 3_100, 3_200]).accepted).toBe(false);
    expect(evaluateFocusedSuiteTiming([2_000, 2_100, 4_501]).accepted).toBe(false);
  });

  it("rejects a web profile when one file or the five slowest files dominate sequential runtime", () => {
    expect(evaluateWebRuntimeDominance([900, 900, 900, 900, 900, 5_500])).toMatchObject({
      accepted: false,
      dominantFileAccepted: false
    });
    expect(evaluateWebRuntimeDominance([700, 700, 700, 700, 700, 6_500])).toMatchObject({
      accepted: false,
      slowestFiveAccepted: false
    });
  });

  it("accepts a balanced profile and reports exact shares", () => {
    expect(evaluateWebRuntimeDominance(Array.from({ length: 20 }, () => 500))).toEqual({
      accepted: true,
      summedDurationMs: 10_000,
      maximumFileShare: 0.05,
      slowestFiveShare: 0.25,
      dominantFileAccepted: true,
      slowestFiveAccepted: true
    });
  });

  it("rejects missing, non-finite, and non-positive evidence", () => {
    expect(() => evaluateFocusedSuiteTiming([1_000, 2_000])).toThrow("three measured repetitions");
    expect(() => evaluateWebRuntimeDominance([])).toThrow("at least one test file");
    expect(() => evaluateWebRuntimeDominance([Number.NaN])).toThrow("finite positive");
  });

  it("extracts complete file durations from Vitest JSON and rejects incomplete reports", () => {
    expect(extractVitestFileDurations({
      success: true,
      testResults: [
        { name: "/repo/a.test.ts", startTime: 100, endTime: 350, status: "passed" },
        { name: "/repo/b.test.ts", startTime: 200, endTime: 700, status: "passed" }
      ]
    })).toEqual([
      { path: "/repo/a.test.ts", durationMs: 250 },
      { path: "/repo/b.test.ts", durationMs: 500 }
    ]);
    expect(() => extractVitestFileDurations({ success: false, testResults: [] })).toThrow("successful Vitest JSON");
    expect(() => extractVitestFileDurations({ success: true, testResults: [{ name: "x" }] })).toThrow("complete timing fields");
  });
});
