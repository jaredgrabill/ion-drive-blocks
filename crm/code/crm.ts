/**
 * CRM block — pure domain helpers, no platform imports. Kept separate from
 * index.ts (the plugin wiring) so they are trivially unit-testable and safe to
 * edit without touching handler registration. This file is YOURS.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** Pipeline stages, in order. Must match the `stage` enum in block.json. */
export const DEAL_STAGES = [
  'prospecting',
  'qualification',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost',
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

/**
 * Default win probability applied when a deal enters a stage. `set_deal_stage`
 * overwrites the deal's probability with these — tune them to your funnel.
 */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  prospecting: 10,
  qualification: 25,
  proposal: 50,
  negotiation: 75,
  closed_won: 100,
  closed_lost: 0,
};

/** A closed stage stamps `closed_at`; closed_lost also requires a reason. */
export function isClosedStage(stage: DealStage): boolean {
  return stage === 'closed_won' || stage === 'closed_lost';
}

/** Must match the `lost_reason` enum in block.json. */
export const LOST_REASONS = [
  'price',
  'competitor',
  'timing',
  'no_budget',
  'unresponsive',
  'other',
] as const;

/** Must match the lead/deal/contact `source` enums in block.json. */
export const LEAD_SOURCES = [
  'website',
  'referral',
  'outbound',
  'event',
  'advertising',
  'partner',
  'other',
] as const;

/** Must match the activity `type` enum in block.json. */
export const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'task', 'note'] as const;

/**
 * Constant-time comparison of a presented token against the stored secret.
 * Hashing both sides first lets `timingSafeEqual` run on equal-length buffers
 * without leaking the secret's length.
 */
export function tokenMatches(presented: string | undefined, secret: string): boolean {
  if (!presented) return false;
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

/** Splits a free-form full name into first/last (last word wins the surname). */
export function splitFullName(name: string): { first_name?: string; last_name: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { last_name: parts[0] };
  return { first_name: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1] };
}

/** Escapes LIKE/ILIKE wildcards so user input matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Drops undefined entries so partial patches never write `undefined` columns. */
export function compact(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
}
