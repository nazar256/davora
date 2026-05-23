import { handleRequest } from "../apps/worker/src/app.ts";
import { createServer } from "node:http";

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(chunks.length > 0 ? new Uint8Array(Buffer.concat(chunks)) : undefined));
    request.on("error", reject);
  });
}

const port = Number.parseInt(process.env.PORT ?? "8788", 10);

createServer(async (req, res) => {
  const body = await readBody(req);
  const request = new Request(`http://127.0.0.1:${port}${req.url ?? "/"}`, {
    method: req.method,
    headers: req.headers,
    body: body && !["GET", "HEAD"].includes(req.method ?? "GET") ? body : undefined,
    duplex: "half"
  });

  const response = await handleRequest(request, process.env);
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  const arrayBuffer = await response.arrayBuffer();
  res.end(Buffer.from(arrayBuffer));
}).listen(port, "127.0.0.1", () => {
  console.log(`real-validation worker listening on http://127.0.0.1:${port}`);
});
