import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { UploadSource } from "./model";
import { hasFileDrag, isInternalDragLeave } from "./dropInteraction";
import { useUpload, type UseUploadInput } from "./useUpload";

interface UploadInteractionDataTransfer {
  readonly types: readonly string[];
  readonly files: ArrayLike<File>;
  dropEffect: string;
}

interface UploadDragDataEvent {
  readonly dataTransfer: UploadInteractionDataTransfer;
  readonly currentTarget: EventTarget | null;
  preventDefault(): void;
}

interface UploadDragLeaveEvent {
  readonly currentTarget: EventTarget | null;
  readonly relatedTarget: EventTarget | null;
}

export interface UseUploadInteractionInput extends UseUploadInput {
  readonly dropAllowed: boolean;
  canDrop(): boolean;
}

export interface UploadDropInteraction {
  readonly active: boolean;
  readonly onDragEnter: (event: UploadDragDataEvent) => void;
  readonly onDragLeave: (event: UploadDragLeaveEvent) => void;
  readonly onDragOver: (event: UploadDragDataEvent) => void;
  readonly onDrop: (event: UploadDragDataEvent) => void;
}

export interface UploadInteraction {
  readonly uploadFiles: (files: FileList | File[] | null, source?: UploadSource) => Promise<void>;
  readonly drop: UploadDropInteraction;
}

export function useUploadInteraction(input: UseUploadInteractionInput): UploadInteraction {
  const inputRef = useRef(input);
  inputRef.current = input;
  const [active, setActive] = useState(false);
  const { uploadFiles } = useUpload(input);

  useLayoutEffect(() => {
    if (active && !input.dropAllowed) {
      setActive(false);
    }
  }, [active, input.dropAllowed]);

  const onDragEnter = useCallback((event: UploadDragDataEvent) => {
    if (!inputRef.current.canDrop() || !hasFileDrag(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    setActive(true);
  }, []);

  const onDragLeave = useCallback((event: UploadDragLeaveEvent) => {
    if (isInternalDragLeave(event.currentTarget, event.relatedTarget)) {
      return;
    }
    setActive(false);
  }, []);

  const onDragOver = useCallback((event: UploadDragDataEvent) => {
    if (!inputRef.current.canDrop() || !hasFileDrag(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setActive(true);
  }, []);

  const onDrop = useCallback((event: UploadDragDataEvent) => {
    setActive(false);
    if (!inputRef.current.canDrop() || !hasFileDrag(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) {
      void uploadFiles(files, "drop");
    }
  }, [uploadFiles]);

  return {
    uploadFiles,
    drop: { active, onDragEnter, onDragLeave, onDragOver, onDrop }
  };
}
