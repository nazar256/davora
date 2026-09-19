import { describe, expect, it } from "vitest";

import { lintMessagesToDebtFindings } from "./lint-debt";

describe("lint debt findings", () => {
  it("uses stable semantic fields and the normalized offending source slice", () => {
    const findings = lintMessagesToDebtFindings("/repo", [{
      filePath: "/repo/apps/web/src/lib/api.ts",
      source: "const value = response   as   ApiResponse;\n",
      messages: [{
        ruleId: "@typescript-eslint/no-unsafe-type-assertion",
        message: "Unsafe type assertion.",
        messageId: "unsafeTypeAssertion",
        nodeType: "TSAsExpression",
        severity: 1,
        line: 1,
        column: 15,
        endLine: 1,
        endColumn: 42
      }]
    }]);

    expect(findings).toEqual([{
      ruleId: "@typescript-eslint/no-unsafe-type-assertion",
      path: "apps/web/src/lib/api.ts",
      nodeType: "TSAsExpression",
      messageId: "unsafeTypeAssertion",
      source: "response as ApiResponse"
    }]);
  });

  it("ignores hard failures and derives stable fallbacks when ESLint omits optional fields", () => {
    const findings = lintMessagesToDebtFindings("/repo", [{
      filePath: "/repo/apps/worker/src/app.ts",
      source: "void task();\n",
      messages: [
        {
          ruleId: "@typescript-eslint/no-floating-promises",
          message: "Promises must be awaited.",
          severity: 1,
          line: 1,
          column: 1
        },
        {
          ruleId: "@typescript-eslint/no-unused-vars",
          message: "'task' is unused.",
          severity: 2,
          line: 1,
          column: 6
        }
      ]
    }]);

    expect(findings).toEqual([{
      ruleId: "@typescript-eslint/no-floating-promises",
      path: "apps/worker/src/app.ts",
      nodeType: "unknown",
      messageId: "Promises must be awaited.",
      source: "void task();"
    }]);
  });
});
