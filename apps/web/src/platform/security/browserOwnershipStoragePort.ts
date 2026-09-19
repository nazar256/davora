import type { BrowserStringStorage } from "../storage/browserStringStorage";

type BrowserOwnershipKey = "davora-browser-id" | "davora-browser-secret";
export interface BrowserOwnershipStorageAdapter {
  read(key: BrowserOwnershipKey): { readonly kind: "value"; readonly value: string | null } | { readonly kind: "unavailable" };
  write(key: BrowserOwnershipKey, value: string): { readonly kind: "written" } | { readonly kind: "unavailable" };
}

export const createBrowserOwnershipStoragePort = (storage: BrowserStringStorage): BrowserOwnershipStorageAdapter => ({
  read(key: BrowserOwnershipKey) {
    const result = storage.readItem(key);
    return result.ok ? { kind: "value", value: result.value } : { kind: "unavailable" };
  },
  write(key: BrowserOwnershipKey, value: string) {
    return storage.writeItem(key, value).ok ? { kind: "written" } : { kind: "unavailable" };
  }
});
