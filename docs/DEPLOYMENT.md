# Deployment

## Release shape
- Davora is deployed, not published to npm.
- The shipped artifact is two Cloudflare surfaces:
  1. a Worker from `apps/worker`;
  2. a Pages static site from `apps/web/dist`.
- The deployed web build must point at a deployed Worker origin. The same-origin `/api` proxy only exists in local Vite dev/preview.

## Canonical root commands
Run all commands from the repo root unless the step explicitly says otherwise.

`npm install` provides the repo-pinned Wrangler binary used by the root deploy scripts.

```bash
npm run deploy:web
npm run deploy:worker
npm run deploy
```

- `npm run deploy:web` builds the web app and uploads `apps/web/dist` with `wrangler pages deploy`.
- `npm run deploy:worker` runs `wrangler deploy` inside `apps/worker`.
- `npm run deploy` runs the worker deploy first and the web deploy second so a new web build is not exposed before the target API/runtime is ready.
- `npm run deploy:worker:dry-run` is the required preflight for bundle/runtime validation.
- `npm run deploy:worker` and `npm run deploy` now fail fast before publish when required Worker secrets such as `SESSION_SECRET` are missing from the target runtime (`wrangler secret list` preflight).
- `npm run deploy:web` and `npm run deploy` default `VITE_API_BASE_URL` to `https://davora.xyofn8h7t.workers.dev` and default `CLOUDFLARE_PAGES_PROJECT_NAME` to `davora` when those env vars are unset, so the bare root command path matches the documented operator flow.

## Required environment for web → Pages

`npm run deploy:web` and `npm run deploy` use:

- `CLOUDFLARE_PAGES_PROJECT_NAME`: optional target Pages project name override. Default: `davora`.

Optional override:

- `VITE_API_BASE_URL`: public origin of a different deployed Worker. If unset, the script uses the current known deployed Worker origin `https://davora.xyofn8h7t.workers.dev`.

Optional passthrough envs:

- `CLOUDFLARE_PAGES_BRANCH`
- `CLOUDFLARE_DEPLOY_COMMIT_HASH`
- `CLOUDFLARE_DEPLOY_COMMIT_MESSAGE`
- `CLOUDFLARE_DEPLOY_COMMIT_DIRTY=true`
- `CLOUDFLARE_PAGES_SKIP_CACHING=true`
- `CLOUDFLARE_PAGES_NO_BUNDLE=true`
- `CLOUDFLARE_PAGES_UPLOAD_SOURCE_MAPS=true`

Example:

```bash
npm run deploy:web
```

If you are deploying the web app against a different Worker origin, override it explicitly:

```bash
VITE_API_BASE_URL=https://your-worker.example.workers.dev \
npm run deploy:web
```

If you need a non-default Pages project name, override that explicitly too:

```bash
CLOUDFLARE_PAGES_PROJECT_NAME=your-pages-project \
npm run deploy:web
```

## Worker runtime release posture

- `SESSION_SECRET` is mandatory for any deployed Worker runtime. Provision it with `cd apps/worker && wrangler secret put SESSION_SECRET` before the first release in a target environment.
- The deploy script now checks `wrangler secret list --format json` inside `apps/worker` and aborts before publish when `SESSION_SECRET` is absent.
- `NEXTCLOUD_ALLOWED_HOSTS` is optional by default. Leaving it empty allows any valid Nextcloud host while preserving the existing URL-safety checks (`https` except localhost dev, no embedded credentials, no DAV resource URLs, no raw IP hosts outside localhost).
- Worker observability is enabled in `apps/worker/wrangler.toml` as the standard release posture.
- Operator live-log path: `cd apps/worker && wrangler tail davora --format pretty`.

## Worker local runtime smoke path

The exact local runtime smoke command is:

```bash
cd apps/worker && wrangler dev
```

- The repo now ships a safe mock-only `apps/worker/.dev.vars` so that exact command starts without extra app-specific setup once Wrangler itself is installed and on `PATH`.
- `apps/worker/.dev.vars` is intentionally local-mock-only and must not be reused for production secrets.
- If you need a different local config, pass an ignored file explicitly via `wrangler dev --env-file path/to/file`.

Expected local smoke result:
- Worker listens on `http://127.0.0.1:8787`.
- `GET /api/health` returns `configLoaded: true`, backend `mock`, and root `.davora-agent-test`.

## Worker deploy validation

Required preflight:

```bash
npm run deploy:worker -- --dry-run
```

- This exercises the real Wrangler bundle/deploy path without publishing.
- The dry-run output should complete without unresolved runtime-compat warnings.

Publish guardrail:
- `npm run deploy:worker` will now stop before release if `SESSION_SECRET` is not provisioned in the target Worker runtime.

## Pages deploy validation

Cloudflare Pages does not expose a dry-run upload command. The truthful validation path is:

1. build the exact Pages artifact with the default deployed Worker origin or an explicit override;
2. run `wrangler pages deploy` via `npm run deploy:web`;
3. if Cloudflare rejects the upload because auth, account access, or the target project is missing, stop at that first external error and record it precisely.

That still validates the local artifact path, the default-or-explicit Worker-origin wiring, and the exact upload command used by operators.

Example of an honest external blocker from local validation:
- `Project not found. ... [code: 8000007]` means the Pages project name/env is not provisioned for the current Cloudflare account, even though the build and upload command wiring are correct.

## Required future guardrail

If a change touches PWA update behavior, deployment config, Worker runtime config, or Pages/Worker publish wiring, future agents must rerun all of these exact workflows:

```bash
cd apps/worker && wrangler dev
npm run deploy:worker -- --dry-run
npm run deploy:web
```

Process correction: future publish/deploy claims must verify the exact user-facing command path as documented above. Verifying only an env-prefixed or near-equivalent variant is not sufficient evidence for the root workflow claim.

Also rerun:

```bash
npm run test:pwa
```

The dev update prompt is intentionally suppressed in Vite development mode because dev-server service-worker restarts are not release updates. The real update prompt remains validated only in the preview/production-like `npm run test:pwa` path.
