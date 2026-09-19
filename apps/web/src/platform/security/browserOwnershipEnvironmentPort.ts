export interface BrowserOwnershipEnvironmentAdapter {
  createSecureToken(): string | undefined;
  canonicalizeHeaderValue(value: string): string | undefined;
}

function secureToken(): string | undefined {
  const cryptoObject = globalThis.crypto as Crypto | undefined;
  try {
    if (typeof cryptoObject?.randomUUID === "function") {
      const value = cryptoObject.randomUUID();
      return value || undefined;
    }
    if (typeof cryptoObject?.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      cryptoObject.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function canonicalizeHeaderValue(value: string): string | undefined {
  if (!value || /[\u0000-\u001f\u007f]/u.test(value) || value.trim().length === 0) {
    return undefined;
  }
  try {
    const headers = new Headers({ "x-davora-browser-value": value });
    const canonical = headers.get("x-davora-browser-value");
    return canonical && canonical.trim().length > 0 ? canonical : undefined;
  } catch {
    return undefined;
  }
}

export const createBrowserOwnershipEnvironmentPort = (): BrowserOwnershipEnvironmentAdapter => ({
  createSecureToken: secureToken,
  canonicalizeHeaderValue
});
