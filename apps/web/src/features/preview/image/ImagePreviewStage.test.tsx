import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImagePreviewStage } from "./ImagePreviewStage";
import type { ImagePreviewStageBindings } from "./useImagePreviewInteraction";

function bindings(consumeSuppressedAdvance = vi.fn(() => false)): ImagePreviewStageBindings {
  return {
    stageRef: vi.fn(), hasCustomZoom: false, imageStyle: undefined,
    onImageLoad: vi.fn(), onImageError: vi.fn(), onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerEnd: vi.fn(),
    onTouchStart: vi.fn(), onTouchMove: vi.fn(), onTouchEnd: vi.fn(), onWheel: vi.fn(), consumeSuppressedAdvance
  };
}

describe("ImagePreviewStage", () => {
  it("consumes one suppressed click, then navigates ordinary and edge clicks", () => {
    const next = vi.fn();
    const previous = vi.fn();
    const consume = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const { getByRole } = render(<ImagePreviewStage alt="photo.png" fitMode="fill" interaction={bindings(consume)} onNext={next} onPrevious={previous} src="blob:photo" />);
    const stage = getByRole("button");
    Object.defineProperty(stage, "clientWidth", { configurable: true, value: 1_000 });

    fireEvent.click(stage, { clientX: 500 });
    fireEvent.click(stage, { clientX: 500 });
    fireEvent.click(stage, { clientX: 10 });
    expect(next).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledTimes(3);
  });
});
