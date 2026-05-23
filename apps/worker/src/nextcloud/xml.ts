import type { DavMultistatusItem } from "../types";

const TAG_PATTERN_CACHE = new Map<string, RegExp>();

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function localTagPattern(localName: string, global = true): RegExp {
  const key = `${localName}:${global ? "g" : "s"}`;
  const cached = TAG_PATTERN_CACHE.get(key);
  if (cached) {
    return cached;
  }

  const flags = global ? "gis" : "is";
  const pattern = new RegExp(`<(?:[^:>\\s]+:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[^:>\\s]+:)?${localName}>`, flags);
  TAG_PATTERN_CACHE.set(key, pattern);
  return pattern;
}

function extractBlocks(xml: string, localName: string): string[] {
  return Array.from(xml.matchAll(localTagPattern(localName))).map((match) => match[1] ?? "");
}

function extractFirstText(xml: string, localName: string): string | undefined {
  const block = extractBlocks(xml, localName)[0];
  if (!block) {
    return undefined;
  }
  const text = decodeXmlEntities(block.replace(/<[^>]+>/g, "").trim());
  return text || undefined;
}

function parseStatusCode(statusLine: string | undefined): number | undefined {
  if (!statusLine) {
    return undefined;
  }
  const match = statusLine.match(/\s(\d{3})(?:\s|$)/);
  return match ? Number(match[1]) : undefined;
}

function pickPropBlock(responseXml: string): string {
  const propstats = extractBlocks(responseXml, "propstat");
  for (const propstat of propstats) {
    const statusCode = parseStatusCode(extractFirstText(propstat, "status"));
    if (statusCode && statusCode >= 200 && statusCode < 300) {
      return extractBlocks(propstat, "prop").join("\n");
    }
  }
  return extractBlocks(responseXml, "prop").join("\n");
}

export function parseMultiStatusXml(xml: string): DavMultistatusItem[] {
  return extractBlocks(xml, "response")
    .map((responseXml) => {
      const propXml = pickPropBlock(responseXml);
      const href = extractFirstText(responseXml, "href");
      if (!href) {
        return undefined;
      }

      const sizeText = extractFirstText(propXml, "getcontentlength");
      const isFolder = /<(?:[^:>\s]+:)?collection\b[^>]*\/?>/i.test(propXml);
      const contentType = extractFirstText(propXml, "getcontenttype");
      const etag = extractFirstText(propXml, "getetag");
      const lastModified = extractFirstText(propXml, "getlastmodified");
      const displayName = extractFirstText(propXml, "displayname");
      const permissions = extractFirstText(propXml, "permissions");
      const ownerDisplayName = extractFirstText(propXml, "owner-display-name");

      return {
        href,
        isFolder,
        ...(sizeText && /^\d+$/.test(sizeText) ? { size: Number(sizeText) } : {}),
        ...(contentType ? { contentType } : {}),
        ...(etag ? { etag } : {}),
        ...(lastModified ? { lastModified } : {}),
        ...(displayName ? { displayName } : {}),
        ...(permissions ? { permissions } : {}),
        ...(ownerDisplayName ? { ownerDisplayName } : {})
      } satisfies DavMultistatusItem;
    })
    .filter((item): item is DavMultistatusItem => Boolean(item));
}
