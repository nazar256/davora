import { readFileSync } from "node:fs";

import { evaluateWebRuntimeDominance, extractVitestFileDurations } from "./test-timing";

const reportPath = process.argv[2] ?? ".tmp/wave3/web-timing.json";
const timings = extractVitestFileDurations(JSON.parse(readFileSync(reportPath, "utf8")));
const result = evaluateWebRuntimeDominance(timings.map(({ durationMs }) => durationMs));
const slowest = [...timings].sort((left, right) => right.durationMs - left.durationMs).slice(0, 5);

console.log(JSON.stringify({ ...result, slowest }, undefined, 2));
if (!result.accepted) process.exitCode = 1;
