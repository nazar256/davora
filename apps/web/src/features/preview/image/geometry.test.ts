import { describe, expect, it } from "vitest";

import {
  clampImageZoom,
  getRenderedImageContentRect,
  getTouchDistance,
  getTouchMidpoint,
  normalizeImageAnchor,
  resolveFillPan,
  resolveImageEdgeNavigationIntent
} from "./geometry";

describe("preview image geometry", () => {
  it("clamps custom zoom to the supported range", () => {
    expect(clampImageZoom(0.1)).toBe(0.25);
    expect(clampImageZoom(1.5)).toBe(1.5);
    expect(clampImageZoom(8)).toBe(4);
  });

  it("calculates fill and fit content rectangles at an object position", () => {
    const viewport = { left: 10, top: 20, width: 200, height: 100 };
    const naturalSize = { width: 100, height: 100 };

    expect(getRenderedImageContentRect(viewport, naturalSize, "fill")).toEqual({
      left: 10,
      top: -30,
      width: 200,
      height: 200
    });
    expect(getRenderedImageContentRect(viewport, naturalSize, "fit", { x: 100, y: 100 })).toEqual({
      left: 110,
      top: 20,
      width: 100,
      height: 100
    });
  });

  it("returns the viewport when there is no fit mode or usable natural size", () => {
    const viewport = { left: 10, top: 20, width: 200, height: 100 };

    expect(getRenderedImageContentRect(viewport, { width: 0, height: 100 }, "fill")).toEqual(viewport);
    expect(getRenderedImageContentRect(viewport, { width: 100, height: 100 })).toEqual(viewport);
  });

  it("normalizes and clamps zoom anchors, including degenerate dimensions", () => {
    expect(normalizeImageAnchor({ x: 60, y: 45 }, { left: 10, top: 20, width: 100, height: 50 })).toEqual({ x: 0.5, y: 0.5 });
    expect(normalizeImageAnchor({ x: -10, y: 90 }, { left: 0, top: 0, width: 100, height: 100 })).toEqual({ x: 0, y: 0.9 });
    expect(normalizeImageAnchor({ x: 4, y: 5 }, { left: 4, top: 5, width: 0, height: 0 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it("resolves fill drag pan from the pointer delta and keeps percentages bounded", () => {
    expect(resolveFillPan(
      { x: 50, y: 50 },
      { x: 100, y: 100 },
      { x: 150, y: 75 },
      { width: 200, height: 100 }
    )).toEqual({ x: 25, y: 75 });
    expect(resolveFillPan(
      { x: 5, y: 95 },
      { x: 0, y: 0 },
      { x: 1000, y: -1000 },
      { width: 0, height: 0 }
    )).toEqual({ x: 0, y: 100 });
  });

  it("uses the first two touch points for distance and midpoint", () => {
    expect(getTouchDistance([])).toBe(0);
    expect(getTouchDistance([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 99, y: 99 }])).toBe(5);
    expect(getTouchMidpoint([{ x: 0, y: 0 }])).toBeUndefined();
    expect(getTouchMidpoint([{ x: 0, y: 2 }, { x: 4, y: 6 }])).toEqual({ x: 2, y: 4 });
  });

  it("resolves only available edge navigation using the bounded 14 percent target", () => {
    expect(resolveImageEdgeNavigationIntent(71, 1_000, { previous: true, next: true })).toBe("previous");
    expect(resolveImageEdgeNavigationIntent(860, 1_000, { previous: true, next: true })).toBe("next");
    expect(resolveImageEdgeNavigationIntent(176, 2_000, { previous: true, next: true })).toBe("previous");
    expect(resolveImageEdgeNavigationIntent(177, 2_000, { previous: true, next: true })).toBeUndefined();
    expect(resolveImageEdgeNavigationIntent(1_824, 2_000, { previous: true, next: true })).toBe("next");
    expect(resolveImageEdgeNavigationIntent(10, 1_000, { previous: false, next: true })).toBeUndefined();
    expect(resolveImageEdgeNavigationIntent(990, 1_000, { previous: true, next: false })).toBeUndefined();
    expect(resolveImageEdgeNavigationIntent(500, 1_000, { previous: true, next: true })).toBeUndefined();
    expect(resolveImageEdgeNavigationIntent(10, 100, { previous: true, next: true })).toBe("previous");
    expect(resolveImageEdgeNavigationIntent(50, 100, { previous: true, next: true })).toBe("previous");
    expect(resolveImageEdgeNavigationIntent(50, 100, { previous: false, next: true })).toBe("next");
  });
});
