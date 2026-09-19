export interface FocusedSuiteTimingResult {
  readonly accepted: boolean;
  readonly medianMs: number;
  readonly maximumMs: number;
}

export interface WebRuntimeDominanceResult {
  readonly accepted: boolean;
  readonly summedDurationMs: number;
  readonly maximumFileShare: number;
  readonly slowestFiveShare: number;
  readonly dominantFileAccepted: boolean;
  readonly slowestFiveAccepted: boolean;
}

export interface VitestFileTiming {
  readonly path: string;
  readonly durationMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractVitestFileDurations(report: unknown): readonly VitestFileTiming[] {
  if (!isRecord(report) || report.success !== true || !Array.isArray(report.testResults) || report.testResults.length === 0) {
    throw new Error("Test timing requires a successful Vitest JSON report with test results.");
  }
  return report.testResults.map((result) => {
    if (!isRecord(result)
      || typeof result.name !== "string"
      || typeof result.startTime !== "number"
      || typeof result.endTime !== "number"
      || result.status !== "passed") {
      throw new Error("Every Vitest result must contain complete timing fields and pass.");
    }
    const durationMs = result.endTime - result.startTime;
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error("Every Vitest result must have a finite positive duration.");
    }
    return { path: result.name, durationMs };
  });
}

function assertDurations(durationsMs: readonly number[], evidenceName: string): void {
  if (durationsMs.length === 0) throw new Error(`${evidenceName} requires at least one test file.`);
  if (durationsMs.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
    throw new Error(`${evidenceName} durations must be finite positive numbers.`);
  }
}

export function evaluateFocusedSuiteTiming(durationsMs: readonly number[]): FocusedSuiteTimingResult {
  if (durationsMs.length !== 3) throw new Error("Focused suite timing requires exactly three measured repetitions.");
  assertDurations(durationsMs, "Focused suite timing");
  const sorted = [...durationsMs].sort((left, right) => left - right);
  const medianMs = sorted[1];
  const maximumMs = sorted[2];
  return {
    accepted: medianMs <= 3_000 && maximumMs <= 4_500,
    medianMs,
    maximumMs
  };
}

export function evaluateWebRuntimeDominance(durationsMs: readonly number[]): WebRuntimeDominanceResult {
  assertDurations(durationsMs, "Web runtime dominance");
  const descending = [...durationsMs].sort((left, right) => right - left);
  const summedDurationMs = descending.reduce((total, duration) => total + duration, 0);
  const maximumFileShare = descending[0] / summedDurationMs;
  const slowestFiveShare = descending.slice(0, 5).reduce((total, duration) => total + duration, 0) / summedDurationMs;
  const dominantFileAccepted = maximumFileShare <= 0.1;
  const slowestFiveAccepted = slowestFiveShare < 0.35;
  return {
    accepted: dominantFileAccepted && slowestFiveAccepted,
    summedDurationMs,
    maximumFileShare,
    slowestFiveShare,
    dominantFileAccepted,
    slowestFiveAccepted
  };
}
