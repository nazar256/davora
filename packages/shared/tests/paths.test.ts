import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  basename,
  dirname,
  normalizeRootPath,
  parseNormalizedPath,
  relativeToSandbox,
  resolveSandboxPath,
  resolveWithinSandbox,
  stripSandboxRoot,
  toDisplayPath,
  type NormalizedPath,
  type SandboxedPath
} from "../src/paths";

const controlCharacters = /[\u0000-\u001F\u007F]/;
const encodedSeparators = /%2f|%5c/i;
const validSegment = fc.string({ minLength: 1, maxLength: 16 }).filter((segment) =>
  segment.trim() === segment
  && !segment.includes("/")
  && !segment.includes("\\")
  && !controlCharacters.test(segment)
  && !encodedSeparators.test(segment)
  && segment !== "."
  && segment !== ".."
);
const validSegments = fc.array(validSegment, { minLength: 0, maxLength: 5 });

describe("path helpers", () => {
  it("normalizes safe root paths", () => {
    expect(normalizeRootPath("/team/docs/")) .toBe("team/docs");
    expect(toDisplayPath(normalizeRootPath("/team/docs/"))).toBe("/team/docs");
  });

  it("resolves sandboxed child paths", () => {
    expect(resolveSandboxPath("team/docs", "reports/q1.txt")).toBe("team/docs/reports/q1.txt");
    expect(stripSandboxRoot("team/docs", "team/docs/reports/q1.txt")).toBe("reports/q1.txt");
  });

  it("preserves literal percent characters in raw path segments", () => {
    expect(resolveSandboxPath("team/docs", "reports/100% complete.txt")).toBe("team/docs/reports/100% complete.txt");
    expect(stripSandboxRoot("team/docs", "team/docs/reports/bad%file.txt")).toBe("reports/bad%file.txt");
    expect(basename("team/docs/100% complete.txt")).toBe("100% complete.txt");
  });

  it("returns parent and base names", () => {
    expect(dirname("team/docs/report.txt")).toBe("team/docs");
    expect(basename("team/docs/report.txt")).toBe("report.txt");
  });

  it("rejects traversal and encoded separators", () => {
    expect(() => normalizeRootPath("../private")).toThrow(/traversal/i);
    expect(() => normalizeRootPath("notes%2Fhack")).toThrow(/separators/i);
  });

  it("keeps normalized and sandboxed paths distinct at compile time", () => {
    const root: NormalizedPath = parseNormalizedPath("team/docs");
    const child: NormalizedPath = parseNormalizedPath("reports/q1.txt");
    const full: SandboxedPath = resolveWithinSandbox(root, child);

    expect(relativeToSandbox(root, full)).toBe(child);
    if (false) {
      // @ts-expect-error raw strings must cross the parser boundary first
      resolveWithinSandbox("team/docs", child);
      // @ts-expect-error a normalized child is not proven to be sandboxed
      relativeToSandbox(root, child);
    }
  });

  it("normalizes idempotently and round-trips children through the same sandbox", () => {
    fc.assert(fc.property(validSegments, validSegments, (rootSegments, childSegments) => {
      const rawRoot = `///${rootSegments.join("//")}///`;
      const rawChild = `//${childSegments.join("//")}//`;
      const root = parseNormalizedPath(rawRoot);
      const child = parseNormalizedPath(rawChild);
      const full = resolveWithinSandbox(root, child);

      expect(parseNormalizedPath(root)).toBe(root);
      expect(parseNormalizedPath(child)).toBe(child);
      expect(relativeToSandbox(root, full)).toBe(child);
    }), { numRuns: 200, seed: 424242 });
  });

  it("reconstructs non-empty normalized paths from dirname and basename", () => {
    fc.assert(fc.property(fc.array(validSegment, { minLength: 1, maxLength: 5 }), (segments) => {
      const normalized = parseNormalizedPath(segments.join("/"));
      const reconstructed = [dirname(normalized), basename(normalized)].filter(Boolean).join("/");

      expect(reconstructed).toBe(normalized);
    }), { numRuns: 200, seed: 424243 });
  });

  it("rejects unrelated and prefix-only sandbox roots", () => {
    expect(() => stripSandboxRoot("team/a", "team/ab/report.txt")).toThrow(/escapes/i);
    expect(() => stripSandboxRoot("team/a/longer", "team/a")).toThrow(/escapes/i);
  });

  it("preserves Unicode, emoji, encoded dots, and ordinary literal percent text", () => {
    expect(parseNormalizedPath("資料/😀 100%/notes%2e%2e.txt")).toBe("資料/😀 100%/notes%2e%2e.txt");
  });

  it("rejects encoded separators in every casing plus backslashes, controls, and dot segments", () => {
    fc.assert(fc.property(fc.constantFrom("%2f", "%2F", "%5c", "%5C"), (separator) => {
      expect(() => parseNormalizedPath(`safe/name${separator}child`)).toThrow(/separators/i);
    }), { numRuns: 40, seed: 424244 });

    for (const invalidPath of ["safe\\child", "safe/\u0000child", "safe/./child", "safe/../child"]) {
      expect(() => parseNormalizedPath(invalidPath)).toThrow();
    }
  });
});
