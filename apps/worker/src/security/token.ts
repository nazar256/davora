import { Buffer } from "node:buffer";

import type { SessionPayload, StreamTokenPayload } from "../types";

export type TokenVerificationFailureKind =
  | "malformed"
  | "invalid_signature"
  | "expired"
  | "invalid_session_scope"
  | "invalid_stream_scope";

const tokenVerificationFailureMessages: Record<TokenVerificationFailureKind, string> = {
  malformed: "Malformed session token.",
  invalid_signature: "Invalid session token signature.",
  expired: "Token expired.",
  invalid_session_scope: "Invalid session token scope.",
  invalid_stream_scope: "Invalid stream token scope."
};

export class TokenVerificationError extends Error {
  readonly kind: TokenVerificationFailureKind;

  constructor(kind: TokenVerificationFailureKind) {
    super(tokenVerificationFailureMessages[kind]);
    this.name = "TokenVerificationError";
    this.kind = kind;
  }
}

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

async function signToken(payload: SessionPayload | StreamTokenPayload, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = toBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const message = `${encodedHeader}.${encodedPayload}`;
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return `${message}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verifyToken(token: string, secret: string): Promise<SessionPayload | StreamTokenPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new TokenVerificationError("malformed");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const key = await importKey(secret);
  const message = `${encodedHeader}.${encodedPayload}`;
  const valid = await crypto.subtle.verify("HMAC", key, toArrayBuffer(fromBase64Url(encodedSignature)), new TextEncoder().encode(message));

  if (!valid) {
    throw new TokenVerificationError("invalid_signature");
  }

  const payload = JSON.parse(Buffer.from(fromBase64Url(encodedPayload)).toString("utf8")) as SessionPayload | StreamTokenPayload;
  if (payload.exp * 1000 <= Date.now()) {
    throw new TokenVerificationError("expired");
  }

  return payload;
}

export async function signSessionToken(payload: SessionPayload, secret: string): Promise<string> {
  return signToken(payload, secret);
}

export async function verifySessionToken(token: string, secret: string): Promise<SessionPayload> {
  const payload = await verifyToken(token, secret);
  if (payload.scope !== "davora") {
    throw new TokenVerificationError("invalid_session_scope");
  }
  return payload;
}

export async function signStreamToken(payload: StreamTokenPayload, secret: string): Promise<string> {
  return signToken(payload, secret);
}

export async function verifyStreamToken(token: string, secret: string): Promise<StreamTokenPayload> {
  const payload = await verifyToken(token, secret);
  if (payload.scope !== "davora-stream") {
    throw new TokenVerificationError("invalid_stream_scope");
  }
  return payload;
}
