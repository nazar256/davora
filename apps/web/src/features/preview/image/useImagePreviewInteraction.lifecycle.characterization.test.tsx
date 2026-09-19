// @vitest-environment jsdom

import { StrictMode } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  SyntheticEvent,
  Touch,
  TouchEvent as ReactTouchEvent,
  TouchList,
  WheelEvent as ReactWheelEvent
} from "react";

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImagePreviewStage } from "./ImagePreviewStage";
import {
  useImagePreviewInteraction,
  type ImagePreviewInteraction,
  type ImagePreviewStageBindings
} from "./useImagePreviewInteraction";

interface ImageSource {
  readonly blobUrl?: string;
  readonly enabled: boolean;
  readonly path?: string;
}

interface ImageLifecycleHarnessProps {
  readonly fitMode?: "fill" | "fit";
  readonly mediaGeneration?: number;
  readonly onFitModeChange?: (mode: "fill" | "fit") => void;
  readonly onNext?: () => void;
  readonly onPrevious?: () => void;
  readonly expose?: (interaction: ImagePreviewInteraction) => void;
  readonly source: ImageSource;
}

function ImageLifecycleHarness({
  expose,
  fitMode = "fill",
  mediaGeneration = 0,
  onFitModeChange = vi.fn(),
  onNext,
  onPrevious,
  source
}: ImageLifecycleHarnessProps) {
  const interaction = useImagePreviewInteraction({ source, fitMode, onFitModeChange });
  expose?.(interaction);
  const hasImage = source.enabled && Boolean(source.path && source.blobUrl);
  return (
    <>
      <output data-testid="failed">{String(interaction.failed)}</output>
      <output data-testid="custom-zoom">{String(interaction.stage.hasCustomZoom)}</output>
      <output data-testid="image-width">{interaction.stage.imageStyle?.width ?? ""}</output>
      <output data-testid="image-position">{interaction.stage.imageStyle?.objectPosition ?? ""}</output>
      {hasImage ? (
        <div key={mediaGeneration}>
          <ImagePreviewStage
            alt="photo"
            fitMode={fitMode}
            interaction={interaction.stage}
            onNext={onNext}
            onPrevious={onPrevious}
            src={source.blobUrl ?? ""}
          />
        </div>
      ) : null}
    </>
  );
}

const sourceA: ImageSource = { enabled: true, path: "Photos/alpha.jpg", blobUrl: "blob:alpha" };
const sourceB: ImageSource = { enabled: true, path: "Photos/beta.jpg", blobUrl: "blob:beta" };
const disabledSource: ImageSource = { enabled: false, path: "Photos/alpha.jpg", blobUrl: "blob:alpha" };
const missingPathSource: ImageSource = { enabled: true, blobUrl: "blob:orphan" };
const missingBlobSource: ImageSource = { enabled: true, path: "Photos/orphan.jpg" };

function currentInteraction(ref: { current?: ImagePreviewInteraction }): ImagePreviewInteraction {
  if (!ref.current) {
    throw new Error("Expected the current image interaction.");
  }
  return ref.current;
}

function currentStage(ref: { current?: ImagePreviewInteraction }): ImagePreviewStageBindings {
  return currentInteraction(ref).stage;
}

function stageElement(): HTMLDivElement {
  const element = document.querySelector(".preview-media-stage-image");
  if (!(element instanceof HTMLDivElement)) {
    throw new Error("Expected the image preview stage.");
  }
  return element;
}

function imageElement(): HTMLImageElement {
  const element = document.querySelector("img.media-preview-image");
  if (!(element instanceof HTMLImageElement)) {
    throw new Error("Expected the image preview image.");
  }
  return element;
}

function setNaturalSize(image: HTMLImageElement, width: number, height: number): void {
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: height });
}

function setRect(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: height });
  element.getBoundingClientRect = () => ({
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({})
  });
}

function imageLoadEvent(image: HTMLImageElement): SyntheticEvent<HTMLImageElement> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- this is a deterministic React-compatible image event.
  return { currentTarget: image } as unknown as SyntheticEvent<HTMLImageElement>;
}

function imageErrorEvent(image: HTMLImageElement): SyntheticEvent<HTMLImageElement> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- this is a deterministic React-compatible image event.
  return { currentTarget: image } as unknown as SyntheticEvent<HTMLImageElement>;
}

function pointerEvent(stage: HTMLDivElement, pointerId: number, clientX: number, clientY: number): ReactPointerEvent<HTMLDivElement> {
  Object.defineProperty(stage, "setPointerCapture", { configurable: true, value: vi.fn() });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the hook only reads these pointer fields from a controlled event.
  return {
    clientX,
    clientY,
    currentTarget: stage,
    pointerId
  } as unknown as ReactPointerEvent<HTMLDivElement>;
}

function touch(identifier: number, clientX: number, clientY: number, target = stageElement()): Touch {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the hook only reads identifier and client coordinates.
  return { clientX, clientY, identifier, target } as unknown as Touch;
}

function touchEvent(stage: HTMLDivElement, touches: readonly Touch[], preventDefault = vi.fn()): ReactTouchEvent<HTMLDivElement> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- this is a deterministic React-compatible TouchList.
  const touchList = {
    item: (index: number) => touches[index] ?? null,
    length: touches.length
  } as unknown as TouchList;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the hook reads only currentTarget, touches, and preventDefault.
  return { currentTarget: stage, preventDefault, touches: touchList } as unknown as ReactTouchEvent<HTMLDivElement>;
}

function wheelEvent(stage: HTMLDivElement, deltaY: number, preventDefault = vi.fn()): ReactWheelEvent<HTMLDivElement> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the hook reads only these wheel fields.
  return {
    clientX: 50,
    clientY: 50,
    ctrlKey: true,
    currentTarget: stage,
    deltaY,
    metaKey: false,
    preventDefault
  } as unknown as ReactWheelEvent<HTMLDivElement>;
}

function renderImageOwner(source: ImageSource = sourceA, mediaGeneration = 0) {
  const interactionRef: { current?: ImagePreviewInteraction } = {};
  const view = render(
    <ImageLifecycleHarness
      expose={(interaction) => {
        interactionRef.current = interaction;
      }}
      mediaGeneration={mediaGeneration}
      source={source}
    />
  );
  return { interactionRef, view };
}

function replaceImageOwner(
  view: ReturnType<typeof render>,
  interactionRef: { current?: ImagePreviewInteraction },
  source: ImageSource,
  mediaGeneration: number,
  fitMode: "fill" | "fit" = "fill",
  onFitModeChange: (mode: "fill" | "fit") => void = vi.fn()
): void {
  act(() => {
    view.rerender(
      <ImageLifecycleHarness
        expose={(interaction) => {
          interactionRef.current = interaction;
        }}
        fitMode={fitMode}
        mediaGeneration={mediaGeneration}
        onFitModeChange={onFitModeChange}
        source={source}
      />
    );
  });
}

describe("useImagePreviewInteraction lifecycle characterization", () => {
  afterEach(cleanup);

  it("T01 current image load publishes positive natural dimensions and error hides only the emitter", () => {
    const { interactionRef } = renderImageOwner();
    const image = imageElement();
    setNaturalSize(image, 640, 480);
    act(() => {
      currentStage(interactionRef).onImageLoad(imageLoadEvent(image));
      currentInteraction(interactionRef).controls.showOriginalSize();
    });
    expect(currentInteraction(interactionRef).stage.imageStyle).toMatchObject({ width: "640px", height: "480px" });
    expect(document.querySelector("[data-testid=failed]")).toHaveTextContent("false");

    act(() => {
      currentStage(interactionRef).onImageError(imageErrorEvent(image));
    });
    expect(document.querySelector("[data-testid=failed]")).toHaveTextContent("true");
    expect(image.style.display).toBe("none");
  });

  it.each([
    ["enabled", { ...disabledSource, enabled: true, blobUrl: "blob:alpha" }, disabledSource],
    ["path", sourceA, sourceB],
    ["blob", sourceA, { ...sourceA, blobUrl: "blob:beta" }]
  ] as const)("T02 source tuple replacement resets owned state for %s", (_dimension, initial, replacement) => {
    const { interactionRef, view } = renderImageOwner(initial);
    const image = imageElement();
    const stage = stageElement();
    setRect(stage, 200, 100);
    setRect(image, 400, 200);
    setNaturalSize(image, 320, 240);
    act(() => {
      currentStage(interactionRef).onImageLoad(imageLoadEvent(image));
      currentStage(interactionRef).onPointerDown(pointerEvent(stage, 7, 20, 20));
      currentStage(interactionRef).onPointerMove(pointerEvent(stage, 7, 80, 40));
      currentInteraction(interactionRef).controls.showOriginalSize();
      currentStage(interactionRef).onWheel(wheelEvent(stage, -1));
      currentStage(interactionRef).onTouchStart(touchEvent(stage, [touch(8, 80, 80)]));
      currentStage(interactionRef).onImageError(imageErrorEvent(image));
    });
    stage.scrollLeft = 31;
    stage.scrollTop = 27;
    image.style.margin = "4px 5px 6px 7px";
    expect(currentInteraction(interactionRef).failed).toBe(true);
    expect(currentInteraction(interactionRef).stage.hasCustomZoom).toBe(true);

    replaceImageOwner(view, interactionRef, replacement, 0);
    const replacementStage = document.querySelector<HTMLDivElement>(".preview-media-stage-image");
    const replacementImage = document.querySelector<HTMLImageElement>("img.media-preview-image");
    expect(currentInteraction(interactionRef).failed).toBe(false);
    expect(currentInteraction(interactionRef).stage.hasCustomZoom).toBe(false);
    expect(currentInteraction(interactionRef).stage.imageStyle).toEqual({ objectPosition: "50% 50%" });
    expect(currentStage(interactionRef).consumeSuppressedAdvance()).toBe(false);
    if (replacement.enabled && replacement.path && replacement.blobUrl) {
      expect(replacementImage).toBe(image);
      expect(replacementStage).toBe(stage);
      act(() => {
        currentInteraction(interactionRef).controls.showOriginalSize();
      });
      expect(currentInteraction(interactionRef).stage.imageStyle?.width).toBeUndefined();
      expect(currentInteraction(interactionRef).stage.imageStyle?.height).toBeUndefined();
      setNaturalSize(image, 640, 480);
      act(() => {
        currentStage(interactionRef).onImageLoad(imageLoadEvent(image));
      });
      act(() => {
        currentInteraction(interactionRef).controls.showOriginalSize();
      });
      expect(currentInteraction(interactionRef).stage.imageStyle).toMatchObject({ width: "640px", height: "480px" });
      expect(replacementImage?.style.display).toBe("");
      expect(replacementImage?.style.margin).toBe("");
      expect(replacementStage?.scrollLeft).toBe(0);
      expect(replacementStage?.scrollTop).toBe(0);
    } else {
      expect(replacementStage).toBeNull();
    }

    if (replacement.enabled && replacement.path && replacement.blobUrl && replacementStage) {
      setRect(replacementStage, 200, 100);
      act(() => {
        currentStage(interactionRef).onPointerMove(pointerEvent(replacementStage, 7, 80, 40));
        currentStage(interactionRef).onTouchMove(touchEvent(replacementStage, [touch(8, 20, 20)]));
        currentStage(interactionRef).onTouchMove(touchEvent(replacementStage, [touch(9, 20, 20), touch(10, 80, 20)]));
      });
      expect(currentInteraction(interactionRef).stage.hasCustomZoom).toBe(true);
      expect(replacementStage.scrollLeft).toBe(0);
      expect(replacementStage.scrollTop).toBe(0);
      act(() => {
        currentStage(interactionRef).onTouchMove(touchEvent(replacementStage, [touch(8, 20, 20)]));
      });
      expect(replacementStage.scrollLeft).toBe(0);
      expect(replacementStage.scrollTop).toBe(0);
    }
  });

  it("T02 source replacement retires a pending pinch gesture", () => {
    const { interactionRef, view } = renderImageOwner(sourceA);
    const stage = stageElement();
    const image = imageElement();
    setRect(stage, 200, 100);
    setRect(image, 400, 200);
    setNaturalSize(image, 400, 200);
    act(() => {
      currentStage(interactionRef).onImageLoad(imageLoadEvent(image));
      currentStage(interactionRef).onTouchStart(touchEvent(stage, [touch(1, 20, 20), touch(2, 80, 20)]));
    });
    replaceImageOwner(view, interactionRef, sourceB, 0);
    const preventDefault = vi.fn();
    act(() => {
      currentStage(interactionRef).onTouchMove(touchEvent(stage, [touch(1, 10, 20), touch(2, 90, 20)], preventDefault));
    });
    expect(currentInteraction(interactionRef).stage.hasCustomZoom).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("T02 source replacement retires a pending anchor before current zoom applies it", () => {
    const { interactionRef, view } = renderImageOwner(sourceA);
    const stage = stageElement();
    const image = imageElement();
    setRect(stage, 200, 100);
    setRect(image, 400, 200);
    setNaturalSize(image, 400, 200);
    act(() => {
      currentStage(interactionRef).onImageLoad(imageLoadEvent(image));
    });
    act(() => {
      currentStage(interactionRef).onWheel(wheelEvent(stage, -1));
      view.rerender(
        <ImageLifecycleHarness
          expose={(interaction) => {
            interactionRef.current = interaction;
          }}
          mediaGeneration={0}
          source={sourceB}
        />
      );
    });
    expect(stageElement()).toBe(stage);
    expect(imageElement()).toBe(image);
    expect(currentInteraction(interactionRef).stage.hasCustomZoom).toBe(false);
    expect(currentInteraction(interactionRef).stage.imageStyle).toEqual({ objectPosition: "50% 50%" });
    expect(stage.scrollLeft).toBe(0);
    expect(stage.scrollTop).toBe(0);
    expect(image.style.margin).toBe("");
  });

  it("T03 unchanged source tuple does not reset interaction state", () => {
    const { interactionRef, view } = renderImageOwner();
    const image = imageElement();
    const stage = stageElement();
    setRect(stage, 200, 100);
    setRect(image, 400, 200);
    setNaturalSize(image, 320, 240);
    act(() => {
      currentStage(interactionRef).onImageLoad(imageLoadEvent(image));
      currentInteraction(interactionRef).controls.showOriginalSize();
      currentStage(interactionRef).onWheel(wheelEvent(stage, -1));
      currentStage(interactionRef).onTouchStart(touchEvent(stage, [touch(8, 80, 80)]));
      currentStage(interactionRef).onImageError(imageErrorEvent(image));
    });
    stage.scrollLeft = 19;
    stage.scrollTop = 23;
    image.style.margin = "8px 9px 10px 11px";
    const preservedStyle = currentInteraction(interactionRef).stage.imageStyle;
    const oldStage = stageElement();
    const oldImage = imageElement();
    replaceImageOwner(view, interactionRef, sourceA, 0);
    expect(stageElement()).toBe(oldStage);
    expect(imageElement()).toBe(oldImage);
    expect(currentInteraction(interactionRef).failed).toBe(true);
    expect(currentInteraction(interactionRef).stage.hasCustomZoom).toBe(true);
    expect(currentInteraction(interactionRef).stage.imageStyle).toEqual(preservedStyle);
    expect(stage.scrollLeft).toBe(19);
    expect(stage.scrollTop).toBe(23);
    expect(image.style.margin).toBe("8px 9px 10px 11px");
    expect(currentStage(interactionRef).consumeSuppressedAdvance()).toBe(true);
    expect(currentStage(interactionRef).consumeSuppressedAdvance()).toBe(false);
  });

  it("T04 A-to-B-to-A source tuples each reset on the same owner DOM", () => {
    const { interactionRef, view } = renderImageOwner(sourceA);
    const imageA = imageElement();
    const stageA = stageElement();
    setRect(stageA, 200, 100);
    setRect(imageA, 400, 200);
    setNaturalSize(imageA, 320, 240);
    act(() => {
      currentStage(interactionRef).onImageLoad(imageLoadEvent(imageA));
      currentInteraction(interactionRef).controls.showOriginalSize();
      currentStage(interactionRef).onWheel(wheelEvent(stageA, -1));
      currentStage(interactionRef).onImageError(imageErrorEvent(imageA));
    });
    stageA.scrollLeft = 13;
    stageA.scrollTop = 17;
    imageA.style.margin = "1px 2px 3px 4px";
    replaceImageOwner(view, interactionRef, sourceB, 0);
    const imageB = imageElement();
    const stageB = stageElement();
    expect(imageB).toBe(imageA);
    expect(stageB).toBe(stageA);
    expect(currentInteraction(interactionRef).failed).toBe(false);
    expect(currentInteraction(interactionRef).stage.hasCustomZoom).toBe(false);
    expect(currentInteraction(interactionRef).stage.imageStyle).toEqual({ objectPosition: "50% 50%" });
    expect(stageB.scrollLeft).toBe(0);
    expect(stageB.scrollTop).toBe(0);
    expect(imageB.style.margin).toBe("");
    expect(currentStage(interactionRef).consumeSuppressedAdvance()).toBe(false);
    act(() => {
      setRect(stageB, 200, 100);
      setRect(imageB, 400, 200);
      currentInteraction(interactionRef).controls.showOriginalSize();
    });
    expect(currentInteraction(interactionRef).stage.imageStyle?.width).toBeUndefined();
    expect(currentInteraction(interactionRef).stage.imageStyle?.height).toBeUndefined();
    setNaturalSize(imageB, 360, 270);
    act(() => {
      currentStage(interactionRef).onImageLoad(imageLoadEvent(imageB));
      currentInteraction(interactionRef).controls.showOriginalSize();
    });
    expect(currentInteraction(interactionRef).stage.imageStyle).toMatchObject({ width: "360px", height: "270px" });
    act(() => {
      currentStage(interactionRef).onImageError(imageErrorEvent(imageB));
    });
    stageB.scrollLeft = 29;
    stageB.scrollTop = 31;
    imageB.style.margin = "5px 6px 7px 8px";
    replaceImageOwner(view, interactionRef, sourceA, 0);
    const imageAAgain = imageElement();
    const stageAAgain = stageElement();
    expect(imageAAgain).toBe(imageA);
    expect(imageAAgain).toBe(imageB);
    expect(stageAAgain).toBe(stageA);
    expect(stageAAgain).toBe(stageB);
    expect(currentInteraction(interactionRef).failed).toBe(false);
    expect(currentInteraction(interactionRef).stage.hasCustomZoom).toBe(false);
    expect(currentInteraction(interactionRef).stage.imageStyle).toEqual({ objectPosition: "50% 50%" });
    expect(stageAAgain.scrollLeft).toBe(0);
    expect(stageAAgain.scrollTop).toBe(0);
    expect(imageAAgain.style.margin).toBe("");
    expect(currentStage(interactionRef).consumeSuppressedAdvance()).toBe(false);
    act(() => {
      currentInteraction(interactionRef).controls.showOriginalSize();
    });
    expect(currentInteraction(interactionRef).stage.imageStyle?.width).toBeUndefined();
    expect(currentInteraction(interactionRef).stage.imageStyle?.height).toBeUndefined();
  });

  it("T05 fit and original-size controls preserve the public transition contract", () => {
    const onFitModeChange = vi.fn();
    const { interactionRef, view } = renderImageOwner();
    const image = imageElement();
    const stage = stageElement();
    setRect(stage, 200, 100);
    setRect(image, 400, 200);
    setNaturalSize(image, 320, 240);
    act(() => {
      currentStage(interactionRef).onImageLoad(imageLoadEvent(image));
      currentInteraction(interactionRef).controls.showOriginalSize();
      currentStage(interactionRef).onWheel(wheelEvent(stage, -1));
      currentStage(interactionRef).onImageError(imageErrorEvent(image));
    });
    stage.scrollLeft = 19;
    stage.scrollTop = 23;
    image.style.margin = "8px 9px 10px 11px";
    const preservedStyle = currentInteraction(interactionRef).stage.imageStyle;
    const oldStage = stageElement();
    const oldImage = imageElement();
    replaceImageOwner(view, interactionRef, sourceA, 0, "fit", onFitModeChange);
    expect(stageElement()).toBe(oldStage);
    expect(imageElement()).toBe(oldImage);
    expect(currentInteraction(interactionRef).failed).toBe(true);
    expect(currentInteraction(interactionRef).stage.hasCustomZoom).toBe(true);
    expect(currentInteraction(interactionRef).stage.imageStyle).toEqual(preservedStyle);
    expect(stage.scrollLeft).toBe(19);
    expect(stage.scrollTop).toBe(23);
    expect(image.style.margin).toBe("8px 9px 10px 11px");
    expect(currentStage(interactionRef).consumeSuppressedAdvance()).toBe(true);
    expect(currentStage(interactionRef).consumeSuppressedAdvance()).toBe(false);
    act(() => {
      currentInteraction(interactionRef).controls.toggleFitMode();
    });
    expect(onFitModeChange).toHaveBeenCalledWith("fill");
  });

  it("T06 current fill pan, pointer termination, and one-shot suppression remain observable", () => {
    const next = vi.fn();
    const interactionRef: { current?: ImagePreviewInteraction } = {};
    render(
      <ImageLifecycleHarness
        expose={(interaction) => {
          interactionRef.current = interaction;
        }}
        onNext={next}
        source={sourceA}
      />
    );
    const stage = stageElement();
    setRect(stage, 200, 100);
    act(() => {
      currentStage(interactionRef).onPointerDown(pointerEvent(stage, 7, 20, 20));
      currentStage(interactionRef).onPointerMove(pointerEvent(stage, 7, 80, 40));
    });
    expect(currentInteraction(interactionRef).stage.imageStyle?.objectPosition).not.toBe("50% 50%");
    act(() => {
      stage.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 100 }));
    });
    expect(next).not.toHaveBeenCalled();
    act(() => {
      stage.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 100 }));
    });
    expect(next).toHaveBeenCalledTimes(1);
    act(() => {
      currentStage(interactionRef).onPointerEnd(pointerEvent(stage, 7, 80, 40));
    });
  });

  it("T07 current anchored wheel zoom preserves suppression and stage scroll ownership", () => {
    const { interactionRef } = renderImageOwner();
    const stage = stageElement();
    const image = imageElement();
    setRect(stage, 200, 100);
    setRect(image, 400, 200);
    setNaturalSize(image, 400, 200);
    act(() => {
      currentStage(interactionRef).onWheel(wheelEvent(stage, -1));
    });
    expect(currentInteraction(interactionRef).stage.hasCustomZoom).toBe(true);
    expect(currentStage(interactionRef).consumeSuppressedAdvance()).toBe(true);
    expect(stage.scrollLeft).toBeGreaterThanOrEqual(0);
    expect(stage.scrollTop).toBeGreaterThanOrEqual(0);
  });

  it("T08 current pinch zoom and custom-zoom single-touch scroll terminate cleanly", () => {
    const { interactionRef } = renderImageOwner();
    const stage = stageElement();
    const image = imageElement();
    setRect(stage, 200, 100);
    setRect(image, 400, 200);
    setNaturalSize(image, 400, 200);
    act(() => {
      currentStage(interactionRef).onTouchStart(touchEvent(stage, [touch(1, 20, 20), touch(2, 80, 20)]));
      const pinchMove = vi.fn();
      currentStage(interactionRef).onTouchMove(touchEvent(stage, [touch(1, 10, 20), touch(2, 90, 20)], pinchMove));
      expect(pinchMove).toHaveBeenCalledTimes(1);
    });
    expect(currentInteraction(interactionRef).stage.hasCustomZoom).toBe(true);
    act(() => {
      currentStage(interactionRef).onTouchEnd(touchEvent(stage, [touch(1, 10, 20)]));
      currentStage(interactionRef).onTouchEnd(touchEvent(stage, []));
      currentInteraction(interactionRef).controls.showOriginalSize();
    });
    const beforeLeft = stage.scrollLeft;
    const beforeTop = stage.scrollTop;
    act(() => {
      currentStage(interactionRef).onTouchStart(touchEvent(stage, [touch(3, 40, 40)]));
      currentStage(interactionRef).onTouchMove(touchEvent(stage, [touch(3, 10, 10)]));
      currentStage(interactionRef).onTouchEnd(touchEvent(stage, []));
    });
    expect(stage.scrollLeft).not.toBe(beforeLeft);
    expect(stage.scrollTop).not.toBe(beforeTop);
    expect(currentStage(interactionRef).consumeSuppressedAdvance()).toBe(true);
  });

  it.each([
    ["disabled", disabledSource],
    ["missing path", missingPathSource],
    ["missing blob URL", missingBlobSource]
  ] as const)("T09 %s input keeps the hook local with no stage resource", (_kind, source) => {
    const { interactionRef } = renderImageOwner(source);
    expect(currentInteraction(interactionRef).failed).toBe(false);
    expect(currentInteraction(interactionRef).stage.hasCustomZoom).toBe(false);
    expect(document.querySelector(".preview-media-stage-image")).toBeNull();
  });

  it.each([
    ["enabled", { ...disabledSource, enabled: true, blobUrl: "blob:alpha" }, disabledSource],
    ["path", sourceA, sourceB],
    ["blob", sourceA, { ...sourceA, blobUrl: "blob:beta" }]
  ] as const)("T10 stale image load after %s replacement cannot publish current natural size", (_dimension, initial, replacement) => {
    const { interactionRef, view } = renderImageOwner(initial);
    const retiredImage = imageElement();
    const retiredStage = currentStage(interactionRef);
    act(() => {
      currentInteraction(interactionRef).controls.showOriginalSize();
    });
    replaceImageOwner(view, interactionRef, replacement, 1);
    act(() => {
      currentInteraction(interactionRef).controls.showOriginalSize();
    });
    setNaturalSize(retiredImage, 800, 600);
    act(() => {
      retiredStage.onImageLoad(imageLoadEvent(retiredImage));
    });
    expect(currentInteraction(interactionRef).stage.imageStyle?.width).toBeUndefined();
  });

  it.each([
    ["enabled", { ...disabledSource, enabled: true, blobUrl: "blob:alpha" }, disabledSource],
    ["path", sourceA, sourceB],
    ["blob", sourceA, { ...sourceA, blobUrl: "blob:beta" }]
  ] as const)("T11 stale image error after %s replacement cannot fail the current owner", (_dimension, initial, replacement) => {
    const { interactionRef, view } = renderImageOwner(initial);
    const retiredImage = imageElement();
    const retiredStage = currentStage(interactionRef);
    replaceImageOwner(view, interactionRef, replacement, 1);
    act(() => {
      retiredStage.onImageError(imageErrorEvent(retiredImage));
    });
    expect(currentInteraction(interactionRef).failed).toBe(false);
    if (replacement.enabled && replacement.path && replacement.blobUrl) {
      expect(imageElement().style.display).toBe("");
    }
  });

  it("T12 stale stage ref cannot replace the current stage identity after source replacement", () => {
    const { interactionRef, view } = renderImageOwner();
    const retiredStageElement = stageElement();
    const retiredStage = currentStage(interactionRef);
    replaceImageOwner(view, interactionRef, sourceB, 1);
    const replacementStageElement = stageElement();
    expect(replacementStageElement).not.toBe(retiredStageElement);
    replacementStageElement.scrollLeft = 17;
    retiredStageElement.scrollLeft = 23;
    retiredStage.stageRef(retiredStageElement);
    act(() => {
      currentInteraction(interactionRef).controls.showOriginalSize();
    });
    expect(replacementStageElement.scrollLeft).toBe(0);
    expect(retiredStageElement.scrollLeft).toBe(23);
  });

  it("T13 stale pointer down/move cannot mutate the current pan", () => {
    const { interactionRef, view } = renderImageOwner();
    const retiredStageElement = stageElement();
    setRect(retiredStageElement, 200, 100);
    const retiredStage = currentStage(interactionRef);
    replaceImageOwner(view, interactionRef, sourceB, 1);
    const replacementStageElement = stageElement();
    setRect(replacementStageElement, 200, 100);
    act(() => {
      retiredStage.onPointerDown(pointerEvent(retiredStageElement, 1, 10, 10));
      retiredStage.onPointerMove(pointerEvent(retiredStageElement, 1, 80, 40));
    });
    expect(currentInteraction(interactionRef).stage.imageStyle?.objectPosition).toBe("50% 50%");
  });

  it("T13 stale pointer end cannot clear the current gesture", () => {
    const { interactionRef, view } = renderImageOwner();
    const retiredStageElement = stageElement();
    const retiredStage = currentStage(interactionRef);
    replaceImageOwner(view, interactionRef, sourceB, 1);
    const replacementStageElement = stageElement();
    setRect(replacementStageElement, 200, 100);
    act(() => {
      currentStage(interactionRef).onPointerDown(pointerEvent(replacementStageElement, 2, 10, 10));
      retiredStage.onPointerEnd(pointerEvent(retiredStageElement, 2, 10, 10));
      currentStage(interactionRef).onPointerMove(pointerEvent(replacementStageElement, 2, 80, 40));
    });
    expect(currentInteraction(interactionRef).stage.imageStyle?.objectPosition).not.toBe("50% 50%");
  });

  it("T14 stale touch termination cannot clear the current custom-scroll gesture", () => {
    const { interactionRef, view } = renderImageOwner();
    const retiredStage = currentStage(interactionRef);
    const retiredStageElement = stageElement();
    replaceImageOwner(view, interactionRef, sourceB, 1);
    const replacementStageElement = stageElement();
    setRect(replacementStageElement, 200, 100);
    act(() => {
      currentInteraction(interactionRef).controls.showOriginalSize();
    });
    act(() => {
      currentStage(interactionRef).onTouchStart(touchEvent(replacementStageElement, [touch(3, 80, 80)]));
      retiredStage.onTouchEnd(touchEvent(retiredStageElement, []));
    });
    const beforeLeft = replacementStageElement.scrollLeft;
    const beforeTop = replacementStageElement.scrollTop;
    act(() => {
      currentStage(interactionRef).onTouchMove(touchEvent(replacementStageElement, [touch(3, 20, 20)]));
    });
    expect(replacementStageElement.scrollLeft).not.toBe(beforeLeft);
    expect(replacementStageElement.scrollTop).not.toBe(beforeTop);
  });

  it("T15 stale wheel callbacks cannot create current custom zoom or mutate current anchoring", () => {
    const { interactionRef, view } = renderImageOwner();
    const retiredStage = currentStage(interactionRef);
    const retiredStageElement = stageElement();
    setRect(retiredStageElement, 200, 100);
    setRect(imageElement(), 400, 200);
    replaceImageOwner(view, interactionRef, sourceB, 1);
    const replacementStageElement = stageElement();
    setRect(replacementStageElement, 200, 100);
    const replacementImage = imageElement();
    setRect(replacementImage, 400, 200);
    replacementStageElement.scrollLeft = 19;
    replacementStageElement.scrollTop = 23;
    replacementImage.style.margin = "8px 9px 10px 11px";
    act(() => {
      retiredStage.onWheel(wheelEvent(retiredStageElement, -1));
    });
    expect(currentInteraction(interactionRef).stage.hasCustomZoom).toBe(false);
    expect(currentInteraction(interactionRef).stage.imageStyle).toEqual({ objectPosition: "50% 50%" });
    expect(replacementStageElement.scrollLeft).toBe(19);
    expect(replacementStageElement.scrollTop).toBe(23);
    expect(replacementImage.style.margin).toBe("8px 9px 10px 11px");
  });

  it("T15 stale wheel callbacks cannot create current suppression", () => {
    const { interactionRef, view } = renderImageOwner();
    const retiredStage = currentStage(interactionRef);
    const retiredStageElement = stageElement();
    setRect(retiredStageElement, 200, 100);
    setRect(imageElement(), 400, 200);
    replaceImageOwner(view, interactionRef, sourceB, 1);
    const replacementStageElement = stageElement();
    setRect(replacementStageElement, 200, 100);
    setRect(imageElement(), 400, 200);
    act(() => {
      retiredStage.onWheel(wheelEvent(retiredStageElement, -1));
    });
    expect(currentStage(interactionRef).consumeSuppressedAdvance()).toBe(false);
  });

  it("T16 stale suppression consumption cannot consume the current owner's advance bit", () => {
    const { interactionRef, view } = renderImageOwner();
    const retiredStage = currentStage(interactionRef);
    replaceImageOwner(view, interactionRef, sourceB, 1);
    const replacementStageElement = stageElement();
    setRect(replacementStageElement, 200, 100);
    act(() => {
      currentStage(interactionRef).onPointerDown(pointerEvent(replacementStageElement, 9, 10, 10));
      currentStage(interactionRef).onPointerMove(pointerEvent(replacementStageElement, 9, 70, 40));
    });
    expect(retiredStage.consumeSuppressedAdvance()).toBe(false);
  });

  it("T16 current suppression remains consumable after a retired consumer", () => {
    const { interactionRef, view } = renderImageOwner();
    const retiredStage = currentStage(interactionRef);
    replaceImageOwner(view, interactionRef, sourceB, 1);
    const replacementStageElement = stageElement();
    setRect(replacementStageElement, 200, 100);
    act(() => {
      currentStage(interactionRef).onPointerDown(pointerEvent(replacementStageElement, 9, 10, 10));
      currentStage(interactionRef).onPointerMove(pointerEvent(replacementStageElement, 9, 70, 40));
    });
    retiredStage.consumeSuppressedAdvance();
    expect(currentStage(interactionRef).consumeSuppressedAdvance()).toBe(true);
  });

  it("T17 current fit callback follows the current owner while a retired control is classified", () => {
    const oldFit = vi.fn();
    const currentFit = vi.fn();
    const interactionRef: { current?: ImagePreviewInteraction } = {};
    const view = render(
      <ImageLifecycleHarness
        expose={(interaction) => {
          interactionRef.current = interaction;
        }}
        onFitModeChange={oldFit}
        source={sourceA}
      />
    );
    const retiredControls = currentInteraction(interactionRef).controls;
    replaceImageOwner(view, interactionRef, sourceA, 0, "fit", currentFit);
    act(() => {
      currentInteraction(interactionRef).controls.toggleFitMode();
    });
    expect(currentFit).toHaveBeenCalledWith("fill");
    currentFit.mockClear();
    oldFit.mockClear();
    act(() => {
      retiredControls.toggleFitMode();
    });
    expect(currentFit).not.toHaveBeenCalled();
    expect(oldFit).not.toHaveBeenCalled();
  });

  it("T18 post-unmount image callbacks cannot mutate the retired DOM", () => {
    const { interactionRef, view } = renderImageOwner();
    const retiredImage = imageElement();
    const retiredStage = currentStage(interactionRef);
    view.unmount();
    expect(retiredImage.style.display).toBe("");
    act(() => {
      retiredStage.onImageError(imageErrorEvent(retiredImage));
    });
    expect(retiredImage.style.display).toBe("");
  });

  it("T18 post-unmount stage refs cannot resurrect retired ownership", () => {
    const { interactionRef, view } = renderImageOwner();
    const retiredStageElement = stageElement();
    const retiredStage = currentStage(interactionRef);
    const retiredControls = currentInteraction(interactionRef).controls;
    retiredStageElement.scrollLeft = 29;
    retiredStageElement.scrollTop = 31;
    view.unmount();
    act(() => {
      retiredStage.stageRef(retiredStageElement);
      retiredControls.showOriginalSize();
    });
    expect(retiredStageElement.scrollLeft).toBe(29);
    expect(retiredStageElement.scrollTop).toBe(31);
  });

  it("T18 post-unmount touch callbacks cannot mutate the retired stage", () => {
    const { interactionRef, view } = renderImageOwner();
    const retiredStageElement = stageElement();
    const retiredImage = imageElement();
    setRect(retiredStageElement, 200, 100);
    setRect(retiredImage, 400, 200);
    act(() => {
      currentInteraction(interactionRef).controls.showOriginalSize();
    });
    act(() => {
      currentStage(interactionRef).onTouchStart(touchEvent(retiredStageElement, [touch(1, 80, 80, retiredStageElement)]));
    });
    const retiredStage = currentStage(interactionRef);
    retiredStageElement.scrollLeft = 17;
    retiredStageElement.scrollTop = 19;
    view.unmount();
    act(() => {
      retiredStage.onTouchMove(touchEvent(retiredStageElement, [touch(1, 20, 20, retiredStageElement)]));
    });
    expect(retiredStageElement.scrollLeft).toBe(17);
    expect(retiredStageElement.scrollTop).toBe(19);
  });

  it("T18 post-unmount suppression cannot be consumed by a retired callback", () => {
    const { interactionRef, view } = renderImageOwner();
    const retiredStageElement = stageElement();
    setRect(retiredStageElement, 200, 100);
    const retiredStage = currentStage(interactionRef);
    act(() => {
      retiredStage.onPointerDown(pointerEvent(retiredStageElement, 4, 10, 10));
      retiredStage.onPointerMove(pointerEvent(retiredStageElement, 4, 80, 40));
    });
    view.unmount();
    expect(retiredStage.consumeSuppressedAdvance()).toBe(false);
  });

  it("T18 post-unmount fit controls cannot publish to the retired owner", () => {
    const onFitModeChange = vi.fn();
    const interactionRef: { current?: ImagePreviewInteraction } = {};
    const view = render(
      <ImageLifecycleHarness
        expose={(interaction) => {
          interactionRef.current = interaction;
        }}
        onFitModeChange={onFitModeChange}
        source={sourceA}
      />
    );
    const retiredControls = currentInteraction(interactionRef).controls;
    view.unmount();
    act(() => {
      retiredControls.toggleFitMode();
    });
    expect(onFitModeChange).not.toHaveBeenCalled();
  });

  it("T19 StrictMode replay retires old image error callbacks", () => {
    const interactionRef: { current?: ImagePreviewInteraction } = {};
    const view = render(
      <StrictMode>
        <ImageLifecycleHarness
          expose={(interaction) => {
            interactionRef.current = interaction;
          }}
          source={sourceA}
        />
      </StrictMode>
    );
    const oldStage = currentStage(interactionRef);
    const oldImage = imageElement();
    act(() => {
      view.rerender(
        <StrictMode>
          <ImageLifecycleHarness
            expose={(interaction) => {
              interactionRef.current = interaction;
            }}
            mediaGeneration={1}
            source={sourceB}
          />
        </StrictMode>
      );
    });
    const currentImage = imageElement();
    expect(currentImage).not.toBe(oldImage);
    act(() => {
      oldStage.onImageError(imageErrorEvent(oldImage));
    });
    expect(currentInteraction(interactionRef).failed).toBe(false);
  });

  it("T19 StrictMode replay retires old stage refs", () => {
    const interactionRef: { current?: ImagePreviewInteraction } = {};
    const view = render(
      <StrictMode>
        <ImageLifecycleHarness
          expose={(interaction) => {
            interactionRef.current = interaction;
          }}
          source={sourceA}
        />
      </StrictMode>
    );
    const oldStageElement = stageElement();
    const oldStage = currentStage(interactionRef);
    act(() => {
      view.rerender(
        <StrictMode>
          <ImageLifecycleHarness
            expose={(interaction) => {
              interactionRef.current = interaction;
            }}
            mediaGeneration={1}
            source={sourceB}
          />
        </StrictMode>
      );
    });
    const currentStageElement = stageElement();
    currentStageElement.scrollLeft = 17;
    oldStageElement.scrollLeft = 23;
    oldStage.stageRef(oldStageElement);
    act(() => {
      currentInteraction(interactionRef).controls.showOriginalSize();
    });
    expect(currentStageElement.scrollLeft).toBe(0);
    expect(oldStageElement.scrollLeft).toBe(23);
  });

  it("T19 StrictMode replay retires old pointer termination callbacks", () => {
    const interactionRef: { current?: ImagePreviewInteraction } = {};
    const view = render(
      <StrictMode>
        <ImageLifecycleHarness
          expose={(interaction) => {
            interactionRef.current = interaction;
          }}
          source={sourceA}
        />
      </StrictMode>
    );
    const oldStageElement = stageElement();
    const oldStage = currentStage(interactionRef);
    act(() => {
      view.rerender(
        <StrictMode>
          <ImageLifecycleHarness
            expose={(interaction) => {
              interactionRef.current = interaction;
            }}
            mediaGeneration={1}
            source={sourceB}
          />
        </StrictMode>
      );
    });
    const currentStageElement = stageElement();
    setRect(currentStageElement, 200, 100);
    act(() => {
      currentStage(interactionRef).onPointerDown(pointerEvent(currentStageElement, 5, 10, 10));
      oldStage.onPointerEnd(pointerEvent(oldStageElement, 5, 10, 10));
      currentStage(interactionRef).onPointerMove(pointerEvent(currentStageElement, 5, 80, 40));
    });
    expect(currentInteraction(interactionRef).stage.imageStyle?.objectPosition).not.toBe("50% 50%");
  });

  it("T19 StrictMode replay keeps current suppression independent from retired consumers", () => {
    const interactionRef: { current?: ImagePreviewInteraction } = {};
    const view = render(
      <StrictMode>
        <ImageLifecycleHarness
          expose={(interaction) => {
            interactionRef.current = interaction;
          }}
          source={sourceA}
        />
      </StrictMode>
    );
    const oldStage = currentStage(interactionRef);
    act(() => {
      view.rerender(
        <StrictMode>
          <ImageLifecycleHarness
            expose={(interaction) => {
              interactionRef.current = interaction;
            }}
            mediaGeneration={1}
            source={sourceB}
          />
        </StrictMode>
      );
    });
    const currentStageElement = stageElement();
    setRect(currentStageElement, 200, 100);
    act(() => {
      currentStage(interactionRef).onPointerDown(pointerEvent(currentStageElement, 6, 10, 10));
      currentStage(interactionRef).onPointerMove(pointerEvent(currentStageElement, 6, 80, 40));
    });
    expect(oldStage.consumeSuppressedAdvance()).toBe(false);
    expect(currentStage(interactionRef).consumeSuppressedAdvance()).toBe(true);
  });

  it("T19 StrictMode replay keeps current fit publication independent from retired controls", () => {
    const oldFit = vi.fn();
    const currentFit = vi.fn();
    const interactionRef: { current?: ImagePreviewInteraction } = {};
    const view = render(
      <StrictMode>
        <ImageLifecycleHarness
          expose={(interaction) => {
            interactionRef.current = interaction;
          }}
          onFitModeChange={oldFit}
          source={sourceA}
        />
      </StrictMode>
    );
    const oldControls = currentInteraction(interactionRef).controls;
    act(() => {
      view.rerender(
        <StrictMode>
          <ImageLifecycleHarness
            expose={(interaction) => {
              interactionRef.current = interaction;
            }}
            mediaGeneration={1}
            onFitModeChange={currentFit}
            source={sourceB}
          />
        </StrictMode>
      );
    });
    act(() => {
      currentInteraction(interactionRef).controls.toggleFitMode();
    });
    expect(currentFit).toHaveBeenCalledWith("fit");
    currentFit.mockClear();
    oldFit.mockClear();
    act(() => {
      oldControls.toggleFitMode();
    });
    expect(currentFit).not.toHaveBeenCalled();
    expect(oldFit).not.toHaveBeenCalled();
  });
});
