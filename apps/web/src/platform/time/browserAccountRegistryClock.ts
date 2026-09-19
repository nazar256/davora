export interface BrowserAccountRegistryClock {
  isExpired(expiresAt: string): boolean;
}

export const createBrowserAccountRegistryClock = (
  now: () => number = Date.now,
  parse: (value: string) => number = Date.parse
): BrowserAccountRegistryClock => ({
  isExpired: (expiresAt) => parse(expiresAt) <= now()
});
