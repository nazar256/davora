import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { handleRequest } from "./app";

function readBody(request: import("node:http").IncomingMessage): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(chunks.length > 0 ? new Uint8Array(Buffer.concat(chunks)) : undefined));
    request.on("error", reject);
  });
}

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

if (!process.env.LOCAL_DEV_STATE_PATH?.trim()) {
  process.env.LOCAL_DEV_STATE_PATH = resolve(repoRoot, ".tmp/local-dev/worker-state.json");
}

createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/__davora/stop-worker") {
    res.writeHead(204);
    res.end();
    setImmediate(() => process.exit(0));
    return;
  }

  const body = await readBody(req);
  const url = `http://127.0.0.1:${port}${req.url ?? "/"}`;
  const request = new Request(url, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: body && !["GET", "HEAD"].includes(req.method ?? "GET") ? body : undefined,
    duplex: "half"
  } as RequestInit & { duplex: "half" });

  const response = await handleRequest(request, process.env);
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (response.body) {
    const arrayBuffer = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } else {
    res.end();
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`davora worker listening on http://127.0.0.1:${port}`);
});
