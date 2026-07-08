# Block spec: `catalog`

**Status:** implemented — shipped as `catalog` 0.1.0 (see [resolved findings](#resolved-during-implementation))
**Depends on:** `invoicing`
**Categories:** `commerce`, `inventory`
**Vendored logic:** yes (`code/` — actions)

## Why

Invoicing's `line_items` are freeform today — every invoice retypes the price.
A product catalog makes billing repeatable (pick a product, price flows in) and
adds lightweight stock tracking for anyone selling goods. Smallest spec in the
set; recommended first build.

## Objects

### `products`

| Field | Type | Notes |
|:--|:--|:--|
| `sku` | `short_text` | required, unique, indexed |
| `name` | `short_text` | required, indexed |
| `kind` | `enum` | `good / service / subscription`; default `good` |
| `unit_price` | `currency` | required |
| `cost` | `currency` | for margin reporting |
| `tax_rate` | `percentage` | 0–100 |
| `unit` | `short_text` | e.g. "each", "hour", "seat" |
| `active` | `boolean` | default `true`; indexed — inactive products can't be added to invoices |
| `track_stock` | `boolean` | default `false` — only `good`s usually |
| `stock_on_hand` | `integer` | maintained exclusively by `adjust_stock`; min not enforced (backorders go negative) |
| `reorder_point` | `integer` | min 0 — the daily task flags products at/below it |
| `description` | `long_text` | |

### `stock_moves`

Append-only ledger; `stock_on_hand` is its running sum.

| Field | Type | Notes |
|:--|:--|:--|
| `quantity` | `integer` | required; signed (+receive / −ship) |
| `reason` | `enum` | `purchase / sale / adjustment / return / write_off`; default `adjustment` |
| `moved_at` | `datetime` | indexed |
| `reference` | `short_text` | free-text pointer (PO number, invoice number) |
| `notes` | `long_text` | |

## Relationships

| Name | Type | Source → target | Notes |
|:--|:--|:--|:--|
| `product` | m2o | `stock_moves` → `products` | cascadeDelete |
| `product` | m2o | `line_items` → `products` | **extends a dependency's object** — optional FK so existing freeform line items keep working |

That second relationship is the point of the block: `line_items` (owned by
`invoicing`) gains a nullable `product_id`. Verified working — see
[resolved findings](#resolved-during-implementation).

## Actions (vendored)

- **`adjust_stock`** `{ product_id, quantity, reason?, reference?, notes? }` —
  writes a `stock_moves` row and updates `stock_on_hand` atomically. Rejects if
  `track_stock` is false. RBAC: `stock_moves:create`.
- **`add_invoice_line`** `{ invoice_id, product_id, quantity?, description? }`
  — creates an invoicing `line_items` row snapshotting the product's current
  `unit_price` (price changes must not rewrite history), links `product_id`,
  recomputes the invoice subtotal/total, and — if `track_stock` — records a
  `sale` stock move. RBAC: `line_items:create` (invoicing-owned resource; same
  cross-block-grant caveat as `support`).
  *Implementation deviation:* `line_items` (invoicing-owned) has no `tax_rate`
  column and blocks can only add relationships — not fields — to a
  dependency's objects, so the line's tax is computed once at add time and
  **incremented into the invoice's `tax`** rather than snapshotted per line.
  Lines removed via raw CRUD won't back their tax out; adjust `tax` by hand or
  add a `remove_invoice_line` action in v0.2.

## Hooks

None in v0.1.

## Subscriptions

None — stock integrity lives in `adjust_stock`, not the bus (bus handlers
can't write except via `persist_event`, and a ledger recomputation needs real
logic).

## Seed

5–6 products spanning `good` (tracked stock + reorder points), `service`
(hourly), and `subscription`. No stock_moves (they'd need FKs).

## Roles

- `catalog_manager` — CRUD on `products`, create/read on `stock_moves`
  (append-only: no update/delete keeps the ledger honest).
- `catalog_viewer` — read-only.

## Tasks

`catalog-low-stock-report` — `log` type, `0 7 * * *`, disabled by default;
upgrade to a real handler that lists `stock_on_hand <= reorder_point` once
task types allow.

## Resolved during implementation

- **Extending dependency objects: ✅ works.** Verified against a live install
  (real server, scratch Postgres, crm → invoicing → catalog): the installer's
  only relationship checks are endpoint existence, per-source name uniqueness,
  and FK column collisions — no ownership rule. `line_items.product_id`
  materializes on invoicing's table stamped `managedBy: block:catalog` (the FK
  field inherits the *relationship's* provenance, not the host object's), the
  FK constraint is enforced (bogus ids rejected, RESTRICT on product delete),
  `expand=product` hydrates across blocks, and uninstalling `invoicing` while
  `catalog` is installed is refused with a 409.
- **Platform finding (filed back to ion-drive): uninstall leaks the FK.**
  `BlockInstaller.uninstall` only drops the block's `createdObjects`; it never
  removes relationships the block added onto objects it didn't create. After
  `remove catalog`, `line_items.product_id` survives as an orphaned uuid
  column (the constraint dies with the `products` table, the relationship
  metadata cascade-deletes, the field metadata remains) — and **re-adding
  catalog then fails** with `Column "product_id" already exists on
  "line_items"`. Fix belongs in uninstall: remove relationships (and their FK
  fields) `managedBy block:<name>` whose source object is not in
  `createdObjects`.

## Open questions

- Price lists / per-customer pricing: explicitly out of scope for v0.1; a
  `price_lists` + entries pair layers on cleanly later.
- Multi-warehouse stock: out of scope; `stock_moves` gains a `location` enum
  or object if it's ever needed.
