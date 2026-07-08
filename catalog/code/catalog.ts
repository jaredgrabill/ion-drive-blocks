/**
 * Catalog block — pure domain helpers, no platform imports. Kept separate from
 * index.ts (the plugin wiring) so they are trivially unit-testable and safe to
 * edit without touching handler registration. This file is YOURS.
 */

/** Must match the `kind` enum in block.json. */
export const PRODUCT_KINDS = ['good', 'service', 'subscription'] as const;

/** Must match the stock_moves `reason` enum in block.json. */
export const STOCK_REASONS = ['purchase', 'sale', 'adjustment', 'return', 'write_off'] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

/** Rounds to cents. All money written back to records goes through this. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A line's amount: quantity × the unit price snapshotted from the product. */
export function lineAmount(quantity: number, unitPrice: number): number {
  return round2(quantity * unitPrice);
}

/**
 * Tax owed on a line amount at the product's percentage rate. Computed once,
 * when the line is added — later changes to the product's tax_rate must not
 * rewrite invoice history.
 */
export function lineTax(amount: number, taxRate: number | null | undefined): number {
  if (!taxRate) return 0;
  return round2((amount * taxRate) / 100);
}

/** Drops undefined entries so partial writes never set `undefined` columns. */
export function compact(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
}
