# Block spec: `projects`

**Status:** draft — not implemented
**Depends on:** `crm`
**Categories:** `operations`, `project-management`
**Vendored logic:** yes (`code/` — actions)

## Why

The catalog covers winning the deal (`crm`) and billing it (`invoicing`) but
nothing in between: delivering the work. `projects` picks up where
`set_deal_stage → closed_won` leaves off — a project linked back to the company
and deal, broken into milestones and tasks. It also sets up the future
`timesheets` block (billable hours → invoicing line items).

## Objects

### `projects`

| Field | Type | Notes |
|:--|:--|:--|
| `name` | `short_text` | required |
| `status` | `enum` | `planned / active / on_hold / completed / cancelled`; default `planned`; indexed; choiceColors matching CRM conventions |
| `start_date` | `date` | |
| `due_date` | `date` | indexed |
| `completed_at` | `datetime` | set by `set_project_status` |
| `budget` | `currency` | |
| `progress` | `percentage` | 0–100; recomputed by `complete_task` (done tasks / total tasks) |
| `description` | `long_text` | |

### `milestones`

| Field | Type | Notes |
|:--|:--|:--|
| `name` | `short_text` | required |
| `due_date` | `date` | indexed |
| `completed` | `boolean` | default `false` |
| `completed_at` | `datetime` | |
| `sort_order` | `integer` | manual ordering |

### `project_tasks`

Named `project_tasks` (not `tasks`) to avoid reading ambiguously against the
manifest's scheduled-`tasks` key and any future platform task surface.

| Field | Type | Notes |
|:--|:--|:--|
| `title` | `short_text` | required |
| `status` | `enum` | `todo / in_progress / blocked / done`; default `todo`; indexed; choiceColors |
| `priority` | `enum` | `low / normal / high / urgent`; default `normal`; choiceColors |
| `due_date` | `date` | indexed |
| `estimate_hours` | `decimal` | min 0 |
| `completed_at` | `datetime` | set by `complete_task` |
| `assignee` | `short_text` | free text until the platform exposes a users object to relate to |
| `notes` | `long_text` | |

### `project_history`

Same pattern as `crm.deal_history`: `changed_at` (datetime, indexed), `diff`
(json), `snapshot` (json), `changed_by` (short_text), `event_id` (uuid, unique,
indexed).

## Relationships

| Name | Type | Source → target | Notes |
|:--|:--|:--|:--|
| `company` | m2o | `projects` → `companies` | from `crm` |
| `deal` | m2o | `projects` → `deals` | the won deal that spawned it |
| `project` | m2o | `milestones` → `projects` | cascadeDelete |
| `project` | m2o | `project_tasks` → `projects` | cascadeDelete |
| `milestone` | m2o | `project_tasks` → `milestones` | optional |
| `project` | m2o | `project_history` → `projects` | cascadeDelete |
| `tags` | m2m | `projects` → `tags` | reuses the CRM tags object |

## Actions (vendored)

- **`create_project_from_deal`** `{ deal_id, name?, start_date?, due_date? }`
  — loads the deal (must exist; warn-not-fail if not `closed_won`), creates a
  project copying `company_id` and setting `budget` from the deal `amount`,
  and logs a CRM `note` activity against the deal. RBAC: `projects:create`.
- **`complete_task`** `{ task_id }` — stamps `completed_at`, sets status
  `done`, recomputes the parent project's `progress`, and marks the parent
  milestone completed when all its tasks are done. RBAC: `project_tasks:update`.
- **`set_project_status`** `{ project_id, status }` — mirrors
  `crm.set_deal_stage`: stamps `completed_at` on `completed`/`cancelled`,
  clears it if reopened. RBAC: `projects:update`.

## Subscriptions

`data.projects.updated` → consumer `projects_history` → `persist_event` into
`project_history` (same map shape as `crm_deal_history`).

## Seed

2 projects (one `active` with progress, one `planned`), 3 milestones, 6 tasks
across statuses. FK-free (platform strips ids on seed) — linking is a
demo-time exercise, same as the CRM seed.

## Roles

- `projects_manager` — CRUD on all four objects; `project_history` read-only.
- `projects_viewer` — read-only everywhere.

## Tasks

`projects-overdue-digest` — `log` type, `0 8 * * 1-5`, disabled by default
(placeholder until richer task handlers exist).

## Open questions

- Should `progress` be computed on read instead of stored? Stored keeps list
  views cheap and matches the platform's action-writes-derived-fields idiom
  (`last_activity_at` in CRM).
- Assignees: revisit once the platform exposes user records to the data layer.
