# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build      # Compile TypeScript to dist/
npm test           # Build + node:test suites (no network; in-process HTTP stubs)
```

## Architecture

Single-purpose CLI for Cloudinary sandbox provisioning: an
unauthenticated call to `POST /v1_1/provisioning/sandboxes` returns a
TTL-bounded, IP-locked temporary account with live credentials and a `claim_url` a human
opens later to keep it. Bin: `cloudinary-sandbox`; `create` is the only command and the default (claim and status are planned).

- `src/lib/provision.ts` — provisioning client. Contract types, client-side delivery-IP
  validation (mirrors server rules), `ProvisionError` carrying the API error codes, the
  `"requester_ip"` sentinel. API host resolution: `--api-host` flag > `CLOUDINARY_API_HOST` env
  > production.
- `src/lib/env-file.ts` — `CLOUDINARY_URL` writer for `./.env`: create/append/replace, with
  a `conflict` result when the key exists and `force` is off, plus `isEnvExposedToGit` for
  the post-write gitignore warning. Write failures surface as a `failed` result (never an
  exception) so a provisioned sandbox's credentials always reach the output; `--no-env`
  skips the write entirely.
- `src/commands/create.ts` — `runCreate()` (programmatic core) + `createCommand()` (output + exit
  codes). Refuses to provision when `./.env` already has `CLOUDINARY_URL` — the check runs
  *before* the API call to avoid burning rate-limited sandboxes; `--force` overrides.
- `src/lib/output.ts` — three output modes: TTY human summary (claim URL is the headline;
  never auto-opens a browser), non-TTY greppable `KEY=value` lines, `--json` raw response.
- `src/lib/index.ts` — library API surface (other tools import the provisioning client).
- `src/lib/args.ts` + `src/lib/colors.ts` + `src/lib/version.ts` — hand-rolled argv parsing,
  ANSI helpers, and package metadata (versioned User-Agent). The package has zero runtime
  dependencies by design (npx supply-chain surface); keep it that way.
- Point the CLI at any environment with `CLOUDINARY_API_HOST` or `--api-host`.

## Testing

`node --test` with plain `.mjs` files in `test/` importing from `dist/` — `npm test` builds
first. Integration tests own their fixture HTTP servers on ephemeral ports.

## API contract

The contract is still settling ahead of launch — re-check the provisioning OpenAPI schema
before changing request/response types. Request fields today: `delivery_ips` (required
array; `"requester_ip"` sentinel allowed as an item), `email`. No TTL parameter.
Credentials come back in `product_environments[0].api_access_keys[]`.
