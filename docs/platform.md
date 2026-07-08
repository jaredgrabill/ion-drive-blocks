# Ion Drive: concept, goals, and architecture

Condensed from the platform repo (`jaredgrabill/ion-drive`, locally
`I:\ion-shift\ion-drive`) so block authors here have the essentials without
leaving this repo. The platform docs remain the source of truth —
`docs/concepts/` and `docs/api/` over there.

## The concept

Ion Drive is a **self-hosted, open-source platform for accelerated business
software development**: define data objects, relationships, and business logic
at runtime, and REST, GraphQL, and MCP APIs generate automatically. The pitch:

> Supabase's instant APIs. Payload's code-first ownership. shadcn's
> take-the-code distribution. Self-hosted, in your repo, one command.

Built for LLM-driven development — the MCP server is first-class, so agents can
introspect the schema and call business operations with zero integration code.
**LLM legibility of vendored code is an explicit product goal.**

## Goals (the ownership model)

The core idea is a clean split between **what you upgrade** and **what you own**:

- **The engine is a dependency** — core, admin console, and infrastructure
  plugins are npm packages; upgrades never touch your code.
- **Blocks are yours** — `ion-drive add <name>` applies the block's schema
  *and* vendors its TypeScript into `blocks/<name>/` in the consumer's repo.
  Like shadcn/ui for backend features: edit freely, re-`add` never overwrites,
  future updates arrive as reviewable diffs.
- **Batteries included** — one `pnpm dev` boots the backend + admin console;
  observability (OpenTelemetry → Grafana), auth (Better Auth, pluggable), and
  multi-tenancy (database-per-tenant, on the roadmap) are designed in, not
  bolted on.

Nothing ever forces a merge between "framework upgrade" and "my business
logic" — platform speed with hand-written-code ownership.

## Core architecture

Monorepo (`pnpm` + Turborepo): `packages/core` (Fastify 5 backend — schema
engine, data APIs, MCP, auth), `packages/admin` (React admin console),
`packages/cli`, `packages/client` (typed query builder SDK), plus plugins
(`plugin-redis`, `plugin-sendgrid`, `plugin-storage-s3`). PostgreSQL 17,
Kysely, Zod, Vitest, Biome.

### Data objects

The core primitive: a runtime-defined table plus self-describing metadata.
Creating one instantly lights up REST/GraphQL/MCP. Platform metadata lives in
`_ion_*` system tables (hidden from the data API); every user object gets
system fields `id` (uuid PK), `created_at`, `updated_at`, and nullable
`created_by`/`updated_by` (actor-stamped, read-only via API).

Field options: `columnType`, `isRequired`, `isUnique`, `isIndexed`,
`defaultValue`, `constraints` (`min`, `max`, `pattern`, `enumValues`,
`message`). Column types by category:

| Category | Types |
|:--|:--|
| Text (searchable) | `text`, `short_text`, `long_text`, `rich_text`, `email`, `url`, `phone`, `slug` |
| Number | `integer`, `big_integer`, `decimal`, `float`, `percentage`, `currency` |
| Boolean / date | `boolean`, `date`, `datetime`, `time` |
| Identity | `uuid`, `auto_increment` |
| Structured | `json`, `array_text`, `array_integer` |
| Enum | `enum`, `multi_enum` |
| Special | `rating`, `color`, `ip_address` |

Relationships: `one_to_one`, `one_to_many`, `many_to_one`, `many_to_many`
(junction tables auto-created). Every schema mutation runs a
ChangeSet → validate → preview → transactional-execute pipeline with data-loss
warnings; there is deliberately no automated migration rollback (recovery is
declarative snapshots + backups).

### Events & the message bus

Every record create/update/delete emits `data.<object>.<created|updated|deleted>`
(and m2m link writes emit `.linked`/`.unlinked`) through a **Postgres
transactional-outbox bus** (`_ion_events`) — durable, no broker, swappable for
Redis Streams via plugin. Properties that matter to blocks:

- At-least-once delivery, **at-most-once per named consumer group** across
  instances; handlers must be idempotent on `event.id`. Failed deliveries back
  off exponentially into a retryable dead-letter queue.
- Topic patterns are AMQP-style: `data.*.created`, `data.contacts.#`, `data.#`.
- Update payloads carry a system-field-free `diff` (`{ field: { before, after } }`),
  `before`/`after` images, and the `actor`.
- Built-in bus handlers: `log_event` and `persist_event` (writes the event into
  a data object via a column→token map; event-suppressing, never recurses).
  Token vocabulary: `event.id|topic|occurredAt`,
  `payload.object|id|op|before|after|diff|record|actor|actorId`.
- **Outbound webhooks** are stored config (HMAC-signed, retried, DLQ'd);
  manifests may provision them (`webhooks`: name/url/topics/headers).
- Realtime SSE (`/api/v1/events/stream`) is a best-effort feed, not a queue.

### Actions & hooks (vendored logic)

Blocks expose HTTP surface beyond CRUD via a **declare-then-provide contract**:
the manifest declares `actions`/`hooks` (that's what appears in OpenAPI, MCP,
and GraphQL); the vendored code registers matching handlers at boot
(`ctx.actions.registerAction/registerHook`); install fails if they don't match.

- **Actions** — `POST /api/v1/blocks/:block/actions/:action`. Zod-validated
  input; RBAC defaults to `update` on `blocks`, overridable per action via
  `"rbac": { "resource", "action" }`. Handler context: `input`, `dataService`,
  `secrets`, `config`, `logger`, `signal`. 30s default timeout. Auto-exposed as
  OpenAPI operations, MCP tools (`<block>_<action>`), and GraphQL mutations.
- **Hooks** — `/api/v1/hooks/:block/:hook`, any method. Session-auth **exempt**
  (authenticity is the handler's job — verify provider signatures against the
  raw body before parsing); per-IP rate limiting still applies.

## The block manifest

`block.json` is the source of truth, validated against the platform's Zod
schema. Top-level keys:

| Key | What it declares |
|:--|:--|
| `name`, `version`, `title`, `description`, `author`, `categories` | Identity + catalog metadata; `version` is a **strict canonical semver** version (no `v` prefix, no build metadata — spec-02) |
| `dependencies` | Blocks that must be installed first, as a **name → semver-range record** (`{ "crm": "^0.2.0" }`; `"*"` = unconstrained). Missing → 422; installed-but-out-of-range → 422 `DEPENDENCY_VERSION` (`force` overrides with a warning) |
| `meta` | `icon`, `docs` URL, and `secrets` (name → human description of each secret the code expects) |
| `requires` | `core` (semver range the running core version must satisfy, checked at install → 400 otherwise), `handlers` (bus handlers that must exist, e.g. `persist_event`), and `plugins` that must be loaded |
| `objects` | Data objects + fields (see column types above) |
| `relationships` | Typed links between objects; FK columns materialize as `<relationshipName>_id`; m2m junctions default to `<sourceTable>_<targetTable>`; non-cascade FKs are ON DELETE RESTRICT |
| `actions` / `hooks` | The declared logic surface (vendored `code/` must register handlers) |
| `subscriptions` | Declarative bus subscriptions: `event` pattern, `consumer` group, `handler` name, handler `config` |
| `webhooks` | Outbound webhooks to provision at install (stamped `block:<name>`) |
| `seed` | Demo rows per object, inserted via `bulkCreate` — `id` is stripped, so seed rows cannot wire cross-record FKs |
| `roles` | RBAC roles with per-resource `actions` grants |
| `tasks` | Scheduled tasks (cron `schedule`, handler `type`, `enabled`, `config`) |

### Install pipeline

`ion-drive add <name|url|path>` resolves the registry index
(`registry/index.json` in this repo maps `name → version → artifact URL`),
resolves dependencies recursively (topological order, installed blocks pruned),
then performs a two-part install (ADR-018):

1. **Vendor the code** — `code/` is copied to the consumer's `blocks/<name>/`
   and wired into the `blocks/index.ts` barrel. From then on it's their code.
2. **Install the manifest** — POSTed to `/api/v1/blocks/install`; the server
   validates it (including the declare-then-provide handler check), applies the
   schema, and records the `_ion_blocks` ledger.

Installation is step-wise and idempotent-friendly (existing objects are skipped
and reported); dependency, requirement, and data-loss guards are enforced
server-side. `remove` uninstalls schema but never deletes vendored code.

### Authoring rules of thumb

- Bus handlers have **no data access** — event-driven writes go through
  `persist_event`; custom logic needing `dataService`/`secrets` belongs in
  actions and hooks.
- Keep vendored code **thin and heavily commented**: call platform services,
  never re-implement plumbing.
- Toolchain: `ion-drive block validate <name>` (platform Zod schema +
  structural code checks) and `ion-drive block pack <name>` (emits
  `dist/block.json` with `code/` embedded — what the registry serves). CI fails
  on artifact drift.
