import { describe, expect, it } from "vitest";

import {
  clampPdfZoom,
  getPdfTouchDistance,
  getPdfTouchMidpoint,
  resolveCssScale,
  resolveCurrentPageFromCenters,
  resolveFitPageScale,
  resolveFitWidthScale,
  resolveRenderedScaleFromCanvas
} from "./model";

describe("preview pdf model", () => {
  it("clamps custom zoom to the supported range", () => {
    expect(clampPdfZoom(0.1)).toBe(0.5);
    expect(clampPdfZoom(1.5)).toBe(1.5);
    expect(clampPdfZoom(8)).toBe(3);
  });

  it("resolves fit-width and fit-page scales from available space", () => {
    expect(resolveFitWidthScale(400, 200)).toBe(2);
    expect(resolveFitPageScale(400, 300, 200, 400)).toBe(0.75);
    expect(resolveFitWidthScale(100, 0)).toBe(3);
  });

  it("selects css scale from zoom mode", () => {
    expect(resolveCssScale("fit-width", 1, 1.2, 0.8)).toBe(1.2);
    expect(resolveCssScale("fit-page", 1, 1.2, 0.8)).toBe(0.8);
    expect(resolveCssScale("custom", 2.5, 1.2, 0.8)).toBe(2.5);
    expect(resolveCssScale("custom", 10, 1.2, 0.8)).toBe(3);
  });

  it("uses the first two touch points for distance and midpoint", () => {
    expect(getPdfTouchDistance([])).toBe(0);
    expect(getPdfTouchDistance([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 99, y: 99 }])).toBe(5);
    expect(getPdfTouchMidpoint([{ x: 0, y: 0 }])).toBeUndefined();
    expect(getPdfTouchMidpoint([{ x: 0, y: 2 }, { x: 4, y: 6 }])).toEqual({ x: 2, y: 4 });
  });

  it("resolves the nearest page from viewport and page centers", () => {
    expect(resolveCurrentPageFromCenters(150, [50, 150, 250])).toBe(2);
    expect(resolveCurrentPageFromCenters(10, [50, 150, 250])).toBe(1);
    expect(resolveCurrentPageFromCenters(999, [])).toBe(1);
  });

  it("derives rendered scale from canvas width and page width", () => {
    expect(resolveRenderedScaleFromCanvas(200, 100, 1)).toBe(2);
    expect(resolveRenderedScaleFromCanvas(200, 0, 1.25)).toBe(1.25);
    expect(resolveRenderedScaleFromCanvas(1000, 100, 1)).toBe(3);
  });
});
