import type {
  CreateFolderRequest,
  FileResponse,
  MetadataResponse,
  MoveCopyRequest,
  SearchResponse,
  StreamTokenResponse,
  UploadFileRequest
} from "@davora/shared";
import {
  assertCreateFolderResponseIdentity,
  assertMoveCopyResponseIdentity,
  assertDeleteResponseIdentity,
  assertUploadResponseIdentity,
  copyEndpoint,
  createFolderEndpoint,
  deleteEndpoint,
  filesEndpoint,
  moveEndpoint,
  searchEndpoint,
  uploadEndpoint,
  metadataEndpoint,
  previewEndpoint,
  originalEndpoint,
  streamTokenEndpoint,
  streamEndpoint,
  downloadEndpoint,
  apiErrorEnvelopeSchema,
  type ApiError
} from "@davora/shared";
import { assertBackendNetworkAllowed, backendFetch, registerBackendRequestAbort } from "./networkPolicy";

export function resolveApiBase(rawBaseUrl: string | undefined): string {
  return (rawBaseUrl?.trim() || "") || "";
}

const API_BASE = resolveApiBase(import.meta.env.VITE_API_BASE_URL);

export function backendApiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: string,
    readonly responseDiagnostic?: ApiResponseDiagnostic
  ) {
    super(message);
  }
}

export type SafeDiagnosticValueType = "undefined" | "null" | "boolean" | "number" | "string" | "array" | "object";

export interface ApiResponseIssueDiagnostic {
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly expectedType?: string;
  readonly actualType: SafeDiagnosticValueType;
}

export interface ApiResponseDiagnostic {
  readonly phase: "json-decode" | "envelope-schema";
  readonly status: number;
  readonly contentType: "json" | "html" | "text" | "binary" | "other" | "missing";
  readonly payloadBytes: number;
  readonly workerBuild?: string;
  readonly apiContract?: string;
  readonly issues?: readonly ApiResponseIssueDiagnostic[];
  readonly truncatedIssueCount?: number;
}

interface SuccessEnvelopeParser<T> {
  parse(value: unknown): { data: T };
}

const diagnosticValueType = (value: unknown): SafeDiagnosticValueType => {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const kind = typeof value;
  if (kind === "boolean" || kind === "number" || kind === "string") return kind;
  return "object";
};

const classifyContentType = (value: string | null): ApiResponseDiagnostic["contentType"] => {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  if (!normalized) return "missing";
  if (normalized === "application/json" || normalized.endsWith("+json")) return "json";
  if (normalized === "text/html") return "html";
  if (normalized.startsWith("text/")) return "text";
  if (normalized === "application/octet-stream" || normalized.startsWith("image/") || normalized.startsWith("audio/") || normalized.startsWith("video/")) return "binary";
  return "other";
};

const safeBuildHeader = (value: string | null, maxLength: number): string | undefined => {
  const normalized = value?.trim();
  return normalized && normalized.length <= maxLength && /^[A-Za-z0-9._-]+$/.test(normalized)
    ? normalized
    : undefined;
};

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const valueAtIssuePath = (payload: unknown, path: readonly (string | number)[]): unknown => {
  let current = payload;
  for (const segment of path) {
    if (typeof segment === "number" && Array.isArray(current)) {
      current = current[segment];
    } else if (typeof segment === "string" && isUnknownRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
};

const safeIssuePath = (value: unknown): readonly (string | number)[] => {
  if (!Array.isArray(value)) return [];
  const result: Array<string | number> = [];
  for (const segment of value.slice(0, 8)) {
    if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0) result.push(segment);
    if (typeof segment === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(segment)) result.push(segment);
  }
  return result;
};

const summarizeSchemaIssues = (error: unknown, payload: unknown): Pick<ApiResponseDiagnostic, "issues" | "truncatedIssueCount"> => {
  if (typeof error !== "object" || error === null || !("issues" in error) || !Array.isArray(error.issues)) {
    return {};
  }
  const rawIssues = error.issues;
  const issues = rawIssues.slice(0, 10).map((raw): ApiResponseIssueDiagnostic => {
    const issue = isUnknownRecord(raw) ? raw : {};
    const path = safeIssuePath(issue.path);
    const code = typeof issue.code === "string" && /^[a-z0-9_-]{1,40}$/i.test(issue.code)
      ? issue.code
      : "invalid";
    const expectedType = typeof issue.expected === "string" && /^[a-z0-9_-]{1,40}$/i.test(issue.expected)
      ? issue.expected
      : undefined;
    return {
      path,
      code,
      expectedType,
      actualType: diagnosticValueType(valueAtIssuePath(payload, path))
    };
  });
  return {
    issues,
    ...(rawIssues.length > issues.length ? { truncatedIssueCount: rawIssues.length - issues.length } : {})
  };
};

const responseDiagnosticBase = (response: Response, payloadBytes: number) => ({
  status: response.status,
  contentType: classifyContentType(response.headers.get("content-type")),
  payloadBytes,
  workerBuild: safeBuildHeader(response.headers.get("x-davora-worker-build"), 64),
  apiContract: safeBuildHeader(response.headers.get("x-davora-api-contract"), 32)
});

export async function throwHttpRequestError(response: Response): Promise<never> {
  const payload = parseApiErrorPayload(await response.json().catch(() => undefined));
  throw new ApiRequestError(payload?.message ?? `Request failed with ${response.status}`, response.status, payload?.code, payload?.details);
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
  successSchema?: SuccessEnvelopeParser<T>
): Promise<T> {
  const response = await backendFetch(backendApiUrl(path), {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    return throwHttpRequestError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (successSchema) {
    const text = await response.text();
    const payloadBytes = new TextEncoder().encode(text).byteLength;
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new ApiRequestError("The server returned an invalid response.", response.status, "invalid_response", undefined, {
        phase: "json-decode",
        ...responseDiagnosticBase(response, payloadBytes)
      });
    }
    try {
      return successSchema.parse(payload).data;
    } catch (error) {
      throw new ApiRequestError("The server returned an invalid response.", response.status, "invalid_response", undefined, {
        phase: "envelope-schema",
        ...responseDiagnosticBase(response, payloadBytes),
        ...summarizeSchemaIssues(error, payload)
      });
    }
  }

  return (await response.json()).data as T;
}

export async function listFiles(path: string, token: string, signal?: AbortSignal) {
  const requestInput = filesEndpoint.requestSchema.parse({ path });
  return request(
    `${filesEndpoint.path}?path=${encodeURIComponent(requestInput.path)}`,
    { method: filesEndpoint.method, signal },
    token,
    filesEndpoint.successSchema
  );
}

export async function getMetadata(path: string, token: string) {
  const input = metadataEndpoint.requestSchema.parse({ path });
  return request<MetadataResponse>(`${metadataEndpoint.path}?path=${encodeURIComponent(input.path)}`, { method: metadataEndpoint.method }, token, metadataEndpoint.successSchema);
}

export async function getFile(path: string, token: string, signal?: AbortSignal) {
  const input = previewEndpoint.requestSchema.parse({ path });
  return request<FileResponse>(`${previewEndpoint.path}?path=${encodeURIComponent(input.path)}`, { method: previewEndpoint.method, signal }, token, previewEndpoint.successSchema);
}

export async function searchFiles(path: string, query: string, token: string, signal?: AbortSignal) {
  const input = searchEndpoint.requestSchema.parse({ path, query });
  return request<SearchResponse>(
    `${searchEndpoint.path}?path=${encodeURIComponent(input.path)}&q=${encodeURIComponent(input.query)}`,
    { method: searchEndpoint.method, signal },
    token,
    searchEndpoint.successSchema
  );
}

export async function fetchOriginalFile(path: string, token: string, signal?: AbortSignal): Promise<{ blob: Blob; mimeType: string; filename: string }> {
  const input = originalEndpoint.requestSchema.parse({ path });
  const response = await backendFetch(backendApiUrl(`${originalEndpoint.path}?path=${encodeURIComponent(input.path)}`), {
    method: originalEndpoint.method,
    headers: {
      authorization: `Bearer ${token}`
    },
    signal
  });

  if (!response.ok) {
    return throwHttpRequestError(response);
  }

  const blob = await response.blob();
  const filename = response.headers.get("content-disposition")?.match(/filename\*=UTF-8''(.+)$/)?.[1];
  return {
    blob,
    mimeType: response.headers.get("content-type") ?? blob.type,
    filename: filename ? decodeURIComponent(filename) : path.split("/").pop() || "file"
  };
}

export async function createStreamingFileUrl(path: string, token: string, signal?: AbortSignal): Promise<string> {
  const input = streamTokenEndpoint.requestSchema.parse({ path });
  const stream = await request<StreamTokenResponse>(`${streamTokenEndpoint.path}?path=${encodeURIComponent(input.path)}`, {
    method: streamTokenEndpoint.method,
    signal
  }, token, streamTokenEndpoint.successSchema);
  return backendApiUrl(`${streamEndpoint.path}?path=${encodeURIComponent(input.path)}&streamToken=${encodeURIComponent(stream.token)}`);
}

export async function createFolder(requestBody: CreateFolderRequest, token: string) {
  const input = createFolderEndpoint.requestSchema.parse(requestBody);
  return request(
    createFolderEndpoint.path,
    { method: createFolderEndpoint.method, body: JSON.stringify(input) },
    token,
    {
      parse(value: unknown) {
        const envelope = createFolderEndpoint.successSchema.parse(value);
        assertCreateFolderResponseIdentity(input, envelope.data);
        return envelope;
      }
    }
  );
}

export async function uploadFile(requestBody: UploadFileRequest, token: string) {
  const input = uploadEndpoint.requestSchema.parse(requestBody);
  return request(
    uploadEndpoint.path,
    { method: uploadEndpoint.method, body: JSON.stringify(input) },
    token,
    {
      parse(value: unknown) {
        const envelope = uploadEndpoint.successSchema.parse(value);
        assertUploadResponseIdentity(input, envelope.data);
        return envelope;
      }
    }
  );
}

export function parseApiErrorPayload(raw: unknown): ApiError | undefined {
  const parsed = apiErrorEnvelopeSchema.safeParse(raw);
  if (parsed.success) return parsed.data.data;
  // Preserve the existing client behavior for forward-compatible server error
  // codes while still requiring the stable envelope/message shape.
  if (typeof raw !== "object" || raw === null || !("data" in raw) || typeof raw.data !== "object" || raw.data === null) {
    return undefined;
  }
  const data = raw.data as Record<string, unknown>;
  if (typeof data.code !== "string" || !data.code || typeof data.message !== "string") {
    return undefined;
  }
  return {
    code: data.code as ApiError["code"],
    message: data.message,
    ...(typeof data.details === "string" ? { details: data.details } : {})
  };
}

async function xhrJson<T>(
  path: string,
  method: "POST",
  body: string,
  token: string,
  options: {
    onUploadProgress?: (loaded: number, total: number) => void;
    signal?: AbortSignal;
    successSchema: SuccessEnvelopeParser<T>;
  }
): Promise<T> {
  assertBackendNetworkAllowed();
  return await new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const unregisterAbort = registerBackendRequestAbort(() => xhr.abort());
    const abortFromSignal = () => xhr.abort();
    let settled = false;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      unregisterAbort();
      options.signal?.removeEventListener("abort", abortFromSignal);
      xhr.upload.onprogress = null;
      xhr.onload = null;
      xhr.onloadend = null;
      xhr.onerror = null;
      xhr.onabort = null;
    };
    const resolveOnce = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const rejectOnce = (error: ApiRequestError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    if (options.signal?.aborted) {
      cleanup();
      rejectOnce(new ApiRequestError("Request aborted", 0));
      return;
    }
    options.signal?.addEventListener("abort", abortFromSignal, { once: true });
    xhr.open(method, backendApiUrl(path));
    xhr.setRequestHeader("content-type", "application/json");
    xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.responseType = "text";

    if (options.onUploadProgress) {
      const total = body.length;
      xhr.upload.onprogress = (event) => {
        if (settled) return;
        // Some browsers set lengthComputable=false for string bodies; use our known body size.
        const loaded = typeof event.loaded === "number" ? event.loaded : 0;
        options.onUploadProgress?.(Math.max(0, loaded), total);
      };
    }

    xhr.onloadend = cleanup;
    xhr.onerror = () => rejectOnce(new ApiRequestError("Request failed", 0));
    xhr.onabort = () => rejectOnce(new ApiRequestError("Request aborted", 0));
    xhr.onload = () => {
      if (settled) return;
      const status = xhr.status;
      const text = xhr.responseText ?? "";
      if (status < 200 || status >= 300) {
        const parsed = (() => {
          try {
            return parseApiErrorPayload(JSON.parse(text));
          } catch {
            return undefined;
          }
        })();
        rejectOnce(new ApiRequestError(parsed?.message ?? `Request failed with ${status}`, status, parsed?.code, parsed?.details));
        return;
      }

      try {
        const parsed: unknown = JSON.parse(text);
        resolveOnce(options.successSchema.parse(parsed).data);
      } catch {
        rejectOnce(new ApiRequestError("The server returned an invalid response.", status, "invalid_response"));
      }
    };

    xhr.send(body);
  });
}

export async function uploadFileWithProgress(
  requestBody: UploadFileRequest,
  token: string,
  onUploadProgress?: (loadedBytes: number, totalBytes: number) => void,
  signal?: AbortSignal
) {
  const input = uploadEndpoint.requestSchema.parse(requestBody);
  return await xhrJson(
    uploadEndpoint.path,
    uploadEndpoint.method,
    JSON.stringify(input),
    token,
    {
      onUploadProgress,
      signal,
      successSchema: {
        parse(value: unknown) {
          const envelope = uploadEndpoint.successSchema.parse(value);
          assertUploadResponseIdentity(input, envelope.data);
          return envelope;
        }
      }
    }
  );
}

export async function moveFile(requestBody: MoveCopyRequest, token: string) {
  const input = moveEndpoint.requestSchema.parse(requestBody);
  return request(
    moveEndpoint.path,
    { method: moveEndpoint.method, body: JSON.stringify(input) },
    token,
    {
      parse(value: unknown) {
        const envelope = moveEndpoint.successSchema.parse(value);
        assertMoveCopyResponseIdentity("move", input, envelope.data);
        return envelope;
      }
    }
  );
}

export async function copyFile(requestBody: MoveCopyRequest, token: string) {
  const input = copyEndpoint.requestSchema.parse(requestBody);
  return request(
    copyEndpoint.path,
    { method: copyEndpoint.method, body: JSON.stringify(input) },
    token,
    {
      parse(value: unknown) {
        const envelope = copyEndpoint.successSchema.parse(value);
        assertMoveCopyResponseIdentity("copy", input, envelope.data);
        return envelope;
      }
    }
  );
}

export async function deleteFile(requestBody: { path: string; confirmName: string }, token: string) {
  const input = deleteEndpoint.requestSchema.parse(requestBody);
  return request(
    deleteEndpoint.path,
    { method: deleteEndpoint.method, body: JSON.stringify(input) },
    token,
    {
      parse(value: unknown) {
        const envelope = deleteEndpoint.successSchema.parse(value);
        assertDeleteResponseIdentity(input, envelope.data);
        return envelope;
      }
    }
  );
}

export async function resetMockBackend(): Promise<void> {
  await request<void>("/api/mock/reset", {
    method: "POST",
    headers: {
      "x-davora-reset-token": import.meta.env.DEV ? "playwright-dev-secret" : ""
    }
  });
}

export async function downloadFile(
  path: string,
  token: string,
  options: {
    onProgress?: (loadedBytes: number, totalBytes?: number) => void;
    signal?: AbortSignal;
  } = {}
): Promise<void> {
  const prepared = await prepareDownloadFile(path, token, options);
  triggerBrowserDownload(prepared.blob, prepared.filename);
}

export async function prepareDownloadFile(
  path: string,
  token: string,
  options: {
    onProgress?: (loadedBytes: number, totalBytes?: number) => void;
    signal?: AbortSignal;
  } = {}
): Promise<{ blob: Blob; filename: string }> {
  const input = metadataEndpoint.requestSchema.parse({ path });
  const metadata = await request<MetadataResponse>(`${metadataEndpoint.path}?path=${encodeURIComponent(input.path)}`, { method: metadataEndpoint.method, signal: options.signal }, token, metadataEndpoint.successSchema);
  const { blob, filename } = await fetchDownloadBlob(path, token, options);
  const resolvedFilename = filename ?? metadata.metadata.name ?? path.split("/").pop() ?? "file";
  return { blob, filename: resolvedFilename };
}

export async function fetchDownloadBlob(
  path: string,
  token: string,
  options: {
    onProgress?: (loadedBytes: number, totalBytes?: number) => void;
    signal?: AbortSignal;
  } = {}
): Promise<{ blob: Blob; filename?: string }> {
  const input = downloadEndpoint.requestSchema.parse({ path });
  const response = await backendFetch(backendApiUrl(`${downloadEndpoint.path}?path=${encodeURIComponent(input.path)}`), {
    method: downloadEndpoint.method,
    headers: {
      authorization: `Bearer ${token}`
    },
    signal: options.signal
  });
  if (!response.ok) {
    return throwHttpRequestError(response);
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const totalHeader = response.headers.get("content-length");
  const total = totalHeader ? Number.parseInt(totalHeader, 10) : undefined;
  let blob: Blob;

  if (response.body && typeof response.body.getReader === "function") {
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    const reader = response.body.getReader();
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      if (result.value) {
        chunks.push(result.value);
        loaded += result.value.byteLength;
        options.onProgress?.(loaded, Number.isFinite(total ?? NaN) ? total : undefined);
      }
    }
    if (loaded === 0) {
      options.onProgress?.(0, Number.isFinite(total ?? NaN) ? total : undefined);
    }
    blob = new Blob(
      chunks.map((c) =>
        c.buffer instanceof ArrayBuffer
          ? c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength)
          : new Uint8Array(c).buffer
      ),
      { type: contentType }
    );
  } else {
    blob = await response.blob();
  }

  const contentDisposition = response.headers.get("content-disposition") ?? "";
  const candidateFilename = contentDisposition.match(/filename\*=UTF-8''(.+)$/)?.[1];
  return {
    blob,
    filename: candidateFilename ? decodeURIComponent(candidateFilename) : undefined
  };
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener noreferrer";
  anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
