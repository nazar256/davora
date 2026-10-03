import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiEndpoints } from "@davora/shared";

import { handleRequest } from "../src/app";
import * as accountFactory from "../src/accounts/factory";
import * as backendFactory from "../src/files/createFileBackend";
import type { FileBackend } from "../src/files/backend";
import * as tokens from "../src/security/token";
import { createSessionToken, env, ownerHeaders, resetConnectedAccountStoreForTests } from "./support/workerApplicationHarness";

beforeEach(resetConnectedAccountStoreForTests);
afterEach(() => vi.restoreAllMocks());

const mutationIds = ["createFolder", "upload", "move", "copy", "delete"] as const;
const uploadBody = { path: "", name: "auth-order.txt", mimeType: "text/plain", contentBase64: "YQ==" };

function mutationRequest(path: string, body: string, token?: string, method = "POST", origin = ownerHeaders.origin) {
  return new Request(`https://worker.test${path}`, {
    method,
    headers: { origin, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body
  });
}

describe("mutation authority before application body consumption", () => {
  it.each(mutationIds)("does not read or validate the %s body without authority", async (id) => {
    const request = mutationRequest(apiEndpoints[id].path, "not-json");
    const read = vi.spyOn(request, "json");
    const schema = vi.spyOn(apiEndpoints[id].requestSchema, "safeParse");
    const verify = vi.spyOn(tokens, "verifySessionToken");
    const backend = vi.spyOn(backendFactory, "createFileBackend");

    const response = await handleRequest(request, env);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ data: { code: "unauthorized", message: "Missing bearer token." } });
    expect(read).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expect(schema).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(backend).not.toHaveBeenCalled();
  });

  it.each([
    { name: "missing", status: 401, code: "unauthorized", message: "Missing bearer token.", events: [] },
    { name: "invalid", status: 401, code: "unauthorized", message: "Malformed session token.", events: ["verify"] },
    { name: "invalid signature", status: 401, code: "unauthorized", message: "Invalid session token signature.", events: ["verify"] },
    { name: "expired", status: 401, code: "unauthorized", message: "Token expired.", events: ["verify"] },
    { name: "missing account", status: 409, code: "account_reconnect_required", message: "Connected account is no longer available. Reconnect this account.", events: ["verify", "account"] },
    { name: "revoked account", status: 409, code: "account_reconnect_required", message: "Connected account is no longer available. Reconnect this account.", events: ["verify", "account"] },
    { name: "account mismatch", status: 401, code: "session_mismatch", message: "Session no longer matches the selected account configuration.", events: ["verify", "account"] },
    { name: "backend mismatch", status: 401, code: "session_mismatch", message: "Session no longer matches the selected account configuration.", events: ["verify", "account"] },
    { name: "root mismatch", status: 401, code: "session_mismatch", message: "Session no longer matches the selected account configuration.", events: ["verify", "account"] },
    { name: "nonce mismatch", status: 401, code: "session_mismatch", message: "Session no longer matches the selected account configuration.", events: ["verify", "account"] },
    { name: "malformed JSON", status: 400, code: "invalid_request", message: "Request body is invalid.", events: ["verify", "account", "json", "schema"] },
    { name: "invalid schema", status: 400, code: "invalid_request", message: "Request body is invalid.", events: ["verify", "account", "json", "schema"] },
    { name: "invalid path", status: 400, code: "invalid_request", message: "Request body is invalid.", events: ["verify", "account", "json", "schema"] },
    { name: "valid upload", status: 201, events: ["verify", "account", "json", "schema", "backend", "upload"] },
    { name: "empty upload", status: 201, events: ["verify", "account", "json", "schema", "backend", "upload"] }
  ])("preserves the response and ordered work for $name", async ({ name, status, code, message, events: expectedEvents }) => {
    const session = await createSessionToken();
    const payload = await tokens.verifySessionToken(session.token, env.SESSION_SECRET);
    let token: string | undefined = session.token;
    if (name === "missing") token = undefined;
    if (name === "invalid") token = "invalid-token";
    if (name === "invalid signature") token = await tokens.signSessionToken(payload, "different-test-secret");
    if (name === "expired") token = await tokens.signSessionToken({ ...payload, exp: 1 }, env.SESSION_SECRET);
    if (name === "missing account") token = await tokens.signSessionToken({ ...payload, accountId: "missing-account" }, env.SESSION_SECRET);
    if (name === "backend mismatch") token = await tokens.signSessionToken({ ...payload, backend: "nextcloud" }, env.SESSION_SECRET);
    if (name === "root mismatch") token = await tokens.signSessionToken({ ...payload, rootPath: "other-root" }, env.SESSION_SECRET);
    if (name === "nonce mismatch") token = await tokens.signSessionToken({ ...payload, accountNonce: "other-nonce" }, env.SESSION_SECRET);
    if (name === "revoked account") {
      const removed = await handleRequest(new Request(`https://worker.test/api/accounts/${session.accountId}`, { method: "DELETE", headers: ownerHeaders }), env);
      expect(removed.status).toBe(204);
    }
    const body = name === "valid upload" ? JSON.stringify(uploadBody)
      : name === "empty upload" ? JSON.stringify({ ...uploadBody, contentBase64: "" })
        : name === "invalid schema" ? JSON.stringify({ ...uploadBody, contentBase64: "not-base64" })
          : name === "invalid path" ? JSON.stringify({ ...uploadBody, path: "../escape" }) : "not-json";
    const request = mutationRequest("/api/upload", body, token);
    const events: string[] = [];
    const originalJson = request.json.bind(request);
    const read = vi.spyOn(request, "json").mockImplementation(() => { events.push("json"); return originalJson(); });
    const originalSchema = apiEndpoints.upload.requestSchema.safeParse.bind(apiEndpoints.upload.requestSchema);
    const schema = vi.spyOn(apiEndpoints.upload.requestSchema, "safeParse").mockImplementation((...args) => { events.push("schema"); return originalSchema(...args); });
    const originalVerify = tokens.verifySessionToken;
    const verify = vi.spyOn(tokens, "verifySessionToken").mockImplementation((...args) => { events.push("verify"); return originalVerify(...args); });
    const originalAccountService = accountFactory.createAccountServiceForEnvironment;
    const resolveAccount = vi.fn(async (accountId: string) => {
      events.push("account");
      const account = await originalAccountService({ ...env, ...workerEnv }).resolveAuthorized(accountId);
      return name === "account mismatch" ? { ...account, account: { ...account.account, id: "other-account" } } : account;
    });
    let workerEnv: Parameters<typeof originalAccountService>[0];
    vi.spyOn(accountFactory, "createAccountServiceForEnvironment").mockImplementation((configuredEnv) => {
      workerEnv = configuredEnv;
      return { ...originalAccountService(configuredEnv), resolveAuthorized: resolveAccount };
    });
    const originalBackend = backendFactory.createFileBackend;
    const upload = vi.fn<FileBackend["upload"]>();
    const backend = vi.spyOn(backendFactory, "createFileBackend").mockImplementation((...args) => {
      events.push("backend");
      const files = originalBackend(...args);
      const originalUpload = files.upload.bind(files);
      upload.mockImplementation((input) => { events.push("upload"); return originalUpload(input); });
      return { ...files, upload };
    });

    const response = await handleRequest(request, { ...env, WORKER_BUILD_LABEL: "auth-order-test" });

    expect(response.status).toBe(status);
    expect(response.headers.get("access-control-allow-origin")).toBe(ownerHeaders.origin);
    expect(response.headers.get("x-davora-worker-build")).toBe("auth-order-test");
    expect(response.headers.get("x-davora-api-contract")).toBe("2");
    if (code) expect(await response.json()).toEqual({ data: { code, message } });
    else expect(await response.json()).toMatchObject({ data: { result: { action: "upload", path: "auth-order.txt" } } });
    expect(events).toEqual(expectedEvents);
    expect(verify).toHaveBeenCalledTimes(expectedEvents.includes("verify") ? 1 : 0);
    expect(resolveAccount).toHaveBeenCalledTimes(expectedEvents.includes("account") ? 1 : 0);
    expect(read).toHaveBeenCalledTimes(expectedEvents.includes("json") ? 1 : 0);
    expect(schema).toHaveBeenCalledTimes(expectedEvents.includes("schema") ? 1 : 0);
    expect(backend).toHaveBeenCalledTimes(status === 201 ? 1 : 0);
    expect(upload).toHaveBeenCalledTimes(status === 201 ? 1 : 0);
    expect(request.bodyUsed).toBe(expectedEvents.includes("json"));
  });

  it.each([
    { path: "/api/upload", method: "PUT", origin: ownerHeaders.origin, status: 404, code: "not_found" },
    { path: "/api/unknown", method: "POST", origin: ownerHeaders.origin, status: 404, code: "not_found" },
    { path: "/api/upload", method: "POST", origin: "https://other.example", status: 403, code: "permission_denied" }
  ])("keeps admission rejection body-inert: $path $method $status", async ({ path, method, origin, status, code }) => {
    const request = mutationRequest(path, "not-json", undefined, method, origin);
    const read = vi.spyOn(request, "json");
    const verify = vi.spyOn(tokens, "verifySessionToken");
    const backend = vi.spyOn(backendFactory, "createFileBackend");
    const response = await handleRequest(request, env);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ data: { code } });
    expect(read).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(backend).not.toHaveBeenCalled();
  });
});
