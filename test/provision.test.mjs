import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  provisionCloud,
  validateDeliveryIps,
  resolveApiHost,
  getCloudinaryUrl,
  getActiveAccessKey,
  ProvisionError,
  REQUESTER_IP_SENTINEL,
  DEFAULT_API_HOST,
  CLOUDS_PATH,
} from '../dist/lib/index.js';

// --- unit: validation ---

test('requester_ip sentinel is valid, alone or alongside IPs', () => {
  assert.equal(validateDeliveryIps([REQUESTER_IP_SENTINEL]), null);
  assert.equal(validateDeliveryIps(['203.0.113.7', REQUESTER_IP_SENTINEL]), null);
});

test('rejects empty list, CIDR, garbage, and >3 entries', () => {
  assert.match(validateDeliveryIps([]), /at least one/i);
  assert.match(validateDeliveryIps(['203.0.113.0/24']), /CIDR/);
  assert.match(validateDeliveryIps(['not-an-ip']), /not a valid ip/i);
  assert.match(validateDeliveryIps(['203.0.113.1', '203.0.113.2', '203.0.113.3', '203.0.113.4']), /at most 3/i);
});

test('accepts IPv4 and IPv6', () => {
  assert.equal(validateDeliveryIps(['203.0.113.7']), null);
  assert.equal(validateDeliveryIps(['2001:db8::1']), null);
});

test('resolveApiHost precedence: explicit > env > default', () => {
  assert.equal(resolveApiHost('http://explicit:1234/'), 'http://explicit:1234');
  const prev = process.env.CLOUDINARY_API_HOST;
  process.env.CLOUDINARY_API_HOST = 'http://from-env:9';
  try {
    assert.equal(resolveApiHost(), 'http://from-env:9');
  } finally {
    if (prev === undefined) delete process.env.CLOUDINARY_API_HOST;
    else process.env.CLOUDINARY_API_HOST = prev;
  }
  if (!process.env.CLOUDINARY_API_HOST) assert.equal(resolveApiHost(), DEFAULT_API_HOST);
});

test('getCloudinaryUrl builds from the first enabled access key', () => {
  const env = {
    id: 'env1',
    cloud_name: 'cloud-abc',
    api_access_keys: [
      { key: 'disabled-key', secret: 's0', enabled: false },
      { key: 'active-key', secret: 's1', enabled: true },
    ],
  };
  assert.equal(getActiveAccessKey(env).key, 'active-key');
  assert.equal(getCloudinaryUrl(env), 'cloudinary://active-key:s1@cloud-abc');
});

test('getActiveAccessKey falls back to the first key and rejects empty lists', () => {
  const onlyDisabled = { id: 'e', cloud_name: 'c', api_access_keys: [{ key: 'k', secret: 's', enabled: false }] };
  assert.equal(getActiveAccessKey(onlyDisabled).key, 'k');
  assert.throws(
    () => getActiveAccessKey({ id: 'e', cloud_name: 'c', api_access_keys: [] }),
    ProvisionError,
  );
});

// --- integration: client against an in-process stub ---

function withStub(handler, run) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
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
  guidance: 'Use it before it expires.',
};

test('posts the contract-shaped body and parses the response', async () => {
  let captured;
  await withStub(
    (req, res) => {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, CLOUDS_PATH);
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', () => {
        captured = JSON.parse(raw);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(OK_RESPONSE));
      });
    },
    async host => {
      const account = await provisionCloud(
        { deliveryIps: [REQUESTER_IP_SENTINEL], email: 'dev@example.com' },
        { apiHost: host },
      );
      assert.equal(account.product_environments[0].cloud_name, 'cloud-abc');
      assert.equal(account.id, 'acct1');
    },
  );
  assert.deepEqual(captured, { delivery_ips: ['requester_ip'], email: 'dev@example.com' });
});

// Live shape since 2026-08: the environment's fields arrive flattened onto the
// account object, with no product_environments array.
const FLAT_RESPONSE = {
  account_id: 'acct2',
  email: 'x@cloud.cloudinary.invalid',
  cloud_name: 'cloud-flat',
  api_key: 'flatkey',
  api_secret: 'flatsecret',
  api_environment_variable: 'CLOUDINARY_URL=cloudinary://flatkey:flatsecret@cloud-flat',
  claimed: false,
  expires_at: '2026-01-01T00:00:00Z',
  delivery_ips: ['203.0.113.7'],
  claim_url: 'https://console.cloudinary.com/claim?token=t',
  guidance: 'Use it before it expires.',
};

test('normalizes the flattened response shape', async () => {
  await withStub(
    (req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(FLAT_RESPONSE));
      });
    },
    async host => {
      const account = await provisionCloud({}, { apiHost: host });
      const env = account.product_environments[0];
      assert.equal(env.cloud_name, 'cloud-flat');
      assert.equal(getCloudinaryUrl(env), 'cloudinary://flatkey:flatsecret@cloud-flat');
      assert.equal(getActiveAccessKey(env).key, 'flatkey');
      assert.equal(account.claim_url, FLAT_RESPONSE.claim_url);
      assert.equal(account.expires_at, FLAT_RESPONSE.expires_at);
    },
  );
});

test('flattened response normalizes without circular references (--json serializes it)', async () => {
  await withStub(
    (req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(FLAT_RESPONSE));
      });
    },
    async host => {
      const account = await provisionCloud({}, { apiHost: host });
      const serialized = JSON.parse(JSON.stringify(account));
      assert.equal(serialized.product_environments[0].cloud_name, 'cloud-flat');
      assert.equal(serialized.product_environments[0].product_environments, undefined);
    },
  );
});

test('unrecognized success shape throws with the raw response preserved', async () => {
  await withStub(
    (req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ unexpected: true, api_secret: 'keep-me' }));
      });
    },
    async host => {
      await assert.rejects(
        provisionCloud({}, { apiHost: host }),
        err => err instanceof ProvisionError && /keep-me/.test(err.message) && /not recognized/.test(err.message),
      );
    },
  );
});

test('omits email when not supplied', async () => {
  let captured;
  await withStub(
    (req, res) => {
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', () => {
        captured = JSON.parse(raw);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(OK_RESPONSE));
      });
    },
    host => provisionCloud({ deliveryIps: ['203.0.113.9'] }, { apiHost: host }),
  );
  assert.deepEqual(captured, { delivery_ips: ['203.0.113.9'] });
});

test('surfaces the API error envelope as ProvisionError', async () => {
  await withStub(
    (req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { category: 'rate_limited', code: 'global_rate_limit_exceeded', message: 'At capacity.' } }));
    },
    async host => {
      await assert.rejects(
        provisionCloud({ deliveryIps: [REQUESTER_IP_SENTINEL] }, { apiHost: host }),
        err => err instanceof ProvisionError
          && err.status === 429
          && err.code === 'global_rate_limit_exceeded'
          && err.message === 'At capacity.',
      );
    },
  );
});

test('handles a non-JSON error body gracefully', async () => {
  await withStub(
    (req, res) => {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end('<html>bad gateway</html>');
    },
    async host => {
      await assert.rejects(
        provisionCloud({ deliveryIps: [REQUESTER_IP_SENTINEL] }, { apiHost: host }),
        err => err instanceof ProvisionError && err.status === 502 && /HTTP 502/.test(err.message),
      );
    },
  );
});

test('invalid IPs fail client-side without a network call', async () => {
  await assert.rejects(
    provisionCloud({ deliveryIps: ['10.0.0.0/8'] }, { apiHost: 'http://localhost:1' }),
    err => err instanceof ProvisionError && err.status === 400,
  );
});

test('unreachable host raises a clear connection error', async () => {
  await assert.rejects(
    provisionCloud({ deliveryIps: [REQUESTER_IP_SENTINEL] }, { apiHost: 'http://localhost:1' }),
    err => err instanceof ProvisionError && err.status === 0 && /could not reach/i.test(err.message),
  );
});

test('sends a versioned User-Agent', async () => {
  let ua;
  await withStub(
    (req, res) => {
      ua = req.headers['user-agent'];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(OK_RESPONSE));
    },
    host => provisionCloud({ deliveryIps: [REQUESTER_IP_SENTINEL] }, { apiHost: host }),
  );
  assert.match(ua, /^cloudinary-cloud\/\d+\.\d+\.\d+ node\/v\d+/);
});

test('a hung server times out with a clear error', async () => {
  await withStub(
    () => { /* never respond */ },
    async host => {
      await assert.rejects(
        provisionCloud({ deliveryIps: [REQUESTER_IP_SENTINEL] }, { apiHost: host, timeoutMs: 200 }),
        err => err instanceof ProvisionError && err.status === 0 && /timed out/i.test(err.message),
      );
    },
  );
});
