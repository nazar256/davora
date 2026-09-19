import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TouchEvent, WheelEvent } from "react";

import { resolveAnchoredScrollAxis } from "../../../lib/anchoredScroll";

import {
  PDF_ZOOM_STEP,
  clampPdfZoom,
  getPdfTouchDistance,
  getPdfTouchMidpoint,
  resolveCssScale,
  resolveCurrentPageFromCenters,
  resolveFitPageScale,
  resolveFitWidthScale,
  resolveRenderedScaleFromCanvas,
  type PdfPoint,
  type PdfZoomMode
} from "./model";
import type { PdfLoadingTask, PdfPreviewRuntimePorts, PdfRenderTask } from "./ports";

function toPdfTouchPoints(touches: React.TouchList): PdfPoint[] {
  const points: PdfPoint[] = [];
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index);
    if (touch) {
      points.push({ x: touch.clientX, y: touch.clientY });
    }
  }
  return points;
}

const EMPTY_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };

interface PdfPreviewInteractionOptions {
  blobUrl: string;
  onError: () => void;
  ports: PdfPreviewRuntimePorts;
}

export interface PdfPreviewControls {
  currentPage: number;
  pageCount?: number;
  visiblePageCount: number;
  renderedZoomLabel: string;
  renderState: "loading" | "ready" | "failed";
  zoomMode: PdfZoomMode;
  renderedScale: number;
  scrollToPreviousPage: () => void;
  scrollToNextPage: () => void;
  zoomOut: () => void;
  zoomIn: () => void;
  setFitWidth: () => void;
  setFitPage: () => void;
}

export interface PdfPreviewStageBindings {
  scrollRef: (element: HTMLDivElement | null) => void;
  pagesRef: (element: HTMLDivElement | null) => void;
  setCanvasRef: (index: number) => (element: HTMLCanvasElement | null) => void;
  setPageRef: (index: number) => (element: HTMLDivElement | null) => void;
  visiblePageCount: number;
  pageCount?: number;
  renderState: "loading" | "ready" | "failed";
  onScroll: () => void;
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
  onTouchStart: (event: TouchEvent<HTMLDivElement>) => void;
  onTouchMove: (event: TouchEvent<HTMLDivElement>) => void;
  onTouchEnd: (event: TouchEvent<HTMLDivElement>) => void;
}

export interface PdfPreviewInteraction {
  controls: PdfPreviewControls;
  stage: PdfPreviewStageBindings;
}

export function usePdfPreviewInteraction({
  blobUrl,
  onError,
  ports
}: PdfPreviewInteractionOptions): PdfPreviewInteraction {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // No pipeline can acquire until the first committed scroll stage advances this
  // generation. The initial render has no mounted stage yet, even though the
  // ref callback may populate `scrollRef` before passive effects run.
  const [scrollMountGeneration, setScrollMountGeneration] = useState(-1);
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const canvasRefCallbacksRef = useRef(new Map<number, (element: HTMLCanvasElement | null) => void>());
  const pageRefCallbacksRef = useRef(new Map<number, (element: HTMLDivElement | null) => void>());
  const firstPageSizeRef = useRef<{ width: number; height: number } | undefined>();
  const onErrorRef = useRef(onError);
  const pinchRef = useRef<{ distance: number; zoom: number } | undefined>();
  const panRef = useRef<{ touchId: number; clientX: number; clientY: number; scrollLeft: number; scrollTop: number } | undefined>();
  const pendingAnchorRef = useRef<{
    fromScale: number;
    toScale: number;
    scrollLeft: number;
    scrollTop: number;
    anchorX: number;
    anchorY: number;
    clientX: number;
    clientY: number;
    canvasIndex?: number;
    normalizedX?: number;
    normalizedY?: number;
  } | undefined>();
  const edgePaddingRef = useRef(EMPTY_PADDING);
  const renderStateRef = useRef<"loading" | "ready" | "failed">("loading");
  const [renderState, setRenderState] = useState<"loading" | "ready" | "failed">("loading");
  const [pageCount, setPageCount] = useState<number | undefined>();
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomMode, setZoomMode] = useState<PdfZoomMode>("fit-width");
  const [zoomScale, setZoomScale] = useState(1);
  const [renderedScale, setRenderedScale] = useState(1);
  const [layoutVersion, setLayoutVersion] = useState(0);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    renderStateRef.current = renderState;
  }, [renderState]);

  const bindScrollRef = useCallback((element: HTMLDivElement | null) => {
    if (scrollRef.current === element) {
      return;
    }
    scrollRef.current = element;
    setScrollMountGeneration((generation) => generation + 1);
  }, []);

  const bindPagesRef = useCallback((element: HTMLDivElement | null) => {
    pagesRef.current = element;
  }, []);

  const getCanvasRef = useCallback((index: number) => {
    let callback = canvasRefCallbacksRef.current.get(index);
    if (!callback) {
      callback = (element: HTMLCanvasElement | null) => {
        canvasRefs.current[index] = element;
      };
      canvasRefCallbacksRef.current.set(index, callback);
    }
    return callback;
  }, []);

  const getPageRef = useCallback((index: number) => {
    let callback = pageRefCallbacksRef.current.get(index);
    if (!callback) {
      callback = (element: HTMLDivElement | null) => {
        pageRefs.current[index] = element;
      };
      pageRefCallbacksRef.current.set(index, callback);
    }
    return callback;
  }, []);

  const resetInteractionState = () => {
    pendingAnchorRef.current = undefined;
    edgePaddingRef.current = EMPTY_PADDING;
    pinchRef.current = undefined;
    panRef.current = undefined;
    firstPageSizeRef.current = undefined;
    setCurrentPage(1);
    setZoomMode("fit-width");
    setZoomScale(1);
    setRenderedScale(1);
    if (pagesRef.current) {
      pagesRef.current.style.padding = "";
    }
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
      scrollRef.current.scrollTop = 0;
    }
  };

  useLayoutEffect(() => {
    if (!blobUrl) {
      return;
    }
    setRenderState("loading");
    setPageCount(undefined);
    resetInteractionState();
  }, [blobUrl]);

  useEffect(() => {
    if (scrollMountGeneration < 0) {
      return;
    }
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      return;
    }

    let subscriptionActive = true;
    const resizeObserver = ports.createResizeObserver(() => {
      if (!subscriptionActive || scrollRef.current !== scrollElement) {
        return;
      }
      // Ignore resize notifications until the first successful render. Observing
      // during loading restarts the pdf.js pipeline and can leave the viewer stuck.
      if (renderStateRef.current !== "ready") {
        return;
      }
      setLayoutVersion((version) => version + 1);
    });
    if (!resizeObserver) {
      return;
    }

    resizeObserver.observe(scrollElement);

    return () => {
      subscriptionActive = false;
      resizeObserver.disconnect();
    };
  }, [scrollMountGeneration, ports]);

  useEffect(() => {
    if (scrollMountGeneration < 0 || !blobUrl || !scrollRef.current) {
      return;
    }

    let cancelled = false;
    const renderTasks: PdfRenderTask[] = [];
    let loadingTask: PdfLoadingTask | undefined;

    const renderPdf = async () => {
      setRenderState("loading");
      setPageCount(undefined);

      try {
        const response = await ports.fetch(blobUrl);
        if (!response.ok) {
          throw new Error("PDF bytes could not be loaded.");
        }

        const data = new Uint8Array(await response.arrayBuffer());
        if (cancelled) {
          return;
        }

        const pdfjsLib = await ports.loadPdfJs();
        if (cancelled) {
          return;
        }
        loadingTask = pdfjsLib.getDocument({ data });
        const pdf = await loadingTask.promise;
        const firstPage = await pdf.getPage(1);
        const firstPageSize = firstPage.getBaseSize();
        firstPageSizeRef.current = firstPageSize;
        const scrollElement = scrollRef.current;
        if (!scrollElement || cancelled) {
          return;
        }

        const availableWidth = Math.max(scrollElement.clientWidth - 32, 240);
        const availableHeight = Math.max(scrollElement.clientHeight - 32, 240);
        const fitWidthScale = resolveFitWidthScale(availableWidth, firstPageSize.width);
        const fitPageScale = resolveFitPageScale(
          availableWidth,
          availableHeight,
          firstPageSize.width,
          firstPageSize.height
        );
        const cssScale = resolveCssScale(zoomMode, zoomScale, fitWidthScale, fitPageScale);
        const outputScale = ports.getDevicePixelRatio();

        setPageCount(pdf.numPages);
        setRenderedScale(cssScale);
        await new Promise<void>((resolve) => {
          ports.requestAnimationFrame(() => {
            ports.requestAnimationFrame(() => resolve());
          });
        });

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) {
            return;
          }
          const page = pageNumber === 1 ? firstPage : await pdf.getPage(pageNumber);
          const canvas = canvasRefs.current[pageNumber - 1];
          const context = canvas?.getContext("2d");
          if (!canvas || !context) {
            continue;
          }

          const renderTask = page.render({
            canvas,
            canvasContext: context,
            cssScale,
            outputScale
          });
          renderTasks.push(renderTask);
          await renderTask.promise;
        }

        if (!cancelled) {
          setRenderState("ready");
          ports.requestAnimationFrame(updateCurrentPageFromScroll);
        }
      } catch {
        if (!cancelled) {
          setRenderState("failed");
          onErrorRef.current();
        }
      }
    };

    void renderPdf();

    return () => {
      cancelled = true;
      renderTasks.forEach((renderTask) => {
        try {
          renderTask.cancel();
        } catch {
          // Render work may already be complete.
        }
      });
      const task = loadingTask;
      if (task) {
        // Defer destroy until the load settles. Synchronously destroying an in-flight
        // pdf.js loading task can wedge the shared worker for later previews.
        void task.promise.then(
          () => {
            void task.destroy();
          },
          () => {
            void task.destroy();
          }
        );
      }
    };
  }, [blobUrl, layoutVersion, scrollMountGeneration, ports, zoomMode, zoomScale]);

  const updateCurrentPageFromScroll = () => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || !pageRefs.current.length) {
      return;
    }

    const pageCenters = pageRefs.current.map((pageElement) => {
      if (!pageElement) {
        return Number.POSITIVE_INFINITY;
      }
      return pageElement.offsetTop + pageElement.offsetHeight / 2;
    });
    const viewportCenter = scrollElement.scrollTop + scrollElement.clientHeight / 2;
    setCurrentPage(resolveCurrentPageFromCenters(viewportCenter, pageCenters));
  };

  useLayoutEffect(() => {
    const pendingAnchor = pendingAnchorRef.current;
    const scrollElement = scrollRef.current;
    if (
      renderState !== "ready" ||
      !pendingAnchor ||
      !scrollElement ||
      Math.abs(pendingAnchor.toScale - renderedScale) >= 0.01
    ) {
      return;
    }

    const anchorCanvas = pendingAnchor.canvasIndex === undefined ? undefined : canvasRefs.current[pendingAnchor.canvasIndex];
    if (anchorCanvas && pendingAnchor.normalizedX !== undefined && pendingAnchor.normalizedY !== undefined) {
      const canvasRect = anchorCanvas.getBoundingClientRect();
      const pagesElement = pagesRef.current;
      const padding = edgePaddingRef.current;
      const horizontal = resolveAnchoredScrollAxis(
        scrollElement.scrollLeft + canvasRect.left + pendingAnchor.normalizedX * canvasRect.width - pendingAnchor.clientX,
        Math.max(0, scrollElement.scrollWidth - padding.left - padding.right),
        scrollElement.clientWidth,
        padding.left,
        padding.right
      );
      const vertical = resolveAnchoredScrollAxis(
        scrollElement.scrollTop + canvasRect.top + pendingAnchor.normalizedY * canvasRect.height - pendingAnchor.clientY,
        Math.max(0, scrollElement.scrollHeight - padding.top - padding.bottom),
        scrollElement.clientHeight,
        padding.top,
        padding.bottom
      );
      const nextPadding = {
        top: vertical.leadingPadding,
        right: horizontal.trailingPadding,
        bottom: vertical.trailingPadding,
        left: horizontal.leadingPadding
      };
      edgePaddingRef.current = nextPadding;
      if (pagesElement) {
        pagesElement.style.padding = `${nextPadding.top}px ${nextPadding.right}px ${nextPadding.bottom}px ${nextPadding.left}px`;
      }
      scrollElement.scrollLeft = horizontal.target;
      scrollElement.scrollTop = vertical.target;
    } else {
      const ratio = renderedScale / Math.max(pendingAnchor.fromScale, 0.01);
      scrollElement.scrollLeft = Math.max(0, (pendingAnchor.scrollLeft + pendingAnchor.anchorX) * ratio - pendingAnchor.anchorX);
      scrollElement.scrollTop = Math.max(0, (pendingAnchor.scrollTop + pendingAnchor.anchorY) * ratio - pendingAnchor.anchorY);
    }
    pendingAnchorRef.current = undefined;
  }, [renderState, renderedScale]);

  const scrollToPage = (pageNumber: number) => {
    const targetPage = Math.max(1, Math.min(pageCount ?? 1, pageNumber));
    pageRefs.current[targetPage - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setCurrentPage(targetPage);
  };

  const getRenderedScaleFromCanvas = () => {
    const firstCanvas = canvasRefs.current[0];
    const firstPageSize = firstPageSizeRef.current;
    if (!firstCanvas || !firstPageSize) {
      return renderedScale;
    }
    return resolveRenderedScaleFromCanvas(firstCanvas.getBoundingClientRect().width, firstPageSize.width, renderedScale);
  };

  const setCustomZoom = (nextZoom: number, anchor?: { clientX: number; clientY: number }) => {
    const clampedZoom = clampPdfZoom(nextZoom);
    const scrollElement = scrollRef.current;
    const currentScale = getRenderedScaleFromCanvas();
    if (anchor && scrollElement) {
      const rect = scrollElement.getBoundingClientRect();
      const canvasAnchors = canvasRefs.current.flatMap((canvas, index) => {
        if (!canvas) {
          return [];
        }
        const canvasRect = canvas.getBoundingClientRect();
        const distanceX = anchor.clientX < canvasRect.left
          ? canvasRect.left - anchor.clientX
          : anchor.clientX > canvasRect.right
            ? anchor.clientX - canvasRect.right
            : 0;
        const distanceY = anchor.clientY < canvasRect.top
          ? canvasRect.top - anchor.clientY
          : anchor.clientY > canvasRect.bottom
            ? anchor.clientY - canvasRect.bottom
            : 0;
        return [{ canvasRect, distance: Math.hypot(distanceX, distanceY), index }];
      });
      const nearestCanvas = canvasAnchors.sort((left, right) => left.distance - right.distance)[0];
      pendingAnchorRef.current = {
        fromScale: currentScale,
        toScale: clampedZoom,
        scrollLeft: scrollElement.scrollLeft,
        scrollTop: scrollElement.scrollTop,
        anchorX: anchor.clientX - rect.left,
        anchorY: anchor.clientY - rect.top,
        clientX: anchor.clientX,
        clientY: anchor.clientY,
        canvasIndex: nearestCanvas?.index,
        normalizedX: nearestCanvas
          ? (anchor.clientX - nearestCanvas.canvasRect.left) / Math.max(nearestCanvas.canvasRect.width, 1)
          : undefined,
        normalizedY: nearestCanvas
          ? (anchor.clientY - nearestCanvas.canvasRect.top) / Math.max(nearestCanvas.canvasRect.height, 1)
          : undefined
      };
    } else {
      pendingAnchorRef.current = undefined;
    }
    setZoomMode("custom");
    setZoomScale(clampedZoom);
  };

  const setFitZoomMode = (mode: Exclude<PdfZoomMode, "custom">) => {
    pendingAnchorRef.current = undefined;
    edgePaddingRef.current = EMPTY_PADDING;
    if (pagesRef.current) {
      pagesRef.current.style.padding = "";
    }
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
      scrollRef.current.scrollTop = 0;
    }
    setZoomMode(mode);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    setCustomZoom(getRenderedScaleFromCanvas() + (event.deltaY < 0 ? PDF_ZOOM_STEP : -PDF_ZOOM_STEP), {
      clientX: event.clientX,
      clientY: event.clientY
    });
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touchPoints = toPdfTouchPoints(event.touches);
    if (event.touches.length === 2) {
      const distance = getPdfTouchDistance(touchPoints);
      if (distance > 0) {
        pinchRef.current = { distance, zoom: getRenderedScaleFromCanvas() };
        panRef.current = undefined;
      }
      return;
    }

    const touch = event.touches.item(0);
    const scrollElement = scrollRef.current;
    if (touch && scrollElement) {
      panRef.current = {
        touchId: touch.identifier,
        clientX: touch.clientX,
        clientY: touch.clientY,
        scrollLeft: scrollElement.scrollLeft,
        scrollTop: scrollElement.scrollTop
      };
    }
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const touchPoints = toPdfTouchPoints(event.touches);
    if (event.touches.length === 2 && pinchRef.current) {
      const nextDistance = getPdfTouchDistance(touchPoints);
      if (nextDistance <= 0) {
        return;
      }
      event.preventDefault();
      const midpoint = getPdfTouchMidpoint(touchPoints);
      setCustomZoom(
        pinchRef.current.zoom * (nextDistance / pinchRef.current.distance),
        midpoint ? { clientX: midpoint.x, clientY: midpoint.y } : undefined
      );
      return;
    }

    const pan = panRef.current;
    const scrollElement = scrollRef.current;
    if (event.touches.length !== 1 || !pan || !scrollElement) {
      return;
    }
    let touch: React.Touch | undefined;
    for (let index = 0; index < event.touches.length; index += 1) {
      const candidate = event.touches.item(index);
      if (candidate?.identifier === pan.touchId) {
        touch = candidate;
        break;
      }
    }
    if (!touch) {
      return;
    }
    event.preventDefault();
    scrollElement.scrollLeft = pan.scrollLeft - (touch.clientX - pan.clientX);
    scrollElement.scrollTop = pan.scrollTop - (touch.clientY - pan.clientY);
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2) {
      pinchRef.current = undefined;
    }
    if (event.touches.length === 0) {
      panRef.current = undefined;
    }
  };

  const visiblePageCount = pageCount ?? 1;
  const renderedZoomLabel = `${Math.round(renderedScale * 100)}%`;

  return {
    controls: {
      currentPage,
      pageCount,
      visiblePageCount,
      renderedZoomLabel,
      renderState,
      zoomMode,
      renderedScale,
      scrollToPreviousPage: () => scrollToPage(currentPage - 1),
      scrollToNextPage: () => scrollToPage(currentPage + 1),
      zoomOut: () => setCustomZoom(renderedScale - PDF_ZOOM_STEP),
      zoomIn: () => setCustomZoom(renderedScale + PDF_ZOOM_STEP),
      setFitWidth: () => setFitZoomMode("fit-width"),
      setFitPage: () => setFitZoomMode("fit-page")
    },
    stage: {
      scrollRef: bindScrollRef,
      pagesRef: bindPagesRef,
      setCanvasRef: getCanvasRef,
      setPageRef: getPageRef,
      visiblePageCount,
      pageCount,
      renderState,
      onScroll: updateCurrentPageFromScroll,
      onWheel: handleWheel,
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd
    }
  };
}
