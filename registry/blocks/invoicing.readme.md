# Invoicing

![invoicing](https://registry.iondrive.dev/badges/invoicing.svg)

Invoices, line items, and payments — billing on top of your CRM, with Stripe
payment links, for an [Ion Drive](https://github.com/jaredgrabill/ion-drive)
backend.

```bash
ion-drive add invoicing   # resolves and installs crm first (dependency)
```

## What it installs

- **Objects:** `invoices`, `line_items`, `payments`.
- **Dependency:** `crm: ^0.2.0` (invoices link to CRM companies/contacts).
- **Action** (`POST /api/v1/blocks/invoicing/actions/create_payment_link`):
  creates a Stripe Checkout session for an invoice, stores `payment_link` +
  `stripe_session_id`, and marks the invoice `sent`.
- **Inbound hook:** `POST /api/v1/hooks/invoicing/stripe` — the Stripe
  webhook; verifies the `stripe-signature` HMAC over the exact raw bytes
  (replay-protected) and marks invoices `paid` on
  `checkout.session.completed`.

## Secrets

| Secret | Purpose |
|:---|:---|
| `stripe_secret_key` | Stripe API secret key (`sk_test_…` / `sk_live_…`) — required by `create_payment_link`. |
| `stripe_webhook_secret` | Stripe webhook signing secret (`whsec_…`) — required by the `stripe` hook. |

## Notes

The Stripe client (`blocks/invoicing/stripe.ts`) is a zero-dependency fetch
wrapper vendored into your project — edit freely; `STRIPE_API_BASE` overrides
the endpoint for tests.
