import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, TouchEvent, WheelEvent } from "react";

import { resolveAnchoredScrollAxis } from "../../../lib/anchoredScroll";

import {
  clampImageZoom,
  getRenderedImageContentRect,
  getTouchDistance,
  getTouchMidpoint,
  normalizeImageAnchor,
  resolveFillPan,
  type ImagePadding,
  type ImagePoint
} from "./geometry";

const IMAGE_ZOOM_STEP = 0.15;
const EMPTY_PADDING: ImagePadding = { top: 0, right: 0, bottom: 0, left: 0 };

interface ImagePreviewSource {
  enabled: boolean;
  path?: string;
  blobUrl?: string;
}

interface ImagePreviewInteractionOptions {
  source: ImagePreviewSource;
  fitMode: "fill" | "fit";
  onFitModeChange: (mode: "fill" | "fit") => void;
}

interface ImagePreviewControls {
  hasCustomZoom: boolean;
  zoomScale?: number;
  zoomLabel: string;
  toggleFitMode: () => void;
  showOriginalSize: () => void;
}

interface ImagePreviewOwner {
  readonly fitMode: "fill" | "fit";
  readonly onFitModeChange: (mode: "fill" | "fit") => void;
  retired: boolean;
}

export interface ImagePreviewStageBindings {
  stageRef: (element: HTMLDivElement | null) => void;
  hasCustomZoom: boolean;
  imageStyle: CSSProperties | undefined;
  onImageLoad: (event: React.SyntheticEvent<HTMLImageElement>) => void;
  onImageError: (event: React.SyntheticEvent<HTMLImageElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onTouchStart: (event: TouchEvent<HTMLDivElement>) => void;
  onTouchMove: (event: TouchEvent<HTMLDivElement>) => void;
  onTouchEnd: (event: TouchEvent<HTMLDivElement>) => void;
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
  consumeSuppressedAdvance: () => boolean;
}

export interface ImagePreviewInteraction {
  failed: boolean;
  controls: ImagePreviewControls;
  stage: ImagePreviewStageBindings;
}

function toImageTouchPoints(touches: React.TouchList): ImagePoint[] {
  const points: ImagePoint[] = [];
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index);
    if (touch) {
      points.push({ x: touch.clientX, y: touch.clientY });
    }
  }
  return points;
}

function toClientPoint(point: ImagePoint | undefined): { clientX: number; clientY: number } | undefined {
  return point ? { clientX: point.x, clientY: point.y } : undefined;
}

export function useImagePreviewInteraction({ source, fitMode, onFitModeChange }: ImagePreviewInteractionOptions): ImagePreviewInteraction {
  const [failed, setFailed] = useState(false);
  const [pan, setPan] = useState<ImagePoint>({ x: 50, y: 50 });
  const [naturalSize, setNaturalSize] = useState<ImagePoint | undefined>();
  const [zoomScale, setZoomScale] = useState<number | undefined>();
  const owner = useMemo<ImagePreviewOwner>(() => ({
    fitMode,
    onFitModeChange,
    retired: false
  }), [fitMode, onFitModeChange]);
  const currentOwnerRef = useRef<ImagePreviewOwner | undefined>();
  const mountedRef = useRef(false);
  const resetSourceRef = useRef<{ enabled: boolean; path?: string; blobUrl?: string } | undefined>();
  const panStartRef = useRef<{ pointerId: number; clientX: number; clientY: number; startX: number; startY: number } | undefined>();
  const pinchRef = useRef<{ distance: number; zoom: number } | undefined>();
  const scrollPanRef = useRef<{ touchId: number; clientX: number; clientY: number; scrollLeft: number; scrollTop: number } | undefined>();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stageOwnerRef = useRef<ImagePreviewOwner | undefined>();
  const pendingStageRef = useRef<{ owner: ImagePreviewOwner; element: HTMLDivElement | null } | undefined>();
  const edgePaddingRef = useRef<ImagePadding>(EMPTY_PADDING);
  const zoomAnchorRef = useRef<{
    zoom: number;
    clientX: number;
    clientY: number;
    normalizedX: number;
    normalizedY: number;
  } | undefined>();
  const suppressAdvanceRef = useRef(false);

  const isCurrentOwner = useCallback((candidate: ImagePreviewOwner): boolean => (
    mountedRef.current && !candidate.retired && currentOwnerRef.current === candidate
  ), []);

  const currentStageFor = useCallback((candidate: ImagePreviewOwner): HTMLDivElement | undefined => {
    const stageElement = stageRef.current;
    return isCurrentOwner(candidate) && stageOwnerRef.current === candidate && stageElement ? stageElement : undefined;
  }, [isCurrentOwner]);

  const isCurrentStageEvent = useCallback((candidate: ImagePreviewOwner, stageElement: HTMLDivElement): boolean => (
    currentStageFor(candidate) === stageElement
  ), [currentStageFor]);

  const currentImageFor = useCallback((candidate: ImagePreviewOwner, imageElement: HTMLImageElement): HTMLImageElement | undefined => {
    const stageElement = currentStageFor(candidate);
    const currentImage = stageElement?.querySelector<HTMLImageElement>("img.media-preview-image");
    return currentImage === imageElement ? currentImage : undefined;
  }, [currentStageFor]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      currentOwnerRef.current = undefined;
      stageOwnerRef.current = undefined;
      stageRef.current = null;
      pendingStageRef.current = undefined;
      edgePaddingRef.current = EMPTY_PADDING;
      zoomAnchorRef.current = undefined;
      panStartRef.current = undefined;
      pinchRef.current = undefined;
      scrollPanRef.current = undefined;
      suppressAdvanceRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    owner.retired = false;
    currentOwnerRef.current = owner;
    const pendingStage = pendingStageRef.current;
    if (pendingStage?.owner === owner) {
      stageRef.current = pendingStage.element;
      stageOwnerRef.current = pendingStage.element ? owner : undefined;
      pendingStageRef.current = undefined;
    }

    return () => {
      owner.retired = true;
      if (currentOwnerRef.current === owner) {
        currentOwnerRef.current = undefined;
      }
      if (stageOwnerRef.current === owner) {
        stageOwnerRef.current = undefined;
        stageRef.current = null;
      }
      if (pendingStageRef.current?.owner === owner) {
        pendingStageRef.current = undefined;
      }
    };
  }, [owner]);

  const resetStagePosition = useCallback((candidate: ImagePreviewOwner) => {
    if (!isCurrentOwner(candidate)) {
      return;
    }
    edgePaddingRef.current = EMPTY_PADDING;
    zoomAnchorRef.current = undefined;
    panStartRef.current = undefined;
    pinchRef.current = undefined;
    scrollPanRef.current = undefined;
    suppressAdvanceRef.current = false;
    const stageElement = currentStageFor(candidate);
    const imageElement = stageElement?.querySelector<HTMLImageElement>("img.media-preview-image");
    if (imageElement) {
      imageElement.style.margin = "";
      imageElement.style.display = "";
    }
    if (stageElement) {
      stageElement.scrollLeft = 0;
      stageElement.scrollTop = 0;
    }
  }, [currentStageFor, isCurrentOwner]);

  useLayoutEffect(() => {
    const previousSource = resetSourceRef.current;
    if (
      previousSource
      && previousSource.enabled === source.enabled
      && previousSource.path === source.path
      && previousSource.blobUrl === source.blobUrl
    ) {
      return;
    }
    if (!isCurrentOwner(owner)) {
      return;
    }
    resetSourceRef.current = { blobUrl: source.blobUrl, enabled: source.enabled, path: source.path };
    setFailed(false);
    setPan({ x: 50, y: 50 });
    setNaturalSize(undefined);
    setZoomScale(undefined);
    resetStagePosition(owner);
  }, [isCurrentOwner, owner, resetStagePosition, source.blobUrl, source.enabled, source.path]);

  useLayoutEffect(() => {
    const candidate = owner;
    const pendingAnchor = zoomAnchorRef.current;
    const stageElement = candidate ? currentStageFor(candidate) : undefined;
    if (!pendingAnchor || !stageElement || zoomScale === undefined || Math.abs(pendingAnchor.zoom - zoomScale) > 0.001) {
      return;
    }

    const imageElement = stageElement.querySelector<HTMLImageElement>("img.media-preview-image");
    if (!imageElement) {
      return;
    }

    const imageRect = imageElement.getBoundingClientRect();
    const padding = edgePaddingRef.current;
    const horizontal = resolveAnchoredScrollAxis(
      stageElement.scrollLeft + imageRect.left + pendingAnchor.normalizedX * imageRect.width - pendingAnchor.clientX,
      imageRect.width,
      stageElement.clientWidth,
      padding.left,
      padding.right
    );
    const vertical = resolveAnchoredScrollAxis(
      stageElement.scrollTop + imageRect.top + pendingAnchor.normalizedY * imageRect.height - pendingAnchor.clientY,
      imageRect.height,
      stageElement.clientHeight,
      padding.top,
      padding.bottom
    );
    const nextPadding = {
      top: vertical.leadingPadding,
      right: horizontal.trailingPadding,
      bottom: vertical.trailingPadding,
      left: horizontal.leadingPadding
    };
    if (!candidate || !isCurrentOwner(candidate) || currentStageFor(candidate) !== stageElement) {
      return;
    }
    edgePaddingRef.current = nextPadding;
    imageElement.style.margin = `${nextPadding.top}px ${nextPadding.right}px ${nextPadding.bottom}px ${nextPadding.left}px`;
    stageElement.scrollLeft = horizontal.target;
    stageElement.scrollTop = vertical.target;
    zoomAnchorRef.current = undefined;
  }, [currentStageFor, isCurrentOwner, owner, source.blobUrl, source.enabled, source.path, zoomScale]);

  const previousFitModeRef = useRef(fitMode);
  useEffect(() => {
    if (previousFitModeRef.current === fitMode) {
      return;
    }
    previousFitModeRef.current = fitMode;
    if (fitMode === "fit" && isCurrentOwner(owner)) {
      setPan({ x: 50, y: 50 });
    }
  }, [fitMode, isCurrentOwner, owner]);

  const resetEdgePadding = useCallback((candidate: ImagePreviewOwner) => {
    if (!isCurrentOwner(candidate)) {
      return;
    }
    edgePaddingRef.current = EMPTY_PADDING;
    zoomAnchorRef.current = undefined;
    const stageElement = currentStageFor(candidate);
    const imageElement = stageElement?.querySelector<HTMLImageElement>("img.media-preview-image");
    if (imageElement) {
      imageElement.style.margin = "";
    }
    if (stageElement) {
      stageElement.scrollLeft = 0;
      stageElement.scrollTop = 0;
    }
  }, [currentStageFor, isCurrentOwner]);

  const setCustomZoom = useCallback((candidate: ImagePreviewOwner, nextZoom: number) => {
    if (!isCurrentOwner(candidate) || !source.enabled || !source.path || !source.blobUrl) {
      return;
    }
    resetEdgePadding(candidate);
    if (!isCurrentOwner(candidate)) {
      return;
    }
    setZoomScale(clampImageZoom(nextZoom));
  }, [isCurrentOwner, resetEdgePadding, source.blobUrl, source.enabled, source.path]);

  const getDisplayedZoom = useCallback((candidate: ImagePreviewOwner) => {
    const stageElement = currentStageFor(candidate);
    if (!stageElement || !naturalSize) {
      return zoomScale ?? 1;
    }

    const widthScale = stageElement.clientWidth / Math.max(naturalSize.x, 1);
    const heightScale = stageElement.clientHeight / Math.max(naturalSize.y, 1);
    return clampImageZoom(candidate.fitMode === "fill" ? Math.max(widthScale, heightScale) : Math.min(widthScale, heightScale));
  }, [currentStageFor, naturalSize, zoomScale]);

  const setAnchoredZoom = useCallback((candidate: ImagePreviewOwner, nextZoom: number, anchor?: { clientX: number; clientY: number }) => {
    if (!isCurrentOwner(candidate) || !source.enabled || !source.path || !source.blobUrl) {
      return;
    }
    const stageElement = currentStageFor(candidate);
    const clampedZoom = clampImageZoom(nextZoom);
    const imageElement = stageElement?.querySelector<HTMLImageElement>("img.media-preview-image");
    if (!anchor || !stageElement || !imageElement) {
      zoomAnchorRef.current = undefined;
      if (!isCurrentOwner(candidate)) {
        return;
      }
      setZoomScale(clampedZoom);
      return;
    }

    const imageRect = getRenderedImageContentRect(
      imageElement.getBoundingClientRect(),
      { width: imageElement.naturalWidth, height: imageElement.naturalHeight },
      zoomScale === undefined ? fitMode : undefined,
      pan
    );
    const normalizedAnchor = normalizeImageAnchor({ x: anchor.clientX, y: anchor.clientY }, imageRect);
    zoomAnchorRef.current = { zoom: clampedZoom, clientX: anchor.clientX, clientY: anchor.clientY, normalizedX: normalizedAnchor.x, normalizedY: normalizedAnchor.y };
    setZoomScale(clampedZoom);
  }, [currentStageFor, fitMode, isCurrentOwner, pan, source.blobUrl, source.enabled, source.path, zoomScale]);

  const hasCustomZoom = zoomScale !== undefined;
  const imageStyle: CSSProperties | undefined = hasCustomZoom
    ? {
      width: naturalSize ? `${Math.round(naturalSize.x * (zoomScale ?? 1))}px` : undefined,
      height: naturalSize ? `${Math.round(naturalSize.y * (zoomScale ?? 1))}px` : undefined,
      margin: `${edgePaddingRef.current.top}px ${edgePaddingRef.current.right}px ${edgePaddingRef.current.bottom}px ${edgePaddingRef.current.left}px`
    }
    : fitMode === "fill"
      ? { objectPosition: `${pan.x}% ${pan.y}%` }
      : undefined;

  return {
    failed,
    controls: {
      hasCustomZoom,
      zoomScale,
      zoomLabel: `${Math.round((zoomScale ?? 1) * 100)}%`,
      toggleFitMode: () => {
        if (!isCurrentOwner(owner) || !source.enabled || !source.path || !source.blobUrl) {
          return;
        }
        resetEdgePadding(owner);
        if (!isCurrentOwner(owner)) {
          return;
        }
        setZoomScale(undefined);
        if (!isCurrentOwner(owner)) {
          return;
        }
        owner.onFitModeChange(owner.fitMode === "fill" && !hasCustomZoom ? "fit" : "fill");
      },
      showOriginalSize: () => setCustomZoom(owner, 1)
    },
    stage: {
      stageRef: (element) => {
        if (owner.retired) {
          return;
        }
        pendingStageRef.current = { owner, element };
        if (currentOwnerRef.current !== owner || !mountedRef.current) {
          return;
        }
        if (element) {
          stageRef.current = element;
          stageOwnerRef.current = owner;
        } else if (stageOwnerRef.current === owner) {
          stageRef.current = null;
          stageOwnerRef.current = undefined;
        }
      },
      hasCustomZoom,
      imageStyle,
      onImageLoad: (event) => {
        const image = currentImageFor(owner, event.currentTarget);
        if (!image) {
          return;
        }
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth > 0 && naturalHeight > 0) {
          setNaturalSize({ x: naturalWidth, y: naturalHeight });
        }
      },
      onImageError: (event) => {
        const image = currentImageFor(owner, event.currentTarget);
        if (!image) {
          return;
        }
        event.currentTarget.style.display = "none";
        setFailed(true);
      },
      onPointerDown: (event) => {
        if (!isCurrentStageEvent(owner, event.currentTarget) || !source.enabled || !source.path || !source.blobUrl || hasCustomZoom || owner.fitMode !== "fill") {
          return;
        }
        panStartRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, startX: pan.x, startY: pan.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event) => {
        const start = panStartRef.current;
        if (!start || start.pointerId !== event.pointerId || !isCurrentStageEvent(owner, event.currentTarget) || !source.enabled || !source.path || !source.blobUrl || hasCustomZoom || owner.fitMode !== "fill") {
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        if (Math.abs(event.clientX - start.clientX) > 6 || Math.abs(event.clientY - start.clientY) > 6) {
          suppressAdvanceRef.current = true;
        }
        setPan(resolveFillPan(
          { x: start.startX, y: start.startY },
          { x: start.clientX, y: start.clientY },
          { x: event.clientX, y: event.clientY },
          { width: rect.width, height: rect.height }
        ));
      },
      onPointerEnd: (event) => {
        if (!isCurrentStageEvent(owner, event.currentTarget)) {
          return;
        }
        if (panStartRef.current?.pointerId === event.pointerId) {
          panStartRef.current = undefined;
        }
      },
      onTouchStart: (event) => {
        if (!isCurrentStageEvent(owner, event.currentTarget) || !source.enabled || !source.path || !source.blobUrl) {
          return;
        }
        if (event.touches.length === 2) {
          const distance = getTouchDistance(toImageTouchPoints(event.touches));
          if (distance > 0) {
            pinchRef.current = { distance, zoom: zoomScale ?? getDisplayedZoom(owner) };
            scrollPanRef.current = undefined;
            suppressAdvanceRef.current = true;
          }
          return;
        }

        const touch = event.touches.item(0);
        const stageElement = currentStageFor(owner);
        if (touch && stageElement && hasCustomZoom) {
          scrollPanRef.current = { touchId: touch.identifier, clientX: touch.clientX, clientY: touch.clientY, scrollLeft: stageElement.scrollLeft, scrollTop: stageElement.scrollTop };
        }
      },
      onTouchMove: (event) => {
        if (!isCurrentStageEvent(owner, event.currentTarget) || !source.enabled || !source.path || !source.blobUrl) {
          return;
        }
        if (event.touches.length === 2 && pinchRef.current) {
          const nextDistance = getTouchDistance(toImageTouchPoints(event.touches));
          if (nextDistance <= 0) {
            return;
          }
          event.preventDefault();
          suppressAdvanceRef.current = true;
          setAnchoredZoom(owner, pinchRef.current.zoom * (nextDistance / pinchRef.current.distance), toClientPoint(getTouchMidpoint(toImageTouchPoints(event.touches))));
          return;
        }

        const panState = scrollPanRef.current;
        const stageElement = currentStageFor(owner);
        if (!hasCustomZoom || event.touches.length !== 1 || !panState || !stageElement) {
          return;
        }
        let touch: React.Touch | undefined;
        for (let index = 0; index < event.touches.length; index += 1) {
          const candidate = event.touches.item(index);
          if (candidate?.identifier === panState.touchId) {
            touch = candidate;
            break;
          }
        }
        if (!touch) {
          return;
        }
        event.preventDefault();
        suppressAdvanceRef.current = true;
        stageElement.scrollLeft = panState.scrollLeft - (touch.clientX - panState.clientX);
        stageElement.scrollTop = panState.scrollTop - (touch.clientY - panState.clientY);
      },
      onTouchEnd: (event) => {
        if (!isCurrentStageEvent(owner, event.currentTarget)) {
          return;
        }
        if (event.touches.length < 2) {
          pinchRef.current = undefined;
        }
        if (event.touches.length === 0) {
          scrollPanRef.current = undefined;
        }
      },
      onWheel: (event) => {
        if (!isCurrentStageEvent(owner, event.currentTarget) || !source.enabled || !source.path || !source.blobUrl || (!event.ctrlKey && !event.metaKey)) {
          return;
        }
        event.preventDefault();
        suppressAdvanceRef.current = true;
        setAnchoredZoom(owner, (zoomScale ?? getDisplayedZoom(owner)) + (event.deltaY < 0 ? IMAGE_ZOOM_STEP : -IMAGE_ZOOM_STEP), { clientX: event.clientX, clientY: event.clientY });
      },
      consumeSuppressedAdvance: () => {
        if (!isCurrentOwner(owner) || !source.enabled || !source.path || !source.blobUrl) {
          return false;
        }
        if (!suppressAdvanceRef.current) {
          return false;
        }
        suppressAdvanceRef.current = false;
        return true;
      }
    }
  };
}
