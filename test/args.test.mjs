import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../dist/lib/args.js';

test('bare invocation and explicit create both run create', () => {
  assert.deepEqual(parseArgs([]), { kind: 'create', options: {} });
  assert.deepEqual(parseArgs(['create']), { kind: 'create', options: {} });
});

test('parses all flags, space and equals forms', () => {
  const parsed = parseArgs([
    'create', '--ip', '203.0.113.7', '--ip=requester_ip',
    '--email=dev@example.com', '--force', '--no-env', '--json',
    '--api-host', 'http://localhost:9999',
  ]);
  assert.equal(parsed.kind, 'create');
  assert.deepEqual(parsed.options, {
    ip: ['203.0.113.7', 'requester_ip'],
    email: 'dev@example.com',
    force: true,
    env: false,
    json: true,
    apiHost: 'http://localhost:9999',
  });
});

test('help and version short-circuit', () => {
  assert.equal(parseArgs(['--help']).kind, 'help');
  assert.equal(parseArgs(['-h']).kind, 'help');
  assert.equal(parseArgs(['--version']).kind, 'version');
  assert.equal(parseArgs(['create', '-V']).kind, 'version');
});

test('unknown option and unknown command are errors', () => {
  const opt = parseArgs(['--ttl', '30']);
  assert.equal(opt.kind, 'error');
  assert.match(opt.message, /unknown option: --ttl/i);

  const cmd = parseArgs(['upload', 'x.jpg']);
  assert.equal(cmd.kind, 'error');
  assert.match(cmd.message, /unknown command: upload/i);
});

test('value-taking flags reject a missing value', () => {
  for (const flag of ['--ip', '--email', '--api-host']) {
    const parsed = parseArgs([flag]);
    assert.equal(parsed.kind, 'error');
    assert.match(parsed.message, /requires a value/);
  }
  const beforeFlag = parseArgs(['--ip', '--json']);
  assert.equal(beforeFlag.kind, 'error');
});
