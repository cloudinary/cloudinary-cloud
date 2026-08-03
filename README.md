# @cloudinary/cloud

**One command, and your media is live on Cloudinary.**

```bash
npx @cloudinary/cloud
```

Provisions a disposable Cloudinary **cloud account** — no signup, no credentials, no human
in the loop. Working `CLOUDINARY_URL` credentials land in `./.env`; a claim URL lets a human
make the account permanent later (same credentials, assets retained).

Built for AI coding agents: unauthenticated, non-interactive, IP-locked delivery,
TTL-bounded, rate-limited per IP.

## Usage

```bash
cloudinary-cloud create                      # provision; delivery locked to your own IP
cloudinary-cloud create --ip 203.0.113.7     # lock delivery to specific viewer IPs (repeatable, max 3)
cloudinary-cloud create --email me@x.com     # pre-fill the claim page (never verified at creation)
cloudinary-cloud create --force              # replace an existing CLOUDINARY_URL in ./.env
cloudinary-cloud create --no-env             # don't touch ./.env — credentials are only printed
cloudinary-cloud create --json               # raw provisioning response for programmatic use
```

Running with no arguments defaults to `create`.

### Output

- **TTY** — human summary; the claim URL is the headline. Never opens a browser.
- **non-TTY** — greppable `KEY=value` lines (`CLOUD_NAME=…`, `CLAIM_URL=…`, …).
- **`--json`** — the raw API response plus `env_file` / `env_file_action`.

### Behavior worth knowing

- If `./.env` already contains `CLOUDINARY_URL`, `create` exits 1 **without provisioning**
  (clouds are rate-limited; don't burn one you won't store). `--force` replaces the line.
- If the `.env` write fails after provisioning (read-only cwd, CI, clouded runtime), the
  credentials are **still printed in full** with `ENV_FILE_ACTION=failed` and a warning —
  a provisioned cloud is never swallowed by a filesystem error.
- If `.env` isn't covered by `.gitignore` in a git repo, `create` warns after writing.
- Cloud media delivery is locked at the CDN edge to `delivery_ips`. By default the CLI
  sends none and the server locks delivery to the address the request came from — the
  right default when the caller is also the viewer. Explicit `--ip` values are sent
  verbatim. After creation the CLI checks (best-effort) whether this machine's public IP
  is in the returned allow-list, and warns with the exact fix if not — the API path and
  the delivery path can exit from different addresses behind VPNs and NAT pools.
- The claim URL and expiry are persisted to `.env` too (`CLOUDINARY_CLOUD_CLAIM_URL`,
  `CLOUDINARY_CLOUD_EXPIRES_AT`), so the claim path survives lost terminal output.
- Cloud lifetime is server-controlled (no TTL parameter in the API).
- Unclaimed clouds are reaped at `expires_at`, assets included. Claiming (a human opens
  `claim_url` and verifies an email) makes the account permanent with the same API key.

## Library API

The provisioning client is exported for other tools:

```ts
import { provisionCloud, runCreate, REQUESTER_IP_SENTINEL } from '@cloudinary/cloud';

const account = await provisionCloud({ deliveryIps: [REQUESTER_IP_SENTINEL] });
```

## Development

```bash
npm install
npm run build      # compile TypeScript to dist/
npm test           # build + node:test (no network; tests own their HTTP stubs)
```

Zero runtime dependencies. Point the CLI at any environment:

```bash
CLOUDINARY_API_HOST=https://staging.example node dist/index.js create
```

## API contract

Speaks `POST /v1_1/provisioning/clouds` (public, unauthenticated, rate limited per IP):

- Request: `delivery_ips` (optional; array of 1–3 public IPs and/or `"requester_ip"` —
  the server always appends the requester's resolved address),
  `email` (optional, unverified pre-fill). No TTL parameter — lifetime is server-set.
- Response: `id`, `email`, `expires_at`, `delivery_ips`, `claim_url`, `guidance`, and
  credentials in `product_environments[0].api_access_keys[]` (`key`/`secret`).
- Errors: `{ error: { category, code?, message, details? } }` with codes such as
  `delivery_ips_not_public`, `ip_rate_limit_exceeded`, `global_rate_limit_exceeded`,
  `agent_registration_disabled`.

New response fields flow into `--json` automatically; the command surface treats its
flags as a stable API.
