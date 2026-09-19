import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { analyzeArchitecture } from "./architecture";
import { architectureFinding } from "./architecture-debt";
import { pruneDebtBaseline, type DebtBaseline } from "./debt-baseline";
import { collectProductionSources } from "./source-files";

const baselinePath = resolve(process.cwd(), "scripts/quality/architecture-debt.json");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as DebtBaseline;
const findings = analyzeArchitecture(collectProductionSources()).violations
  .filter(({ ruleId }) => ruleId === "sources/no-js-shadow")
  .map(architectureFinding);
const pruned = pruneDebtBaseline(baseline, findings);

writeFileSync(baselinePath, `${JSON.stringify(pruned, null, 2)}\n`);
console.log(`architecture debt baseline pruned (${pruned.entries.length} entries)`);
