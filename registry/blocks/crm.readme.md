# CRM

![crm](https://registry.iondrive.dev/badges/crm.svg)

Leads, companies, contacts, deals, and activities — lead capture, conversion,
and a stage-tracked sales pipeline for an [Ion Drive](https://github.com/jaredgrabill/ion-drive)
backend.

```bash
ion-drive add crm
```

## What it installs

- **Objects:** `leads`, `companies`, `contacts`, `deals`, `activities`,
  `tags`, `deal_history` — all exposed instantly over REST, GraphQL, and MCP.
- **Actions** (`POST /api/v1/blocks/crm/actions/<name>`):
  - `convert_lead` — turn a lead into a contact (+ company + optional deal).
  - `set_deal_stage` — move a deal through the pipeline (history recorded).
  - `log_activity` — attach a call/email/meeting/note to a record.
- **Inbound hook:** `POST /api/v1/hooks/crm/inbound_lead` — web-form lead
  capture; requires the shared token in its `x-crm-token` header.
- **Subscription:** `data.deals.updated` → stage changes append to
  `deal_history`.

## Secrets

| Secret | Purpose |
|:---|:---|
| `crm_inbound_token` | Shared token the `inbound_lead` hook requires in `x-crm-token`. |

## Notes

The action/hook code is vendored into your project at `blocks/crm/` — it is
yours to edit; the dev server hot-reloads. Other blocks build on this one
(e.g. `invoicing` depends on `crm: ^0.2.0`).
