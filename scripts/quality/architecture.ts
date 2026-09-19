import ts from "typescript";
import { dirname, extname, posix } from "node:path";

export interface SourceRecord {
  path: string;
  source: string;
}

export interface ArchitectureViolation {
  ruleId: string;
  path: string;
  detail: string;
}

export interface ArchitectureAnalysis {
  violations: ArchitectureViolation[];
  importEdges: number;
  cycles: string[][];
  platformReferences: number;
}

const sourceExtensions = [".ts", ".tsx", ".js", ".jsx"];
const directGlobals = new Set([
  "fetch",
  "XMLHttpRequest",
  "localStorage",
  "indexedDB",
  "history",
  "location",
  "window",
  "globalThis",
  "self",
  "document",
  "navigator",
  "crypto",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "AbortController",
  "FileReader"
]);

const normalizePath = (path: string): string => posix.normalize(path.replaceAll("\\", "/"));

const isIdentifierReference = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;
  return true;
};

const virtualPath = (path: string): string => posix.join("/__davora__", normalizePath(path));

const createAnalysisProgram = (records: readonly SourceRecord[]): ts.Program => {
  const sources = new Map(records.map((record) => [virtualPath(record.path), record]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    skipLibCheck: true
  };
  const host = ts.createCompilerHost(options);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultReadFile = host.readFile.bind(host);
  host.fileExists = (fileName) => sources.has(normalizePath(fileName)) || defaultFileExists(fileName);
  host.readFile = (fileName) => sources.get(normalizePath(fileName))?.source ?? defaultReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const record = sources.get(normalizePath(fileName));
    return record
      ? ts.createSourceFile(
          fileName,
          record.source,
          languageVersion,
          true,
          record.path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
        )
      : defaultGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  return ts.createProgram({ rootNames: [...sources.keys()], options, host });
};

const isGlobalSymbol = (checker: ts.TypeChecker, node: ts.Identifier, sourceFile: ts.SourceFile): boolean => {
  const declarations = checker.getSymbolAtLocation(node)?.declarations;
  return Boolean(declarations?.length && declarations.every((declaration) => declaration.getSourceFile() !== sourceFile));
};

const countPlatformReferencesByPath = (records: readonly SourceRecord[]): Map<string, number> => {
  const program = createAnalysisProgram(records);
  const checker = program.getTypeChecker();
  const counts = new Map<string, number>();

  for (const record of records) {
    const sourceFile = program.getSourceFile(virtualPath(record.path));
    if (!sourceFile) continue;
    let count = 0;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && directGlobals.has(node.text) && isIdentifierReference(node) && isGlobalSymbol(checker, node, sourceFile)) {
        count += 1;
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        const expression = node.expression.text;
        const name = node.name.text;
        const isSpecialGlobal = (expression === "URL" && (name === "createObjectURL" || name === "revokeObjectURL")) ||
          (expression === "Date" && name === "now") ||
          (expression === "Math" && name === "random");
        if (isSpecialGlobal && isGlobalSymbol(checker, node.expression, sourceFile)) count += 1;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    counts.set(normalizePath(record.path), count);
  }
  return counts;
};

export const countPlatformReferences = (record: SourceRecord): number =>
  countPlatformReferencesByPath([record]).get(normalizePath(record.path)) ?? 0;

const resolveImport = (sourcePath: string, specifier: string, paths: Set<string>): string | undefined => {
  let base: string;
  if (specifier === "@davora/shared") {
    base = "packages/shared/src/index";
  } else if (specifier.startsWith("@davora/shared/")) {
    base = `packages/shared/src/${specifier.slice("@davora/shared/".length)}`;
  } else if (specifier.startsWith(".")) {
    base = normalizePath(posix.join(dirname(sourcePath), specifier));
  } else {
    return undefined;
  }

  const withoutExtension = sourceExtensions.includes(extname(base)) ? base.slice(0, -extname(base).length) : base;
  const candidates = [base, ...sourceExtensions.map((extension) => `${withoutExtension}${extension}`)];
  for (const extension of sourceExtensions) candidates.push(`${withoutExtension}/index${extension}`);
  return candidates.find((candidate) => paths.has(candidate));
};

const workspace = (path: string): "web" | "worker" | "shared" | undefined => {
  if (path.startsWith("apps/web/")) return "web";
  if (path.startsWith("apps/worker/")) return "worker";
  if (path.startsWith("packages/shared/")) return "shared";
  return undefined;
};

const featureName = (path: string): string | undefined =>
  /^apps\/web\/src\/features\/([^/]+)\//.exec(path)?.[1];

const findCycles = (graph: Map<string, string[]>): string[][] => {
  const complete = new Set<string>();
  const active = new Map<string, number>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (node: string): void => {
    if (complete.has(node)) return;
    const cycleStart = active.get(node);
    if (cycleStart !== undefined) {
      cycles.push([...stack.slice(cycleStart), node]);
      return;
    }
    active.set(node, stack.length);
    stack.push(node);
    for (const target of graph.get(node) ?? []) visit(target);
    stack.pop();
    active.delete(node);
    complete.add(node);
  };

  for (const node of graph.keys()) visit(node);
  return cycles;
};

export const analyzeArchitecture = (rawRecords: readonly SourceRecord[]): ArchitectureAnalysis => {
  const records = rawRecords.map((record) => ({ ...record, path: normalizePath(record.path) }));
  const paths = new Set(records.map((record) => record.path));
  const graph = new Map<string, string[]>();
  const violations: ArchitectureViolation[] = [];
  let platformReferences = 0;
  const platformReferencesByPath = countPlatformReferencesByPath(records);

  for (const record of records) {
    const imports = ts.preProcessFile(record.source, true, true).importedFiles;
    const isPureDomainModule = /\/(?:model|selectors)\.(?:ts|tsx)$/.test(record.path);
    if (isPureDomainModule && imports.some(({ fileName }) => fileName === "react")) {
      violations.push({ ruleId: "imports/pure-model", path: record.path, detail: "react" });
    }
    const targets = imports
      .map(({ fileName }) => ({ specifier: fileName, target: resolveImport(record.path, fileName, paths) }))
      .filter((entry): entry is { specifier: string; target: string } => entry.target !== undefined);
    graph.set(record.path, targets.map(({ target }) => target));

    for (const { specifier, target } of targets) {
      const sourceWorkspace = workspace(record.path);
      const targetWorkspace = workspace(target);
      if ((sourceWorkspace === "shared" && targetWorkspace !== "shared") ||
          (sourceWorkspace === "web" && targetWorkspace === "worker") ||
          (sourceWorkspace === "worker" && targetWorkspace === "web")) {
        violations.push({ ruleId: "imports/workspace-direction", path: record.path, detail: specifier });
      }

      const sourceFeature = featureName(record.path);
      const targetFeature = featureName(target);
      if (sourceFeature && targetFeature && sourceFeature !== targetFeature && !/\/index\.(?:ts|tsx|js|jsx)$/.test(target)) {
        violations.push({ ruleId: "imports/feature-public-api", path: record.path, detail: specifier });
      }
      if (record.path.startsWith("apps/web/src/platform/") && target.startsWith("apps/web/src/features/")) {
        violations.push({ ruleId: "imports/platform-feature", path: record.path, detail: specifier });
      }
      if (record.path.startsWith("apps/web/src/features/") && target.startsWith("apps/web/src/platform/")) {
        violations.push({ ruleId: "imports/feature-platform", path: record.path, detail: specifier });
      }
      if (isPureDomainModule && target.startsWith("apps/web/src/platform/")) {
        violations.push({ ruleId: "imports/pure-model", path: record.path, detail: specifier });
      }
    }

    const referenceCount = platformReferencesByPath.get(record.path) ?? 0;
    platformReferences += referenceCount;
    const isProspectiveWebTarget = /^apps\/web\/src\/(?:app|features|ui)\//.test(record.path);
    if (isProspectiveWebTarget && referenceCount > 0) {
      violations.push({
        ruleId: "platform/direct-global",
        path: record.path,
        detail: `${referenceCount} direct platform reference(s)`
      });
    }
  }

  for (const path of paths) {
    if (!path.endsWith(".js")) continue;
    const shadowed = `${path.slice(0, -3)}.ts`;
    if (paths.has(shadowed)) {
      violations.push({ ruleId: "sources/no-js-shadow", path, detail: shadowed });
    }
  }

  const cycles = findCycles(graph);
  for (const cycle of cycles) {
    violations.push({ ruleId: "imports/no-cycle", path: cycle[0] ?? "", detail: cycle.join(" -> ") });
  }

  return {
    violations: violations.sort((left, right) =>
      `${left.ruleId}:${left.path}:${left.detail}`.localeCompare(`${right.ruleId}:${right.path}:${right.detail}`)
    ),
    importEdges: [...graph.values()].reduce((total, targets) => total + targets.length, 0),
    cycles,
    platformReferences
  };
};
