# @cloudinary/sandbox

**One command, and your media is live on Cloudinary.**

```bash
npx @cloudinary/sandbox
```

Provisions a disposable Cloudinary **sandbox account** — no signup, no credentials, no human
in the loop. Working `CLOUDINARY_URL` credentials land in `./.env`; a claim URL lets a human
make the account permanent later (same credentials, assets retained).

Built for AI coding agents: unauthenticated, non-interactive, IP-locked delivery,
TTL-bounded, rate-limited per IP.

> **Status:** not yet published; the provisioning endpoint is in POC.

## Usage

```bash
cloudinary-sandbox create                      # provision; delivery locked to your own IP
cloudinary-sandbox create --ip 203.0.113.7     # lock delivery to specific viewer IPs (repeatable, max 3)
cloudinary-sandbox create --email me@x.com     # pre-fill the claim page (never verified at creation)
cloudinary-sandbox create --force              # replace an existing CLOUDINARY_URL in ./.env
cloudinary-sandbox create --no-env             # don't touch ./.env — credentials are only printed
cloudinary-sandbox create --json               # raw provisioning response for programmatic use
```

Running with no arguments defaults to `create`.

### Output

- **TTY** — human summary; the claim URL is the headline. Never opens a browser.
- **non-TTY** — greppable `KEY=value` lines (`CLOUD_NAME=…`, `CLAIM_URL=…`, …).
- **`--json`** — the raw API response plus `env_file` / `env_file_action`.

### Behavior worth knowing

- If `./.env` already contains `CLOUDINARY_URL`, `create` exits 1 **without provisioning**
  (sandboxes are rate-limited; don't burn one you won't store). `--force` replaces the line.
- If the `.env` write fails after provisioning (read-only cwd, CI, sandboxed runtime), the
  credentials are **still printed in full** with `ENV_FILE_ACTION=failed` and a warning —
  a provisioned sandbox is never swallowed by a filesystem error.
- If `.env` isn't covered by `.gitignore` in a git repo, `create` warns after writing.
- Sandbox media delivery is locked at the CDN edge to `delivery_ips`. Default is the
  `requester_ip` sentinel — the server locks to the IP the request came from, the right
  default when the caller is also the viewer. Sentinel and explicit IPs can be mixed.
- Sandbox lifetime is server-controlled (no TTL parameter in the API).
- Unclaimed sandboxes are reaped at `expires_at`, assets included. Claiming (a human opens
  `claim_url` and verifies an email) makes the account permanent with the same API key.

## Library API

The provisioning client is exported for other tools:

```ts
import { provisionSandbox, runCreate, REQUESTER_IP_SENTINEL } from '@cloudinary/sandbox';

const account = await provisionSandbox({ deliveryIps: [REQUESTER_IP_SENTINEL] });
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

Speaks `POST /v1_1/provisioning/sandboxes` (public, unauthenticated, rate limited per IP):

- Request: `delivery_ips` (required; array of 1–3 public IPs and/or `"requester_ip"`),
  `email` (optional, unverified pre-fill). No TTL parameter — lifetime is server-set.
- Response: `id`, `email`, `expires_at`, `delivery_ips`, `claim_url`, `guidance`, and
  credentials in `product_environments[0].api_access_keys[]` (`key`/`secret`).
- Errors: `{ error: { category, code?, message, details? } }` with codes such as
  `delivery_ips_not_public`, `ip_rate_limit_exceeded`, `global_rate_limit_exceeded`,
  `agent_registration_disabled`.

The API contract is still settling ahead of launch; flags are shaped so contract changes
absorb without breaking the command surface.
