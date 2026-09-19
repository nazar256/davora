export type BrowserOwnershipKey = "davora-browser-id" | "davora-browser-secret";

export type BrowserOwnershipStorageReadResult =
  | { readonly kind: "value"; readonly value: string | null }
  | { readonly kind: "unavailable" };

export type BrowserOwnershipStorageWriteResult =
  | { readonly kind: "written" }
  | { readonly kind: "unavailable" };

export interface BrowserOwnershipStoragePort {
  read(key: BrowserOwnershipKey): BrowserOwnershipStorageReadResult;
  write(key: BrowserOwnershipKey, value: string): BrowserOwnershipStorageWriteResult;
}

export interface BrowserOwnershipEnvironmentPort {
  createSecureToken(): string | undefined;
  canonicalizeHeaderValue(value: string): string | undefined;
}
