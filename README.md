# Repus

Email marketing, made simple. Repus is a multi-tenant email marketing platform built with Next.js, NestJS, PostgreSQL, Prisma, Redis, BullMQ, and Amazon SES.

## Development status

See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for the phase checklist, implemented scope, and remaining production work. The repository started empty apart from `REPUS_SPEC.md`; the implementation is being built from that document. Docker is not installed in the current development environment, so local containers cannot be started here.

Latest verification results and remaining acceptance checks are recorded in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Requirements

- Node.js 22.13+ (the Docker image uses Node.js 22)
- npm 10+
- PostgreSQL 15+ and Redis 7+ (or Docker Compose)
- AWS SES credentials and production access for live delivery; without AWS credentials the API uses a development-only delivery adapter.

## Quick start

1. Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell, or `cp .env.example .env` in a POSIX shell). Replace `SESSION_SECRET` with the output of `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Set `WEB_PORT` if port 3000 is already in use. Web build/start commands always use production rendering while the development API can retain its development email adapter. Configure `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `WORKER_DATABASE_URL`, `REDIS_URL`, and `NEXT_PUBLIC_APP_URL`. `DATABASE_URL` uses the non-owner API role, migration commands switch to the owner URL, and worker launch commands switch to the trusted worker role. For Docker Compose, set `POSTGRES_PASSWORD`, `API_DB_PASSWORD`, and `WORKER_DB_PASSWORD`; its idempotent `db-roles` step creates or updates both runtime logins. Set `RLS_TEST_DATABASE_URL` to the API role and `TEST_DATABASE_URL` to the worker role to run the PostgreSQL integration suites. Add comma-separated operator emails to `PLATFORM_ADMIN_EMAILS` only when you need the platform operations dashboard. Workspace launch/build commands load the root `.env` automatically when it exists.
2. Start infrastructure and reconcile local database roles with `docker compose up -d --wait postgres redis`, then wait for role provisioning to finish with `docker compose run --rm --no-deps db-roles` (or provide compatible services yourself).
3. Install the locked dependencies with `npm ci`.
4. Generate the Prisma client and apply migrations with `npm run db:generate` and `npm run db:migrate`.
5. Run `npm run dev` to start the API and web app. Run `npm run worker` for campaign delivery and `npm run event-worker` for provider event processing. Alternatively, `docker compose up --build --wait --wait-timeout 180` starts the complete local stack and waits for readiness; Compose runs migrations in a one-shot owner-only service before starting the API and workers.

The API listens on port 4000 and serves Swagger at `/api/docs`; the web app listens on port 3000. Users can belong to multiple workspaces, switch their session between active memberships, and manage invitations and workspace roles; profile names are shared across their workspaces. The dashboard includes unique click rate, recent campaigns, recent delivery and engagement events, and a guided setup page at **Getting started** that derives progress from the workspace, verified sending domains, lists, contacts, and campaigns, and can be revisited from the sidebar. The template library includes seven tenant-owned starter designs with preview, edit, duplicate, and delete actions. Contacts support paginated search, full and selected CSV export, list membership, tags, bulk unsubscribe, fresh-permission reactivation, and profile redaction/deletion. CSV imports use a private local staging directory in development and private S3 when `AWS_S3_BUCKET` is configured; the API and worker must share `IMPORT_STAGING_DIR` for local imports. The campaign editor supports bold/italic/text color formatting, reusable templates, configurable email background color, generated HTML source preview, and per-recipient open pixels and authenticated click redirects; set `TRACKING_BASE_URL` to a public HTTPS origin before production sending. SES campaigns require a verified sending identity and DKIM; scheduled campaigns keep a fixed recipient snapshot and can be rescheduled with quota reservations rebased transactionally. In development, email sends are written to structured logs and simulated events are processed by the event worker. Never enable the development adapter in production.

## Useful commands

The dashboard includes a real 14-day contact-growth chart, and Analytics shows accepted totals and unique open/click counts alongside totals and rates. Growth counts newly added contacts in the workspace timezone and excludes deleted contacts. Use **Help Center** at the bottom of the navigation for setup and delivery guidance, or **Your profile** to open profile settings; both shortcuts are available on mobile.

The optional admin browser check uses `E2E_PLATFORM_ADMIN_EMAIL=repus-admin-e2e-<unique-suffix>@example.test`, with that same fresh synthetic address temporarily included in the development API's `PLATFORM_ADMIN_EMAILS`. Run `npm run test:e2e -- apps/web/e2e/admin-quotas.spec.ts` against dedicated local test services. It exercises the real operator login, quota-default form, new registration/workspace assignment, ordinary-owner denial, environment reset and audit records, then restores settings and deletes its accounts. Remove the temporary allowlist entry after the test. The CI workflow configures its synthetic operator only within disposable development services; without the test variable the admin-specific check is skipped.

Open a draft campaign and choose **Edit draft** to reopen its visual design and details. New campaigns retain their block layout, text formatting, background color, and preview text when edited; older HTML drafts are imported into blocks for review before saving.

Choose **Delete draft** on an unsent draft to remove it after confirmation. The API rejects deletion if a concurrent send or schedule has already claimed the draft.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run web and API concurrently |
| `npm run build` | Build all workspaces |
| `npm test` | Run automated tests |
| `npm run test:launcher` | Check command launching and environment/role selection |
| `npm run test:e2e` | Run the Playwright full-stack journey against running local services |
| `npm run test:load` | Verify concurrent tenant-scoped HTTP reads and latency against local development services |
| `npm run test:backup` | Verify encrypted backup and restore using disposable local databases |
| `npm run test:recovery` | Crash/restart the actual worker and verify recovery and duplicate-send protection locally |
| `npm run test:redis-recovery` | Verify AOF job durability across an isolated Redis crash, then run worker recovery |
| `npm run lint` | Lint all workspaces |
| `npm run typecheck` | Type check all workspaces |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:studio` | Open Prisma Studio |

For the full-stack browser journey, copy `.env.example` to `.env`, set a 32-character `SESSION_SECRET`, keep `EMAIL_PROVIDER=development`, start PostgreSQL and Redis, apply migrations, and start `npm run dev`, `npm run worker`, and `npm run event-worker` in separate terminals. Install the browser once with `npx playwright install chromium`, then run `npm run test:e2e`. The journey creates and removes its own tenants and verifies signup, email verification, login, guided onboarding progress, double opt-in resend with stale-link rejection, successful activation, and rejection of reuse of the confirmation token; consent-backed CSV import and list membership; contact profile and custom-field editing; development domain verification; campaign editor formatting and draft creation; test/send; simulated delivery analytics; scheduled-campaign cancellation with quota release; unsubscribe; and rejection of a follow-up send to the suppressed recipient. It creates a second workspace, verifies campaign isolation and switching, then registers and verifies another user, invites that existing account, accepts without replacing its password, checks its workspace role, switches back to the original owner account, and edits the owner profile from another workspace. Use a disposable development database; the test exercises real backend writes and queue processing.

Workspace role edits, removals, invitation resends and restoration reject concurrent role/status changes with a refresh-and-retry message. Removing a member or replacing an invitation affects only the selected workspace; the account and its other memberships and invitations remain intact.

Campaign details include a filterable activity history. Use the event type selector and page controls to find earlier delivery notices, rejections and rendering failures.

Use the recipient status filter, email search and page controls to find a specific recipient or inspect failed and suppressed recipients.

## Local HTTP load baseline

The marketing browser journey requires loopback services, `EMAIL_PROVIDER=development`, and the non-superuser worker database role. Use disposable test services for repeated runs. When a shared local Redis returns HTTP 429, let the affected route's window expire or use a fresh disposable stack with the same limits. The public subscription-confirmation POST allows ten requests per client per hour, and a single journey exercises it multiple times. Keep the API and both workers on the same disposable Redis instance so queue processing and rate-limit state match the test environment.

For a local HTTP load baseline, start the development API, then run `npm run test:load`. It requires loopback HTTP/PostgreSQL, `EMAIL_PROVIDER=development` and the non-superuser `repus_worker` fixture connection. It creates two temporary tenants with 120 contacts each and short-lived synthetic sessions, performs three rounds of 40 requests with concurrency eight and 61 seconds between round starts, verifies list/detail isolation and forged tenant-query rejection, and removes its fixtures. The five-second per-response budget includes JSON parsing. `HTTP_LOAD_ROUNDS=2` through `10` changes the duration; `HTTP_LOAD_API_URL` overrides the API origin. Run it separately from browser tests to avoid sharing the IP rate allowance. It never clears counters or changes throttles. Aggregate latency/status results stay in ignored `.repus-test-data/http-load-*/result.json`; no sessions or response bodies are retained. This small local baseline does not establish production capacity, delivery throughput or privacy-proxy behavior.

## Delivery configuration

Verification, password-reset and invitation emails use an encrypted database outbox and the sending worker. Start `npm run worker` for account email as well as campaigns. Requests persist the message before the worker submits it, so an invitation cannot be mailed before its transaction commits. Development browser links remain available immediately; production delivers through SES. Account jobs take priority over marketing while sharing the provider send-rate limit, and do not consume marketing quotas.

Platform administrators can configure **New workspace defaults** in the admin dashboard. Daily/monthly values apply to new registrations and newly created workspaces; existing tenant quotas are preserved. Blank values use `DEFAULT_TENANT_DAILY_LIMIT` and `DEFAULT_TENANT_MONTHLY_LIMIT`, while zero explicitly disables allowance for that period. Changes are audited.

Recovery verification stays local. `npm run test:backup` requires the standard `repus`, `repus_api`, and `repus_worker` development roles on one loopback PostgreSQL cluster, an owner allowed to create disposable databases, PostgreSQL client tools, Bash and OpenSSL. Set `PGCLIENT_BIN` to the client binary directory when it is not on PATH, and optionally `BASH_BIN` to Bash. Windows defaults to Git Bash and `.repus-tools/postgres-clients/bin`. The drill uses synthetic data, checks tampering/wrong-key rejection and restored RLS, and drops successful disposable databases. Ignored results and a redacted log stay in `.repus-test-data`; keys and encrypted archives stay local. See [deployment recovery instructions](docs/DEPLOYMENT.md) for production responsibilities.

After `npm run build`, run `npm run test:recovery` with `WORKER_RECOVERY_REDIS_URL` set to an unused loopback Redis database 1–15, including its password if required. The tool refuses database zero and any nonempty selected database. It uses the same local PostgreSQL roles and client tools as the backup drill, creates a disposable PostgreSQL database, runs the actual development worker, crashes/restarts it twice, and verifies queued/delayed/scheduled recovery, replay protection, uncertain-send retention and exactly-once quota accounting. Synthetic databases and test queue keys are removed; redacted local evidence stays in `.repus-test-data/worker-drill-*`. It does not restart your Redis server or send real email.

`npm run test:redis-recovery` adds a separate password-protected loopback Redis process with AOF enabled. Supply Redis 7.2+ through `REDIS_SERVER_BIN` (or `redis-server` on PATH); Windows defaults to the existing development binary under `.repus-tools/redis`. The tool chooses a free port, confirms AOF fsync with `WAITAOF`, crashes only its own Redis process, verifies waiting/delayed BullMQ jobs survived, then completes the real-worker recovery/replay/quota drill. Its generated Redis password/configuration, AOF and redacted evidence stay local under ignored `.repus-test-data/redis-drill-*`. No recovery artifact upload or CI recovery job is configured.

The GitHub Actions workflow in `.github/workflows/verify.yml` provisions disposable PostgreSQL/Redis services, bootstraps separate API and worker roles, applies migrations, and runs tests (including non-owner RLS checks), lint, typecheck, builds, and the Chromium marketing, operator, and security specs. It installs the locked dependency tree with `npm ci` and retains the lockfile and diagnostics for seven days. Local recovery output is outside the artifact paths. This workflow has not yet run from this checkout.

Set `EMAIL_PROVIDER=ses`, `AWS_REGION`, and `AWS_SES_CONFIGURATION_SET` to enable Amazon SES. The production API and send worker fail closed unless SES, a private `AWS_S3_BUCKET`, valid `EMAIL_FROM_ADDRESS`, a 32-character `SESSION_SECRET`, and HTTPS `NEXT_PUBLIC_APP_URL`, `TRACKING_BASE_URL`, and `PUBLIC_MEDIA_URL` origins are configured. All three backend services also require PostgreSQL and Redis URLs with non-loopback hosts. The event worker separately requires the production SES SQS queue and SNS topic configuration. Campaign launch also requires a verified identity and Easy DKIM. The worker defaults to one email per second; set `EMAIL_MAX_SEND_RATE_PER_SECOND` no higher than your SES account's current maximum send rate. SES sandbox accounts can only send to verified recipients and have restricted rates; request production access and verify a sending domain before launching campaigns. Prefer IAM roles in production. See [deployment guide](docs/DEPLOYMENT.md).

## Security and compliance

Marketing sends require explicit, recorded permission. Unsubscribe and suppression records are durable. Tenant IDs are taken from the authenticated session. Never upload purchased or scraped lists. Assign on-call owners and configure production alert routing using the [abuse response runbook](docs/ABUSE_RESPONSE.md). Public [Privacy](/privacy), [Terms](/terms), and [Acceptable Use](/acceptable-use) pages are included; deployment-specific legal details remain pending (see [policy publication checklist](docs/LEGAL_POLICIES.md)). Review [security](docs/SECURITY.md), [architecture](docs/ARCHITECTURE.md), and the product requirements in `REPUS_SPEC.md` before deployment.

Use the CloudFormation templates and setup guide in [infrastructure/aws](infrastructure/aws/README.md) for private object storage and the SES event pipeline. The storage template creates a private encrypted bucket with separate API and sending/import-worker policies. The SES template automates the configuration set, DKIM identity, SNS/SQS event delivery, dead-letter queue, queue-lag/DLQ alarms, and IAM permissions scoped to explicit SES identity ARNs; tenant identities must be provisioned by an operator, and DNS publication and SES production approval remain explicit steps. Templates are locally validated; live AWS deployment remains pending.
