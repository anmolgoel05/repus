# Repository guidance

- `REPUS_SPEC.md` is the authoritative product and engineering specification.
- Use TypeScript, npm workspaces, Next.js App Router, NestJS, Prisma migrations, PostgreSQL, Redis, and BullMQ.
- Tenant identity must come from authenticated context. Every tenant query is scoped; never accept a tenant ID as authorization.
- Use parameterized ORM queries, validated DTOs, HTTP-only session cookies, Argon2id, durable idempotency, and database-backed quota reservations.
- Do not commit secrets or enable simulated email delivery in production.
- Maintain implementation status in `docs/IMPLEMENTATION_PLAN.md` and setup instructions in `README.md`.
- Tests must cover tenant isolation and security-sensitive business rules. Run the relevant tests and type checks after changes.
