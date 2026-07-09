# Registry operations runbook

How the main Ion Drive block registry (`registry.iondrive.dev`, this repo) is
operated: publishing, yanking, advisories, the registries directory, takedowns,
and serving. Protocol reference: spec-01 (registry protocol v1) and spec-05
(publishing pipeline) in the platform repo's `docs/specs/blocks-ecosystem/`.

## How this repo is laid out

```
registry.config.json        # hand-maintained registry identity (name, repository, trust)
registries.json             # hand-maintained, PR-reviewed directory of registries
registry/index.json         # GENERATED — never edit by hand
registry/blocks/<name>.json # GENERATED — mutable status fields edited via `registry yank`
<name>/block.json           # block source manifest (+ code/)
<name>/dist/<version>/block.json               # immutable released artifact
<name>/dist/<version>/block.json.sigstore.json # attestation bundle (CI-produced)
schemas/*.v1.json           # copies of core's published JSON Schemas
```

Everything under `registry/` and `*/dist/` is produced by
`ion-drive registry build`; CI (`ci.yml`) fails any PR where they drift from
the sources or where released bytes changed.

`.gitattributes` marks artifacts and registry JSON `-text` (no EOL
translation): their sha256 digests are over exact bytes, and a Windows
checkout with `core.autocrlf` would otherwise serve CRLF-mangled artifacts
that fail every consumer's digest verification. Keep those patterns when
adding new generated paths.

## Testing blocks (spec-06)

CI runs `ion-drive block test <dir> --deps-from .` for every block on every
push and PR: it creates a scratch database on the workflow's Postgres service
container, boots a **real** ephemeral Ion Drive server with the block's code
vendored, installs the block (dependencies resolved offline from this repo),
runs the built-in assertion suite (install report, data endpoints, action
reachability, uninstall-leaves-no-residue via the schema doctor) plus the
block's own `test/*.test.ts` files (`tsx --test` with `ION_TEST_SERVER_URL` /
`ION_TEST_API_KEY`), and uninstalls. Run the same command locally before
opening a PR — a green `block test` is required before a block enters the
registry. Optional per-block `test/fixtures.json` supplies action inputs and
seed-count expectations.

## Publishing a version (the normal flow)

1. Edit the block, bump `version` in its `block.json` (strict semver; a
   released `(name, version)` is immutable — any change means a bump).
2. Run `ion-drive registry build` locally and commit the generated artifact +
   registry JSON with your change (or let CI's publish run generate them —
   both work; the guard only refuses *mutations*).
3. Open a PR. CI validates every block and runs the drift guard.
4. Merge to `main`. `publish.yml` → `publish-block.yml`:
   - packs any manifest version with no released artifact,
   - attests each new artifact (`actions/attest-build-provenance` — OIDC →
     Fulcio → Rekor, no keys to manage),
   - downloads each bundle adjacent as `block.json.sigstore.json`, re-runs the
     (idempotent) build so `attestationUrl` lands,
   - commits `publish: <name>@<version>` back to `main`.
5. Verify: `ion-drive block verify <name>@<version>` from any project should
   report the digest OK, attestation OK, tier `◆ official`.

Rehearse without publishing: **Actions → publish → Run workflow** (dry-run
defaults to `true`) — the run must go green with a correct would-publish
summary and no commit.

Third parties: `ion-drive block publish --registry-repo <owner/repo>` opens
the same PR against any registry repo (or `--direct` pushes to its default
branch). Local publishes cannot attest provenance — the block stays
`community` until the target repo's CI attests on main.

## Yanking a version

Yanked versions are never *selected* by resolvers (not for ranges, not as
`latest`); exact re-installs of a version already recorded in a project keep
working, loudly warned.

```bash
git switch -c yank-crm-0.2.0
ion-drive registry yank crm@0.2.0 --reason "0.2.0 corrupts pipeline stages on install"
git commit -am "yank: crm@0.2.0" && git push  # then PR + merge
```

`registry deprecate <name>@<version> --reason …` is the softer variant
(installable, clients warn). Both recompute `latest` in the block doc and the
index. The artifact stays in place — yank is a status edit, not a deletion.

## Publishing an advisory

Advisories are the one hand edit made to a generated file: add an entry to the
`advisories` array in `registry/blocks/<name>.json` (the build preserves it):

```json
{
  "id": "IONB-2026-0001",
  "severity": "critical",
  "affectedVersions": "<0.2.1",
  "description": "0.2.0 shipped a webhook handler that logged raw Stripe payloads.",
  "url": "https://github.com/jaredgrabill/ion-drive-blocks/security/advisories/…",
  "createdAt": "2026-07-08T00:00:00Z"
}
```

IDs are `IONB-<year>-<seq>`, first-come. Severity: `low|moderate|high|critical`.
`affectedVersions` is a semver range. Consumed by `ion-drive audit` (spec-06)
and resolver warnings. Usually paired with a yank of the affected versions.

## Malware takedown (interim procedure, spec-01 §5)

The **only** case where released bytes may be removed. All three steps land in
one PR, merged immediately:

1. Delete the malicious artifact file (`<name>/dist/<version>/block.json` and
   its `.sigstore.json`) — the URL 404s from the next Pages deploy.
2. `ion-drive registry yank <name>@<version> --reason "malware takedown: …"`.
3. Publish a `critical` advisory covering the version.

Consumers then see a loud, explicable failure instead of silently installing
malware. Digests recorded in every consumer's `ion.config.json` make any
out-of-band artifact mutation detectable at their next `add`/`audit`.
(M3 formalizes an SLA and a hosted takedown API.)

## Reviewing a registries-directory PR (`registries.json`)

`trust: "listed"` means exactly "reviewed for listing", **not** "code
audited" — say so in any communication. Checklist before merging an entry:

- [ ] `url` is public HTTPS and serves a valid protocol-v1 `index.json`
      (`ion-drive registry add @probe <url>` against a scratch project passes).
- [ ] `namespace` matches the grammar (`@[a-z][a-z0-9-]*`), is not a
      name-grab of a brand/product the submitter doesn't represent, and does
      not collide with an existing entry (first-come-first-served).
- [ ] `owner` and a working contact (repo issues or email) are present.
- [ ] The registry's blocks install into a scratch project without the server
      erroring (spot-check one).

Disputes are resolved by the maintainers; M3 formalizes the name policy.

## Serving: GitHub Pages + registry.iondrive.dev

`pages.yml` deploys the repo root on every push to `main`
(`actions/deploy-pages`; `.nojekyll` keeps Pages from mangling paths). The
custom domain + DNS are owner-configured in repo Settings → Pages
(CNAME `registry.iondrive.dev` → `<owner>.github.io`, HTTPS enforced).

Sanity after a deploy:

```bash
curl -fsS https://registry.iondrive.dev/registry/index.json | jq .schemaVersion   # 1
curl -fsS https://registry.iondrive.dev/registry/blocks/crm.json | jq .latest
curl -fsSI https://registry.iondrive.dev/crm/dist/0.2.0/block.json                # 200
curl -fsS https://registry.iondrive.dev/schemas/registry-index.v1.json | jq '.["$id"]'
curl -fsS https://registry.iondrive.dev/registries.json | jq '.registries[].namespace'
```

GitHub Pages cannot serve `cache-control: immutable` on `dist/**` — accepted
(digests make caching safe regardless). If immutable headers ever matter,
migrate to Cloudflare Pages: same repo, plus a `_headers` file:

```
/*/dist/*
  Cache-Control: public, max-age=31536000, immutable
```

## Keeping `/schemas` in sync with core

The `schemas/*.v1.json` files are copies of the JSON Schemas
`@ion-drive/core` generates from its Zod definitions
(`packages/core/schemas/` in the platform repo, emitted by
`pnpm --filter @ion-drive/core emit:schemas`). On every core release that
touches them, re-copy:

```bash
cp <ion-drive>/packages/core/schemas/*.v1.json schemas/
```

CI's "Schemas parity" step diffs `schemas/` against the installed
`@ion-drive/core`'s `schemas/` directory and fails on drift.
