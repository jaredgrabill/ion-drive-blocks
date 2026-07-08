# Block specs

Design docs for blocks that don't exist yet. One file per block, written against the
same manifest surface the shipped blocks use (objects, relationships, actions, hooks,
subscriptions, seed, roles, tasks). Platform background lives in
[`../platform.md`](../platform.md).

## Specced

| Spec | One-liner | Depends on |
|:--|:--|:--|
| [`catalog`](catalog.md) ✅ **confirmed priority** | Products, pricing, and stock — feeds invoicing line items | `invoicing` |
| [`projects`](projects.md) | Projects, tasks, milestones — delivery after the deal closes | `crm` |
| [`support`](support.md) | Helpdesk tickets with threaded messages and an inbound hook | `crm` |
| [`scheduling`](scheduling.md) | Appointment types, bookings, and a public booking hook | `crm` |

Recommended build order: **catalog** (smallest, immediately useful to invoicing,
and the on-ramp to the ERP suite), then **projects**, **support**, **scheduling**.

## The ERP direction

[`erp-suite.md`](erp-suite.md) maps the ERP-flavored block family (purchasing,
orders, accounting-lite, expenses, timesheets, hr-lite, manufacturing-lite) and
the loose-coupling mechanisms each should use — bus subscriptions, optional
cross-block relationships, runtime action integration, or hard dependencies.

## Shortlist (not yet specced, non-ERP)

- **forms** — generalizes the CRM `inbound_lead` hook: form definitions (json schema)
  + submissions object + a token-guarded intake hook per form.
- **knowledge-base** — articles, categories, published/draft workflow; could back
  canned responses in `support`.
- **approvals** — generic request/approve/reject workflow other blocks attach to;
  needs a story for cross-block polymorphic references first.

## Platform constraints every spec honors

- Event-driven writes go through the built-in `persist_event` handler only — bus
  handlers have no data access. Custom logic lives in actions and hooks.
- Relationship FKs materialize as `<relationshipName>_id`; m2m junction tables default
  to `<sourceTable>_<targetTable>`; non-cascade FKs are ON DELETE RESTRICT.
- Seed rows can't wire cross-record FKs (`id` is stripped on bulkCreate), so seed data
  stays FK-free or relies on actions/demos to link records.
- Scheduled tasks are `log`-type placeholders (disabled by default) until the platform
  grows richer task handlers.
