export interface PdfSize {
  width: number;
  height: number;
}

export interface PdfRenderTask {
  cancel(): void;
  promise: Promise<unknown>;
}

export interface PdfPage {
  getBaseSize(): PdfSize;
  render(options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    cssScale: number;
    outputScale: number;
  }): PdfRenderTask;
}

export interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}

export interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): void;
}

export interface PdfJsModule {
  getDocument(options: { data: Uint8Array }): PdfLoadingTask;
}

export interface PdfPreviewResizeObserver {
  observe(target: Element): void;
  disconnect(): void;
}

export interface PdfPreviewRuntimePorts {
  loadPdfJs(): Promise<PdfJsModule>;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  getDevicePixelRatio(): number;
  createResizeObserver(callback: ResizeObserverCallback): PdfPreviewResizeObserver | undefined;
}
