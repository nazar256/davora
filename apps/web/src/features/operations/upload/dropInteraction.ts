export interface DropInteractionState {
  readonly active: boolean;
}

export interface FileDragTransfer {
  readonly types: readonly string[];
  readonly files: ArrayLike<File>;
}

export function hasFileDrag(dataTransfer: FileDragTransfer | null | undefined): boolean {
  if (!dataTransfer) {
    return false;
  }
  const types = Array.from(dataTransfer.types ?? []);
  return types.length > 0 ? types.includes("Files") : dataTransfer.files.length > 0;
}

export function isInternalDragLeave(
  currentTarget: EventTarget | null,
  relatedTarget: EventTarget | null
): boolean {
  return relatedTarget instanceof Node
    && currentTarget instanceof Node
    && currentTarget.contains(relatedTarget);
}
