const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const { promisify } = require('node:util');

const run = promisify(execFile);
const script = path.join(__dirname, 'service-readiness.cjs');

test('HTTP readiness uses the configured loopback ports and reports unhealthy responses', async () => {
  const paths = [];
  let apiResponse = { status: 503, code: 'SERVICE_UNAVAILABLE' };
  const server = createServer((request, response) => {
    paths.push(request.url);
    if (request.url === '/') response.writeHead(200).end();
    else if (apiResponse.status === 302) response.writeHead(302, { Location: '/' }).end();
    else response.writeHead(apiResponse.status).end(JSON.stringify(apiResponse.body ?? { code: apiResponse.code }));
  });
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const port = String(server.address().port);
    const env = { ...process.env, PORT: port, WEB_PORT: port };
    await run(process.execPath, [script, 'web'], { env, timeout: 6000 });
    await assert.rejects(run(process.execPath, [script, 'api'], { env, timeout: 6000 }), { code: 1 });
    await run(process.execPath, [script, 'api-unavailable'], { env, timeout: 6000 });
    apiResponse = { status: 503, code: 'INTERNAL_SERVER_ERROR' };
    await assert.rejects(run(process.execPath, [script, 'api-unavailable'], { env, timeout: 6000 }), { code: 1 });
    apiResponse = { status: 200, code: 'SERVICE_UNAVAILABLE' };
    await assert.rejects(run(process.execPath, [script, 'api-unavailable'], { env, timeout: 6000 }), { code: 1 });
    await assert.rejects(run(process.execPath, [script, 'api'], { env, timeout: 6000 }), { code: 1 });
    apiResponse = { status: 200, body: { service: 'repus-api', status: 'ok', dependencies: { database: 'available', redis: 'available' } } };
    await run(process.execPath, [script, 'api'], { env, timeout: 6000 });
    await assert.rejects(run(process.execPath, [script, 'web'], {
      env: { ...env, WEB_PORT: `${port}/unexpected` }, timeout: 6000,
    }), { code: 1 });
    apiResponse = { status: 302 };
    await assert.rejects(run(process.execPath, [script, 'api'], { env, timeout: 6000 }), { code: 1 });
    assert.deepEqual(paths, ['/', ...Array(7).fill('/api/v1/health/ready')]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
