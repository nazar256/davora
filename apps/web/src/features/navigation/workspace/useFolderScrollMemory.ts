import { useLayoutEffect, useRef, type RefObject } from "react";

export interface FolderScrollMemoryInput {
  readonly fileListRef: RefObject<HTMLElement>;
  readonly viewKey: string;
  readonly listReady: boolean;
}

export const useFolderScrollMemory = (input: FolderScrollMemoryInput): void => {
  const inputRef = useRef(input);
  const positionsRef = useRef(new Map<string, number>());
  const boundRef = useRef<{ element: HTMLElement; record: () => void } | null>(null);
  const viewKeyRef = useRef(input.viewKey);
  const pendingRestoreRef = useRef<{ readonly viewKey: string; readonly top: number } | null>(null);

  useLayoutEffect(() => {
    inputRef.current = input;
  }, [input]);

  // The emptied list clamps scrollTop before a path-change effect can read it,
  // so the active view's offset is recorded continuously on scroll events.
  useLayoutEffect(() => {
    const element = inputRef.current.fileListRef.current;
    if (!element || element === boundRef.current?.element) {
      return;
    }
    const record = () => {
      positionsRef.current.set(viewKeyRef.current, element.scrollTop);
    };
    element.addEventListener("scroll", record, { passive: true });
    if (boundRef.current) {
      boundRef.current.element.removeEventListener("scroll", boundRef.current.record);
    }
    boundRef.current = { element, record };
  });

  useLayoutEffect(() => () => {
    if (boundRef.current) {
      boundRef.current.element.removeEventListener("scroll", boundRef.current.record);
      boundRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    if (viewKeyRef.current === input.viewKey) {
      return;
    }
    viewKeyRef.current = input.viewKey;
    const saved = positionsRef.current.get(input.viewKey);
    pendingRestoreRef.current = saved !== undefined && saved > 0
      ? { viewKey: input.viewKey, top: saved }
      : null;
    const element = inputRef.current.fileListRef.current;
    if (element) {
      element.scrollTop = 0;
    }
  }, [input.viewKey]);

  useLayoutEffect(() => {
    const pending = pendingRestoreRef.current;
    if (!pending || pending.viewKey !== input.viewKey || !input.listReady) {
      return;
    }
    const element = boundRef.current?.element ?? inputRef.current.fileListRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = pending.top;
    positionsRef.current.set(input.viewKey, element.scrollTop);
    pendingRestoreRef.current = null;
  }, [input.viewKey, input.listReady]);
};
