import { randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";

import dotenv from "dotenv";

dotenv.config({ path: join(process.cwd(), ".env") });

const SAFE_VALIDATION_ROOT = ".davora-agent-test";
const requestedRootPath = process.env.NEXTCLOUD_ROOT_PATH?.trim();
if (requestedRootPath && requestedRootPath !== SAFE_VALIDATION_ROOT) {
  throw new Error(`NEXTCLOUD_ROOT_PATH must remain ${SAFE_VALIDATION_ROOT} for real validation.`);
}

const baseUrl = process.env.NEXTCLOUD_BASE_URL ?? "https://nextcloud.example.invalid";
const username = process.env.NEXTCLOUD_USERNAME ?? "demo-user";
const password = process.env.NEXTCLOUD_APP_PASSWORD;
const rootPath = SAFE_VALIDATION_ROOT;
const sessionSecret = process.env.SESSION_SECRET ?? "local-dev-session-secret";
const workerPort = Number.parseInt(process.env.REAL_VALIDATION_WORKER_PORT ?? "8788", 10);
const unlockCode = process.env.APP_UNLOCK_CODE?.trim();
const browserId = process.env.REAL_VALIDATION_BROWSER_ID?.trim() || randomUUID();
const browserSecret = process.env.REAL_VALIDATION_BROWSER_SECRET?.trim() || randomUUID();

if (!password) {
  throw new Error("NEXTCLOUD_APP_PASSWORD must be present in the project root .env for real validation.");
}

function httpRequest(url: URL, init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array } = {}): Promise<{ status: number; body: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: new Uint8Array(Buffer.concat(chunks))
          });
        });
      }
    );
    request.on("error", reject);
    if (init.body) {
      request.write(init.body);
    }
    request.end();
  });
}

function createDavUrl(path: string): URL {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const basePath = base.pathname.replace(/\/+$/, "");
  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  base.pathname = `${basePath}/remote.php/dav/files/${encodeURIComponent(username)}${encodedPath ? `/${encodedPath}` : ""}`.replace(/\/+/g, "/");
  return base;
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

async function mkcol(path: string) {
  const response = await httpRequest(createDavUrl(path), {
    method: "MKCOL",
    headers: { authorization: authHeader() }
  });
  if (![201, 405].includes(response.status)) {
    throw new Error(`MKCOL failed for ${path} with ${response.status}`);
  }
}

async function put(path: string, body: string) {
  const encoded = Buffer.from(body, "utf8");
  const response = await httpRequest(createDavUrl(path), {
    method: "PUT",
    headers: {
      authorization: authHeader(),
      "content-type": "text/plain; charset=utf-8",
      "content-length": String(encoded.byteLength)
    },
    body: encoded
  });
  if (![200, 201, 204].includes(response.status)) {
    throw new Error(`PUT failed for ${path} with ${response.status}`);
  }
}

async function putBytes(path: string, body: Uint8Array, contentType: string) {
  const response = await httpRequest(createDavUrl(path), {
    method: "PUT",
    headers: {
      authorization: authHeader(),
      "content-type": contentType,
      "content-length": String(body.byteLength)
    },
    body
  });
  if (![200, 201, 204].includes(response.status)) {
    throw new Error(`PUT failed for ${path} with ${response.status}`);
  }
}

async function move(sourcePath: string, destinationPath: string) {
  const response = await httpRequest(createDavUrl(sourcePath), {
    method: "MOVE",
    headers: {
      authorization: authHeader(),
      Destination: createDavUrl(destinationPath).toString(),
      Overwrite: "F"
    }
  });
  if (![201, 204].includes(response.status)) {
    throw new Error(`MOVE failed for ${sourcePath} with ${response.status}`);
  }
}

async function copy(sourcePath: string, destinationPath: string) {
  const response = await httpRequest(createDavUrl(sourcePath), {
    method: "COPY",
    headers: {
      authorization: authHeader(),
      Destination: createDavUrl(destinationPath).toString(),
      Overwrite: "F"
    }
  });
  if (![201, 204].includes(response.status)) {
    throw new Error(`COPY failed for ${sourcePath} with ${response.status}`);
  }
}

async function remove(path: string) {
  const response = await httpRequest(createDavUrl(path), {
    method: "DELETE",
    headers: { authorization: authHeader() }
  });
  if (![204, 404].includes(response.status)) {
    throw new Error(`DELETE failed for ${path} with ${response.status}`);
  }
}

async function jsonRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`http://127.0.0.1:${workerPort}${path}`, init);
  const payload = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined;
  return { response, payload };
}

function requestHeaders(token?: string): HeadersInit {
  return {
    origin: "http://127.0.0.1:4173",
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };
}

function browserOwnershipHeaders(): HeadersInit {
  return {
    "x-davora-browser-id": browserId,
    "x-davora-browser-secret": browserSecret
  };
}

function accountBootstrapHeaders(): HeadersInit {
  return {
    ...requestHeaders(),
    ...browserOwnershipHeaders()
  };
}

async function expectOk(path: string, init: RequestInit = {}) {
  const result = await jsonRequest(path, init);
  if (!result.response.ok) {
    throw new Error(`Expected ${path} to succeed, got ${result.response.status}`);
  }
  return result.payload;
}

async function main() {
  console.log("Preparing safe Nextcloud validation directory...");
  await mkcol(rootPath);
  await mkcol(`${rootPath}/docs`);
  await put(`${rootPath}/docs/hello.txt`, "hello from davora real validation\nnormalized worker api");
  await move(`${rootPath}/docs/hello.txt`, `${rootPath}/docs/renamed.txt`);
  await copy(`${rootPath}/docs/renamed.txt`, `${rootPath}/docs/copied.txt`);
  await mkcol(`${rootPath}/docs/100% folder`);
  await put(`${rootPath}/docs/100% folder/100% complete.txt`, "literal percent path works");
  await putBytes(`${rootPath}/docs/stream-check.mp3`, Buffer.from("stream-range-validation", "utf8"), "audio/mpeg");

  console.log("Starting local worker-backed validation checks...");
  const { spawn } = await import("node:child_process");
  const worker = spawn(process.execPath, ["--import", "tsx", "scripts/worker-real-validation.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(workerPort),
      SESSION_SECRET: sessionSecret,
      MOCK_BACKEND: "false",
      ALLOWED_ORIGINS: "http://127.0.0.1:4173",
      NEXTCLOUD_ROOT_PATH: rootPath,
      ...(process.env.NEXTCLOUD_ALLOWED_HOSTS?.trim()
        ? { NEXTCLOUD_ALLOWED_HOSTS: process.env.NEXTCLOUD_ALLOWED_HOSTS.trim() }
        : {}),
      ...(unlockCode ? { APP_UNLOCK_CODE: unlockCode } : {})
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  worker.stdout.on("data", (chunk) => process.stdout.write(chunk));
  worker.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const waitForServer = async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${workerPort}/api/health`);
        if (response.ok) {
          return;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Worker did not start for real validation.");
  };

  try {
    await waitForServer();

    const healthPayload = await expectOk("/api/health");
    const health = healthPayload as { data?: { unlockRequired?: boolean; connectionMode?: string; supportedAccountTypes?: string[] } } | undefined;
    if (Boolean(health?.data?.unlockRequired) !== Boolean(unlockCode)) {
      throw new Error("Real validation health/unlock state mismatch.");
    }
    if (health?.data?.connectionMode !== "in_app") {
      throw new Error(`Real validation expected in_app connection mode, got ${health?.data?.connectionMode ?? "unknown"}.`);
    }
    if (!health?.data?.supportedAccountTypes?.includes("nextcloud")) {
      throw new Error("Real validation health payload no longer reports nextcloud support.");
    }

    const accountPayload = await expectOk("/api/accounts", {
      method: "POST",
      headers: {
        ...accountBootstrapHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: "nextcloud",
        baseUrl,
        username,
        appPassword: password,
        label: "Real validation"
      })
    }) as { data: { account: { id: string } } };
    const accountId = accountPayload.data.account.id;

    if (unlockCode) {
      const invalidSession = await jsonRequest("/api/session", {
        method: "POST",
        headers: {
          ...accountBootstrapHeaders(),
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId, unlockCode: "invalid" })
      });
      if (invalidSession.response.status !== 401) {
        throw new Error(`Expected invalid unlock code to return 401, got ${invalidSession.response.status}`);
      }
    }

    const sessionPayload = await expectOk("/api/session", {
      method: "POST",
      headers: {
        ...accountBootstrapHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({ accountId, ...(unlockCode ? { unlockCode } : {}) })
    }) as { data: { session: { token: string } } };
    const token = sessionPayload.data.session.token;
    const percentFolderPath = "docs/100% folder";
    const percentFilePath = "docs/100% folder/100% complete.txt";

    const listPayload = await expectOk("/api/files?path=docs", {
      headers: requestHeaders(token)
    }) as { data: { items: Array<{ path: string }> } };

    const filePayload = await expectOk("/api/file?path=docs/renamed.txt", {
      headers: requestHeaders(token)
    }) as { data: { file: { content: string; unsupportedReason?: string } } };
    if (filePayload.data.file.unsupportedReason) {
      throw new Error(`Real validation preview unsupported: ${filePayload.data.file.unsupportedReason}`);
    }

    const searchPayload = await expectOk("/api/search?path=&q=renamed", {
      headers: requestHeaders(token)
    }) as { data: { items: Array<{ path: string }> } };

    await expectOk("/api/move", {
      method: "POST",
      headers: {
        ...requestHeaders(token),
        "content-type": "application/json"
      },
      body: JSON.stringify({ path: "docs/copied.txt", destinationPath: "docs/copied-moved.txt" })
    });

    await expectOk("/api/copy", {
      method: "POST",
      headers: {
        ...requestHeaders(token),
        "content-type": "application/json"
      },
      body: JSON.stringify({ path: "docs/renamed.txt", destinationPath: "docs/worker-copy.txt" })
    });

    await expectOk("/api/folders", {
      method: "POST",
      headers: {
        ...requestHeaders(token),
        "content-type": "application/json"
      },
      body: JSON.stringify({ path: "docs", name: "worker-folder" })
    });

    await expectOk("/api/upload", {
      method: "POST",
      headers: {
        ...requestHeaders(token),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        path: "docs/worker-folder",
        name: "worker-upload.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("worker upload content", "utf8").toString("base64")
      })
    });

    await expectOk("/api/delete", {
      method: "POST",
      headers: {
        ...requestHeaders(token),
        "content-type": "application/json"
      },
      body: JSON.stringify({ path: "docs/worker-copy.txt", confirmName: "worker-copy.txt" })
    });

    const finalListPayload = await expectOk("/api/files?path=docs", {
      headers: requestHeaders(token)
    }) as { data: { items: Array<{ path: string }> } };

    const uploadedFilePayload = await expectOk("/api/file?path=docs/worker-folder/worker-upload.txt", {
      headers: requestHeaders(token)
    }) as { data: { file: { content: string } } };

    const percentFolderPayload = await expectOk(`/api/files?path=${encodeURIComponent(percentFolderPath)}`, {
      headers: requestHeaders(token)
    }) as { data: { items: Array<{ path: string }> } };

    const percentFilePayload = await expectOk(`/api/file?path=${encodeURIComponent(percentFilePath)}`, {
      headers: requestHeaders(token)
    }) as { data: { file: { content: string } } };

    const percentDownloadResponse = await fetch(`http://127.0.0.1:${workerPort}/api/download?path=${encodeURIComponent(percentFilePath)}`, {
      headers: requestHeaders(token)
    });
    if (!percentDownloadResponse.ok) {
      throw new Error(`Expected literal percent download to succeed, got ${percentDownloadResponse.status}`);
    }
    const percentDownloadText = await percentDownloadResponse.text();

    const streamPreviewPayload = await expectOk("/api/file?path=docs/stream-check.mp3", {
      headers: requestHeaders(token)
    }) as { data: { file: { viewer: string; requiresOriginalBlob?: boolean } } };

    const streamRangeResponse = await fetch(`http://127.0.0.1:${workerPort}/api/file/stream?path=${encodeURIComponent("docs/stream-check.mp3")}&token=${encodeURIComponent(token)}`, {
      headers: {
        origin: "http://127.0.0.1:4173",
        range: "bytes=7-11"
      }
    });
    if (streamRangeResponse.status !== 206) {
      throw new Error(`Expected real media stream range to return 206, got ${streamRangeResponse.status}`);
    }
    const streamRangeText = await streamRangeResponse.text();

    const finalSearchPayload = await expectOk("/api/search?path=docs&q=worker", {
      headers: requestHeaders(token)
    }) as { data: { items: Array<{ path: string }> } };

    if (!listPayload.data.items.some((item) => item.path === "docs/renamed.txt")) {
      throw new Error("Real validation listing did not include docs/renamed.txt");
    }
    if (!listPayload.data.items.some((item) => item.path === "docs/copied.txt")) {
      throw new Error("Real validation listing did not include docs/copied.txt");
    }
    if (!filePayload.data.file.content.includes("normalized worker api")) {
      throw new Error(`Real validation preview content mismatch: ${filePayload.data.file.content}`);
    }
    if (!searchPayload.data.items.some((item) => item.path === "docs/renamed.txt")) {
      throw new Error("Real validation search did not include docs/renamed.txt");
    }
    if (!finalListPayload.data.items.some((item) => item.path === "docs/copied-moved.txt")) {
      throw new Error("Real validation move result missing docs/copied-moved.txt");
    }
    if (!finalListPayload.data.items.some((item) => item.path === "docs/worker-folder")) {
      throw new Error("Real validation create-folder result missing docs/worker-folder");
    }
    if (!finalListPayload.data.items.some((item) => item.path === percentFolderPath)) {
      throw new Error("Real validation listing did not include literal percent folder");
    }
    if (finalListPayload.data.items.some((item) => item.path === "docs/worker-copy.txt")) {
      throw new Error("Real validation delete did not remove docs/worker-copy.txt");
    }
    if (!uploadedFilePayload.data.file.content.includes("worker upload content")) {
      throw new Error(`Real validation upload preview mismatch: ${uploadedFilePayload.data.file.content}`);
    }
    if (!percentFolderPayload.data.items.some((item) => item.path === percentFilePath)) {
      throw new Error("Real validation literal percent folder did not list child file");
    }
    if (!percentFilePayload.data.file.content.includes("literal percent path works")) {
      throw new Error(`Real validation literal percent preview mismatch: ${percentFilePayload.data.file.content}`);
    }
    if (!percentDownloadText.includes("literal percent path works")) {
      throw new Error(`Real validation literal percent download mismatch: ${percentDownloadText}`);
    }
    if (streamPreviewPayload.data.file.viewer !== "audio" || !streamPreviewPayload.data.file.requiresOriginalBlob) {
      throw new Error("Real validation stream-check.mp3 was not classified as streamable audio.");
    }
    if (streamRangeResponse.headers.get("accept-ranges") !== "bytes") {
      throw new Error("Real validation stream response did not advertise byte ranges.");
    }
    if (!streamRangeResponse.headers.get("content-range")?.includes("/23")) {
      throw new Error(`Real validation stream response had unexpected content-range: ${streamRangeResponse.headers.get("content-range")}`);
    }
    if (streamRangeText !== "range") {
      throw new Error(`Real validation stream range mismatch: ${streamRangeText}`);
    }
    if (!finalSearchPayload.data.items.some((item) => item.path === "docs/worker-folder/worker-upload.txt")) {
      throw new Error("Real validation worker search did not include uploaded file");
    }

    console.log("Real backend validation passed.");
  } finally {
    worker.kill("SIGTERM");
    await remove(rootPath);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
