const LOCALHOST_NAMES = new Set(["localhost"]);
const LOCALHOST_IPV4 = "127.0.0.1";
const LOCALHOST_IPV6 = "[::1]";
const SPECIAL_USE_NAMES = new Set([
  "localhost",
  "localhost.",
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "ip6-localhost",
  "ip6-loopback"
]);

export interface NextcloudDestinationPolicyConfig {
  runtimeMode: "production" | "development";
  allowLocalNextcloud: boolean;
  allowedHosts: string[];
  allowAnyHost?: boolean;
}

export interface NextcloudDestinationPolicy {
  assertAllowed(url: URL): void;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

function isIpv4(hostname: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);
}

function isIpv6(hostname: string): boolean {
  return hostname.startsWith("[") && hostname.endsWith("]") && hostname.includes(":");
}

function isIpLiteral(hostname: string): boolean {
  return isIpv4(hostname) || isIpv6(hostname);
}

function isSpecialUseName(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return SPECIAL_USE_NAMES.has(normalized)
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".invalid")
    || normalized.endsWith(".example")
    || normalized.endsWith(".test")
    || normalized === "home.arpa"
    || normalized.endsWith(".home.arpa");
}

function isLocalhost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return LOCALHOST_NAMES.has(normalized) || normalized === LOCALHOST_IPV4 || normalized === LOCALHOST_IPV6;
}

function normalizedHostname(rawHost: string): string {
  const trimmed = rawHost.trim();
  if (!trimmed || trimmed.endsWith(".")) {
    throw new Error("NEXTCLOUD_ALLOWED_HOSTS must contain exact normalized hostnames.");
  }
  if (trimmed.startsWith("*.") || /[/:@?#\\]/.test(trimmed)) {
    throw new Error("NEXTCLOUD_ALLOWED_HOSTS must contain exact hostnames without wildcards or URL syntax.");
  }

  let parsed: URL;
  try {
    parsed = new URL(`https://${trimmed}`);
  } catch {
    throw new Error("NEXTCLOUD_ALLOWED_HOSTS contains an invalid hostname.");
  }
  if (parsed.username || parsed.password || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("NEXTCLOUD_ALLOWED_HOSTS must contain exact hostnames without ports or URL syntax.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (isIpLiteral(hostname) || isSpecialUseName(hostname) || !hostname.includes(".")) {
    throw new Error("NEXTCLOUD_ALLOWED_HOSTS must contain public DNS hostnames.");
  }
  if (!hostname.split(".").every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) {
    throw new Error("NEXTCLOUD_ALLOWED_HOSTS contains an invalid hostname.");
  }
  return hostname;
}

export function normalizeNextcloudAllowedHosts(rawHosts: string[]): string[] {
  return Array.from(new Set(rawHosts.map(normalizedHostname)));
}

function assertAllowedDestination(url: URL, config: NextcloudDestinationPolicyConfig): void {
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Nextcloud destination is not allowed.");
  }

  const hostname = url.hostname.toLowerCase();
  const local = isLocalhost(hostname);
  if (isSpecialUseName(hostname) && !(config.runtimeMode === "development" && config.allowLocalNextcloud && local)) {
    throw new Error("Nextcloud destination is not allowed.");
  }

  if (config.runtimeMode === "production") {
    if (url.protocol !== "https:" || url.port || isIpLiteral(hostname) || local) {
      throw new Error("Nextcloud destination is not allowed.");
    }
    if (!config.allowAnyHost && !config.allowedHosts.includes(hostname)) throw new Error("Nextcloud destination hostname is not allowlisted.");
    return;
  }

  if (local) {
    if (!config.allowLocalNextcloud || !["http:", "https:"].includes(url.protocol)) {
      throw new Error("Nextcloud destination is not allowed.");
    }
    return;
  }

  if (url.protocol !== "https:" || url.port || isIpLiteral(hostname)) {
    throw new Error("Nextcloud destination is not allowed.");
  }
  if (!config.allowAnyHost && !config.allowedHosts.includes(hostname)) throw new Error("Nextcloud destination hostname is not allowlisted.");
}

export function createNextcloudDestinationPolicy(
  config: NextcloudDestinationPolicyConfig,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)
): NextcloudDestinationPolicy {
  const allowedHosts = normalizeNextcloudAllowedHosts(config.allowedHosts);
  const effectiveConfig = { ...config, allowedHosts };
  const assertAllowed = (url: URL) => assertAllowedDestination(url, effectiveConfig);
  return {
    assertAllowed,
    fetch(input, init) {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      assertAllowed(url);
      return fetchImpl(input, init);
    }
  };
}

export function isLocalNextcloudHostname(hostname: string): boolean {
  return isLocalhost(hostname);
}
