import { Buffer } from "node:buffer";

import type { SessionPayload } from "../types";

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(Buffer.from(padded, "base64"));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signSessionToken(payload: SessionPayload, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = toBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const message = `${encodedHeader}.${encodedPayload}`;
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return `${message}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token: string, secret: string): Promise<SessionPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed session token.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const key = await importKey(secret);
  const message = `${encodedHeader}.${encodedPayload}`;
  const valid = await crypto.subtle.verify("HMAC", key, toArrayBuffer(fromBase64Url(encodedSignature)), new TextEncoder().encode(message));

  if (!valid) {
    throw new Error("Invalid session token signature.");
  }

  const payload = JSON.parse(Buffer.from(fromBase64Url(encodedPayload)).toString("utf8")) as SessionPayload;
  if (payload.scope !== "davora") {
    throw new Error("Invalid session token scope.");
  }
  if (payload.exp * 1000 <= Date.now()) {
    throw new Error("Session token expired.");
  }

  return payload;
}
