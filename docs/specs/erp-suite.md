# The ERP suite: block family & coupling map

**Status:** direction doc — individual blocks get their own spec files as they
are promoted (see [`catalog.md`](catalog.md), the confirmed starting point).

The goal is an ERP that emerges from **loosely interdependent blocks** rather
than a monolith: each block is independently useful, and richer behavior lights
up when neighbors are installed. "Infinitely configurable ERP" is literally the
platform's pitch — this is the catalog strategy for delivering it.

## Coupling mechanisms (weakest first)

The platform gives us four ways for blocks to interoperate. Every ERP spec
should say which it uses and why — default to the weakest that works:

1. **Bus subscriptions (no dependency at all).** A block can subscribe to
   `data.<object>.*` topics for objects it doesn't own; if the emitting block
   isn't installed, the subscription simply never fires. Great for
   history/rollup tables via `persist_event`. This is *zero*-coupling —
   no registry dependency needed.
2. **Optional relationships to a dependency's objects.** A nullable m2o FK
   (e.g. `line_items.product_id`) — the base block keeps working standalone.
   Requires a registry dependency so install order is right.
3. **Actions that read/write a dependency's objects.** Runtime coupling in
   vendored code (e.g. `add_invoice_line` writing invoicing's `line_items`).
   Also needs the registry dependency; keep such actions thin and clearly
   commented since the consumer owns the code.
4. **Hard data dependency.** The block is meaningless without the parent
   (invoicing → crm today). Use sparingly.

Diamond-shaped graphs are fine — the installer resolves dependencies
topologically and prunes what's installed.

## The family

```
                 crm ──────────────┐
                  │                │
   scheduling ────┤            invoicing ◀─── catalog (products + stock)
                  │                │               ▲
    support ──────┤             payments*         │
                  │                            purchasing ──▶ vendors
    projects ─────┤                                │
        │         │                            receiving (stock moves in)
    timesheets ───┴──▶ invoicing            orders/fulfillment (stock moves out)
```

*already inside `invoicing` today

### Confirmed / specced

| Block | Role in the suite | Coupling |
|:--|:--|:--|
| `catalog` ✅ priority | Products, pricing, `stock_moves` ledger, `stock_on_hand` | (2)+(3) onto invoicing |
| `projects` | Delivery after closed-won | (2)+(3) onto crm |
| `support` | Helpdesk | (2)+(3) onto crm |
| `scheduling` | Bookings | (2)+(3) onto crm |

### ERP candidates (sketches)

- **`purchasing`** — `vendors`, `purchase_orders`, `po_lines`. Actions:
  `submit_po`, `receive_po` (writes catalog `stock_moves` with
  `reason: purchase` and stamps received quantities — mechanism 3 onto
  catalog). Status machine `draft / submitted / partially_received / received /
  cancelled`. Depends on `catalog`. Vendors is deliberately part of purchasing,
  not crm — suppliers and customers are different lifecycles.
- **`orders`** — `sales_orders`, `order_lines`, fulfillment status. Sits
  between crm deals and invoicing: `create_order_from_deal`, `fulfill_order`
  (catalog stock moves out, `reason: sale`), `invoice_order` (generates an
  invoicing invoice + lines). Depends on `crm`, `catalog`; invoicing optional —
  detect at runtime and degrade (mechanism 1/3 hybrid: the action errors
  helpfully if invoicing isn't installed).
- **`accounting-lite`** — a journal (`journal_entries`, `journal_lines`) fed
  **entirely by bus subscriptions** (mechanism 1): `data.payments.created`,
  `data.invoices.updated`, `data.stock_moves.created` → `persist_event` rows
  into a staging object, with a `post_journal` action doing double-entry
  mapping. Zero registry dependencies — installs into any project and
  captures whatever event streams exist. The best showcase of loose coupling.
- **`expenses`** — expense claims + approval states; rebill via invoicing
  (optional). Blocked on file/attachment columns for receipts.
- **`timesheets`** — time entries → projects (2) → invoice lines (3).
- **`hr-lite`** — employees, time-off, approvals. Standalone (mechanism 0);
  other blocks' free-text `assignee`/`author` fields graduate to real FKs once
  it exists.
- **`manufacturing-lite`** — BOMs + work orders consuming/producing catalog
  stock moves. Furthest out; only worth it after purchasing/orders prove the
  stock-ledger patterns.

## Suggested sequencing

1. **`catalog`** — smallest, unlocks everything stock-shaped, and forces the
   "can a block extend a dependency's object?" platform question early.
2. **`purchasing`** — first two-block stock flow (PO → receive → on-hand).
3. **`orders`** — completes quote-to-cash: deal → order → fulfillment →
   invoice.
4. **`accounting-lite`** — pure-bus consumer; also a great stress test of
   `persist_event` + idempotency on `event.id`.

## Platform asks this surfaces

- Cross-block relationship declarations (catalog → invoicing `line_items`) —
  verify or build.
- Cross-block RBAC grants in a block's `roles`.
- Runtime "is block X installed?" check for vendored code (the `_ion_blocks`
  ledger is readable — confirm a sanctioned API).
- Attachment/file column type (expenses, receiving docs).
