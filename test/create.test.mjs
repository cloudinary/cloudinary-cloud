import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCreate, ProvisionError } from '../dist/lib/index.js';

const OK_RESPONSE = {
  id: 'acct1',
  email: 'x@temp.agent.cloudinary.invalid',
  expires_at: '2026-01-01T00:00:00Z',
  delivery_ips: ['203.0.113.7'],
  claim_url: 'https://console.cloudinary.com/claim?token=t',
  product_environments: [{
    id: 'env1',
    cloud_name: 'sandbox-abc',
    name: 'sandbox-abc',
    enabled: true,
    api_access_keys: [{ key: 'key', secret: 'secret', enabled: true }],
  }],
};

function withStub(run) {
  let requests = 0;
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      requests++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(OK_RESPONSE));
    });
    server.listen(0, async () => {
      const host = `http://localhost:${server.address().port}`;
      try {
        resolve(await run(host, () => requests));
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function inTempCwd(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cld-init-'));
  const prev = process.cwd();
  process.chdir(dir);
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => process.chdir(prev));
}

test('runCreate provisions and writes CLOUDINARY_URL to ./.env', () =>
  inTempCwd(dir =>
    withStub(async host => {
      const result = await runCreate({ apiHost: host });
      assert.equal(result.cloudinaryUrl, 'cloudinary://key:secret@sandbox-abc');
      assert.equal(result.envResult.action, 'created');
      assert.equal(
        readFileSync(join(dir, '.env'), 'utf-8'),
        'CLOUDINARY_URL=cloudinary://key:secret@sandbox-abc\n',
      );
    }),
  ));

test('runCreate refuses to provision when .env already has CLOUDINARY_URL', () =>
  inTempCwd(dir =>
    withStub(async (host, requestCount) => {
      writeFileSync(join(dir, '.env'), 'CLOUDINARY_URL=cloudinary://old:old@old\n');
      await assert.rejects(
        runCreate({ apiHost: host }),
        err => err instanceof ProvisionError && err.status === 409,
      );
      assert.equal(requestCount(), 0, 'must not burn a sandbox before refusing');
    }),
  ));

test('runCreate --force provisions and replaces the existing entry', () =>
  inTempCwd(dir =>
    withStub(async (host, requestCount) => {
      writeFileSync(join(dir, '.env'), 'CLOUDINARY_URL=cloudinary://old:old@old\n');
      const result = await runCreate({ apiHost: host, force: true });
      assert.equal(result.envResult.action, 'replaced');
      assert.equal(requestCount(), 1);
      assert.match(readFileSync(join(dir, '.env'), 'utf-8'), /sandbox-abc/);
    }),
  ));

test('runCreate rejects invalid --ip values before any request', () =>
  inTempCwd(() =>
    withStub(async (host, requestCount) => {
      for (const ip of [['not-an-ip'], ['203.0.113.0/24'], ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4']]) {
        await assert.rejects(runCreate({ apiHost: host, ip }), ProvisionError);
      }
      assert.equal(requestCount(), 0);
    }),
  ));

test('runCreate with env:false skips the .env write', () =>
  inTempCwd(dir =>
    withStub(async host => {
      const result = await runCreate({ apiHost: host, env: false });
      assert.equal(result.envResult.action, 'skipped');
      assert.throws(() => readFileSync(join(dir, '.env')));
    }),
  ));

test('an unwritable .env never swallows the credentials', () =>
  inTempCwd(dir =>
    withStub(async host => {
      // A directory named .env makes the write fail after provisioning succeeds.
      mkdirSync(join(dir, '.env'));
      const result = await runCreate({ apiHost: host });
      assert.equal(result.envResult.action, 'failed');
      assert.ok(result.envResult.reason.length > 0);
      assert.equal(result.cloudinaryUrl, 'cloudinary://key:secret@sandbox-abc');
      assert.equal(result.account.claim_url, 'https://console.cloudinary.com/claim?token=t');
    }),
  ));
