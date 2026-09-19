import { parseNormalizedPath } from "@davora/shared";

export const FOLDER_SORT_STORAGE_PREFIX = "davora-folder-sort:";

export const FOLDER_SORT_SAVE_FAILED_MESSAGE = "Sort preference could not be saved for this folder.";
export const FOLDER_SORT_CLEAR_FAILED_MESSAGE = "Folder sort settings could not be cleared.";

export const buildFolderSortClearedMessage = (removedCount: number): string => {
  if (removedCount === 0) {
    return "Folder sort settings cleared.";
  }
  return removedCount === 1
    ? "Folder sort settings cleared for 1 folder."
    : `Folder sort settings cleared for ${removedCount} folders.`;
};

export const buildFolderSortResetQuestion = (count: number): string =>
  `Clear saved sort for ${count} ${count === 1 ? "folder" : "folders"}?`;

const encodePart = (value: string): string => `${value.length}:${value}`;

export const folderSortStorageKey = (namespace: string, path: string): string =>
  `${FOLDER_SORT_STORAGE_PREFIX}${encodePart(namespace)}${encodePart(path)}`;

const isCanonicalPath = (path: unknown): path is string => {
  if (typeof path !== "string") return false;
  try {
    return parseNormalizedPath(path) === path;
  } catch {
    return false;
  }
};

const isValidNamespace = (namespace: unknown): namespace is string =>
  typeof namespace === "string" && namespace.length > 0;

type DecodedPart = { readonly value: string; readonly next: number };

const decodePart = (key: string, offset: number): DecodedPart | undefined => {
  const separator = key.indexOf(":", offset);
  if (separator < offset) return undefined;
  const lengthText = key.slice(offset, separator);
  if (!/^(?:0|[1-9]\d*)$/.test(lengthText)) return undefined;

  let length = 0;
  for (const character of lengthText) {
    const digit = character.charCodeAt(0) - 48;
    if (length > Math.floor((Number.MAX_SAFE_INTEGER - digit) / 10)) return undefined;
    length = length * 10 + digit;
  }
  const valueStart = separator + 1;
  const valueEnd = valueStart + length;
  if (valueEnd < valueStart || valueEnd > key.length) return undefined;
  return { value: key.slice(valueStart, valueEnd), next: valueEnd };
};

export interface DecodedFolderSortKey {
  readonly namespace: string;
  readonly path: string;
}

/** Strict parser used by namespace enumeration and clearing. Malformed keys are deliberately left untouched. */
export const decodeFolderSortStorageKey = (key: string): DecodedFolderSortKey | undefined => {
  if (typeof key !== "string" || !key.startsWith(FOLDER_SORT_STORAGE_PREFIX)) return undefined;
  const namespace = decodePart(key, FOLDER_SORT_STORAGE_PREFIX.length);
  if (!namespace) return undefined;
  const path = decodePart(key, namespace.next);
  if (!path || path.next !== key.length) return undefined;
  if (!isValidNamespace(namespace.value) || !isCanonicalPath(path.value)) return undefined;
  return { namespace: namespace.value, path: path.value };
};

export const planFolderSortNamespaceClear = (
  keys: readonly string[],
  namespace: string
): string[] => keys.filter((key) => decodeFolderSortStorageKey(key)?.namespace === namespace);
