import {
  apiEndpoints,
  type ConnectAccountRequest,
  type CreateFolderRequestInput,
  type DeleteRequestInput,
  type DiagnosticReportMetadata,
  type FilePathRequest,
  type FilesRequest,
  type MoveCopyRequestInput,
  type SearchRequest,
  type SessionRequest,
  type UploadRequestInput
} from "@davora/shared";

import { isWorkerFailure, workerFailure, type WorkerFailure } from "./failure";

interface RouteBase<Id extends string, Auth extends "public" | "browser" | "session" | "stream", Input> {
  readonly id: Id;
  readonly auth: Auth;
  readonly input: Input;
  readonly inputError?: undefined;
}

export type ParsedWorkerRoute =
  | RouteBase<"health", "public", undefined>
  | RouteBase<"reset", "public", undefined>
  | RouteBase<"connectAccount", "browser", ConnectAccountRequest>
  | RouteBase<"deleteAccount", "browser", { accountId: string }>
  | RouteBase<"session", "browser", SessionRequest>
  | RouteBase<"files", "session", FilesRequest>
  | RouteBase<"metadata", "session", FilePathRequest>
  | RouteBase<"preview", "session", FilePathRequest>
  | RouteBase<"original", "session", FilePathRequest>
  | RouteBase<"streamToken", "session", FilePathRequest>
  | RouteBase<"stream", "session" | "stream", FilePathRequest>
  | RouteBase<"search", "session", SearchRequest>
  | (RouteBase<"download", "session", FilePathRequest> & { readonly authorityToken?: string })
  | RouteBase<"createFolder", "session", CreateFolderRequestInput>
  | RouteBase<"upload", "session", UploadRequestInput>
  | RouteBase<"move", "session", MoveCopyRequestInput>
  | RouteBase<"copy", "session", MoveCopyRequestInput>
  | RouteBase<"delete", "session", DeleteRequestInput>
  | RouteBase<"diagnosticReport", "session", DiagnosticReportMetadata>;

/**
 * Route for a request whose endpoint matched but whose input failed validation.
 * The failure is deferred so authentication runs before the input error is
 * revealed; `handleWorkerApplication` rethrows `inputError` after the request
 * context is established, keeping unauthenticated callers on 401/403.
 */
export interface InvalidInputRoute {
  readonly id: ApiEndpointKey;
  readonly auth: "public" | "browser" | "session" | "stream";
  readonly input?: undefined;
  readonly inputError: WorkerFailure;
  readonly authorityToken?: string;
}

export type WorkerRoute = ParsedWorkerRoute | InvalidInputRoute;

type SessionMutationId = "createFolder" | "upload" | "move" | "copy" | "delete";

interface PendingMutationRoute {
  readonly id: SessionMutationId;
  readonly auth: "session";
  readonly inputState: "pending-body";
}

export type MatchedWorkerRoute = WorkerRoute | PendingMutationRoute;

const MALFORMED_JSON = Symbol("malformed-json");
type ApiEndpointKey = keyof typeof apiEndpoints;
type CatalogEndpoint = (typeof apiEndpoints)[ApiEndpointKey];
type CatalogRouteParser = (request: Request, url: URL) => WorkerRoute | Promise<WorkerRoute>;

function isApiEndpointKey(value: string): value is ApiEndpointKey {
  return Object.hasOwn(apiEndpoints, value);
}

export const catalogRouteKeys: readonly ApiEndpointKey[] = Object.freeze(
  Object.keys(apiEndpoints).filter(isApiEndpointKey)
);

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return MALFORMED_JSON;
  }
}

function pathInput(
  endpoint: Pick<CatalogEndpoint, "requestSchema">,
  url: URL,
  failureKind: "invalid_file_query" | "invalid_stream_token_path" = "invalid_file_query"
): FilePathRequest {
  const parsed = endpoint.requestSchema.safeParse({ path: url.searchParams.get("path") ?? "" });
  if (!parsed.success) throw workerFailure(failureKind, parsed.error.issues.map((issue) => issue.code));
  const data = parsed.data;
  if (typeof data !== "object" || data === null || !("path" in data) || typeof data.path !== "string") {
    throw workerFailure(failureKind, "catalog-path-schema");
  }
  return { path: data.path };
}

async function postDownloadRoute(request: Request): Promise<WorkerRoute> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { id: "download", auth: "session", inputError: workerFailure("bad_download_request", "form-data") };
  }
  const path = formData.get("path");
  const tokenField = formData.get("token");
  const authorityToken = typeof tokenField === "string" && tokenField.trim() ? tokenField.trim() : undefined;
  if (typeof path !== "string" || !path.trim() || authorityToken === undefined) {
    return { id: "download", auth: "session", authorityToken, inputError: workerFailure("bad_download_request", "missing-field") };
  }
  const parsed = apiEndpoints.download.requestSchema.safeParse({ path });
  if (!parsed.success) {
    return { id: "download", auth: "session", authorityToken, inputError: workerFailure("invalid_file_query", "download-form-path") };
  }
  return { id: "download", auth: "session", input: parsed.data, authorityToken };
}

const catalogRouteParsers = {
  health: () => {
    apiEndpoints.health.requestSchema.parse(undefined);
    return { id: "health", auth: "public", input: undefined };
  },
  connectAccount: async (request) => {
    const body = await readJson(request);
    if (typeof body === "object" && body !== null && "type" in body && body.type !== "nextcloud") {
      throw workerFailure("unsupported_account_type", "account-type");
    }
    const parsed = apiEndpoints.connectAccount.requestSchema.safeParse(body);
    if (!parsed.success) throw workerFailure("account_validation_failed", "account-body");
    return { id: "connectAccount", auth: "browser", input: parsed.data };
  },
  deleteAccount: (_request, url) => {
    const accountId = apiEndpoints.deleteAccount.parsePath(url.pathname);
    if (accountId === undefined) throw workerFailure("not_found", "account-path");
    return { id: "deleteAccount", auth: "browser", input: { accountId } };
  },
  session: async (request) => {
    const body = await readJson(request);
    if (typeof body !== "object" || body === null || !("accountId" in body) || typeof body.accountId !== "string" || !body.accountId.trim()) {
      throw workerFailure("account_required", "account-id");
    }
    const parsed = apiEndpoints.session.requestSchema.safeParse(body);
    if (!parsed.success) throw workerFailure("invalid_request", "session-body");
    return { id: "session", auth: "browser", input: parsed.data };
  },
  files: (_request, url) => {
    const parsed = apiEndpoints.files.requestSchema.safeParse({
      path: url.searchParams.get("path") ?? "",
      ...(url.searchParams.has("listing") ? { listing: url.searchParams.get("listing") } : {})
    });
    if (!parsed.success) throw workerFailure("invalid_file_query", "listing-query");
    return { id: "files", auth: "session", input: parsed.data };
  },
  metadata: (_request, url) => ({ id: "metadata", auth: "session", input: pathInput(apiEndpoints.metadata, url) }),
  preview: (_request, url) => ({ id: "preview", auth: "session", input: pathInput(apiEndpoints.preview, url) }),
  original: (_request, url) => ({ id: "original", auth: "session", input: pathInput(apiEndpoints.original, url) }),
  streamToken: (_request, url) => ({ id: "streamToken", auth: "session", input: pathInput(apiEndpoints.streamToken, url, "invalid_stream_token_path") }),
  stream: (_request, url) => ({
    id: "stream",
    auth: url.searchParams.has("streamToken") ? "stream" : "session",
    input: pathInput(apiEndpoints.stream, url)
  }),
  search: (_request, url) => {
    const parsed = apiEndpoints.search.requestSchema.safeParse({ path: url.searchParams.get("path") ?? "", query: url.searchParams.get("q") ?? "", ...(url.searchParams.has("coverage") ? { coverage: url.searchParams.get("coverage") } : {}) });
    if (!parsed.success) throw workerFailure("invalid_file_query", "search-query");
    return { id: "search", auth: "session", input: parsed.data };
  },
  download: (request, url) => request.method === "POST"
    ? postDownloadRoute(request)
    : { id: "download", auth: "session", input: pathInput(apiEndpoints.download, url) },
  createFolder: async (request) => {
    const body = await readJson(request);
    const parsed = apiEndpoints.createFolder.requestSchema.safeParse(body);
    if (!parsed.success) throw workerFailure("invalid_mutation_body", "createFolder");
    return { id: "createFolder", auth: "session", input: parsed.data };
  },
  upload: async (request) => {
    const body = await readJson(request);
    const parsed = apiEndpoints.upload.requestSchema.safeParse(body);
    if (!parsed.success) throw workerFailure("invalid_mutation_body", "upload");
    return { id: "upload", auth: "session", input: parsed.data };
  },
  move: async (request) => {
    const body = await readJson(request);
    if (body === MALFORMED_JSON) throw workerFailure("invalid_move_copy_json", "move");
    const parsed = apiEndpoints.move.requestSchema.safeParse(body);
    if (!parsed.success) throw workerFailure("invalid_mutation_body", "move");
    return { id: "move", auth: "session", input: parsed.data };
  },
  copy: async (request) => {
    const body = await readJson(request);
    if (body === MALFORMED_JSON) throw workerFailure("invalid_move_copy_json", "copy");
    const parsed = apiEndpoints.copy.requestSchema.safeParse(body);
    if (!parsed.success) throw workerFailure("invalid_mutation_body", "copy");
    return { id: "copy", auth: "session", input: parsed.data };
  },
  delete: async (request) => {
    const body = await readJson(request);
    const parsed = apiEndpoints.delete.requestSchema.safeParse(body);
    if (!parsed.success) throw workerFailure("invalid_mutation_body", "delete");
    return { id: "delete", auth: "session", input: parsed.data };
  },
  diagnosticReport: (request) => {
    const diagnosticsSchema = Number(request.headers.get("x-davora-diagnostics-schema"));
    const parsed = apiEndpoints.diagnosticReport.requestSchema.safeParse({
      reportId: request.headers.get("x-davora-report-id") ?? "",
      sha256: request.headers.get("x-davora-report-sha256") ?? "",
      generatedAt: request.headers.get("x-davora-report-generated-at") ?? "",
      diagnosticsSchema,
      webBuild: request.headers.get("x-davora-web-build") ?? ""
    });
    if (!parsed.success) throw workerFailure("invalid_diagnostic_report", "metadata-headers");
    return { id: "diagnosticReport", auth: "session", input: parsed.data };
  }
} satisfies Record<ApiEndpointKey, CatalogRouteParser>;

function endpointPathMatches(endpoint: CatalogEndpoint, url: URL): boolean {
  return "parsePath" in endpoint
    ? endpoint.parsePath(url.pathname) !== undefined
    : endpoint.path === url.pathname;
}

function isSessionMutation(id: ApiEndpointKey): id is SessionMutationId {
  return id === "createFolder" || id === "upload" || id === "move" || id === "copy" || id === "delete";
}

async function parseCatalogRoute(request: Request, url: URL, endpointKey: ApiEndpointKey): Promise<WorkerRoute> {
  try {
    return await catalogRouteParsers[endpointKey](request, url);
  } catch (error) {
    if (isWorkerFailure(error)) {
      return {
        id: endpointKey,
        auth: endpointKey === "stream" && url.searchParams.has("streamToken") ? "stream" : apiEndpoints[endpointKey].auth,
        inputError: error
      };
    }
    throw error;
  }
}

export async function resolveWorkerRouteInput(request: Request, route: MatchedWorkerRoute): Promise<WorkerRoute> {
  if (!("inputState" in route)) return route;
  return parseCatalogRoute(request, new URL(request.url), route.id);
}

export async function matchWorkerRoute(request: Request): Promise<MatchedWorkerRoute> {
  const url = new URL(request.url);

  if (url.pathname === "/api/mock/reset" && request.method === "POST") {
    return { id: "reset", auth: "public", input: undefined };
  }
  for (const endpointKey of catalogRouteKeys) {
    const endpoint = apiEndpoints[endpointKey];
    if (!endpointPathMatches(endpoint, url)) continue;
    if (endpoint.matchPolicy === "method" && request.method !== endpoint.method) continue;
    if (isSessionMutation(endpointKey)) {
      return { id: endpointKey, auth: "session", inputState: "pending-body" };
    }
    return parseCatalogRoute(request, url, endpointKey);
  }

  throw workerFailure("not_found", "path");
}
