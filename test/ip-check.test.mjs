import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getObservedPublicIp, deliveryIpMismatchWarning } from '../dist/lib/ip-check.js';

const okFetch = body => async () => new Response(body, { status: 200 });

test('getObservedPublicIp parses a clean IP echo', async () => {
  assert.equal(await getObservedPublicIp(okFetch('203.0.113.9\n')), '203.0.113.9');
  assert.equal(await getObservedPublicIp(okFetch('2001:db8::1')), '2001:db8::1');
});

test('getObservedPublicIp never throws: bad status, garbage body, network error', async () => {
  assert.equal(await getObservedPublicIp(async () => new Response('x', { status: 500 })), null);
  assert.equal(await getObservedPublicIp(okFetch('<html>not an ip</html>')), null);
  assert.equal(await getObservedPublicIp(async () => { throw new Error('offline'); }), null);
});

test('mismatch warning fires only when observed IP is outside the allow-list', () => {
  assert.equal(deliveryIpMismatchWarning(['203.0.113.9'], '203.0.113.9'), null);
  assert.equal(deliveryIpMismatchWarning(['203.0.113.9'], null), null);
  assert.equal(deliveryIpMismatchWarning([], '203.0.113.9'), null);

  const warning = deliveryIpMismatchWarning(['52.20.43.88'], '94.7.253.136');
  assert.match(warning, /94\.7\.253\.136/);
  assert.match(warning, /52\.20\.43\.88/);
  assert.match(warning, /--force --ip 94\.7\.253\.136/);
});
