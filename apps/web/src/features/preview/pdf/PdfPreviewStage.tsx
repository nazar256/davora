import { PDF_MAX_ZOOM, PDF_MIN_ZOOM } from "./model";
import type { PdfPreviewInteraction } from "./usePdfPreviewInteraction";

interface PdfPreviewStageProps {
  fileName: string;
  interaction: PdfPreviewInteraction;
}

export function PdfPreviewStage({ fileName, interaction }: PdfPreviewStageProps) {
  const { controls, stage } = interaction;

  return (
    <div className="pdf-canvas-preview" aria-label={`PDF preview ${fileName}`}>
      <div className="pdf-canvas-toolbar">
        <span className="pdf-canvas-page-status" aria-live="polite">
          {controls.pageCount ? `Page ${controls.currentPage} of ${controls.pageCount}` : "Rendering PDF"}
        </span>
        <div className="pdf-canvas-controls" aria-label="PDF controls">
          <button
            type="button"
            className="pdf-canvas-control"
            aria-label="Previous PDF page"
            disabled={controls.currentPage <= 1 || controls.renderState !== "ready"}
            onClick={controls.scrollToPreviousPage}
          >
            ‹
          </button>
          <button
            type="button"
            className="pdf-canvas-control"
            aria-label="Next PDF page"
            disabled={controls.currentPage >= controls.visiblePageCount || controls.renderState !== "ready"}
            onClick={controls.scrollToNextPage}
          >
            ›
          </button>
          <button
            type="button"
            className="pdf-canvas-control"
            aria-label="Zoom PDF out"
            disabled={controls.renderState !== "ready" || controls.renderedScale <= PDF_MIN_ZOOM}
            onClick={controls.zoomOut}
          >
            -
          </button>
          <span className="pdf-canvas-zoom" aria-label={`PDF zoom ${controls.renderedZoomLabel}`} aria-live="polite">
            {controls.renderedZoomLabel}
          </span>
          <button
            type="button"
            className="pdf-canvas-control"
            aria-label="Zoom PDF in"
            disabled={controls.renderState !== "ready" || controls.renderedScale >= PDF_MAX_ZOOM}
            onClick={controls.zoomIn}
          >
            +
          </button>
          <button
            type="button"
            className="pdf-canvas-control pdf-canvas-control-text"
            aria-label="Fit PDF to width"
            aria-pressed={controls.zoomMode === "fit-width"}
            disabled={controls.renderState !== "ready"}
            onClick={controls.setFitWidth}
          >
            Fit width
          </button>
          <button
            type="button"
            className="pdf-canvas-control pdf-canvas-control-text"
            aria-label="Fit PDF to page"
            aria-pressed={controls.zoomMode === "fit-page"}
            disabled={controls.renderState !== "ready"}
            onClick={controls.setFitPage}
          >
            Fit page
          </button>
        </div>
      </div>
      <div
        aria-label={`Scrollable PDF pages for ${fileName}`}
        className="pdf-canvas-scroll"
        ref={stage.scrollRef}
        tabIndex={0}
        onScroll={stage.onScroll}
        onWheel={stage.onWheel}
        onTouchStart={stage.onTouchStart}
        onTouchMove={stage.onTouchMove}
        onTouchEnd={stage.onTouchEnd}
      >
        <div className="pdf-canvas-pages" ref={stage.pagesRef}>
          {Array.from({ length: stage.visiblePageCount }, (_, index) => (
            <div
              className="pdf-canvas-page"
              key={index + 1}
              ref={stage.setPageRef(index)}
            >
              <canvas
                aria-label={`PDF page ${index + 1}`}
                className="pdf-canvas"
                data-render-state={stage.renderState}
                ref={stage.setCanvasRef(index)}
              />
              {stage.pageCount ? <span className="pdf-canvas-page-label">Page {index + 1}</span> : null}
            </div>
          ))}
        </div>
        {stage.renderState === "loading" ? <p className="pdf-canvas-status">Rendering PDF...</p> : null}
      </div>
    </div>
  );
}
