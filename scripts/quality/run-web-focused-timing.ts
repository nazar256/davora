import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

import { evaluateFocusedSuiteTiming } from "./test-timing";

interface FocusedSuite {
  readonly owner: string;
  readonly files: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseManifest(value: unknown): readonly FocusedSuite[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("Focused-suite manifest must be a non-empty array.");
  const owners = new Set<string>();
  const files = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error("Focused-suite entries must be objects.");
    const { owner, files: entryFiles } = entry;
    if (typeof owner !== "string" || !owner || owners.has(owner)) throw new Error("Focused-suite owners must be unique non-empty strings.");
    if (!isStringArray(entryFiles) || entryFiles.length === 0) {
      throw new Error(`Focused suite ${owner} must list test files.`);
    }
    owners.add(owner);
    for (const file of entryFiles) {
      if (!file.startsWith("src/features/") || !file.endsWith(".test.ts") || files.has(file)) {
        throw new Error(`Focused-suite file is invalid or duplicated: ${file}`);
      }
      files.add(file);
    }
    return { owner, files: entryFiles };
  });
}

const projectRoot = process.cwd();
const webRoot = resolve(projectRoot, "apps/web");
const tempRoot = resolve(projectRoot, ".tmp");
const outputDirectory = resolve(tempRoot, "wave3");
const outputPath = resolve(outputDirectory, "focused-timing.json");
if (!outputPath.startsWith(`${tempRoot}${sep}`) || !existsSync(tempRoot)) {
  throw new Error("Focused timing output must stay under the existing repository .tmp directory.");
}
mkdirSync(outputDirectory, { recursive: true });

const manifest = parseManifest(JSON.parse(readFileSync(resolve(projectRoot, "scripts/quality/web-focused-suites.json"), "utf8")));
const vitestEntry = resolve(projectRoot, "node_modules/vitest/vitest.mjs");

const results = manifest.map((suite) => {
  for (const file of suite.files) {
    if (!existsSync(resolve(webRoot, file))) throw new Error(`Focused-suite file does not exist: ${file}`);
  }
  const durationsMs: number[] = [];
  for (let run = 0; run < 4; run += 1) {
    const startedAt = performance.now();
    const result = spawnSync(process.execPath, [vitestEntry, "run", ...suite.files, "--config", "vitest.focused.config.ts", "--no-file-parallelism", "--reporter=basic"], {
      cwd: webRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    });
    const durationMs = performance.now() - startedAt;
    if (result.status !== 0) {
      throw new Error(`Focused suite ${suite.owner} failed on ${run === 0 ? "warm-up" : `measurement ${run}`}\n${result.stdout}\n${result.stderr}`);
    }
    if (run > 0) durationsMs.push(durationMs);
  }
  return { owner: suite.owner, files: suite.files, durationsMs, ...evaluateFocusedSuiteTiming(durationsMs) };
});

writeFileSync(outputPath, `${JSON.stringify({ accepted: results.every((result) => result.accepted), results }, undefined, 2)}\n`);
console.log(JSON.stringify({ accepted: results.every((result) => result.accepted), results }, undefined, 2));
if (results.some((result) => !result.accepted)) process.exitCode = 1;
