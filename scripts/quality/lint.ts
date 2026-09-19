import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { ESLint } from "eslint";

import {
  compareDebtBaseline,
  createDebtBaseline,
  pruneDebtBaseline,
  type DebtBaseline,
  type DebtBaselineEntry
} from "./debt-baseline";
import { lintMessagesToDebtFindings } from "./lint-debt";

const repoRoot = process.cwd();
const configPath = path.join(repoRoot, "eslint.config.js");
const baselinePath = path.join(repoRoot, "scripts/quality/lint-debt.json");
const lintTargets = [
  "*.{js,mjs,cjs,ts}",
  "apps/**/*.{js,mjs,cjs,ts,tsx}",
  "packages/**/*.{js,mjs,cjs,ts,tsx}",
  "scripts/**/*.{js,mjs,cjs,ts,tsx}"
];

const readBaseline = async (): Promise<DebtBaseline> => JSON.parse(
  await fs.readFile(baselinePath, "utf8")
) as DebtBaseline;

const formatEntry = (entry: DebtBaselineEntry): string =>
  `${entry.ruleId} ${entry.path} ${entry.nodeType} x${entry.count}`;

const summarizeEntries = (label: string, entries: readonly DebtBaselineEntry[]): string[] => entries.length === 0
  ? []
  : [label, ...entries.slice(0, 20).map((entry) => `  ${formatEntry(entry)}`),
    ...(entries.length > 20 ? [`  ... ${entries.length - 20} more`] : [])];

const hardFailures = (results: readonly ESLint.LintResult[]): string[] => results.flatMap((result) =>
  result.messages
    .filter((message) => message.severity === 2)
    .map((message) => `${path.relative(repoRoot, result.filePath)}:${message.line ?? 0}:${message.column ?? 0} ${message.ruleId ?? "parse"}`)
);

const main = async (): Promise<void> => {
  const mode = process.argv[2] ?? "check";
  if (!new Set(["check", "create-baseline", "prune-baseline"]).has(mode)) {
    throw new Error(`Unknown lint mode: ${mode}`);
  }

  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: configPath
  });
  const results = await eslint.lintFiles(lintTargets);
  const failures = hardFailures(results);
  const findings = lintMessagesToDebtFindings(repoRoot, results);

  if (failures.length > 0) {
    console.error([`lint FAIL (${failures.length} hard failures)`, ...failures.slice(0, 40)].join("\n"));
    process.exitCode = 1;
    return;
  }

  if (mode === "create-baseline") {
    try {
      await fs.access(baselinePath);
      throw new Error("Refusing to replace the existing lint debt baseline.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    const baseline = createDebtBaseline(findings);
    await fs.writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`lint baseline CREATED (${baseline.entries.length} fingerprints)`);
    return;
  }

  const baseline = await readBaseline();
  if (mode === "prune-baseline") {
    const pruned = pruneDebtBaseline(baseline, findings);
    await fs.writeFile(baselinePath, `${JSON.stringify(pruned, null, 2)}\n`);
    console.log(`lint baseline PRUNED (${pruned.entries.length} fingerprints)`);
    return;
  }

  const comparison = compareDebtBaseline(baseline, findings);
  if (!comparison.matches) {
    console.error([
      "lint debt baseline MISMATCH",
      ...summarizeEntries("additions:", comparison.additions),
      ...summarizeEntries("removals (baseline must be pruned):", comparison.removals)
    ].join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(`lint PASS (${findings.length} baselined findings)`);
};

await main();
