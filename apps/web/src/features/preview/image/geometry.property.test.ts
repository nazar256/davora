import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  clampImageZoom,
  getRenderedImageContentRect,
  getTouchDistance,
  getTouchMidpoint,
  normalizeImageAnchor,
  resolveFillPan,
  resolveImageEdgeNavigationIntent,
  type ImageFitMode,
  type ImagePoint,
  type ImageRect,
  type ImageSize
} from "./geometry";

const PROPERTY_OPTIONS = { numRuns: 250, seed: 20260831 } as const;

const finiteNumberArb = fc.double({
  min: -1_000,
  max: 1_000,
  noNaN: true,
  noDefaultInfinity: true
});
const inRangeZoomArb = fc.double({
  min: 0.25,
  max: 4,
  noNaN: true,
  noDefaultInfinity: true
});
const coordinateArb = fc.double({
  min: -500,
  max: 500,
  noNaN: true,
  noDefaultInfinity: true
});
const positiveDimensionArb = fc.double({
  min: 0.25,
  max: 1_000,
  noNaN: true,
  noDefaultInfinity: true
});
const nonPositiveDimensionArb = fc.double({
  min: -100,
  max: 0,
  noNaN: true,
  noDefaultInfinity: true
});
const unitArb = fc.double({
  min: 0,
  max: 1,
  noNaN: true,
  noDefaultInfinity: true
});
const percentageArb = fc.double({
  min: 0,
  max: 100,
  noNaN: true,
  noDefaultInfinity: true
});

const pointArb: fc.Arbitrary<ImagePoint> = fc.record({
  x: coordinateArb,
  y: coordinateArb
});
const positiveSizeArb: fc.Arbitrary<ImageSize> = fc.record({
  width: positiveDimensionArb,
  height: positiveDimensionArb
});
const viewportArb: fc.Arbitrary<ImageRect> = fc.record({
  left: coordinateArb,
  top: coordinateArb,
  width: positiveDimensionArb,
  height: positiveDimensionArb
});
const objectPositionArb: fc.Arbitrary<ImagePoint> = fc.record({
  x: percentageArb,
  y: percentageArb
});
const fitModeArb: fc.Arbitrary<ImageFitMode> = fc.constantFrom("fit", "fill");
const unusableNaturalSizeArb: fc.Arbitrary<ImageSize> = fc.oneof(
  fc.record({ width: nonPositiveDimensionArb, height: positiveDimensionArb }),
  fc.record({ width: positiveDimensionArb, height: nonPositiveDimensionArb }),
  fc.record({ width: nonPositiveDimensionArb, height: nonPositiveDimensionArb })
);
const availabilityArb = fc.record({
  previous: fc.boolean(),
  next: fc.boolean()
});

function expectClose(actual: number, expected: number, tolerance = 1e-9): void {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance * scale);
}

function expectPointClose(actual: ImagePoint, expected: ImagePoint): void {
  expectClose(actual.x, expected.x);
  expectClose(actual.y, expected.y);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("preview image geometry property characterization", () => {
  if (process.env.DAVORA_IMAGE_GEOMETRY_FAILING_FIRST === "1") {
    it("failing-first sentinel isolates the zoom lower-bound oracle", () => {
      expect(clampImageZoom(0.25)).toBe(0.5);
    });
  }

  it("keeps zoom clamping bounded, idempotent, and monotone", () => {
    fc.assert(fc.property(finiteNumberArb, finiteNumberArb, (first, second) => {
      const firstClamped = clampImageZoom(first);
      const secondClamped = clampImageZoom(second);

      expect(firstClamped).toBeGreaterThanOrEqual(0.25);
      expect(firstClamped).toBeLessThanOrEqual(4);
      expect(clampImageZoom(firstClamped)).toBe(firstClamped);
      if (first <= second) {
        expect(firstClamped).toBeLessThanOrEqual(secondClamped);
      }
    }), PROPERTY_OPTIONS);
  });

  it("leaves supported in-range zoom values unchanged", () => {
    expect(clampImageZoom(0.25)).toBe(0.25);
    expect(clampImageZoom(1.5)).toBe(1.5);
    expect(clampImageZoom(4)).toBe(4);

    fc.assert(fc.property(inRangeZoomArb, (value) => {
      expect(clampImageZoom(value)).toBe(value);
    }), PROPERTY_OPTIONS);
  });

  it("preserves aspect-ratio fit/fill contracts and affine object-position alignment", () => {
    fc.assert(fc.property(
      viewportArb,
      positiveSizeArb,
      fitModeArb,
      objectPositionArb,
      (viewport, naturalSize, fitMode, objectPosition) => {
        const widthScale = viewport.width / naturalSize.width;
        const heightScale = viewport.height / naturalSize.height;
        const scale = fitMode === "fill" ? Math.max(widthScale, heightScale) : Math.min(widthScale, heightScale);
        const expected = {
          left: viewport.left + (viewport.width - naturalSize.width * scale) * (objectPosition.x / 100),
          top: viewport.top + (viewport.height - naturalSize.height * scale) * (objectPosition.y / 100),
          width: naturalSize.width * scale,
          height: naturalSize.height * scale
        };
        const rendered = getRenderedImageContentRect(viewport, naturalSize, fitMode, objectPosition);

        expectClose(rendered.left, expected.left);
        expectClose(rendered.top, expected.top);
        expectClose(rendered.width, expected.width);
        expectClose(rendered.height, expected.height);
        expectClose(rendered.width / rendered.height, naturalSize.width / naturalSize.height);
        if (fitMode === "fit") {
          expect(rendered.width).toBeLessThanOrEqual(viewport.width + 1e-9);
          expect(rendered.height).toBeLessThanOrEqual(viewport.height + 1e-9);
        } else {
          expect(rendered.width).toBeGreaterThanOrEqual(viewport.width - 1e-9);
          expect(rendered.height).toBeGreaterThanOrEqual(viewport.height - 1e-9);
        }

        const leftAtZero = getRenderedImageContentRect(viewport, naturalSize, fitMode, { x: 0, y: objectPosition.y }).left;
        const leftAtOneHundred = getRenderedImageContentRect(viewport, naturalSize, fitMode, { x: 100, y: objectPosition.y }).left;
        const topAtZero = getRenderedImageContentRect(viewport, naturalSize, fitMode, { x: objectPosition.x, y: 0 }).top;
        const topAtOneHundred = getRenderedImageContentRect(viewport, naturalSize, fitMode, { x: objectPosition.x, y: 100 }).top;
        expectClose(rendered.left, leftAtZero + (leftAtOneHundred - leftAtZero) * (objectPosition.x / 100));
        expectClose(rendered.top, topAtZero + (topAtOneHundred - topAtZero) * (objectPosition.y / 100));
      }
    ), PROPERTY_OPTIONS);
  });

  it("returns the original viewport for missing fit mode or unusable natural dimensions", () => {
    fc.assert(fc.property(
      viewportArb,
      unusableNaturalSizeArb,
      fitModeArb,
      (viewport, naturalSize, fitMode) => {
        const before = clone(viewport);
        expect(getRenderedImageContentRect(viewport, naturalSize, fitMode)).toEqual(viewport);
        expect(viewport).toEqual(before);
      }
    ), PROPERTY_OPTIONS);

    fc.assert(fc.property(viewportArb, positiveSizeArb, (viewport, naturalSize) => {
      const before = clone(viewport);
      expect(getRenderedImageContentRect(viewport, naturalSize)).toEqual(viewport);
      expect(viewport).toEqual(before);
    }), PROPERTY_OPTIONS);
  });

  it("uses the explicit centered object-position for 50 percent", () => {
    expect(getRenderedImageContentRect(
      { left: 10, top: 20, width: 100, height: 200 },
      { width: 200, height: 100 },
      "fit",
      { x: 50, y: 50 }
    )).toEqual({ left: 10, top: 95, width: 100, height: 50 });
  });

  it("round-trips anchors inside positive rectangles and clamps outside anchors", () => {
    fc.assert(fc.property(viewportArb, unitArb, unitArb, (rect, x, y) => {
      const anchor = { x: rect.left + rect.width * x, y: rect.top + rect.height * y };
      expectPointClose(normalizeImageAnchor(anchor, rect), { x, y });
    }), PROPERTY_OPTIONS);

    fc.assert(fc.property(viewportArb, pointArb, (rect, anchor) => {
      const normalized = normalizeImageAnchor(anchor, rect);
      expect(normalized.x).toBeGreaterThanOrEqual(0);
      expect(normalized.x).toBeLessThanOrEqual(1);
      expect(normalized.y).toBeGreaterThanOrEqual(0);
      expect(normalized.y).toBeLessThanOrEqual(1);
    }), PROPERTY_OPTIONS);
  });

  it("uses the centered anchor for each degenerate axis", () => {
    fc.assert(fc.property(
      coordinateArb,
      coordinateArb,
      nonPositiveDimensionArb,
      positiveDimensionArb,
      pointArb,
      (left, top, width, height, anchor) => {
        const normalized = normalizeImageAnchor(anchor, { left, top, width, height });
        expect(normalized.x).toBe(0.5);
        expect(normalized.y).toBeGreaterThanOrEqual(0);
        expect(normalized.y).toBeLessThanOrEqual(1);
      }
    ), PROPERTY_OPTIONS);

    fc.assert(fc.property(
      coordinateArb,
      coordinateArb,
      positiveDimensionArb,
      nonPositiveDimensionArb,
      pointArb,
      (left, top, width, height, anchor) => {
        const normalized = normalizeImageAnchor(anchor, { left, top, width, height });
        expect(normalized.x).toBeGreaterThanOrEqual(0);
        expect(normalized.x).toBeLessThanOrEqual(1);
        expect(normalized.y).toBe(0.5);
      }
    ), PROPERTY_OPTIONS);
  });

  it("keeps fill-pan percentages bounded and applies inverse pointer displacement", () => {
    const panArb = fc.record({ x: percentageArb, y: percentageArb });
    const viewportSizeArb: fc.Arbitrary<ImageSize> = fc.record({
      width: fc.double({ min: -50, max: 500, noNaN: true, noDefaultInfinity: true }),
      height: fc.double({ min: -50, max: 500, noNaN: true, noDefaultInfinity: true })
    });

    fc.assert(fc.property(panArb, pointArb, pointArb, viewportSizeArb, (startPan, startPointer, currentPointer, viewport) => {
      const actual = resolveFillPan(startPan, startPointer, currentPointer, viewport);
      const expected = {
        x: Math.max(0, Math.min(100, startPan.x - ((currentPointer.x - startPointer.x) / Math.max(viewport.width, 1)) * 100)),
        y: Math.max(0, Math.min(100, startPan.y - ((currentPointer.y - startPointer.y) / Math.max(viewport.height, 1)) * 100))
      };

      expectPointClose(actual, expected);
      expect(actual.x).toBeGreaterThanOrEqual(0);
      expect(actual.x).toBeLessThanOrEqual(100);
      expect(actual.y).toBeGreaterThanOrEqual(0);
      expect(actual.y).toBeLessThanOrEqual(100);
      expectPointClose(resolveFillPan(startPan, startPointer, startPointer, viewport), startPan);
    }), PROPERTY_OPTIONS);
  });

  it("uses only the first two touches while preserving distance and midpoint geometry", () => {
    fc.assert(fc.property(pointArb, pointArb, fc.array(pointArb, { maxLength: 4 }), (first, second, extra) => {
      const expectedDistance = Math.hypot(first.x - second.x, first.y - second.y);
      const distance = getTouchDistance([first, second, ...extra]);
      expectClose(distance, expectedDistance);
      expectClose(getTouchDistance([second, first]), expectedDistance);
      expectClose(getTouchDistance([first, second, ...extra, ...extra]), distance);
      expect(getTouchDistance([first])).toBe(0);

      const expectedMidpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2
      };
      const midpoint = getTouchMidpoint([first, second, ...extra]);
      expect(midpoint).toBeDefined();
      if (midpoint) {
        expectPointClose(midpoint, expectedMidpoint);
      }
      expectPointClose(getTouchMidpoint([second, first])!, expectedMidpoint);
      expect(getTouchMidpoint([first])).toBeUndefined();
      expect(getTouchMidpoint([])).toBeUndefined();
    }), PROPERTY_OPTIONS);
  });

  it("is translation-invariant for touch distance and translation-equivariant for midpoint", () => {
    fc.assert(fc.property(pointArb, pointArb, pointArb, (first, second, translation) => {
      const translatedFirst = { x: first.x + translation.x, y: first.y + translation.y };
      const translatedSecond = { x: second.x + translation.x, y: second.y + translation.y };
      expectClose(getTouchDistance([translatedFirst, translatedSecond]), getTouchDistance([first, second]));

      const midpoint = getTouchMidpoint([first, second]);
      const translatedMidpoint = getTouchMidpoint([translatedFirst, translatedSecond]);
      expect(midpoint).toBeDefined();
      expect(translatedMidpoint).toBeDefined();
      if (midpoint && translatedMidpoint) {
        expectPointClose(translatedMidpoint, {
          x: midpoint.x + translation.x,
          y: midpoint.y + translation.y
        });
      }
    }), PROPERTY_OPTIONS);
  });

  it("applies inclusive bounded edge thresholds and availability priority", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 3_000 }),
      fc.integer({ min: -100, max: 3_100 }),
      availabilityArb,
      (viewportWidth, clientX, availability) => {
        const edgeWidth = Math.max(72, Math.min(176, viewportWidth * 0.14));
        const expected = clientX <= edgeWidth && availability.previous
          ? "previous"
          : clientX >= viewportWidth - edgeWidth && availability.next
            ? "next"
            : undefined;
        expect(resolveImageEdgeNavigationIntent(clientX, viewportWidth, availability)).toBe(expected);
      }
    ), PROPERTY_OPTIONS);
  });

  it("locks minimum, maximum, narrow-overlap, and exact boundary examples", () => {
    const available = { previous: true, next: true };

    expect(resolveImageEdgeNavigationIntent(72, 72 / 0.14, available)).toBe("previous");
    expect(resolveImageEdgeNavigationIntent(176, 176 / 0.14, available)).toBe("previous");
    expect(resolveImageEdgeNavigationIntent(72, 500, available)).toBe("previous");
    expect(resolveImageEdgeNavigationIntent(73, 500, available)).toBeUndefined();
    expect(resolveImageEdgeNavigationIntent(428, 500, available)).toBe("next");
    expect(resolveImageEdgeNavigationIntent(176, 2_000, available)).toBe("previous");
    expect(resolveImageEdgeNavigationIntent(177, 2_000, available)).toBeUndefined();
    expect(resolveImageEdgeNavigationIntent(1_824, 2_000, available)).toBe("next");
    expect(resolveImageEdgeNavigationIntent(50, 100, available)).toBe("previous");
    expect(resolveImageEdgeNavigationIntent(50, 100, { previous: false, next: true })).toBe("next");
    expect(resolveImageEdgeNavigationIntent(50, 100, { previous: false, next: false })).toBeUndefined();
    expect(resolveImageEdgeNavigationIntent(500, 1_000, available)).toBeUndefined();
  });

  it("does not mutate geometry inputs and deterministically repeats equivalent calls", () => {
    fc.assert(fc.property(
      viewportArb,
      positiveSizeArb,
      objectPositionArb,
      pointArb,
      pointArb,
      pointArb,
      fc.array(pointArb, { maxLength: 4 }),
      fitModeArb,
      availabilityArb,
      (viewport, naturalSize, objectPosition, startPan, startPointer, currentPointer, touches, fitMode, availability) => {
        const before = {
          viewport: clone(viewport),
          naturalSize: clone(naturalSize),
          objectPosition: clone(objectPosition),
          startPan: clone(startPan),
          startPointer: clone(startPointer),
          currentPointer: clone(currentPointer),
          touches: clone(touches),
          availability: clone(availability)
        };

        const firstResults = {
          rect: getRenderedImageContentRect(viewport, naturalSize, fitMode, objectPosition),
          anchor: normalizeImageAnchor(currentPointer, getRenderedImageContentRect(viewport, naturalSize, fitMode, objectPosition)),
          pan: resolveFillPan(startPan, startPointer, currentPointer, viewport),
          distance: getTouchDistance(touches),
          midpoint: getTouchMidpoint(touches),
          intent: resolveImageEdgeNavigationIntent(currentPointer.x, viewport.width, availability)
        };
        const secondResults = {
          rect: getRenderedImageContentRect(clone(viewport), clone(naturalSize), fitMode, clone(objectPosition)),
          anchor: normalizeImageAnchor(clone(currentPointer), getRenderedImageContentRect(clone(viewport), clone(naturalSize), fitMode, clone(objectPosition))),
          pan: resolveFillPan(clone(startPan), clone(startPointer), clone(currentPointer), clone(viewport)),
          distance: getTouchDistance(clone(touches)),
          midpoint: getTouchMidpoint(clone(touches)),
          intent: resolveImageEdgeNavigationIntent(currentPointer.x, viewport.width, clone(availability))
        };

        expect(viewport).toEqual(before.viewport);
        expect(naturalSize).toEqual(before.naturalSize);
        expect(objectPosition).toEqual(before.objectPosition);
        expect(startPan).toEqual(before.startPan);
        expect(startPointer).toEqual(before.startPointer);
        expect(currentPointer).toEqual(before.currentPointer);
        expect(touches).toEqual(before.touches);
        expect(availability).toEqual(before.availability);
        expect(secondResults.rect).toEqual(firstResults.rect);
        expectPointClose(secondResults.anchor, firstResults.anchor);
        expectPointClose(secondResults.pan, firstResults.pan);
        expectClose(secondResults.distance, firstResults.distance);
        expect(secondResults.midpoint).toEqual(firstResults.midpoint);
        expect(secondResults.intent).toBe(firstResults.intent);
      }
    ), PROPERTY_OPTIONS);
  });
});
