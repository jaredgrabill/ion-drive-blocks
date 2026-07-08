# Block spec: `scheduling`

**Status:** draft — not implemented
**Depends on:** `crm`
**Categories:** `scheduling`, `operations`
**Vendored logic:** yes (`code/` — actions + public booking hook)

## Why

Appointments are the front door for service businesses — demos, consultations,
site visits. The block gives them a Calendly-shaped core: appointment types
with durations and buffers, availability windows, conflict-checked booking, and
a token-guarded public hook so a website form can book directly. Completed
appointments write back into CRM (`activities` + `last_activity_at`), keeping
the customer timeline in one place.

## Objects

### `appointment_types`

| Field | Type | Notes |
|:--|:--|:--|
| `name` | `short_text` | required, unique |
| `slug` | `slug` | required, unique — what the public booking hook keys on |
| `duration_minutes` | `integer` | required, min 5 |
| `buffer_minutes` | `integer` | default 0 — padding enforced after each appointment |
| `location_kind` | `enum` | `virtual / in_person / phone`; default `virtual` |
| `active` | `boolean` | default `true` — inactive types reject bookings |
| `description` | `long_text` | |

### `availability_windows`

Weekly recurring bookable hours, per appointment type (global if unlinked).

| Field | Type | Notes |
|:--|:--|:--|
| `weekday` | `enum` | `monday … sunday` |
| `start_time` | `time` | required |
| `end_time` | `time` | required; must be after `start_time` (validated in the booking code — the schema can't express cross-field constraints) |

### `appointments`

| Field | Type | Notes |
|:--|:--|:--|
| `title` | `short_text` | required |
| `starts_at` | `datetime` | required, indexed |
| `ends_at` | `datetime` | required — computed from the type's duration on booking |
| `status` | `enum` | `scheduled / confirmed / completed / cancelled / no_show`; default `scheduled`; indexed; choiceColors |
| `location` | `short_text` | address or meeting URL |
| `cancellation_reason` | `short_text` | |
| `booked_via` | `enum` | `staff / public_hook`; default `staff` |
| `notes` | `long_text` | |

## Relationships

| Name | Type | Source → target | Notes |
|:--|:--|:--|:--|
| `appointment_type` | m2o | `appointments` → `appointment_types` | |
| `appointment_type` | m2o | `availability_windows` → `appointment_types` | optional (null = applies to all types); cascadeDelete |
| `contact` | m2o | `appointments` → `contacts` | from `crm` |
| `company` | m2o | `appointments` → `companies` | |

## Actions (vendored)

All booking paths funnel through one vendored `checkSlot()` helper: inside the
type's availability windows, no overlap with existing non-cancelled
appointments (`ends_at + buffer`).

- **`book_appointment`** `{ appointment_type_id, contact_id, starts_at, title?, location?, notes? }`
  — conflict-checks, computes `ends_at`, creates the appointment. RBAC:
  `appointments:create`.
- **`cancel_appointment`** `{ appointment_id, reason? }` — sets `cancelled` +
  reason; refuses on already-completed appointments. RBAC:
  `appointments:update`.
- **`complete_appointment`** `{ appointment_id, outcome_notes?, no_show? }` —
  sets `completed` (or `no_show`) and logs a CRM `meeting` activity linked to
  the contact/company with `duration_minutes` from the actual span — which also
  stamps CRM's `last_activity_at`. RBAC: `appointments:update`.

## Hooks

- **`book`** — the public endpoint
  (`POST /api/v1/hooks/scheduling/book`), guarded by an `x-scheduling-token`
  header (secret `scheduling_public_token` in `meta.secrets` — a
  site-embed token, not per-user auth). Payload:
  `{ type_slug, starts_at, email, first_name?, last_name?, notes? }`.
  Resolves the type by slug (active only), finds-or-creates the CRM contact by
  email (mirroring `inbound_lead` dedupe), runs the same `checkSlot()`;
  returns `409`-style body with the conflict reason on failure, the
  appointment id on success (`booked_via: public_hook`).

## Subscriptions

None in v0.1. (An `appointment_history` table via `persist_event` is easy to
add if change-tracking demand shows up; `audit` already covers the generic
case.)

## Seed

3 appointment types (30-min demo, 60-min consultation, 15-min phone check-in),
Mon–Fri 9:00–17:00 availability windows (global, unlinked). No appointments
(they'd need contact FKs).

## Roles

- `scheduling_agent` — CRUD on all three objects; read on `contacts`.
- `scheduling_viewer` — read-only.

## Tasks

`scheduling-daily-agenda` — `log` type, `0 7 * * *`, disabled by default.

## Open questions

- **Timezones:** v0.1 stores UTC and treats availability windows as
  server-local — acceptable for single-location businesses, wrong for anything
  else. A `timezone` field on `appointment_types` is the v0.2 fix; flagging now
  because it shapes the `checkSlot()` implementation.
- Reminders/confirmations belong to `communications` once it can send; the
  hook should not email.
- Slot *listing* (an availability query for pickers) wants a read-only action
  (`list_open_slots`) — confirm actions are an acceptable read surface or
  whether this should wait for a platform "computed endpoint" story.
