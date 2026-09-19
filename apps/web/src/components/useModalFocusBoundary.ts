import { useLayoutEffect, useRef, type RefObject } from "react";

const TABBABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "details > summary:first-of-type",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable=\"false\"])",
  "[tabindex]"
].join(",");

let activeBoundaryCount = 0;
let sessionActive = false;
let sessionReturnTarget: HTMLElement | null = null;
let lastClosedBoundary: HTMLElement | null = null;
let restoreToken = 0;

function currentHTMLElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function isHiddenOrInert(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.hidden || current.hasAttribute("inert") || current.getAttribute("aria-hidden") === "true") return true;
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return true;
    current = current.parentElement;
  }
  return false;
}

function isTabbable(element: HTMLElement): boolean {
  if (!element.matches(TABBABLE_SELECTOR) || isHiddenOrInert(element)) return false;
  if (element.hasAttribute("disabled") || element.matches(":disabled") || element.tabIndex < 0) return false;
  return true;
}

function tabbableDescendants(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)].filter(isTabbable);
}

function focusWithoutScroll(element: HTMLElement): void {
  element.focus({ preventScroll: true });
}

function focusInitialTarget(root: HTMLElement): void {
  const active = currentHTMLElement();
  if (active && root.contains(active)) return;
  const first = tabbableDescendants(root)[0];
  focusWithoutScroll(first ?? root);
}

function scheduleSessionRestore(): void {
  const token = ++restoreToken;
  queueMicrotask(() => {
    if (token !== restoreToken || activeBoundaryCount !== 0) return;

    const target = sessionReturnTarget;
    const closedBoundary = lastClosedBoundary;
    sessionActive = false;
    sessionReturnTarget = null;
    lastClosedBoundary = null;

    if (!target?.isConnected) return;
    const active = currentHTMLElement();
    const focusWasMovedByCloseHandler = active
      && active !== document.body
      && active.isConnected
      && (!closedBoundary || !closedBoundary.contains(active));
    if (focusWasMovedByCloseHandler) return;
    focusWithoutScroll(target);
  });
}

/** Owns keyboard containment, Escape dismissal, and opener return for one transient modal focus session. */
export function useModalFocusBoundary<T extends HTMLElement>(open: boolean, onDismiss?: () => void): RefObject<T> {
  const dialogRef = useRef<T>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  if (!open) {
    openerRef.current = null;
  } else if (typeof document !== "undefined" && !openerRef.current && !sessionActive && activeBoundaryCount === 0) {
    const active = currentHTMLElement();
    openerRef.current = active && active !== document.body ? active : null;
  }

  useLayoutEffect(() => {
    if (!open) return undefined;
    const root = dialogRef.current;
    if (!root) return undefined;

    if (sessionActive && activeBoundaryCount === 0) restoreToken += 1;
    if (!sessionActive) {
      sessionActive = true;
      sessionReturnTarget = openerRef.current;
    }
    activeBoundaryCount += 1;
    lastClosedBoundary = null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissRef.current) {
        event.preventDefault();
        event.stopPropagation();
        dismissRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const tabbables = tabbableDescendants(root);
      if (tabbables.length === 0) {
        event.preventDefault();
        focusWithoutScroll(root);
        return;
      }

      const active = currentHTMLElement();
      const currentIndex = active ? tabbables.indexOf(active) : -1;
      const nextIndex = event.shiftKey
        ? currentIndex <= 0 ? tabbables.length - 1 : currentIndex - 1
        : currentIndex < 0 || currentIndex >= tabbables.length - 1 ? 0 : currentIndex + 1;
      event.preventDefault();
      focusWithoutScroll(tabbables[nextIndex]);
    };

    root.addEventListener("keydown", onKeyDown);
    focusInitialTarget(root);

    return () => {
      root.removeEventListener("keydown", onKeyDown);
      activeBoundaryCount = Math.max(0, activeBoundaryCount - 1);
      lastClosedBoundary = root;
      if (activeBoundaryCount === 0) scheduleSessionRestore();
    };
  }, [open]);

  return dialogRef;
}
