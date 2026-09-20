import {
  assertCreateFolderResponseIdentity,
  assertDeleteResponseIdentity,
  assertMoveCopyResponseIdentity,
  assertUploadResponseIdentity,
  copyEndpoint,
  createFolderEndpoint,
  deleteEndpoint,
  filesEndpoint,
  metadataEndpoint,
  moveEndpoint,
  previewEndpoint,
  searchEndpoint,
  uploadEndpoint,
  type ApiEnvelope,
  type FileResponse,
  type FilesResponse,
  type MetadataResponse,
  type SearchResponse
} from "@davora/shared";
import { Buffer } from "node:buffer";

import { isWorkerFailure, normalizeFileWorkerFailure, workerFailure } from "../http/failure";
import type { ParsedWorkerRoute } from "../http/router";
import { json } from "../security/http";
import type { FileBackend } from "./backend";

export type FileApplicationRoute = Exclude<ParsedWorkerRoute, { id: "health" | "reset" | "connectAccount" | "deleteAccount" | "session" | "streamToken" }>;

function inlineHeaders(contentType: string | undefined, filename: string): Headers {
  return new Headers({
    "content-type": contentType ?? "application/octet-stream",
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "cache-control": "no-store"
  });
}

export async function executeFileRoute(
  route: FileApplicationRoute,
  request: Request,
  backend: FileBackend
): Promise<Response> {
  try {
    switch (route.id) {
      case "files": {
        const payload: ApiEnvelope<FilesResponse> = { data: { path: route.input.path, items: [...await backend.list(route.input.path)] } };
        return json(filesEndpoint.successSchema.parse(payload));
      }
      case "metadata": {
        const metadata = await backend.metadata(route.input.path);
        if (!metadata) throw workerFailure("resource_not_found", "metadata");
        const payload: ApiEnvelope<MetadataResponse> = { data: { metadata } };
        return json(metadataEndpoint.successSchema.parse(payload));
      }
      case "preview": {
        const file = await backend.preview(route.input.path);
        if (!file) throw workerFailure("file_not_found", "preview");
        const payload: ApiEnvelope<FileResponse> = { data: { file } };
        return json(previewEndpoint.successSchema.parse(payload));
      }
      case "original": {
        const original = await backend.original(route.input.path);
        if (!original) throw workerFailure("file_not_found", "original");
        return new Response(Buffer.from(original.body), { headers: inlineHeaders(original.metadata.mimeType, original.metadata.name) });
      }
      case "stream": {
        const stream = await backend.stream(route.input.path, request.headers.get("range"));
        if (!stream) throw workerFailure("file_not_found", "stream");
        const headers = inlineHeaders(stream.contentType ?? stream.metadata.mimeType, stream.metadata.name);
        headers.set("accept-ranges", "bytes");
        if (stream.contentLength !== undefined) headers.set("content-length", String(stream.contentLength));
        if (stream.contentRange) headers.set("content-range", stream.contentRange);
        const body = stream.body instanceof Uint8Array ? Buffer.from(stream.body) : stream.body;
        return new Response(body, { status: stream.status, headers });
      }
      case "search": {
        const payload: ApiEnvelope<SearchResponse> = { data: { query: route.input.query, path: route.input.path, items: [...await backend.search(route.input.path, route.input.query)] } };
        return json(searchEndpoint.successSchema.parse(payload));
      }
      case "download": {
        const file = await backend.download(route.input.path);
        if (!file) throw workerFailure("file_not_found", "download");
        return new Response(Buffer.from(file.body), {
          headers: {
            "content-type": file.mimeType,
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
            "cache-control": "no-store"
          }
        });
      }
      case "createFolder": {
        const result = await backend.createFolder(route.input);
        const payload = createFolderEndpoint.successSchema.parse({ data: { result } });
        assertCreateFolderResponseIdentity(route.input, payload.data);
        return json(payload, 201);
      }
      case "upload": {
        const result = await backend.upload(route.input);
        const payload = uploadEndpoint.successSchema.parse({ data: { result } });
        assertUploadResponseIdentity(route.input, payload.data);
        return json(payload, 201);
      }
      case "move": {
        const result = await backend.move(route.input);
        const payload = moveEndpoint.successSchema.parse({ data: { result } });
        assertMoveCopyResponseIdentity("move", route.input, payload.data);
        return json(payload);
      }
      case "copy": {
        const result = await backend.copy(route.input);
        const payload = copyEndpoint.successSchema.parse({ data: { result } });
        assertMoveCopyResponseIdentity("copy", route.input, payload.data);
        return json(payload, 201);
      }
      case "delete": {
        const result = await backend.delete(route.input);
        const payload = deleteEndpoint.successSchema.parse({ data: { result } });
        assertDeleteResponseIdentity(route.input, payload.data);
        return json(payload);
      }
    }
  } catch (error) {
    if (isWorkerFailure(error)) throw error;
    throw normalizeFileWorkerFailure(error);
  }
}
