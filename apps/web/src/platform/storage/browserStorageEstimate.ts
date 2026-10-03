export async function estimateBrowserStorage(): Promise<unknown> {
  return typeof navigator !== "undefined" && typeof navigator.storage?.estimate === "function"
    ? navigator.storage.estimate() : undefined;
}
