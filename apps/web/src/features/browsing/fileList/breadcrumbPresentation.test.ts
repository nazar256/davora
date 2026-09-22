import { describe, expect, it } from "vitest";

import { buildBreadcrumbs } from "../presentation";
import { foldFileListBreadcrumbs } from "./breadcrumbPresentation";

describe("foldFileListBreadcrumbs", () => {
  it("keeps short paths fully unfolded", () => {
    for (const path of ["", "a", "a/b", "a/b/c"]) {
      const items = buildBreadcrumbs(path);
      const nodes = foldFileListBreadcrumbs(items);
      expect(nodes).toHaveLength(items.length);
      expect(nodes.every((node) => node.kind === "item")).toBe(true);
      expect(nodes.map((node) => node.kind === "item" ? node.item.value : "ellipsis")).toEqual(items.map((item) => item.value));
    }
  });

  it.each([
    { path: "a/b/c/d", hidden: ["a/b"] },
    { path: "a/b/c/d/e", hidden: ["a/b", "a/b/c"] },
    { path: "a/b/c/d/e/f", hidden: ["a/b", "a/b/c", "a/b/c/d"] }
  ])("folds middle segments of $path under a single ellipsis", ({ path, hidden }) => {
    const items = buildBreadcrumbs(path);
    const nodes = foldFileListBreadcrumbs(items);
    const values = nodes.map((node) => node.kind === "ellipsis" ? "ellipsis" : node.item.value);

    expect(values).toEqual(["", "ellipsis", ...items.slice(-2).map((item) => item.value)]);
    for (const folded of hidden) {
      expect(values).not.toContain(folded);
    }
    expect(nodes.filter((node) => node.kind === "ellipsis")).toHaveLength(1);
  });
});
