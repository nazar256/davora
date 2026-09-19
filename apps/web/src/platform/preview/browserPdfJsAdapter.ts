import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

export type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
export type PdfLoadingTask = ReturnType<PdfJsModule["getDocument"]>;
export type PdfRenderTask = { cancel: () => void; promise: Promise<unknown> };

interface PdfPreviewSize {
  width: number;
  height: number;
}

interface PdfPreviewRenderTask {
  cancel(): void;
  promise: Promise<unknown>;
}

interface PdfPreviewPage {
  getBaseSize(): PdfPreviewSize;
  render(options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    cssScale: number;
    outputScale: number;
  }): PdfPreviewRenderTask;
}

interface PdfPreviewDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPreviewPage>;
}

interface PdfPreviewLoadingTask {
  promise: Promise<PdfPreviewDocument>;
  destroy(): void;
}

export interface PdfPreviewJsModule {
  getDocument(options: { data: Uint8Array }): PdfPreviewLoadingTask;
}

let pdfJsModulePromise: Promise<PdfJsModule> | undefined;

export function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsModulePromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((module) => {
    module.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return module;
  });
  return pdfJsModulePromise;
}

export async function loadPdfPreviewModule(): Promise<PdfPreviewJsModule> {
  const pdfjsLib = await loadPdfJs();

  return {
    getDocument: ({ data }) => {
      const loadingTask = pdfjsLib.getDocument({ data });
      return {
        promise: loadingTask.promise.then((pdf) => ({
          numPages: pdf.numPages,
          getPage: async (pageNumber: number) => {
            const page = await pdf.getPage(pageNumber);
            const baseViewport = page.getViewport({ scale: 1 });
            return {
              getBaseSize: () => ({ width: baseViewport.width, height: baseViewport.height }),
              render: ({ canvas, canvasContext, cssScale, outputScale }) => {
                const viewport = page.getViewport({ scale: cssScale });
                canvas.width = Math.floor(viewport.width * outputScale);
                canvas.height = Math.floor(viewport.height * outputScale);
                canvas.style.width = `${Math.floor(viewport.width)}px`;
                canvas.style.height = `${Math.floor(viewport.height)}px`;
                canvasContext.clearRect(0, 0, canvas.width, canvas.height);
                const renderTask = page.render({
                  canvas,
                  canvasContext,
                  transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
                  viewport
                });
                return {
                  cancel: () => {
                    renderTask.cancel();
                  },
                  promise: renderTask.promise
                };
              }
            };
          }
        })),
        destroy: () => {
          void loadingTask.destroy();
        }
      };
    }
  };
}

export function resetPdfJsModuleForTests(): void {
  pdfJsModulePromise = undefined;
}
