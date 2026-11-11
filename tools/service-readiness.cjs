'use strict';

const mode = process.argv[2];
const timeoutMs = 2500;
// Leave time for the probe to report failure before Compose's five-second timeout.
const deadline = setTimeout(() => process.exit(1), 4000);

async function checkHttp(configuredPort, defaultPort, path, expectUnavailable = false) {
  const port = configuredPort ?? defaultPort;
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('Invalid readiness port.');
  }
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (expectUnavailable) {
    if (response.status !== 503 || (await response.json()).code !== 'SERVICE_UNAVAILABLE') {
      throw new Error('Expected fail-closed API response.');
    }
    return;
  }
  if (path === '/api/v1/health/ready' && response.ok) {
    const body = await response.json();
    if (body?.service !== 'repus-api' || body.status !== 'ok' ||
        body.dependencies?.database !== 'available' || body.dependencies?.redis !== 'available') {
      throw new Error('Expected a ready Repus API response.');
    }
    return;
  }
  await response.body?.cancel();
  if (!response.ok) throw new Error('HTTP readiness failed.');
}

async function main() {
  if (mode === 'api' || mode === 'api-unavailable') {
    return checkHttp(process.env.PORT, '4000', '/api/v1/health/ready', mode === 'api-unavailable');
  }
  if (mode === 'web') {
    return checkHttp(process.env.WEB_PORT, '3000', '/');
  }
  if (mode !== 'worker') throw new Error('Unknown readiness mode.');

  const { createPrismaClient } = require('@repus/database');
  const Redis = require('ioredis');
  const database = createPrismaClient();
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: timeoutMs,
    commandTimeout: timeoutMs,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    await Promise.all([database.$queryRawUnsafe('SELECT 1'), redis.ping()]);
  } finally {
    redis.disconnect();
    await database.$disconnect();
  }
}

main().then(
  () => { clearTimeout(deadline); process.exit(0); },
  () => { clearTimeout(deadline); process.exit(1); },
);
