# Audit Log

![audit](https://registry.iondrive.dev/badges/audit.svg)

Records every record create/update/delete into an `audit_log` table, with a
system-field-free diff — cluster-once, via the
[Ion Drive](https://github.com/jaredgrabill/ion-drive) message bus.

```bash
ion-drive add audit
```

## What it installs

- **Object:** `audit_log` — one row per change (object, record id, operation,
  actor, before/after diff).
- **Subscription:** `data.#` → the built-in `persist_event` handler, delivered
  once per cluster (consumer-group semantics), so every CRUD event on every
  object lands in the log automatically.
- No vendored code, actions, hooks, or secrets.

## Notes

Rows are written through a non-emitting insert (`insertSilent`), so auditing
never recursively audits itself. Query the log like any other object:
`GET /api/v1/data/audit_log?object_name=deals&sort=-created_at`.
