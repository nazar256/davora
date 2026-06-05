export function getViewerKind(mimeType) {
    const normalizedMimeType = mimeType?.split(";", 1)[0]?.trim().toLowerCase();
    if (!normalizedMimeType) {
        return "text";
    }
    if (normalizedMimeType === "application/pdf") {
        return "pdf";
    }
    if (normalizedMimeType === "text/markdown" || normalizedMimeType.includes("markdown")) {
        return "markdown";
    }
    if (normalizedMimeType.startsWith("text/")) {
        return "text";
    }
    if (normalizedMimeType.startsWith("image/")) {
        return "image";
    }
    if (normalizedMimeType.startsWith("audio/")) {
        return "audio";
    }
    if (normalizedMimeType.startsWith("video/")) {
        return "video";
    }
    if (["json", "xml", "javascript"].some((part) => normalizedMimeType.includes(part))) {
        return "text";
    }
    return "unsupported";
}
export function buildCapabilitySet(backend, options = {}) {
    const readOnly = options.readOnly ?? false;
    return {
        backend,
        readOnly,
        search: true,
        preview: true,
        download: true,
        offlineCache: true,
        createFolder: !readOnly,
        upload: !readOnly,
        move: !readOnly,
        copy: !readOnly,
        delete: !readOnly,
        mediaPreview: true,
        markdownPreview: true,
        openedFileCache: true
    };
}
