import { describe, expect, it } from "vitest";

import {
  buildBreadcrumbs,
  buildBrowseStatusLabel,
  formatBrowseCount,
  getFolderLabel,
  getLocationLabel,
  getSearchDisplayQuery,
  isSearchActive
} from "./presentation";

describe("browsing presentation", () => {
  it.each([
    ["", "", false],
    ["   \t\n", "", false],
    ["  Plan  ", "Plan", true],
    ["  Plan  Q3: 100% 📁  ", "Plan  Q3: 100% 📁", true]
  ])("derives display and active search state from %j", (rawQuery, displayQuery, active) => {
    expect(getSearchDisplayQuery(rawQuery)).toBe(displayQuery);
    expect(isSearchActive(rawQuery)).toBe(active);
  });

  it("builds the root breadcrumb", () => {
    expect(buildBreadcrumbs("")).toEqual([
      { label: "Home", ariaLabel: "Go to home folder", value: "" }
    ]);
  });

  it("builds cumulative breadcrumbs without changing segment text", () => {
    expect(buildBreadcrumbs("Projects/資料 100%/Q3: 📁")).toEqual([
      { label: "Home", ariaLabel: "Go to home folder", value: "" },
      { label: "Projects", ariaLabel: "Go to /Projects", value: "Projects" },
      { label: "資料 100%", ariaLabel: "Go to /Projects/資料 100%", value: "Projects/資料 100%" },
      { label: "Q3: 📁", ariaLabel: "Go to /Projects/資料 100%/Q3: 📁", value: "Projects/資料 100%/Q3: 📁" }
    ]);
  });

  it("returns fresh breadcrumb data without mutating prior results", () => {
    const first = buildBreadcrumbs("Projects/Plans");
    const second = buildBreadcrumbs("Projects/Plans");

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second[1]).not.toBe(first[1]);
  });

  it.each([
    ["", "Home", "/"],
    ["Projects", "Projects", "/Projects"],
    ["Projects/資料 100%/Q3: 📁", "Q3: 📁", "/Projects/資料 100%/Q3: 📁"]
  ])("formats folder and location labels for %j", (path, folderLabel, locationLabel) => {
    expect(getFolderLabel(path)).toBe(folderLabel);
    expect(getLocationLabel(path)).toBe(locationLabel);
  });

  it.each([
    [0, "item", "0 items"],
    [1, "item", "1 item"],
    [2, "item", "2 items"],
    [0, "result", "0 results"],
    [1, "result", "1 result"],
    [2, "result", "2 results"]
  ] as const)("formats %i %s counts", (count, kind, expected) => {
    expect(formatBrowseCount(count, kind)).toBe(expected);
  });

  it.each([
    [{ count: 0, path: "", rawSearchQuery: "" }, "0 items in /"],
    [{ count: 1, path: "Projects", rawSearchQuery: "" }, "1 item in /Projects"],
    [{ count: 0, path: "", rawSearchQuery: "  Plan  " }, "0 results for “Plan” in /"],
    [{ count: 2, path: "Projects/資料", rawSearchQuery: "  Plan  Q3  " }, "2 results for “Plan  Q3” in /Projects/資料"]
  ])("builds the exact browse status for $expected", (input, expected) => {
    expect(buildBrowseStatusLabel(input)).toBe(expected);
  });
});
