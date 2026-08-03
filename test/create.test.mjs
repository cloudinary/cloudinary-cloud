import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCreate, ProvisionError } from '../dist/lib/index.js';

const noEcho = async () => { throw new Error('offline'); };

const OK_RESPONSE = {
  id: 'acct1',
  email: 'x@temp.agent.cloudinary.invalid',
  expires_at: '2026-01-01T00:00:00Z',
  delivery_ips: ['203.0.113.7'],
  claim_url: 'https://console.cloudinary.com/claim?token=t',
  product_environments: [{
    id: 'env1',
    cloud_name: 'cloud-abc',
    name: 'cloud-abc',
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
      const result = await runCreate({ apiHost: host, ipEchoFetch: noEcho });
      assert.equal(result.cloudinaryUrl, 'cloudinary://key:secret@cloud-abc');
      assert.equal(result.envResult.action, 'created');
      assert.equal(
        readFileSync(join(dir, '.env'), 'utf-8'),
        'CLOUDINARY_URL=cloudinary://key:secret@cloud-abc\n' +
        'CLOUDINARY_CLOUD_CLAIM_URL=https://console.cloudinary.com/claim?token=t\n' +
        'CLOUDINARY_CLOUD_EXPIRES_AT=2026-01-01T00:00:00Z\n',
      );
    }),
  ));

test('runCreate refuses to provision when .env already has CLOUDINARY_URL', () =>
  inTempCwd(dir =>
    withStub(async (host, requestCount) => {
      writeFileSync(join(dir, '.env'), 'CLOUDINARY_URL=cloudinary://old:old@old\n');
      await assert.rejects(
        runCreate({ apiHost: host, ipEchoFetch: noEcho }),
        err => err instanceof ProvisionError && err.status === 409,
      );
      assert.equal(requestCount(), 0, 'must not burn a cloud before refusing');
    }),
  ));

test('runCreate --force provisions and replaces the existing entry', () =>
  inTempCwd(dir =>
    withStub(async (host, requestCount) => {
      writeFileSync(join(dir, '.env'), 'CLOUDINARY_URL=cloudinary://old:old@old\n');
      const result = await runCreate({ apiHost: host, ipEchoFetch: noEcho, force: true });
      assert.equal(result.envResult.action, 'replaced');
      assert.equal(requestCount(), 1);
      assert.match(readFileSync(join(dir, '.env'), 'utf-8'), /cloud-abc/);
    }),
  ));

test('runCreate rejects invalid --ip values before any request', () =>
  inTempCwd(() =>
    withStub(async (host, requestCount) => {
      for (const ip of [['not-an-ip'], ['203.0.113.0/24'], ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4']]) {
        await assert.rejects(runCreate({ apiHost: host, ip, ipEchoFetch: noEcho }), ProvisionError);
      }
      assert.equal(requestCount(), 0);
    }),
  ));

test('runCreate with env:false skips the .env write', () =>
  inTempCwd(dir =>
    withStub(async host => {
      const result = await runCreate({ apiHost: host, ipEchoFetch: noEcho, env: false });
      assert.equal(result.envResult.action, 'skipped');
      assert.throws(() => readFileSync(join(dir, '.env')));
    }),
  ));

test('an unwritable .env never swallows the credentials', () =>
  inTempCwd(dir =>
    withStub(async host => {
      // A directory named .env makes the write fail after provisioning succeeds.
      mkdirSync(join(dir, '.env'));
      const result = await runCreate({ apiHost: host, ipEchoFetch: noEcho });
      assert.equal(result.envResult.action, 'failed');
      assert.ok(result.envResult.reason.length > 0);
      assert.equal(result.cloudinaryUrl, 'cloudinary://key:secret@cloud-abc');
      assert.equal(result.account.claim_url, 'https://console.cloudinary.com/claim?token=t');
    }),
  ));

// --- default delivery_ips composition ---

function withBodyCapture(run) {
  const bodies = [];
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', () => {
        bodies.push(JSON.parse(raw));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(OK_RESPONSE));
      });
    });
    server.listen(0, async () => {
      const host = `http://localhost:${server.address().port}`;
      try {
        resolve(await run(host, bodies));
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

const echoOf = ip => async () => new Response(`${ip}\n`, { status: 200 });

test('default sends the observed public IP plus the requester_ip sentinel', () =>
  inTempCwd(() =>
    withBodyCapture(async (host, bodies) => {
      const result = await runCreate({ apiHost: host, ipEchoFetch: echoOf('94.7.253.136') });
      assert.deepEqual(bodies[0].delivery_ips, ['94.7.253.136', 'requester_ip']);
      assert.equal(result.observedIp, '94.7.253.136');
    }),
  ));

test('default falls back to requester_ip alone when the IP lookup fails', () =>
  inTempCwd(() =>
    withBodyCapture(async (host, bodies) => {
      const result = await runCreate({ apiHost: host, ipEchoFetch: noEcho });
      assert.deepEqual(bodies[0].delivery_ips, ['requester_ip']);
      assert.equal(result.observedIp, null);
    }),
  ));

test('explicit --ip values are sent verbatim and skip the lookup', () =>
  inTempCwd(() =>
    withBodyCapture(async (host, bodies) => {
      let lookups = 0;
      const countingEcho = async () => { lookups++; return new Response('9.9.9.9', { status: 200 }); };
      await runCreate({ apiHost: host, ip: ['203.0.113.7'], ipEchoFetch: countingEcho });
      assert.deepEqual(bodies[0].delivery_ips, ['203.0.113.7']);
      assert.equal(lookups, 0);
    }),
  ));

// --- agent attribution (experimental) ---

function withAgentEnv(fn) {
  const saved = { CLAUDECODE: process.env.CLAUDECODE, ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL };
  process.env.CLAUDECODE = '1';
  process.env.ANTHROPIC_MODEL = 'claude-fable-5';
  return Promise.resolve().then(fn).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test('sends detected agent attribution and --goal by default', () =>
  withAgentEnv(() =>
    inTempCwd(() =>
      withBodyCapture(async (host, bodies) => {
        await runCreate({ apiHost: host, ipEchoFetch: noEcho, goal: 'add image optimization' });
        assert.equal(bodies[0].agent_framework, 'claude-code');
        assert.equal(bodies[0].agent_llm_model, 'claude-fable-5');
        assert.equal(bodies[0].agent_goal, 'add image optimization');
      }),
    ),
  ));

test('--no-agent-metadata omits attribution fields entirely', () =>
  withAgentEnv(() =>
    inTempCwd(() =>
      withBodyCapture(async (host, bodies) => {
        await runCreate({ apiHost: host, ipEchoFetch: noEcho, agentMetadata: false, goal: 'ignored' });
        assert.equal('agent_framework' in bodies[0], false);
        assert.equal('agent_llm_model' in bodies[0], false);
        assert.equal('agent_goal' in bodies[0], false);
      }),
    ),
  ));
