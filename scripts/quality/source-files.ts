import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

import type { SourceRecord } from "./architecture";

const productionRoots = ["apps/web/src", "apps/worker/src", "packages/shared/src"];
const sourcePattern = /\.(?:ts|tsx|js|jsx)$/;
const excludedPattern = /(?:\.test\.|\.spec\.|\.d\.ts$|\/(?:test|tests)\/)/;

export const isProductionSourcePath = (path: string): boolean => {
  const normalized = path.replaceAll("\\", "/");
  return sourcePattern.test(normalized) && !excludedPattern.test(normalized);
};

const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

export const collectProductionSources = (root = process.cwd()): SourceRecord[] => productionRoots
  .flatMap((directory) => walk(resolve(root, directory)))
  .filter(isProductionSourcePath)
  .map((path) => ({
    path: relative(root, path).replaceAll("\\", "/"),
    source: readFileSync(path, "utf8")
  }));
