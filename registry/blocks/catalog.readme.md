# Product Catalog

![catalog](https://registry.iondrive.dev/badges/catalog.svg)

Products with prices and lightweight stock tracking — pick a product and the
price flows onto the invoice. Built for an
[Ion Drive](https://github.com/jaredgrabill/ion-drive) backend.

```bash
ion-drive add catalog   # resolves invoicing (and its crm dependency) first
```

## What it installs

- **Objects:** `products` (SKU, price, stock level) and `stock_moves`
  (adjustment history).
- **Dependency:** `invoicing: ^0.1.0` (which itself depends on `crm`).
- **Actions** (`POST /api/v1/blocks/catalog/actions/<name>`):
  - `adjust_stock` — apply a stock adjustment to a product and record the
    move.
  - `add_invoice_line` — add a product to an invoice as a line item, pricing
    it from the catalog.
- No hooks or secrets.

## Notes

The action code is vendored into your project at `blocks/catalog/` — edit
freely; the dev server hot-reloads.
