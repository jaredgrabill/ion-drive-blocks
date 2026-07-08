# Ion Drive official building blocks

The official block registry for [Ion Drive](https://github.com/jaredgrabill/ion-drive) — the
built-in `@ion` namespace, served as **protocol-v1** static JSON at
`https://registry.iondrive.dev` (this repo's root, via GitHub Pages).

One directory per block:

| Block | What it is |
|:--|:--|
| `crm/` | Leads, companies, contacts, deals, activities — **vendored conversion/pipeline logic** (`code/`) |
| `invoicing/` | Invoices, line items, payments — **vendored Stripe logic** (`code/`) |
| `catalog/` | Products, pricing, stock ledger — **vendored stock/billing logic** (`code/`); extends `invoicing`'s line items with a `product_id` FK |
| `communications/` | Message log, templates, campaigns |
| `audit/` | Cluster-wide audit log via the message bus |

## Layout (registry protocol v1)

```
registry.config.json          # registry identity (name, repository, trust)
registries.json               # PR-reviewed directory of other registries
registry/index.json           # GENERATED directory: name → summary + latest
registry/blocks/<name>.json   # GENERATED per-block version history + digests
schemas/*.v1.json             # published JSON Schemas (copied from @ion-drive/core)
<name>/
  block.json                  # manifest — the source of truth
  code/                       # vendored TypeScript (only for logic-bearing blocks)
  dist/<version>/block.json   # IMMUTABLE released artifact (code embedded)
  dist/<version>/block.json.sigstore.json  # attestation bundle (CI-produced)
```

Resolution: `ion-drive add crm@^0.2` reads `registry/index.json` →
`registry/blocks/crm.json` → picks the highest satisfying version → fetches
the immutable artifact, **verifies its sha256 digest** (and, when attested,
its sigstore provenance — that's the `◆ official` badge), vendors `code/`
into the consumer's project, and installs the manifest. Official blocks ride
the exact same pipeline a third-party registry does.

## Publishing a version

Bump `version` in the block's `block.json`, PR, merge — CI validates every
block (glob-discovered) and guards immutability; the merge to `main` packs,
**attests** (GitHub artifact attestations), and commits the new
`dist/<version>/` artifact + registry JSON. Released `(name, version)` bytes
never change; fixing anything means a new version.

Full procedures (yank, advisories, takedown, directory review, serving):
[`docs/registry-operations.md`](docs/registry-operations.md).

## Develop

```bash
ion-drive block validate <name>   # platform Zod schema + code checks
ion-drive block pack <name>       # emit <name>/dist/<version>/block.json
ion-drive registry build          # regenerate registry JSON (append-only)
ion-drive registry build --check  # CI's drift/immutability guard
```

Test a block against a scaffolded project without publishing anything:

```bash
cd ../my-app && ion-drive add ../blocks/invoicing
```

## Docs

- [`docs/registry-operations.md`](docs/registry-operations.md) — publish, yank, advisory, takedown, and serving runbook.
- [`docs/platform.md`](docs/platform.md) — Ion Drive concept, goals, core architecture, and the block manifest, condensed from the platform repo.
- [`docs/specs/`](docs/specs/README.md) — design specs for upcoming blocks (`projects`, `support`, `scheduling`) and the [ERP suite map](docs/specs/erp-suite.md).

## License

MIT — blocks are meant to be copied, edited, and owned.
