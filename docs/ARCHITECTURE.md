# Architecture

Repus is an npm-workspace monorepo. `apps/web` is the Next.js App Router client; `apps/api` is the NestJS REST API; `apps/worker` hosts BullMQ processors. Shared packages hold Prisma persistence, contracts/validation, and safe email rendering. PostgreSQL is the system of record; Redis is a recoverable queue/cache, never the source of quota truth.

## Request and trust boundaries

The browser talks to `/api/v1` using same-site HTTP-only cookies. NestJS validates DTOs and derives user, tenant, and role from the authenticated session. Tenant-owned records use tenant IDs, tenant-scoped service queries, composite foreign keys, and PostgreSQL RLS as defense in depth. Public unsubscribe/tracking endpoints use random unsubscribe tokens and AES-GCM authenticated-encryption tracking capabilities; tokens expose no contact identifiers in URLs.

## Delivery flow

Campaign send validates sender/domain, content, consent, suppressions, audience and quotas in a database transaction. Recipient rows and quota reservations are committed before BullMQ jobs are enqueued; an outbox/reconciler repairs queue publication gaps. Each recipient stores its own quota date. Scheduled campaigns revalidate capacity at launch and atomically rebase their reservations if the platform quota day changed; active campaigns rebase each remaining reservation before provider submission and durably defer jobs when the next day is full. Provider acceptance is charged to the date reported by the provider, including a request that crosses midnight. CSV files are written to private S3 (or a local shared development directory), parsed as streams, previewed with bounded memory, and processed in resumable 500-row database transactions. Import row errors are stored under tenant RLS. Workers apply bounded provider concurrency and send through an adapter. Provider acceptance is stored separately from delivery and accounted exactly once by a ledger helper shared with the event worker. Authenticated SES events can reconcile acceptance if the send worker exits before persisting its response. Ambiguous SES timeouts and server errors are not automatically retried; the recipient remains `SENDING` with its quota reserved until an event or operator review resolves the outcome. SES events arrive through a private SQS queue subscribed to SNS; the event worker verifies SNS signatures and the configured topic before durably recording and asynchronously processing them. Click redirects are restricted to HTTP(S) links present in the stored campaign; tracked HTML uses per-recipient capabilities and a transparent pixel. Open/click totals and first-event unique counts are stored independently. Definite pre-acceptance failures release reservations; accepted submissions remain counted against sending allowance.

## Services

Account verification, password recovery and membership invitations use an outbox on `one_time_tokens`. The API stores the lookup hash and an encrypted delivery capability in its token transaction; it performs no SES submission. The worker reconciles committed pending rows every 15 seconds, queues token IDs only, claims each attempt atomically, verifies the decrypted capability against its stored hash and rechecks validity before submission. Definite throttling backs off for at most five claims; ambiguous outcomes remain unretried and authenticated SES notices can reconcile them. Provider acceptance clears the encrypted delivery material. Account, confirmation, test and campaign jobs have explicit priorities and share one provider-rate limiter. Account mail has no campaign recipient or marketing quota entry.

Provider acceptance, quota settlement and the normalized `accepted` event commit in one transaction through the shared database helper. The sending worker, authenticated provider events and operator reconciliation use that helper; they do not maintain separate acceptance-event writers. SES `Send` notices normalize to acceptance and retain their raw webhook record, while the normalized history contains one acceptance per recipient. A non-destructive migration fills missing historical acceptance entries and preserves existing operator/worker history.

Local Docker Compose provides PostgreSQL, Redis, and a shared local import-staging volume. API, web, email/import worker, and event worker are independently deployable. Production uses SES, private S3 storage, SNS/SQS or EventBridge, CloudWatch, TLS termination, and encrypted PostgreSQL backups. All service settings come from environment variables or managed secrets.

## Decisions and limits

- Prisma migrations are the canonical schema history; raw SQL migrations install RLS and advanced constraints.
- Sessions are server-side, revocable, and stored hashed; cookies are HttpOnly, Secure in production, SameSite=Lax.
- CSV processing is streaming and staged in private object storage; local development may use a private disk adapter.
- Configure `TRACKING_BASE_URL` to the public HTTPS tracking origin in production; open metrics are approximate because of image proxies and privacy controls. Provider acceptance is never labeled inbox placement.
