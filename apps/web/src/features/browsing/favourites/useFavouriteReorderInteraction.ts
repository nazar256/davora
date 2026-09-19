import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { FavouritesPointerEnvironment } from "./ports";

export interface UseFavouriteReorderInteractionInput {
  readonly environment: FavouritesPointerEnvironment;
  readonly onReorder: (fromKey: string, toKey: string) => void;
}

export interface FavouriteReorderInteraction {
  readonly draggedKey: string | undefined;
  readonly start: (key: string) => void;
  readonly moveBefore: (targetKey: string) => void;
  readonly stop: () => void;
}

export function useFavouriteReorderInteraction(
  input: UseFavouriteReorderInteractionInput
): FavouriteReorderInteraction {
  const [draggedKey, setDraggedKey] = useState<string | undefined>();
  const draggedKeyRef = useRef<string | undefined>();
  const onReorderRef = useRef(input.onReorder);
  const environmentRef = useRef(input.environment);
  const removeListenersRef = useRef<(() => void) | undefined>();
  const retiredRef = useRef(false);

  const moveBefore = useCallback((targetKey: string) => {
    const fromKey = draggedKeyRef.current;
    if (retiredRef.current || !fromKey || fromKey === targetKey) {
      return;
    }
    onReorderRef.current(fromKey, targetKey);
  }, []);

  const stop = useCallback(() => {
    if (retiredRef.current) {
      return;
    }
    removeListenersRef.current?.();
    removeListenersRef.current = undefined;
    draggedKeyRef.current = undefined;
    setDraggedKey(undefined);
  }, []);

  const bindListeners = useCallback((environment: FavouritesPointerEnvironment) => {
    if (retiredRef.current || !draggedKeyRef.current || removeListenersRef.current) {
      return;
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (retiredRef.current || !draggedKeyRef.current) {
        return;
      }
      event.preventDefault();
      const target = environment.elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-favourite-key]");
      const targetKey = target?.dataset.favouriteKey;
      if (targetKey) {
        moveBefore(targetKey);
      }
    };
    const handlePointerStop = () => stop();
    const removePointerMove = environment.addWindowListener("pointermove", handlePointerMove, { passive: false });
    const removePointerUp = environment.addWindowListener("pointerup", handlePointerStop);
    const removePointerCancel = environment.addWindowListener("pointercancel", handlePointerStop);
    removeListenersRef.current = () => {
      removePointerMove();
      removePointerUp();
      removePointerCancel();
    };
  }, [moveBefore, stop]);

  useLayoutEffect(() => {
    onReorderRef.current = input.onReorder;
    if (input.environment === environmentRef.current) {
      return;
    }
    removeListenersRef.current?.();
    removeListenersRef.current = undefined;
    environmentRef.current = input.environment;
    bindListeners(input.environment);
  }, [bindListeners, input.environment, input.onReorder]);

  useLayoutEffect(() => {
    if (draggedKey && !removeListenersRef.current) {
      bindListeners(environmentRef.current);
    }
    return () => {
      if (!draggedKey) {
        return;
      }
      removeListenersRef.current?.();
      removeListenersRef.current = undefined;
    };
  }, [bindListeners, draggedKey]);

  useLayoutEffect(() => {
    retiredRef.current = false;
    return () => {
    retiredRef.current = true;
    removeListenersRef.current?.();
    removeListenersRef.current = undefined;
    draggedKeyRef.current = undefined;
    };
  }, []);

  const start = (key: string) => {
    if (retiredRef.current) {
      return;
    }
    if (draggedKeyRef.current === key) {
      bindListeners(environmentRef.current);
      return;
    }
    removeListenersRef.current?.();
    removeListenersRef.current = undefined;
    draggedKeyRef.current = key;
    setDraggedKey(key);
  };

  return { draggedKey, start, moveBefore, stop };
}
