/**
 * Thin Stripe client for the invoicing block — this file is YOURS.
 *
 * It was vendored into your project by `ion-drive add invoicing` (shadcn-style:
 * you own the copy). Edit it freely — the dev server hot-reloads. It talks to
 * Stripe's REST API with the built-in `fetch`, so there is no SDK dependency.
 *
 * Two capabilities:
 *  1. {@link createCheckoutSession} — a Stripe Checkout session whose URL acts
 *     as a payment link for an invoice.
 *  2. {@link verifyStripeSignature} — HMAC verification of Stripe webhook
 *     deliveries (the `Stripe-Signature` header signs the *raw* body bytes).
 *
 * Configuration comes from Ion Drive secrets (never hardcode keys):
 *  - `stripe_secret_key`     — sk_test_… / sk_live_…
 *  - `stripe_webhook_secret` — whsec_… (from your webhook endpoint's settings)
 *
 * `STRIPE_API_BASE` (env) overrides the API host — useful for tests/mocks.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const API_BASE = process.env.STRIPE_API_BASE ?? 'https://api.stripe.com';

export interface CheckoutSession {
  id: string;
  url: string;
}

/**
 * Creates a Stripe Checkout session for a single invoice. Amounts are sent in
 * cents; the invoice id rides in `metadata` so the webhook can find the record.
 */
export async function createCheckoutSession(
  secretKey: string,
  invoice: { id: string; number: string; totalCents: number; currency?: string },
  successUrl: string,
): Promise<CheckoutSession> {
  // Stripe's API is form-encoded, not JSON.
  const body = new URLSearchParams({
    mode: 'payment',
    success_url: successUrl,
    'metadata[invoice_id]': invoice.id,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': invoice.currency ?? 'usd',
    'line_items[0][price_data][unit_amount]': String(invoice.totalCents),
    'line_items[0][price_data][product_data][name]': `Invoice ${invoice.number}`,
  });

  const res = await fetch(`${API_BASE}/v1/checkout/sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = (await res.json()) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!res.ok || !payload.id || !payload.url) {
    throw new Error(`Stripe checkout session failed: ${payload.error?.message ?? res.status}`);
  }
  return { id: payload.id, url: payload.url };
}

/**
 * Verifies a Stripe webhook signature (https://docs.stripe.com/webhooks#verify-manually).
 *
 * The `Stripe-Signature` header carries `t=<timestamp>,v1=<hmac>[,…]`; the HMAC
 * is SHA-256 over `"<timestamp>.<raw body>"` keyed with the webhook secret.
 * Returns true only for a matching signature within `toleranceSeconds` of now
 * (replay protection). Comparison is constant-time.
 */
export function verifyStripeSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  webhookSecret: string,
  toleranceSeconds = 300,
): boolean {
  if (!signatureHeader) return false;

  // Parse "t=169…,v1=abc…,v1=def…" — multiple v1 entries are allowed.
  const parts = new Map<string, string[]>();
  for (const pair of signatureHeader.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    parts.set(key, [...(parts.get(key) ?? []), value]);
  }

  const timestamp = Number(parts.get('t')?.[0]);
  const candidates = parts.get('v1') ?? [];
  if (!Number.isFinite(timestamp) || candidates.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const expected = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');

  return candidates.some((candidate) => {
    const candidateBuf = Buffer.from(candidate, 'utf8');
    return candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf);
  });
}
