# Contributing

## Local development

```bash
npm ci
npm run build      # tsc → dist/
npm test           # build + node:test (no network; tests own their HTTP stubs)
```

Node 20+ is required (`engines.node`); CI runs the suite on 20, 22 and 24.
`.nvmrc` pins the version used for packaging and releases.

The package has **zero runtime dependencies** by design — it is executed via
`npx`, so every dependency is supply-chain surface for every user. Please keep
it that way; prefer a few lines of local code over a new dependency.

## Releasing

Releases publish to the **public npm registry** (`registry.npmjs.org`), pinned in
`.npmrc`, `publishConfig.registry`, and the workflow's `registry-url` so an
internal mirror in `~/.npmrc` can't redirect a release.

### One-time setup

1. **Bootstrap the package name.** npm can only attach a Trusted Publisher to a
   package that already exists, so the very first publish needs a token:
   add a granular-access `NPM_TOKEN` (scoped to `@cloudinary/cloud`, publish
   permission) as a repository secret, then run the workflow once.
2. **Switch to trusted publishing.** On npmjs.com → the package → *Settings* →
   *Trusted Publisher*, add: GitHub Actions, `cloudinary/cloudinary-cloud`,
   workflow `publish.yml`, environment `npm-publish`. Then delete the
   `NPM_TOKEN` secret — OIDC replaces it and there is no long-lived credential
   left to leak.
3. **Gate the publishes.** Settings → Environments → `npm-publish` → add the
   release owners as *Required reviewers*. Every publish then waits for an
   explicit approval.
4. **Make the repository public** when the provisioning endpoint ships. npm
   provenance attestations are not supported from private or internal
   repositories; until then the workflow publishes unsigned and logs a warning.

### Cutting a release

Bump the version, then either:

- **GitHub Release** (preferred) — tag `v<version>`, matching `package.json`.
  The workflow refuses a mismatch. A release marked *pre-release* publishes
  under the `next` dist-tag; a normal release publishes under `latest`.
- **Manual run** — Actions → *Publish to npm* → *Run workflow*, choosing the
  dist-tag. `dry_run` defaults to **true**; untick it to actually publish.

Publish pre-release or unverified versions under `next`. `npx
@cloudinary/cloud` resolves `latest`, so tagging an unusable version as
`latest` hands every public caller a broken command.
