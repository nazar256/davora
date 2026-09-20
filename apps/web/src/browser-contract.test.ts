import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = join(process.cwd(), "src");
const FORBIDDEN_PATTERNS = [
  /remote\.php\/dav/i,
  /\bPROPFIND\b/i,
  /\bMKCOL\b/i,
  // WebDAV method tokens are uppercase by spec; keep REPORT case-sensitive so
  // the diagnostics "bug report" feature vocabulary does not collide with it.
  /\bREPORT\b/,
  /Authorization:\s*Basic/i,
  /NEXTCLOUD_APP_PASSWORD/
];

function walkFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      return walkFiles(absolutePath);
    }
    if (/\.test\.(ts|tsx|js|jsx)$/.test(entry)) {
      return [];
    }
    return /\.(ts|tsx|js|jsx|html|css)$/.test(entry) ? [absolutePath] : [];
  });
}

describe("browser contract guard", () => {
  it("keeps raw WebDAV and backend credential surfaces out of browser source", () => {
    for (const filePath of walkFiles(SOURCE_ROOT)) {
      const contents = readFileSync(filePath, "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(contents, `${filePath} should not match ${pattern}`).not.toMatch(pattern);
      }
    }
  }, 30_000);
});
