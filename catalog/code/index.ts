/**
 * Catalog block — vendored logic entry point. This file is YOURS.
 *
 * `ion-drive add catalog` copied it to blocks/catalog/ and wired it into
 * blocks/index.ts; your server.ts passes it to `createServer`, which runs
 * `setup` at boot. Everything registered here is declared in the block's
 * manifest, so the platform exposes it automatically:
 *
 *  - action `adjust_stock`     → POST /api/v1/blocks/catalog/actions/adjust_stock
 *  - action `add_invoice_line` → POST /api/v1/blocks/catalog/actions/add_invoice_line
 *    (each is also an MCP tool — `catalog_adjust_stock` etc. — and in the OpenAPI spec)
 *
 * The block extends the invoicing block it depends on: installing it adds a
 * nullable `product_id` FK to invoicing's `line_items`, so existing freeform
 * lines keep working and product-backed lines link back to the catalog.
 *
 * Stock integrity lives entirely in `adjust_stock` / `add_invoice_line`:
 * `stock_moves` is an append-only ledger and `products.stock_on_hand` is its
 * running sum. Writing either directly through the data API skips the other —
 * if they ever drift, the ledger is the source of truth (recount its sum).
 */
import { definePlugin } from '@ion-drive/core';
import { z } from 'zod';
import { STOCK_REASONS, compact, lineAmount, lineTax, round2 } from './catalog.js';

/** The product columns both actions read. */
type ProductRecord = {
  sku: string;
  name: string;
  unit_price: string | number;
  tax_rate: string | number | null;
  active: boolean;
  track_stock: boolean;
  stock_on_hand: number | null;
};

export default definePlugin({
  name: 'catalog',

  setup(ctx) {
    // ------------------------------------------------------------------
    // Action: record a signed stock movement (the only sanctioned way to
    // change stock_on_hand)
    // ------------------------------------------------------------------
    ctx.actions.registerAction({
      block: 'catalog',
      name: 'adjust_stock',
      description:
        'Record a signed stock movement for a tracked product and update its stock on hand.',
      // The Zod schema validates requests (400 with issues on failure) and
      // shapes the MCP tool's parameters.
      input: z.object({
        product_id: z.string().uuid(),
        quantity: z
          .number()
          .int()
          .refine((q) => q !== 0, { message: 'quantity must not be zero' }),
        reason: z.enum(STOCK_REASONS).optional().default('adjustment'),
        reference: z.string().max(255).optional(),
        notes: z.string().max(20_000).optional(),
      }),
      handler: async (actionCtx) => {
        const input = actionCtx.input as {
          product_id: string;
          quantity: number;
          reason: (typeof STOCK_REASONS)[number];
          reference?: string;
          notes?: string;
        };
        const { dataService } = actionCtx;

        const found = await dataService.getById('products', input.product_id);
        if (!found) throw new Error(`Product ${input.product_id} not found`);
        const product = found.data as unknown as ProductRecord;
        if (!product.track_stock) {
          throw new Error(`Product ${product.sku} does not track stock — enable track_stock first.`);
        }

        const move = await dataService.create(
          'stock_moves',
          compact({
            quantity: input.quantity,
            reason: input.reason,
            moved_at: new Date().toISOString(),
            reference: input.reference,
            notes: input.notes,
            product_id: input.product_id,
          }),
        );

        // Read-modify-write: concurrent adjustments can race. The ledger row
        // above is durable either way — recounting the product's stock_moves
        // sum repairs stock_on_hand if it ever drifts.
        const stockOnHand = (product.stock_on_hand ?? 0) + input.quantity;
        await dataService.update('products', input.product_id, { stock_on_hand: stockOnHand });

        actionCtx.logger.info('Stock adjusted', {
          sku: product.sku,
          quantity: input.quantity,
          reason: input.reason,
          stockOnHand,
        });
        return { move_id: String(move.data.id), stock_on_hand: stockOnHand };
      },
    });

    // ------------------------------------------------------------------
    // Action: add a product to an invoice (price snapshot + totals + stock)
    // ------------------------------------------------------------------
    ctx.actions.registerAction({
      block: 'catalog',
      name: 'add_invoice_line',
      description:
        'Add a product to an invoice: snapshots the current price, recomputes the invoice totals, and records a sale stock move for tracked products.',
      input: z.object({
        invoice_id: z.string().uuid(),
        product_id: z.string().uuid(),
        quantity: z.number().positive().optional().default(1),
        description: z.string().max(255).optional(),
      }),
      handler: async (actionCtx) => {
        const input = actionCtx.input as {
          invoice_id: string;
          product_id: string;
          quantity: number;
          description?: string;
        };
        const { dataService } = actionCtx;

        const foundInvoice = await dataService.getById('invoices', input.invoice_id);
        if (!foundInvoice) throw new Error(`Invoice ${input.invoice_id} not found`);
        const invoice = foundInvoice.data as {
          number: string;
          status: string;
          tax: string | number | null;
        };
        if (invoice.status === 'paid' || invoice.status === 'void') {
          throw new Error(`Invoice ${invoice.number} is ${invoice.status} — cannot add lines.`);
        }

        const foundProduct = await dataService.getById('products', input.product_id);
        if (!foundProduct) throw new Error(`Product ${input.product_id} not found`);
        const product = foundProduct.data as unknown as ProductRecord;
        if (!product.active) {
          throw new Error(`Product ${product.sku} is inactive — reactivate it to bill it.`);
        }
        if (product.track_stock && !Number.isInteger(input.quantity)) {
          throw new Error(`Product ${product.sku} tracks stock — quantity must be a whole number.`);
        }

        // Snapshot the price onto the line: later price changes must not
        // rewrite invoice history.
        const unitPrice = round2(Number(product.unit_price));
        const amount = lineAmount(input.quantity, unitPrice);
        const line = await dataService.create(
          'line_items',
          compact({
            description: input.description ?? product.name,
            quantity: input.quantity,
            unit_price: unitPrice,
            amount,
            invoice_id: input.invoice_id,
            // The FK this block's relationship added onto invoicing's object.
            product_id: input.product_id,
          }),
        );

        // Subtotal is recomputed from all lines; tax is *incremented* by this
        // line's share — line_items is invoicing's object, so it has no
        // tax_rate column to recompute from (blocks can add relationships to a
        // dependency's objects, not fields). Lines removed via raw CRUD won't
        // back their tax out — adjust the invoice's tax by hand in that case.
        let subtotal = 0;
        for (let page = 1; ; page++) {
          const batch = await dataService.list('line_items', {
            filters: [{ field: 'invoice_id', operator: 'eq', value: input.invoice_id }],
            pagination: { page, pageSize: 200 },
          });
          for (const row of batch.data) {
            subtotal += Number((row as { amount: string | number | null }).amount ?? 0);
          }
          if (batch.data.length < 200) break;
        }
        subtotal = round2(subtotal);
        const tax = round2(Number(invoice.tax ?? 0) + lineTax(amount, Number(product.tax_rate ?? 0)));
        const total = round2(subtotal + tax);
        await dataService.update('invoices', input.invoice_id, { subtotal, tax, total });

        // Tracked goods leave stock when billed: mirror the sale in the ledger.
        let stockOnHand: number | undefined;
        if (product.track_stock) {
          await dataService.create('stock_moves', {
            quantity: -input.quantity,
            reason: 'sale',
            moved_at: new Date().toISOString(),
            reference: invoice.number,
            product_id: input.product_id,
          });
          stockOnHand = (product.stock_on_hand ?? 0) - input.quantity;
          await dataService.update('products', input.product_id, { stock_on_hand: stockOnHand });
        }

        actionCtx.logger.info('Invoice line added', {
          invoice: invoice.number,
          sku: product.sku,
          quantity: input.quantity,
          amount,
        });
        return {
          line_item_id: String(line.data.id),
          amount,
          invoice: { subtotal, tax, total },
          ...(stockOnHand !== undefined ? { stock_on_hand: stockOnHand } : {}),
        };
      },
    });
  },
});
