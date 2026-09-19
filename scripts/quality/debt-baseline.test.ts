import { describe, expect, it } from "vitest";

import {
  compareDebtBaseline,
  createDebtBaseline,
  pruneDebtBaseline,
  type DebtFinding
} from "./debt-baseline";

const finding = (overrides: Partial<DebtFinding> = {}): DebtFinding => ({
  ruleId: "quality/no-unsafe-boundary",
  path: "apps/web/src/App.tsx",
  nodeType: "AsExpression",
  messageId: "unsafeAssertion",
  source: "response   as   ApiResponse",
  ...overrides
});

describe("debt baseline", () => {
  it("normalizes source whitespace and counts duplicate fingerprints", () => {
    const baseline = createDebtBaseline([
      finding(),
      finding({ source: "response as ApiResponse" })
    ]);

    expect(baseline.entries).toEqual([
      expect.objectContaining({ count: 2, source: "response as ApiResponse" })
    ]);
  });

  it("fails exact comparison for additions and removals", () => {
    const baseline = createDebtBaseline([finding()]);

    expect(compareDebtBaseline(baseline, [finding(), finding({ path: "apps/web/src/lib/api.ts" })]))
      .toMatchObject({ matches: false, additions: [{ count: 1 }], removals: [] });
    expect(compareDebtBaseline(baseline, []))
      .toMatchObject({ matches: false, additions: [], removals: [{ count: 1 }] });
  });

  it("allows prune-only updates and refuses additions", () => {
    const original = createDebtBaseline([
      finding(),
      finding({ path: "apps/web/src/lib/api.ts" })
    ]);

    expect(pruneDebtBaseline(original, [finding()]).entries).toHaveLength(1);
    expect(() => pruneDebtBaseline(original, [
      finding(),
      finding({ path: "apps/worker/src/app.ts" })
    ])).toThrow(/cannot add debt/i);
  });
});
