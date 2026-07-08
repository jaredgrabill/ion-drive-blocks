# Block spec: `support`

**Status:** draft — not implemented
**Depends on:** `crm`
**Categories:** `support`, `service`
**Vendored logic:** yes (`code/` — actions + inbound hook)

## Why

Post-sale, customers need a place to report problems. A helpdesk is the
highest-leverage next block: it exercises every platform seam (hook with token
auth, threading logic in actions, history via `persist_event`, SLA-ish
timestamps) and links straight into CRM contacts/companies so a ticket shows up
in the same universe as the deal that created the customer.

## Objects

### `tickets`

| Field | Type | Notes |
|:--|:--|:--|
| `subject` | `short_text` | required |
| `status` | `enum` | `open / pending / on_hold / solved / closed`; default `open`; indexed; choiceColors (open blue, pending amber, on_hold gray, solved green, closed dark gray) |
| `priority` | `enum` | `low / normal / high / urgent`; default `normal`; indexed; choiceColors |
| `channel` | `enum` | `email / web / phone / chat / other`; default `web` |
| `first_response_at` | `datetime` | stamped by the first outbound `reply_ticket` |
| `resolved_at` | `datetime` | stamped by `set_ticket_status` on `solved` |
| `closed_at` | `datetime` | stamped on `closed` |
| `satisfaction` | `rating` | post-resolution CSAT |
| `description` | `long_text` | the original request |

### `ticket_messages`

| Field | Type | Notes |
|:--|:--|:--|
| `body` | `long_text` | required |
| `direction` | `enum` | `inbound / outbound` |
| `author` | `short_text` | display name/email of the sender |
| `is_internal` | `boolean` | default `false` — private agent note, never customer-visible |
| `sent_at` | `datetime` | indexed |

### `canned_responses`

| Field | Type | Notes |
|:--|:--|:--|
| `name` | `short_text` | required, unique |
| `body` | `long_text` | required |
| `category` | `short_text` | |

### `ticket_history`

Same `persist_event` shape as `crm.deal_history`: `changed_at`, `diff`,
`snapshot`, `changed_by`, `event_id` (unique).

## Relationships

| Name | Type | Source → target | Notes |
|:--|:--|:--|:--|
| `contact` | m2o | `tickets` → `contacts` | requester (from `crm`) |
| `company` | m2o | `tickets` → `companies` | |
| `ticket` | m2o | `ticket_messages` → `tickets` | cascadeDelete |
| `ticket` | m2o | `ticket_history` → `tickets` | cascadeDelete |
| `tags` | m2m | `tickets` → `tags` | reuses CRM tags |

## Actions (vendored)

- **`reply_ticket`** `{ ticket_id, body, is_internal?, author? }` — creates a
  `ticket_messages` row (`direction: outbound`, `sent_at: now`); on the first
  non-internal reply stamps `first_response_at`; moves `open → pending` unless
  internal. Does **not** send email itself — that's `communications`' job (see
  open questions). RBAC: `ticket_messages:create`.
- **`set_ticket_status`** `{ ticket_id, status, satisfaction? }` — stage
  machine mirroring `crm.set_deal_stage`: stamps `resolved_at`/`closed_at`,
  clears them on reopen, records `satisfaction` when provided with `solved`.
  RBAC: `tickets:update`.

## Hooks

- **`inbound_ticket`** — POST with shared `x-support-token` header (secret
  `support_inbound_token`, declared in `meta.secrets`, mirroring
  `crm.inbound_lead`). Payload: `{ email, subject, body, channel? }`.
  Threading: match an existing non-closed ticket by requester contact +
  normalized subject → append an inbound `ticket_messages` row and flip status
  `pending → open`; otherwise create ticket + first message. Looks up the
  contact by email; creates a bare CRM contact if none exists.

## Subscriptions

`data.tickets.updated` → consumer `support_ticket_history` → `persist_event`
into `ticket_history`.

## Seed

3 canned responses; 2 tickets (one `open` urgent, one `solved` with
`satisfaction`), 3 messages. FK-free.

## Roles

- `support_agent` — CRUD on tickets/messages/canned_responses; `ticket_history`
  read-only; read on `contacts`/`companies` (cross-block grant — verify the
  installer allows granting on objects owned by a dependency).
- `support_viewer` — read-only.

## Tasks

`support-stale-ticket-digest` — `log` type, `0 9 * * *`, disabled by default.

## Open questions

- **Email out:** `reply_ticket` should eventually enqueue through
  `communications` (notifications object) rather than sending directly — spec
  the integration once communications grows a send pipeline. Until then replies
  are record-keeping only.
- **Cross-block role grants:** confirm a block's `roles` may reference
  dependency-owned resources (`contacts`); if not, drop those grants and lean
  on `crm_viewer`.
- SLA targets per priority (e.g. `first_response_due_at`) — worth a v0.2 once
  scheduled tasks can do more than log.
