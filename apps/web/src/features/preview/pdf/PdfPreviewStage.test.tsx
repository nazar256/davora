import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PdfPreviewStage } from "./PdfPreviewStage";
import type { PdfPreviewInteraction } from "./usePdfPreviewInteraction";

function interaction(overrides: Partial<PdfPreviewInteraction> = {}): PdfPreviewInteraction {
  return {
    controls: {
      currentPage: 1,
      pageCount: 2,
      visiblePageCount: 2,
      renderedZoomLabel: "100%",
      renderState: "ready",
      zoomMode: "fit-width",
      renderedScale: 1,
      scrollToPreviousPage: vi.fn(),
      scrollToNextPage: vi.fn(),
      zoomOut: vi.fn(),
      zoomIn: vi.fn(),
      setFitWidth: vi.fn(),
      setFitPage: vi.fn()
    },
    stage: {
      scrollRef: vi.fn(),
      pagesRef: vi.fn(),
      setCanvasRef: () => vi.fn(),
      setPageRef: () => vi.fn(),
      visiblePageCount: 2,
      pageCount: 2,
      renderState: "ready",
      onScroll: vi.fn(),
      onWheel: vi.fn(),
      onTouchStart: vi.fn(),
      onTouchMove: vi.fn(),
      onTouchEnd: vi.fn()
    },
    ...overrides
  };
}

describe("PdfPreviewStage", () => {
  it("wires toolbar controls and exposes page status", () => {
    const preview = interaction();
    const { getByLabelText, getByText } = render(<PdfPreviewStage fileName="sample.pdf" interaction={preview} />);

    fireEvent.click(getByLabelText("Next PDF page"));
    fireEvent.click(getByLabelText("Zoom PDF in"));
    fireEvent.click(getByLabelText("Fit PDF to page"));

    expect(preview.controls.scrollToNextPage).toHaveBeenCalledTimes(1);
    expect(preview.controls.zoomIn).toHaveBeenCalledTimes(1);
    expect(preview.controls.setFitPage).toHaveBeenCalledTimes(1);
    expect(getByText("Page 1 of 2")).toBeInTheDocument();
  });
});
