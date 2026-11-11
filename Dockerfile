FROM node:22-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
# Prisma's install hook may generate the client, so provide a non-secret build-only datasource value.
RUN DATABASE_URL='postgresql://repus:build-only@localhost:5432/repus?schema=public' npm ci --no-audit --no-fund
COPY . .
# Client generation validates the schema datasource variable but does not connect to PostgreSQL.
RUN DATABASE_URL='postgresql://repus:build-only@localhost:5432/repus?schema=public' npm run db:generate

FROM base AS api
RUN npm run build -w @repus/validation && npm run build -w @repus/token-security && npm run build -w @repus/email-renderer && npm run build -w @repus/import-storage && npm run build -w @repus/api
EXPOSE 4000
CMD ["node","apps/api/dist/main.js"]

FROM base AS web
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build -w @repus/email-renderer && npm run build -w @repus/web
EXPOSE 3000
CMD ["node","tools/run-with-env.cjs","--production","--web","node","node_modules/next/dist/bin/next","start","apps/web"]

FROM base AS worker
RUN npm run build -w @repus/token-security && npm run build -w @repus/email-renderer && npm run build -w @repus/validation && npm run build -w @repus/import-storage && npm run build -w @repus/worker
CMD ["node","tools/run-with-env.cjs","--worker-db","node","apps/worker/dist/main.js"]

FROM base AS event-worker
RUN npm run build -w @repus/validation && npm run build -w @repus/event-worker
CMD ["node","tools/run-with-env.cjs","--worker-db","node","apps/event-worker/dist/main.js"]

FROM postgres:16-alpine AS postgres-backup
RUN apk add --no-cache bash openssl && mkdir -p /backups && chown postgres:postgres /backups
COPY tools/postgres-backup-loop.sh /usr/local/bin/postgres-backup-loop
COPY tools/postgres-restore.sh /usr/local/bin/postgres-restore
RUN chmod 0755 /usr/local/bin/postgres-backup-loop /usr/local/bin/postgres-restore
CMD ["/usr/local/bin/postgres-backup-loop"]
