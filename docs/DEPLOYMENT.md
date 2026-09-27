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
- `npm run deploy:worker` and `npm run deploy` fail fast before publish when any required Worker key role (`SESSION_SECRET`, `ACCOUNT_STATE_SECRET`, `SESSION_TOKEN_SECRET`, or `DIAGNOSTIC_QUOTA_SECRET`) is missing from the target runtime (`wrangler secret list` preflight).
- `npm run deploy:web` and `npm run deploy` default `VITE_API_BASE_URL` to `https://api.example.invalid` and default `CLOUDFLARE_PAGES_PROJECT_NAME` to `davora` when those env vars are unset, so the bare root command path matches the documented operator flow.

## Required environment for web → Pages

`npm run deploy:web` and `npm run deploy` use:

- `CLOUDFLARE_PAGES_PROJECT_NAME`: optional target Pages project name override. Default: `davora`.

Optional override:

- `VITE_API_BASE_URL`: public origin of a different deployed Worker. If unset, the script uses the current known deployed Worker origin `https://api.example.invalid`.

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

- `SESSION_SECRET` is mandatory for any deployed Worker runtime, and production rejects values shorter than 32 UTF-8 bytes. Generate and pipe fresh randomness directly to Wrangler without placing it in a file, shell variable, log, or repository:
  ```bash
  (cd apps/worker && head -c 32 /dev/urandom | base64 | tr -d '\n' | wrangler secret put SESSION_SECRET)
  ```
  Rotating it invalidates all sessions and short-lived stream tokens. It also changes the key used for encrypted Worker account state, so the rotation procedure must intentionally reset/re-provision the old encrypted account-state envelope before reconnecting accounts; a decrypt failure must never be treated as an empty state.
- For a session-only rotation, leave `SESSION_SECRET` unchanged and provision a separate `SESSION_TOKEN_SECRET` from fresh randomness:
  ```bash
  (cd apps/worker && head -c 32 /dev/urandom | base64 | tr -d '\n' | wrangler secret put SESSION_TOKEN_SECRET)
  ```
  The Worker falls back to `SESSION_SECRET` only until this optional secret is provisioned. Once present, it signs and verifies account-session and stream tokens while account-state encryption continues using `SESSION_SECRET`; all existing sessions are invalidated without requiring account reconnect.
  This token-only path requires the existing production `SESSION_SECRET` to already satisfy the 32-byte state-key policy. If it is a short legacy key, use the two-key migration below instead.
- To migrate a legacy state key while preserving accounts, provision both fresh keys before deploying the migration code:
  ```bash
  (cd apps/worker && head -c 32 /dev/urandom | base64 | tr -d '\n' | wrangler secret put ACCOUNT_STATE_SECRET)
  (cd apps/worker && head -c 32 /dev/urandom | base64 | tr -d '\n' | wrangler secret put SESSION_TOKEN_SECRET)
  ```
  The Worker decrypts the existing envelope with the legacy `SESSION_SECRET`, writes it encrypted under `ACCOUNT_STATE_SECRET`, and signs new sessions with `SESSION_TOKEN_SECRET`. Only after successful migration should the legacy key be retired through a separately verified rollout.
- `APP_UNLOCK_CODE` is development-only. Production rejects any non-empty value; do not use it as a production rate-control or authentication mechanism.
- The deploy script checks `wrangler secret list --format json` inside `apps/worker` and aborts before publish when any required production key role is absent. It also reads `davora-local-diagnostic-reports` through Wrangler's EU jurisdiction and fails closed unless both exact enabled 30-day lifecycle rules are present. It passes `--keep-vars`, explicitly enables diagnostic upload, and stamps matching dirty-aware build labels into Worker and web artifacts.
- `NEXTCLOUD_ALLOWED_HOSTS` is optional in real production mode. When it is empty, users may connect to any public HTTPS Nextcloud hostname; when set, it is an exact normalized hostname allowlist (for example `nextcloud.example.invalid`). `RUNTIME_MODE` defaults to `production`; `ALLOW_LOCAL_NEXTCLOUD=true` is valid only with `RUNTIME_MODE=development` and permits only explicit localhost/loopback destinations. Production always rejects HTTP, IP literals, special-use/private/link-local/metadata destinations, credentials, query/fragment syntax, wildcard/suffix matches, and invalid ports. Cloudflare's Worker egress restrictions remain an additional platform boundary.
- Worker observability keeps application logs and errors available, while request invocation logs and traces are disabled in `apps/worker/wrangler.toml` so short-lived stream tokens in media URLs are not retained.
- Operator live-log path: `cd apps/worker && wrangler tail davora --format pretty`.

## Private diagnostic report inbox

- `POST /api/diagnostic-reports` accepts only an authenticated session and only after the user explicitly presses **Send report**. Download and Share remain local alternatives.
- The Worker streams at most 3 MiB, requires ZIP magic plus a matching SHA-256, rate-limits per account and globally, and allows at most three accepted report IDs per account-derived HMAC and UTC day. R2 metadata contains no raw account ID, username, path, description, token, or file content.
- `DAVORA_DIAGNOSTIC_REPORTS` binds the private EU-jurisdiction bucket `davora-local-diagnostic-reports`. There is no public list or download endpoint.
- Provision the independent quota-HMAC secret without placing it in a file or shell variable:
  ```bash
  (cd apps/worker && head -c 32 /dev/urandom | base64 | tr -d '\n' | wrangler secret put DIAGNOSTIC_QUOTA_SECRET)
  ```
- The bucket has two enabled 30-day expiry rules, one each for `reports/v1/` and `quota/v1/`. Every Worker deploy verifies both rules and that the bucket is reachable only through the configured EU jurisdiction before upload can be enabled. Inspect them manually with:
  ```bash
  cd apps/worker && wrangler r2 bucket lifecycle list davora-local-diagnostic-reports --jurisdiction eu
  ```
- Create a separate Cloudflare API token with only account R2 read permission for operator pulls. Export it interactively as `CLOUDFLARE_DIAGNOSTICS_READ_TOKEN`, set `CLOUDFLARE_ACCOUNT_ID`, then run:
  ```bash
  npm run diagnostics:inbox -- pull --since 30d --limit 50
  ```
  The command performs only GET requests, accepts only canonical `reports/v1/YYYY/MM/DD/<uuid>.zip` keys, verifies the stored SHA-256, never extracts archive contents, and writes ZIPs plus `manifest.json` only under ignored `.tmp/diagnostic-inbox/`.
- **Handled reports must always be cleared from the inbox.** Once a report has been investigated and its fix is deployed and verified, delete it explicitly so the inbox only ever holds unhandled reports:
  ```bash
  npm run diagnostics:inbox -- clear --report <uuid> [--report <uuid>...]
  ```
  `clear` resolves each UUID to canonical `reports/v1/` object keys and issues DELETE requests only for those keys — it never touches quota objects, unmatched IDs, or other keys, and it reports IDs that were already absent as `missing`. It requires a separate token with R2 object delete permission exported as `CLOUDFLARE_DIAGNOSTICS_WRITE_TOKEN`; do not reuse the read token.

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
- `npm run deploy:worker` stops before release if `SESSION_SECRET`, `ACCOUNT_STATE_SECRET`, `SESSION_TOKEN_SECRET`, or `DIAGNOSTIC_QUOTA_SECRET` is not provisioned in the target Worker runtime.

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
