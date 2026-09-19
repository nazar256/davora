import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

type DeployTarget = "web" | "worker" | "all";
type WorkerSecretSummary = { name?: string; type?: string };

export const DEFAULT_DEPLOYED_WORKER_ORIGIN = "https://davora.xyofn8h7t.workers.dev";
export const DEFAULT_PAGES_PROJECT_NAME = "davora";
export const REQUIRED_WORKER_SECRETS = ["SESSION_SECRET", "ACCOUNT_STATE_SECRET", "SESSION_TOKEN_SECRET"];
const WORKER_SECRET_LIST_VALUE_FLAGS = new Set(["--config", "-c", "--cwd", "--env", "-e", "--env-file", "--name"]);
const WORKER_SECRET_LIST_INLINE_FLAGS = ["--config=", "-c=", "--cwd=", "--env=", "-e=", "--env-file=", "--name="];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const workerDir = resolve(repoRoot, "apps/worker");
const defaultWorkerDryRunOutdir = resolve(workerDir, "../../.tmp/worker-dry-run");

function fail(message: string): never {
  throw new Error(message);
}

export function parseCommandJson<T>(renderedCommand: string, output: string): T {
  try {
    return JSON.parse(output || "null") as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse failure.";
    fail(`${renderedCommand} returned invalid JSON: ${message}`);
  }
}

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): void {
  const rendered = [command, ...args].join(" ");
  console.log(`→ ${rendered}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 0) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runJson<T>(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): T {
  const rendered = [command, ...args].join(" ");
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"]
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 0) !== 0) {
    const stderr = result.stderr?.trim();
    fail(stderr ? `${rendered} failed: ${stderr}` : `${rendered} failed with status ${result.status ?? 1}`);
  }

  return parseCommandJson<T>(rendered, result.stdout);
}

function readEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function appendFlag(args: string[], enabled: string | undefined, flag: string): void {
  if (enabled?.trim().toLowerCase() === "true") {
    args.push(flag);
  }
}

function appendOptionalValue(args: string[], value: string | undefined, flag: string): void {
  const trimmed = value?.trim();
  if (trimmed) {
    args.push(flag, trimmed);
  }
}

export function resolveWebDeployConfig(env: NodeJS.ProcessEnv = process.env): {
  apiBaseUrl: string;
  projectName: string;
  wranglerArgs: string[];
  usingDefaultApiBaseUrl: boolean;
  usingDefaultProjectName: boolean;
} {
  const configuredApiBaseUrl = readEnv("VITE_API_BASE_URL", env);
  const apiBaseUrl = configuredApiBaseUrl ?? DEFAULT_DEPLOYED_WORKER_ORIGIN;
  const configuredProjectName = readEnv("CLOUDFLARE_PAGES_PROJECT_NAME", env);
  const projectName = configuredProjectName ?? DEFAULT_PAGES_PROJECT_NAME;
  const wranglerArgs = ["pages", "deploy", "apps/web/dist", "--project-name", projectName];
  appendOptionalValue(wranglerArgs, env.CLOUDFLARE_PAGES_BRANCH, "--branch");
  appendOptionalValue(wranglerArgs, env.CLOUDFLARE_DEPLOY_COMMIT_HASH, "--commit-hash");
  appendOptionalValue(wranglerArgs, env.CLOUDFLARE_DEPLOY_COMMIT_MESSAGE, "--commit-message");
  appendFlag(wranglerArgs, env.CLOUDFLARE_DEPLOY_COMMIT_DIRTY, "--commit-dirty");
  appendFlag(wranglerArgs, env.CLOUDFLARE_PAGES_SKIP_CACHING, "--skip-caching");
  appendFlag(wranglerArgs, env.CLOUDFLARE_PAGES_NO_BUNDLE, "--no-bundle");
  appendFlag(wranglerArgs, env.CLOUDFLARE_PAGES_UPLOAD_SOURCE_MAPS, "--upload-source-maps");
  return {
    apiBaseUrl,
    projectName,
    wranglerArgs,
    usingDefaultApiBaseUrl: !configuredApiBaseUrl,
    usingDefaultProjectName: !configuredProjectName
  };
}

export function assertRequiredWorkerSecrets(
  secrets: WorkerSecretSummary[],
  requiredSecrets: string[] = REQUIRED_WORKER_SECRETS
): void {
  const available = new Set(secrets.map((secret) => secret.name).filter((name): name is string => Boolean(name)));
  const missing = requiredSecrets.filter((secretName) => !available.has(secretName));

  if (missing.length > 0) {
    const renderedMissing = missing.join(", ");
    const provisionCommands = missing.map((secretName) => `wrangler secret put ${secretName}`).join(" and then ");
    fail(`Missing required Worker secret(s): ${renderedMissing}. Provision them in apps/worker via \
\`${provisionCommands}\` before running a release deploy.`);
  }
}

export function buildWorkerSecretListArgs(extraArgs: string[]): string[] {
  const args = ["secret", "list", "--format", "json"];

  for (let index = 0; index < extraArgs.length; index += 1) {
    const arg = extraArgs[index]!;
    if (WORKER_SECRET_LIST_INLINE_FLAGS.some((flag) => arg.startsWith(flag))) {
      args.push(arg);
      continue;
    }

    if (!WORKER_SECRET_LIST_VALUE_FLAGS.has(arg)) {
      continue;
    }

    const value = extraArgs[index + 1];
    if (!value) {
      fail(`${arg} requires a value.`);
    }

    args.push(arg, value);
    index += 1;
  }

  return args;
}

export function assertWorkerDestinationPolicy(env: NodeJS.ProcessEnv = process.env): void {
  const runtimeMode = readEnv("RUNTIME_MODE", env)?.toLowerCase() === "development" ? "development" : "production";
  const allowLocal = readEnv("ALLOW_LOCAL_NEXTCLOUD", env)?.toLowerCase() === "true";

  if (runtimeMode === "production" && allowLocal) {
    fail("ALLOW_LOCAL_NEXTCLOUD=true requires RUNTIME_MODE=development.");
  }
}

function verifyWorkerDeployPreflight(extraArgs: string[]): void {
  assertWorkerDestinationPolicy();
  const secrets = runJson<WorkerSecretSummary[]>("wrangler", buildWorkerSecretListArgs(extraArgs), { cwd: workerDir });
  assertRequiredWorkerSecrets(secrets);
}

function deployWeb(extraArgs: string[]): void {
  if (extraArgs.includes("--dry-run")) {
    fail("Cloudflare Pages does not expose a dry-run upload path. Use `npm run build` for the local artifact check, then run `npm run deploy:web` to exercise the real upload command up to the auth boundary.");
  }

  const config = resolveWebDeployConfig(process.env);

  if (config.usingDefaultApiBaseUrl) {
    console.log(`ℹ Using default VITE_API_BASE_URL=${config.apiBaseUrl}`);
  }
  if (config.usingDefaultProjectName) {
    console.log(`ℹ Using default CLOUDFLARE_PAGES_PROJECT_NAME=${config.projectName}`);
  }

  run("npm", ["run", "build", "--workspace=@davora/web"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      VITE_API_BASE_URL: config.apiBaseUrl
    }
  });

  const args = [...config.wranglerArgs];
  args.push(...extraArgs);
  run("wrangler", args, { cwd: repoRoot });
}

function deployWorker(extraArgs: string[]): void {
  verifyWorkerDeployPreflight(extraArgs);
  const args = ["deploy", ...extraArgs];
  if (extraArgs.includes("--dry-run") && !extraArgs.includes("--outdir")) {
    args.push("--outdir", defaultWorkerDryRunOutdir);
  }
  run("wrangler", args, { cwd: workerDir });
}

export function main(): void {
  const [targetArg, ...extraArgs] = process.argv.slice(2);
  const target = targetArg as DeployTarget | undefined;

  if (!target || !["web", "worker", "all"].includes(target)) {
    fail("Usage: tsx scripts/deploy.ts <web|worker|all> [wrangler args for the selected target]");
  }

  if (target === "web") {
    deployWeb(extraArgs);
    return;
  }

  if (target === "worker") {
    deployWorker(extraArgs);
    return;
  }

  if (extraArgs.length > 0) {
    fail("`npm run deploy` does not forward arbitrary extra args. Use `npm run deploy:web` or `npm run deploy:worker` for target-specific flags.");
  }

  deployWorker([]);
  deployWeb([]);
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;

if (entryPath === fileURLToPath(import.meta.url)) {
  main();
}
