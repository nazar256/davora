const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const ENCODED_SEPARATORS = /%2f|%5c/i;

declare const normalizedPathBrand: unique symbol;
declare const sandboxedPathBrand: unique symbol;

export type NormalizedPath = string & { readonly [normalizedPathBrand]: true };
export type SandboxedPath = NormalizedPath & { readonly [sandboxedPathBrand]: true };

function brandNormalizedPath(path: string): NormalizedPath {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the brand is created only after segment validation
  return path as NormalizedPath;
}

function brandSandboxedPath(path: string): SandboxedPath {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the brand is created only from two validated normalized paths
  return path as SandboxedPath;
}

function rejectInvalidCharacters(path: string): void {
  if (CONTROL_CHARS.test(path) || path.includes("\\")) {
    throw new Error("Path contains forbidden characters.");
  }
}

function normalizeSegments(rawPath: string | undefined): string[] {
  const trimmed = (rawPath ?? "").trim();
  rejectInvalidCharacters(trimmed);

  if (ENCODED_SEPARATORS.test(trimmed)) {
    throw new Error("Encoded path separators are not allowed.");
  }

  return trimmed
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment === "." || segment === "..") {
        throw new Error("Path traversal is not allowed.");
      }
      return segment;
    });
}

function joinSegments(segments: string[]): string {
  return segments.join("/");
}

export function parseNormalizedPath(rawPath: string | undefined): NormalizedPath {
  return brandNormalizedPath(joinSegments(normalizeSegments(rawPath)));
}

function relativeNormalizedPath(rootPath: NormalizedPath, fullPath: NormalizedPath): NormalizedPath {
  const rootSegments = normalizeSegments(rootPath);
  const fullSegments = normalizeSegments(fullPath);

  if (rootSegments.length > fullSegments.length) {
    throw new Error("Resolved path escapes configured root.");
  }

  for (let index = 0; index < rootSegments.length; index += 1) {
    if (rootSegments[index] !== fullSegments[index]) {
      throw new Error("Resolved path escapes configured root.");
    }
  }

  return brandNormalizedPath(joinSegments(fullSegments.slice(rootSegments.length)));
}

export function resolveWithinSandbox(rootPath: NormalizedPath, requestedPath: NormalizedPath): SandboxedPath {
  return brandSandboxedPath(joinSegments([...normalizeSegments(rootPath), ...normalizeSegments(requestedPath)]));
}

export function relativeToSandbox(rootPath: NormalizedPath, fullPath: SandboxedPath): NormalizedPath {
  return relativeNormalizedPath(rootPath, fullPath);
}

export function normalizeRootPath(rootPath: string | undefined): string {
  return parseNormalizedPath(rootPath);
}

export function resolveSandboxPath(rootPath: string | undefined, requestedPath?: string): string {
  return resolveWithinSandbox(parseNormalizedPath(rootPath), parseNormalizedPath(requestedPath));
}

export function stripSandboxRoot(rootPath: string | undefined, fullPath: string): string {
  return relativeNormalizedPath(parseNormalizedPath(rootPath), parseNormalizedPath(fullPath));
}

export function toDisplayPath(path: string): string {
  return path ? `/${path}` : "/";
}

export function dirname(path: string): string {
  const segments = normalizeSegments(path);
  return joinSegments(segments.slice(0, -1));
}

export function basename(path: string): string {
  const segments = normalizeSegments(path);
  return segments.at(-1) ?? "";
}
