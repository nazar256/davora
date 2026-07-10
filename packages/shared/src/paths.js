const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const ENCODED_SEPARATORS = /%2f|%5c/i;
function rejectInvalidCharacters(path) {
    if (CONTROL_CHARS.test(path) || path.includes("\\")) {
        throw new Error("Path contains forbidden characters.");
    }
}
function normalizeSegments(rawPath) {
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
function joinSegments(segments) {
    return segments.join("/");
}
export function normalizeRootPath(rootPath) {
    return joinSegments(normalizeSegments(rootPath));
}
export function resolveSandboxPath(rootPath, requestedPath) {
    return joinSegments([...normalizeSegments(rootPath), ...normalizeSegments(requestedPath)]);
}
export function stripSandboxRoot(rootPath, fullPath) {
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
    return joinSegments(fullSegments.slice(rootSegments.length));
}
export function toDisplayPath(path) {
    return path ? `/${path}` : "/";
}
export function dirname(path) {
    const segments = normalizeSegments(path);
    return joinSegments(segments.slice(0, -1));
}
export function basename(path) {
    const segments = normalizeSegments(path);
    return segments.at(-1) ?? "";
}
