import { collectQualityMetrics } from "./metrics";
import { collectProductionSources } from "./source-files";

const metrics = collectQualityMetrics(collectProductionSources());

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(metrics));
} else {
  const summary = metrics.summary;
  console.log(
    `metrics (${summary.modules} modules, ${summary.importEdges} imports, ${summary.cycles} cycles, ${summary.platformReferences} platform refs, ${summary.overBudgetModules} modules >600 lines)`
  );
  for (const hotspot of metrics.hotspots.slice(0, 10)) {
    console.log(`${hotspot.lines.toString().padStart(5)} ${hotspot.path}${hotspot.overBudget ? " [over budget]" : ""}`);
  }
}
