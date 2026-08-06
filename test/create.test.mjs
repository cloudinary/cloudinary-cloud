import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { runCreate, ProvisionError } from '../dist/lib/index.js';
// Deliberately not part of the public library surface — imported from the module.
import { privateRequesterHint } from '../dist/lib/ip-check.js';

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

// --- delivery_ips_not_public guidance ---

test('derived private requester IP produces the gateway hint', () => {
  const hint = privateRequesterHint('delivery IP must be public: 10.16.231.234', undefined);
  assert.match(hint, /10\.16\.231\.234/);
  assert.match(hint, /VPN|WARP/);
  assert.match(hint, /not a\s+security block/);
  assert.match(hint, /do not change network/);
});

test('no hint when the user passed the rejected private IP themselves', () => {
  assert.equal(privateRequesterHint('delivery IP must be public: 10.0.0.5', ['10.0.0.5']), null);
});

test('IPv6 forms are compared normalized, not textually', () => {
  assert.equal(
    privateRequesterHint(
      'delivery IP must be public: FD00:0000:0000:0000:0000:0000:0000:0001',
      ['fd00::1'],
    ),
    null,
  );
});

test('a derived private IP hints even when a user-supplied IP appears first in the message', () => {
  const hint = privateRequesterHint(
    'delivery IPs rejected: 203.0.113.7 is allowed but 10.16.231.234 must be public',
    ['203.0.113.7'],
  );
  assert.match(hint, /10\.16\.231\.234/);
});

test('no hint when every rejected address is public — the private-address story would be wrong', () => {
  assert.equal(privateRequesterHint('delivery IP must be public: 203.0.113.7', undefined), null);
});

test('unparseable message: hint only when the server had to derive (no --ip given)', () => {
  assert.match(privateRequesterHint('delivery IP must be public', undefined), /VPN|WARP/);
  assert.equal(privateRequesterHint('delivery IP must be public', ['203.0.113.7']), null);
});

test('times and stray hex in prose are not mistaken for IPv6', () => {
  assert.match(privateRequesterHint('rejected at 10:30:45 near node bad:beef', undefined), /VPN|WARP/);
});

// --- CLI integration: the hint reaches real output ---

const CLI_BIN = new URL('../dist/index.js', import.meta.url).pathname;

function withNotPublicStub(run) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            category: 'user_error',
            code: 'delivery_ips_not_public',
            message: 'delivery IP must be public: 10.16.231.234',
          },
        }));
      });
    });
    server.listen(0, async () => {
      const host = `http://localhost:${server.address().port}`;
      try {
        resolve(await run(host));
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function runCli(args, apiHost, cwd) {
  return new Promise(resolve => {
    execFile(
      process.execPath,
      [CLI_BIN, ...args],
      { cwd, env: { ...process.env, CLOUDINARY_API_HOST: apiHost, NO_COLOR: '1' } },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }),
    );
  });
}

test('--json error envelope carries the hint field', () =>
  inTempCwd(dir =>
    withNotPublicStub(async host => {
      const { code, stdout } = await runCli(['--json'], host, dir);
      assert.equal(code, 1);
      const payload = JSON.parse(stdout);
      assert.equal(payload.error.code, 'delivery_ips_not_public');
      assert.match(payload.error.hint, /not a\s+security block/);
      assert.match(payload.error.hint, /do not change network/);
    }),
  ));

test('human mode prints the hint to stderr after the error line', () =>
  inTempCwd(dir =>
    withNotPublicStub(async host => {
      const { code, stderr } = await runCli([], host, dir);
      assert.equal(code, 1);
      assert.match(stderr, /delivery IP must be public/);
      assert.match(stderr, /VPN|WARP/);
      assert.match(stderr, /report this to the\s+user/);
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

test('default omits delivery_ips entirely — the server derives the allow-list', () =>
  inTempCwd(() =>
    withBodyCapture(async (host, bodies) => {
      await runCreate({ apiHost: host, ipEchoFetch: noEcho });
      assert.equal('delivery_ips' in bodies[0], false);
    }),
  ));

test('explicit --ip values are sent verbatim, no lookup involved', () =>
  inTempCwd(() =>
    withBodyCapture(async (host, bodies) => {
      let lookups = 0;
      const countingEcho = async () => { lookups++; return new Response('9.9.9.9', { status: 200 }); };
      await runCreate({ apiHost: host, ip: ['203.0.113.7'], ipEchoFetch: countingEcho });
      assert.deepEqual(bodies[0].delivery_ips, ['203.0.113.7']);
      assert.equal(lookups, 0, 'runCreate must not perform the lookup');
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

test('--model overrides env detection for agent_llm_model', () =>
  withAgentEnv(() =>
    inTempCwd(() =>
      withBodyCapture(async (host, bodies) => {
        await runCreate({ apiHost: host, ipEchoFetch: noEcho, model: 'gpt-6-codex' });
        assert.equal(bodies[0].agent_llm_model, 'gpt-6-codex');
        assert.equal(bodies[0].agent_framework, 'claude-code');
      }),
    ),
  ));

test('--no-agent-metadata omits attribution fields entirely', () =>
  withAgentEnv(() =>
    inTempCwd(() =>
      withBodyCapture(async (host, bodies) => {
        await runCreate({ apiHost: host, ipEchoFetch: noEcho, agentMetadata: false, goal: 'ignored', model: 'ignored' });
        assert.equal('agent_framework' in bodies[0], false);
        assert.equal('agent_llm_model' in bodies[0], false);
        assert.equal('agent_goal' in bodies[0], false);
      }),
    ),
  ));
