export const createBrowserDelay = (): ((ms: number) => Promise<void>) =>
  (ms) => new Promise((resolve) => setTimeout(resolve, ms));
