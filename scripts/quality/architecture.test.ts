import { describe, expect, it } from "vitest";

import { analyzeArchitecture, type SourceRecord } from "./architecture";

const analyze = (files: Record<string, string>) => analyzeArchitecture(
  Object.entries(files).map(([path, source]): SourceRecord => ({ path, source }))
);

describe("architecture analysis", () => {
  it("detects cycles and reverse workspace dependencies", () => {
    const result = analyze({
      "apps/web/src/a.ts": 'import "./b";',
      "apps/web/src/b.ts": 'import "./a";',
      "packages/shared/src/reverse.ts": 'import "../../../apps/web/src/a";'
    });

    expect(result.violations.map((violation) => violation.ruleId)).toEqual(
      expect.arrayContaining(["imports/no-cycle", "imports/workspace-direction"])
    );
  });

  it("allows feature public APIs and rejects cross-feature internals", () => {
    const allowed = analyze({
      "apps/web/src/features/browsing/model.ts": 'import { settings } from "../settings/index";',
      "apps/web/src/features/settings/index.ts": "export const settings = true;"
    });
    const rejected = analyze({
      "apps/web/src/features/browsing/model.ts": 'import { settings } from "../settings/model";',
      "apps/web/src/features/settings/model.ts": "export const settings = true;"
    });

    expect(allowed.violations).toEqual([]);
    expect(rejected.violations).toEqual([
      expect.objectContaining({ ruleId: "imports/feature-public-api" })
    ]);
  });

  it("rejects platform-to-feature imports and direct globals outside platform adapters", () => {
    const result = analyze({
      "apps/web/src/platform/api/client.ts": 'import type { Port } from "../../features/browsing/ports";',
      "apps/web/src/features/browsing/ports.ts": "export interface Port {}",
      "apps/web/src/features/browsing/controller.ts": "export const load = () => fetch('/api');",
      "apps/web/src/platform/api/fetchAdapter.ts": "export const load = () => fetch('/api');"
    });

    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "imports/platform-feature" }),
      expect.objectContaining({ ruleId: "platform/direct-global", path: "apps/web/src/features/browsing/controller.ts" })
    ]));
    expect(result.violations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "platform/direct-global", path: "apps/web/src/platform/api/fetchAdapter.ts" })
    ]));
  });

  it("rejects feature-to-platform imports, including from hooks", () => {
    const result = analyze({
      "apps/web/src/features/transfers/useTransfers.ts": 'import type { Clock } from "../../platform/time/systemClock";',
      "apps/web/src/platform/time/systemClock.ts": "export interface Clock { nowIso(): string }"
    });

    expect(result.violations).toEqual([
      expect.objectContaining({
        ruleId: "imports/feature-platform",
        path: "apps/web/src/features/transfers/useTransfers.ts"
      })
    ]);
  });

  it("detects JavaScript shadows of TypeScript source", () => {
    const result = analyze({
      "packages/shared/src/paths.ts": "export const root = '/';",
      "packages/shared/src/paths.js": "export const root = '/';"
    });

    expect(result.violations).toEqual([
      expect.objectContaining({ ruleId: "sources/no-js-shadow" })
    ]);
  });

  it("keeps models and selectors pure and catches documented browser globals", () => {
    const result = analyze({
      "apps/web/src/features/browsing/model.ts": 'import type { ReactNode } from "react"; export const load = () => window.fetch("/api");',
      "apps/web/src/features/browsing/selectors.ts": "export const body = document.body; export const id = crypto.randomUUID();",
      "apps/web/src/features/browsing/controller.ts": "export const load = () => globalThis.fetch('/api'); export const retry = () => self.fetch('/api');"
    });

    expect(result.violations.filter(({ ruleId }) => ruleId === "imports/pure-model")).toHaveLength(1);
    expect(result.violations.filter(({ ruleId }) => ruleId === "platform/direct-global")).toHaveLength(3);
  });

  it("does not mistake a locally declared platform-like name for a browser global", () => {
    const result = analyze({
      "apps/web/src/features/browsing/controller.ts": "const fetch = () => 1; const self = { fetch }; export const load = () => self.fetch();"
    });

    expect(result.violations).toEqual([]);
  });
});
