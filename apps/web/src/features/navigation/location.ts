export interface ParsedLocationSearch {
  readonly path: string;
  readonly accountId?: string;
}

export const buildLocationHref = (
  baseHref: string,
  path: string,
  accountId?: string
): string => {
  const url = new URL(baseHref);
  if (path) {
    url.searchParams.set("path", path);
    if (accountId) {
      url.searchParams.set("account", accountId);
    } else {
      // Drop stale account from baseHref so history state and URL stay coupled.
      url.searchParams.delete("account");
    }
  } else {
    url.searchParams.delete("path");
    url.searchParams.delete("account");
  }
  return url.toString();
};

export const parseLocationSearch = (search: string): ParsedLocationSearch => {
  const normalized = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalized);
  const path = params.get("path") ?? "";
  const accountId = params.get("account") ?? undefined;
  return accountId === undefined ? { path } : { path, accountId };
};
