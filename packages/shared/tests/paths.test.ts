import { describe, expect, it } from "vitest";

import { basename, dirname, normalizeRootPath, resolveSandboxPath, stripSandboxRoot, toDisplayPath } from "../src/index";

describe("path helpers", () => {
  it("normalizes safe root paths", () => {
    expect(normalizeRootPath("/team/docs/")) .toBe("team/docs");
    expect(toDisplayPath(normalizeRootPath("/team/docs/"))).toBe("/team/docs");
  });

  it("resolves sandboxed child paths", () => {
    expect(resolveSandboxPath("team/docs", "reports/q1.txt")).toBe("team/docs/reports/q1.txt");
    expect(stripSandboxRoot("team/docs", "team/docs/reports/q1.txt")).toBe("reports/q1.txt");
  });

  it("returns parent and base names", () => {
    expect(dirname("team/docs/report.txt")).toBe("team/docs");
    expect(basename("team/docs/report.txt")).toBe("report.txt");
  });

  it("rejects traversal and encoded separators", () => {
    expect(() => normalizeRootPath("../private")).toThrow(/traversal/i);
    expect(() => normalizeRootPath("notes%2Fhack")).toThrow(/separators/i);
  });
});
