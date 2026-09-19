import { analyzeArchitecture, type SourceRecord } from "./architecture";

export interface MetricsOptions {
  productionModuleBudget?: number;
}

export interface QualityMetrics {
  schemaVersion: 1;
  summary: {
    modules: number;
    importEdges: number;
    cycles: number;
    platformReferences: number;
    overBudgetModules: number;
  };
  hotspots: Array<{ path: string; lines: number; overBudget: boolean }>;
}

const lineCount = (source: string): number => source.length === 0
  ? 0
  : source.replace(/\n$/, "").split("\n").length;

export const collectQualityMetrics = (
  records: readonly SourceRecord[],
  options: MetricsOptions = {}
): QualityMetrics => {
  const budget = options.productionModuleBudget ?? 600;
  const analysis = analyzeArchitecture(records);
  const hotspots = records
    .map((record) => ({
      path: record.path.replaceAll("\\", "/"),
      lines: lineCount(record.source),
      overBudget: lineCount(record.source) > budget
    }))
    .sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path));

  return {
    schemaVersion: 1,
    summary: {
      modules: records.length,
      importEdges: analysis.importEdges,
      cycles: analysis.cycles.length,
      platformReferences: analysis.platformReferences,
      overBudgetModules: hotspots.filter(({ overBudget }) => overBudget).length
    },
    hotspots
  };
};
