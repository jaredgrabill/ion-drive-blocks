# Block spec: `catalog`

**Status:** draft — not implemented
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
`invoicing`) gains a nullable `product_id`. Blocks installing relationships
onto dependency-owned objects should work since relationships are declared by
source/target name — verify during implementation (see open questions).

## Actions (vendored)

- **`adjust_stock`** `{ product_id, quantity, reason?, reference?, notes? }` —
  writes a `stock_moves` row and updates `stock_on_hand` atomically. Rejects if
  `track_stock` is false. RBAC: `stock_moves:create`.
- **`add_invoice_line`** `{ invoice_id, product_id, quantity?, description? }`
  — creates an invoicing `line_items` row snapshotting the product's current
  `unit_price`/`tax_rate` (price changes must not rewrite history), links
  `product_id`, recomputes the invoice total if invoicing stores one, and — if
  `track_stock` — records a `sale` stock move. RBAC: `line_items:create`
  (invoicing-owned resource; same cross-block-grant caveat as `support`).

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

## Open questions

- **Extending dependency objects:** confirm the installer accepts a
  relationship whose `sourceObjectName` belongs to another block
  (`line_items`). If not, this block needs a platform feature first — that
  finding alone makes the block worth prototyping early.
- Price lists / per-customer pricing: explicitly out of scope for v0.1; a
  `price_lists` + entries pair layers on cleanly later.
- Multi-warehouse stock: out of scope; `stock_moves` gains a `location` enum
  or object if it's ever needed.
