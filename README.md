# Ion Drive official building blocks

The official block catalog for [Ion Drive](https://github.com/ionshift/ion-drive) — plus the
**registry index** the CLI resolves blocks from (`registry/index.json`).

One directory per block:

| Block | What it is |
|:--|:--|
| `crm/` | Companies, contacts, deals, activities |
| `invoicing/` | Invoices, line items, payments — **vendored Stripe logic** (`code/`) |
| `communications/` | Message log, templates, campaigns |
| `audit/` | Cluster-wide audit log via the message bus |

## Block layout

```
<name>/
  block.json        # manifest — the source of truth
  code/             # vendored TypeScript (only for logic-bearing blocks)
  dist/block.json   # distributable artifact (code embedded) — what the registry serves
```

Official blocks distribute through the exact same pipeline a third-party block does:
the registry index maps `name → version → artifact URL`; `ion-drive add <name>` fetches
the artifact, vendors `code/` into the consumer's project, and installs the manifest.

## Develop

```bash
ion-drive block validate <name>   # platform Zod schema + code checks
ion-drive block pack <name>       # emit <name>/dist/block.json
```

Test a block against a scaffolded project without publishing anything:

```bash
cd ../my-app && ion-drive add ../blocks/invoicing
```

CI runs validate + pack for every block and fails on artifact drift.

## License

MIT — blocks are meant to be copied, edited, and owned.
