/**
 * Invoicing block — vendored logic entry point. This file is YOURS.
 *
 * `ion-drive add invoicing` copied it to blocks/invoicing/ and wired it into
 * blocks/index.ts; your server.ts passes it to `createServer`, which runs
 * `setup` at boot. Everything registered here is declared in the block's
 * manifest, so the platform exposes it automatically:
 *
 *  - action `create_payment_link` → POST /api/v1/blocks/invoicing/actions/create_payment_link
 *    (also an MCP tool: `invoicing_create_payment_link`, and in the OpenAPI spec)
 *  - hook `stripe`               → POST /api/v1/hooks/invoicing/stripe
 *    (session-auth exempt; authenticity = the Stripe signature we verify)
 *
 * Setup (one-time):
 *  1. Store your Stripe keys as Ion Drive secrets (admin console → Secrets, or
 *     POST /api/v1/secrets): `stripe_secret_key`, `stripe_webhook_secret`.
 *  2. Point a Stripe webhook (event: checkout.session.completed) at
 *     https://<your host>/api/v1/hooks/invoicing/stripe
 */
import { definePlugin } from '@ionshift/ion-drive-core';
import { z } from 'zod';
import { createCheckoutSession, verifyStripeSignature } from './stripe.js';

export default definePlugin({
  name: 'invoicing',

  setup(ctx) {
    // ------------------------------------------------------------------
    // Action: create a Stripe payment link for an invoice
    // ------------------------------------------------------------------
    ctx.actions.registerAction({
      block: 'invoicing',
      name: 'create_payment_link',
      description: 'Create a Stripe Checkout payment link for an invoice.',
      // The Zod schema validates requests (400 with issues on failure) and
      // shapes the MCP tool's parameters.
      input: z.object({ invoice_id: z.string().uuid() }),
      handler: async (actionCtx) => {
        const { invoice_id } = actionCtx.input as { invoice_id: string };

        const secretKey = await actionCtx.secrets.get('stripe_secret_key');
        if (!secretKey) {
          throw new Error('Secret "stripe_secret_key" is not set — add it before creating links.');
        }

        const invoice = await actionCtx.dataService.getById('invoices', invoice_id);
        if (!invoice) throw new Error(`Invoice ${invoice_id} not found`);
        const record = invoice.data as { number: string; total: string | number | null };
        const totalCents = Math.round(Number(record.total ?? 0) * 100);
        if (!Number.isFinite(totalCents) || totalCents <= 0) {
          throw new Error(`Invoice ${record.number} has no positive total to collect.`);
        }

        // Where Stripe sends the customer after paying. Adjust to your app.
        const successUrl = `${actionCtx.config.publicUrl ?? `http://localhost:${actionCtx.config.port}`}/payments/success`;

        const session = await createCheckoutSession(
          secretKey,
          { id: invoice_id, number: record.number, totalCents },
          successUrl,
        );

        // Persist the link + session id so the webhook can match the invoice
        // and your app/grid can show the URL.
        await actionCtx.dataService.update('invoices', invoice_id, {
          payment_link: session.url,
          stripe_session_id: session.id,
          status: 'sent',
        });

        actionCtx.logger.info('Payment link created', { invoice: record.number });
        return { url: session.url, session_id: session.id };
      },
    });

    // ------------------------------------------------------------------
    // Hook: Stripe webhook receiver (raw body → verify → mark paid)
    // ------------------------------------------------------------------
    ctx.actions.registerHook({
      block: 'invoicing',
      name: 'stripe',
      description: 'Verifies Stripe signatures and marks invoices paid.',
      handler: async (hookCtx) => {
        const webhookSecret = await hookCtx.secrets.get('stripe_webhook_secret');
        if (!webhookSecret) {
          return { status: 500, body: { error: 'stripe_webhook_secret is not configured' } };
        }

        // Verify BEFORE parsing — the signature covers the exact raw bytes.
        const signature = hookCtx.headers['stripe-signature'];
        const ok = verifyStripeSignature(
          hookCtx.rawBody,
          Array.isArray(signature) ? signature[0] : signature,
          webhookSecret,
        );
        if (!ok) {
          hookCtx.logger.warn('Rejected Stripe delivery: bad signature');
          return { status: 400, body: { error: 'invalid signature' } };
        }

        const event = JSON.parse(hookCtx.rawBody.toString('utf8')) as {
          type: string;
          data: { object: { id: string; metadata?: { invoice_id?: string } } };
        };

        if (event.type === 'checkout.session.completed') {
          const invoiceId = event.data.object.metadata?.invoice_id;
          if (invoiceId) {
            await hookCtx.dataService.update('invoices', invoiceId, { status: 'paid' });
            hookCtx.logger.info('Invoice marked paid via Stripe webhook', { invoiceId });
          }
        }

        // Always 200 verified deliveries — Stripe retries anything else.
        return { status: 200, body: { received: true } };
      },
    });
  },
});
