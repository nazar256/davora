import type {
  ConnectAccountRequest,
  ConnectAccountResponse,
  CreateFolderRequest,
  FileResponse,
  FilesResponse,
  HealthResponse,
  MetadataResponse,
  MoveCopyRequest,
  MutationResponse,
  SearchResponse,
  SessionRequest,
  SessionResponse,
  UploadFileRequest
} from "@davora/shared";

import {
  clearAccountSession,
  loadAccountState,
  markAccountReconnectRequired,
  removeStoredAccount,
  saveAccountSession,
  saveConnectedAccount,
  setActiveAccountId,
  type StoredAccountRecord
} from "./accountState";
import { getBrowserIdentity } from "./browserIdentity";

export function resolveApiBase(rawBaseUrl: string | undefined): string {
  return (rawBaseUrl?.trim() || "") || "";
}

const API_BASE = resolveApiBase(import.meta.env.VITE_API_BASE_URL);

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: string
  ) {
    super(message);
  }
}

function browserAuthHeaders(): Record<string, string> {
  const { browserId, browserSecret } = getBrowserIdentity();
  return {
    "x-davora-browser-id": browserId,
    "x-davora-browser-secret": browserSecret
  };
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as { data?: { message?: string; code?: string; details?: string } } | undefined;
    throw new ApiRequestError(payload?.data?.message ?? `Request failed with ${response.status}`, response.status, payload?.data?.code, payload?.data?.details);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()).data as T;
}

export function loadStoredAccounts() {
  return loadAccountState();
}

export function saveActiveAccount(accountId: string) {
  return setActiveAccountId(accountId);
}

export function markStoredAccountReconnectRequired(accountId: string) {
  return markAccountReconnectRequired(accountId);
}

export function clearStoredAccountSession(accountId: string) {
  return clearAccountSession(accountId);
}

export function removeAccountFromStorage(accountId: string) {
  return removeStoredAccount(accountId);
}

export async function getHealth() {
  return request<HealthResponse>("/api/health");
}

export async function connectAccount(requestBody: ConnectAccountRequest) {
  const data = await request<ConnectAccountResponse>("/api/accounts", {
    method: "POST",
    headers: browserAuthHeaders(),
    body: JSON.stringify(requestBody)
  });
  saveConnectedAccount(data.account);
  return data;
}

export async function createSession(requestBody: SessionRequest) {
  const data = await request<SessionResponse>("/api/session", {
    method: "POST",
    headers: browserAuthHeaders(),
    body: JSON.stringify(requestBody)
  });
  saveAccountSession(requestBody.accountId, data.session);
  return data.session;
}

export async function deleteConnectedAccount(accountId: string) {
  await request<void>(`/api/accounts/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
    headers: browserAuthHeaders()
  });
  removeStoredAccount(accountId);
}

export function getStoredAccount(accountId: string): StoredAccountRecord | undefined {
  return loadAccountState().accounts.find((record) => record.account.id === accountId);
}

export async function listFiles(path: string, token: string) {
  return request<FilesResponse>(`/api/files?path=${encodeURIComponent(path)}`, {}, token);
}

export async function getMetadata(path: string, token: string) {
  return request<MetadataResponse>(`/api/metadata?path=${encodeURIComponent(path)}`, {}, token);
}

export async function getFile(path: string, token: string) {
  return request<FileResponse>(`/api/file?path=${encodeURIComponent(path)}`, {}, token);
}

export async function searchFiles(path: string, query: string, token: string) {
  return request<SearchResponse>(`/api/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(query)}`, {}, token);
}

export async function fetchOriginalFile(path: string, token: string): Promise<{ blob: Blob; mimeType: string; filename: string }> {
  const response = await fetch(apiUrl(`/api/file/original?path=${encodeURIComponent(path)}`), {
    headers: {
      authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new ApiRequestError(`Original file request failed with ${response.status}`, response.status);
  }

  const blob = await response.blob();
  const filename = response.headers.get("content-disposition")?.match(/filename\*=UTF-8''(.+)$/)?.[1];
  return {
    blob,
    mimeType: response.headers.get("content-type") ?? blob.type,
    filename: filename ? decodeURIComponent(filename) : path.split("/").pop() || "file"
  };
}

export async function createFolder(requestBody: CreateFolderRequest, token: string) {
  return request<MutationResponse>("/api/folders", {
    method: "POST",
    body: JSON.stringify(requestBody)
  }, token);
}

export async function uploadFile(requestBody: UploadFileRequest, token: string) {
  return request<MutationResponse>("/api/upload", {
    method: "POST",
    body: JSON.stringify(requestBody)
  }, token);
}

function parseApiErrorPayload(raw: unknown): { message?: string; code?: string; details?: string } | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const envelope = raw as { data?: unknown };
  if (!envelope.data || typeof envelope.data !== "object") {
    return undefined;
  }
  const data = envelope.data as { message?: unknown; code?: unknown; details?: unknown };
  return {
    message: typeof data.message === "string" ? data.message : undefined,
    code: typeof data.code === "string" ? data.code : undefined,
    details: typeof data.details === "string" ? data.details : undefined
  };
}

async function xhrJson<T>(
  path: string,
  method: "POST",
  body: string,
  token: string,
  options: {
    onUploadProgress?: (loaded: number, total: number) => void;
  } = {}
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, apiUrl(path));
    xhr.setRequestHeader("content-type", "application/json");
    xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.responseType = "text";

    if (options.onUploadProgress) {
      const total = body.length;
      xhr.upload.onprogress = (event) => {
        // Some browsers set lengthComputable=false for string bodies; use our known body size.
        const loaded = typeof event.loaded === "number" ? event.loaded : 0;
        options.onUploadProgress?.(Math.max(0, loaded), total);
      };
    }

    xhr.onerror = () => reject(new ApiRequestError("Request failed", 0));
    xhr.onabort = () => reject(new ApiRequestError("Request aborted", 0));
    xhr.onload = () => {
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
        reject(new ApiRequestError(parsed?.message ?? `Request failed with ${status}`, status, parsed?.code, parsed?.details));
        return;
      }

      try {
        const parsed = JSON.parse(text) as { data?: unknown };
        resolve(parsed.data as T);
      } catch {
        reject(new ApiRequestError("Response was not valid JSON.", status));
      }
    };

    xhr.send(body);
  });
}

export async function uploadFileWithProgress(
  requestBody: UploadFileRequest,
  token: string,
  onUploadProgress?: (loadedBytes: number, totalBytes: number) => void
) {
  return await xhrJson<MutationResponse>("/api/upload", "POST", JSON.stringify(requestBody), token, { onUploadProgress });
}

export async function moveFile(requestBody: MoveCopyRequest, token: string) {
  return request<MutationResponse>("/api/move", {
    method: "POST",
    body: JSON.stringify(requestBody)
  }, token);
}

export async function copyFile(requestBody: MoveCopyRequest, token: string) {
  return request<MutationResponse>("/api/copy", {
    method: "POST",
    body: JSON.stringify(requestBody)
  }, token);
}

export async function deleteFile(requestBody: { path: string; confirmName: string }, token: string) {
  return request<MutationResponse>("/api/delete", {
    method: "POST",
    body: JSON.stringify(requestBody)
  }, token);
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
  } = {}
): Promise<void> {
  const metadata = await request<MetadataResponse>(`/api/metadata?path=${encodeURIComponent(path)}`, {}, token);

  const { blob, filename } = await fetchDownloadBlob(path, token, options);
  const resolvedFilename = filename ?? metadata.metadata.name ?? path.split("/").pop() ?? "file";
  triggerBrowserDownload(blob, resolvedFilename);
}

export async function fetchDownloadBlob(
  path: string,
  token: string,
  options: {
    onProgress?: (loadedBytes: number, totalBytes?: number) => void;
  } = {}
): Promise<{ blob: Blob; filename?: string }> {
  const response = await fetch(apiUrl(`/api/download?path=${encodeURIComponent(path)}`), {
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    throw new ApiRequestError(`Download request failed with ${response.status}`, response.status);
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
