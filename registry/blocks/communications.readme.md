# Communications

![communications](https://registry.iondrive.dev/badges/communications.svg)

Email templates and a notification log for outbound messaging on an
[Ion Drive](https://github.com/jaredgrabill/ion-drive) backend.

```bash
ion-drive add communications
```

## What it installs

- **Objects:** `email_templates` (subject/body templates with placeholders)
  and `notifications` (an outbound-message log with status tracking).
- No vendored code, actions, hooks, or secrets — a pure schema block. Pair it
  with an `EmailProvider` plugin (e.g. `@ion-drive/plugin-sendgrid`) and your
  own task/action logic to actually send.

## Notes

Everything is exposed instantly over REST, GraphQL, and MCP; the objects are
`block:communications`-managed (extend with new fields rather than modifying
the block's own).
