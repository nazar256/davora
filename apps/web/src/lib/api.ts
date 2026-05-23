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

const BROWSER_DOWNLOAD_TARGET = "davora-browser-download";

function ensureBrowserDownloadTarget(): HTMLIFrameElement {
  const existingTarget = document.getElementById(BROWSER_DOWNLOAD_TARGET);
  if (existingTarget instanceof HTMLIFrameElement) {
    return existingTarget;
  }

  const target = document.createElement("iframe");
  target.hidden = true;
  target.id = BROWSER_DOWNLOAD_TARGET;
  target.name = BROWSER_DOWNLOAD_TARGET;
  target.setAttribute("aria-hidden", "true");
  document.body.appendChild(target);
  return target;
}

function appendHiddenField(form: HTMLFormElement, name: string, value: string): void {
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = name;
  input.value = value;
  form.appendChild(input);
}

export async function downloadFile(path: string, token: string): Promise<void> {
  await request<MetadataResponse>(`/api/metadata?path=${encodeURIComponent(path)}`, {}, token);

  const target = ensureBrowserDownloadTarget();
  const form = document.createElement("form");
  form.action = apiUrl("/api/download");
  form.method = "POST";
  form.style.display = "none";
  form.target = target.name;
  appendHiddenField(form, "path", path);
  appendHiddenField(form, "token", token);
  document.body.appendChild(form);

  try {
    form.submit();
  } finally {
    form.remove();
  }
}
