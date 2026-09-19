export interface DebtFinding {
  ruleId: string;
  path: string;
  nodeType: string;
  messageId: string;
  source: string;
}

export interface DebtBaselineEntry extends DebtFinding {
  count: number;
}

export interface DebtBaseline {
  schemaVersion: 1;
  entries: DebtBaselineEntry[];
}

export interface DebtComparison {
  matches: boolean;
  additions: DebtBaselineEntry[];
  removals: DebtBaselineEntry[];
}

const normalizeSource = (source: string): string => source.replace(/\s+/g, " ").trim();

const normalizeFinding = (finding: DebtFinding): DebtFinding => ({
  ...finding,
  path: finding.path.replaceAll("\\", "/"),
  source: normalizeSource(finding.source)
});

const identity = (finding: DebtFinding): string => JSON.stringify([
  finding.ruleId,
  finding.path,
  finding.nodeType,
  finding.messageId,
  finding.source
]);

export const createDebtBaseline = (findings: readonly DebtFinding[]): DebtBaseline => {
  const entries = new Map<string, DebtBaselineEntry>();

  for (const rawFinding of findings) {
    const finding = normalizeFinding(rawFinding);
    const key = identity(finding);
    const existing = entries.get(key);
    entries.set(key, { ...finding, count: (existing?.count ?? 0) + 1 });
  }

  return {
    schemaVersion: 1,
    entries: [...entries.values()].sort((left, right) => identity(left).localeCompare(identity(right)))
  };
};

const entryMap = (baseline: DebtBaseline): Map<string, DebtBaselineEntry> => new Map(
  baseline.entries.map((entry) => [identity(normalizeFinding(entry)), entry])
);

export const compareDebtBaseline = (
  baseline: DebtBaseline,
  currentFindings: readonly DebtFinding[]
): DebtComparison => {
  const expected = entryMap(baseline);
  const current = entryMap(createDebtBaseline(currentFindings));
  const additions: DebtBaselineEntry[] = [];
  const removals: DebtBaselineEntry[] = [];

  for (const [key, entry] of current) {
    const previous = expected.get(key);
    if (!previous || entry.count > previous.count) {
      additions.push({ ...entry, count: entry.count - (previous?.count ?? 0) });
    }
  }
  for (const [key, entry] of expected) {
    const next = current.get(key);
    if (!next || entry.count > next.count) {
      removals.push({ ...entry, count: entry.count - (next?.count ?? 0) });
    }
  }

  return {
    matches: additions.length === 0 && removals.length === 0,
    additions,
    removals
  };
};

export const pruneDebtBaseline = (
  baseline: DebtBaseline,
  currentFindings: readonly DebtFinding[]
): DebtBaseline => {
  const comparison = compareDebtBaseline(baseline, currentFindings);
  if (comparison.additions.length > 0) {
    throw new Error("Prune-only baseline update cannot add debt.");
  }
  return createDebtBaseline(currentFindings);
};
