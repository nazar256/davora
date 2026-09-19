import { describe, expect, it } from "vitest";

import { collectQualityMetrics } from "./metrics";

describe("quality metrics", () => {
  it("reports deterministic hotspot, graph, and platform-debt data", () => {
    const result = collectQualityMetrics([
      {
        path: "apps/web/src/App.tsx",
        source: "fetch('/api');\nconst value = localStorage.getItem('x');\n"
      },
      {
        path: "apps/web/src/lib/value.ts",
        source: 'import "../App";\nexport const value = 1;\n'
      }
    ], { productionModuleBudget: 1 });

    expect(result.schemaVersion).toBe(1);
    expect(result.summary).toMatchObject({ modules: 2, importEdges: 1, platformReferences: 2 });
    expect(result.hotspots.map((entry) => entry.path)).toEqual([
      "apps/web/src/App.tsx",
      "apps/web/src/lib/value.ts"
    ]);
  });
});
