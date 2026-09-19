import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { analyzeArchitecture } from "./architecture";
import { architectureFinding } from "./architecture-debt";
import {
  compareDebtBaseline,
  type DebtBaseline
} from "./debt-baseline";
import { collectProductionSources } from "./source-files";

const baselinePath = resolve(process.cwd(), "scripts/quality/architecture-debt.json");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as DebtBaseline;
const records = collectProductionSources();
const analysis = analyzeArchitecture(records);
const baselineable = analysis.violations.filter(({ ruleId }) => ruleId === "sources/no-js-shadow");
const hardFailures = analysis.violations.filter(({ ruleId }) => ruleId !== "sources/no-js-shadow");
const comparison = compareDebtBaseline(baseline, baselineable.map(architectureFinding));

if (hardFailures.length > 0 || !comparison.matches) {
  for (const violation of hardFailures) {
    console.error(`${violation.ruleId} ${violation.path}: ${violation.detail}`);
  }
  for (const addition of comparison.additions) {
    console.error(`debt-added ${addition.ruleId} ${addition.path}: ${addition.source} (+${addition.count})`);
  }
  for (const removal of comparison.removals) {
    console.error(`debt-baseline-stale ${removal.ruleId} ${removal.path}: ${removal.source} (-${removal.count})`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `architecture PASS (${records.length} modules, ${analysis.importEdges} imports, ${analysis.cycles.length} cycles, ${baseline.entries.length} baselined shadows)`
  );
}
