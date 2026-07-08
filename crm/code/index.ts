/**
 * CRM block — vendored logic entry point. This file is YOURS.
 *
 * `ion-drive add crm` copied it to blocks/crm/ and wired it into
 * blocks/index.ts; your server.ts passes it to `createServer`, which runs
 * `setup` at boot. Everything registered here is declared in the block's
 * manifest, so the platform exposes it automatically:
 *
 *  - action `convert_lead`   → POST /api/v1/blocks/crm/actions/convert_lead
 *  - action `set_deal_stage` → POST /api/v1/blocks/crm/actions/set_deal_stage
 *  - action `log_activity`   → POST /api/v1/blocks/crm/actions/log_activity
 *    (each is also an MCP tool — `crm_convert_lead` etc. — and in the OpenAPI spec)
 *  - hook `inbound_lead`     → POST /api/v1/hooks/crm/inbound_lead
 *    (session-auth exempt; authenticity = the shared token we verify)
 *
 * The deal_history trail needs no code at all — it is a manifest subscription
 * on `data.deals.updated` using the built-in `persist_event` bus handler.
 *
 * Setup (one-time): store the web-to-lead shared token as an Ion Drive secret
 * (admin console → Secrets, or POST /api/v1/secrets): `crm_inbound_token`.
 * Point your website form/automation at the hook URL with header
 * `x-crm-token: <that token>`.
 */
import { definePlugin } from '@ion-drive/core';
import { z } from 'zod';
import {
  ACTIVITY_TYPES,
  DEAL_STAGES,
  LEAD_SOURCES,
  LOST_REASONS,
  STAGE_PROBABILITY,
  compact,
  escapeLike,
  isClosedStage,
  splitFullName,
  tokenMatches,
} from './crm.js';

export default definePlugin({
  name: 'crm',

  setup(ctx) {
    // ------------------------------------------------------------------
    // Action: convert a lead into company + contact (+ optional deal)
    // ------------------------------------------------------------------
    ctx.actions.registerAction({
      block: 'crm',
      name: 'convert_lead',
      description:
        'Convert a lead into a company + contact (de-duplicated) and optionally a deal.',
      // The Zod schema validates requests (400 with issues on failure) and
      // shapes the MCP tool's parameters.
      input: z.object({
        lead_id: z.string().uuid(),
        create_deal: z.boolean().optional().default(false),
        deal_title: z.string().min(1).max(255).optional(),
        amount: z.number().nonnegative().optional(),
      }),
      handler: async (actionCtx) => {
        const input = actionCtx.input as {
          lead_id: string;
          create_deal: boolean;
          deal_title?: string;
          amount?: number;
        };
        const { dataService } = actionCtx;

        const found = await dataService.getById('leads', input.lead_id);
        if (!found) throw new Error(`Lead ${input.lead_id} not found`);
        const lead = found.data as {
          first_name: string | null;
          last_name: string;
          email: string | null;
          phone: string | null;
          company_name: string | null;
          title: string | null;
          source: string | null;
          status: string;
          converted_company_id: string | null;
          converted_contact_id: string | null;
          converted_deal_id: string | null;
        };

        // Idempotent: converting twice returns the original conversion.
        if (lead.status === 'converted') {
          return {
            already_converted: true,
            company_id: lead.converted_company_id,
            contact_id: lead.converted_contact_id,
            deal_id: lead.converted_deal_id,
          };
        }
        if (lead.status === 'disqualified') {
          throw new Error(`Lead ${input.lead_id} is disqualified — re-qualify it first.`);
        }

        // Company: reuse an existing record by (case-insensitive) name, else create.
        let companyId: string | null = null;
        const companyName = lead.company_name?.trim();
        if (companyName) {
          const existing = await dataService.list('companies', {
            filters: [{ field: 'name', operator: 'ilike', value: escapeLike(companyName) }],
            pagination: { page: 1, pageSize: 1 },
          });
          if (existing.data.length > 0) {
            companyId = String(existing.data[0].id);
          } else {
            const created = await dataService.create('companies', { name: companyName });
            companyId = String(created.data.id);
          }
        }

        // Contact: reuse by unique email, else create linked to the company.
        let contactId: string;
        const existingContact = lead.email
          ? await dataService.list('contacts', {
              filters: [{ field: 'email', operator: 'eq', value: lead.email }],
              pagination: { page: 1, pageSize: 1 },
            })
          : null;
        if (existingContact && existingContact.data.length > 0) {
          contactId = String(existingContact.data[0].id);
        } else {
          const created = await dataService.create(
            'contacts',
            compact({
              first_name: lead.first_name ?? '—',
              last_name: lead.last_name,
              email: lead.email ?? undefined,
              phone: lead.phone ?? undefined,
              title: lead.title ?? undefined,
              lead_source: lead.source ?? undefined,
              lifecycle_stage: 'sales_qualified',
              company_id: companyId ?? undefined,
            }),
          );
          contactId = String(created.data.id);
        }

        // Deal (optional): opens at the top of the pipeline.
        let dealId: string | null = null;
        if (input.create_deal) {
          const created = await dataService.create(
            'deals',
            compact({
              title:
                input.deal_title ?? `${companyName ?? lead.last_name} — new deal`,
              amount: input.amount,
              stage: 'prospecting',
              probability: STAGE_PROBABILITY.prospecting,
              source: lead.source ?? undefined,
              company_id: companyId ?? undefined,
              primary_contact_id: contactId,
            }),
          );
          dealId = String(created.data.id);
        }

        await dataService.update(
          'leads',
          input.lead_id,
          compact({
            status: 'converted',
            converted_at: new Date().toISOString(),
            converted_company_id: companyId ?? undefined,
            converted_contact_id: contactId,
            converted_deal_id: dealId ?? undefined,
          }),
        );

        actionCtx.logger.info('Lead converted', { leadId: input.lead_id, companyId, contactId, dealId });
        return { already_converted: false, company_id: companyId, contact_id: contactId, deal_id: dealId };
      },
    });

    // ------------------------------------------------------------------
    // Action: move a deal through the pipeline (stage invariants live here)
    // ------------------------------------------------------------------
    ctx.actions.registerAction({
      block: 'crm',
      name: 'set_deal_stage',
      description:
        'Move a deal to a pipeline stage, applying default probability and close bookkeeping.',
      input: z.object({
        deal_id: z.string().uuid(),
        stage: z.enum(DEAL_STAGES),
        lost_reason: z.enum(LOST_REASONS).optional(),
      }),
      handler: async (actionCtx) => {
        const input = actionCtx.input as {
          deal_id: string;
          stage: (typeof DEAL_STAGES)[number];
          lost_reason?: (typeof LOST_REASONS)[number];
        };
        const { dataService } = actionCtx;

        const found = await dataService.getById('deals', input.deal_id);
        if (!found) throw new Error(`Deal ${input.deal_id} not found`);
        const deal = found.data as {
          title: string;
          stage: string;
          company_id: string | null;
          primary_contact_id: string | null;
        };

        if (deal.stage === input.stage) {
          return { deal_id: input.deal_id, stage: deal.stage, unchanged: true };
        }

        const now = new Date().toISOString();
        const closed = isClosedStage(input.stage);
        await dataService.update('deals', input.deal_id, {
          stage: input.stage,
          probability: STAGE_PROBABILITY[input.stage],
          // Reopening a closed deal clears the close bookkeeping again.
          closed_at: closed ? now : null,
          lost_reason: input.stage === 'closed_lost' ? (input.lost_reason ?? 'other') : null,
          last_activity_at: now,
        });

        // Leave a breadcrumb on the activity timeline (deal_history captures
        // the raw diff; this is the human-readable version).
        await dataService.create(
          'activities',
          compact({
            subject: `Stage changed: ${deal.stage} → ${input.stage}`,
            type: 'note',
            completed: true,
            completed_at: now,
            deal_id: input.deal_id,
            company_id: deal.company_id ?? undefined,
            contact_id: deal.primary_contact_id ?? undefined,
          }),
        );

        actionCtx.logger.info('Deal stage changed', {
          dealId: input.deal_id,
          from: deal.stage,
          to: input.stage,
        });
        return {
          deal_id: input.deal_id,
          stage: input.stage,
          probability: STAGE_PROBABILITY[input.stage],
          closed,
        };
      },
    });

    // ------------------------------------------------------------------
    // Action: log an activity and stamp last_activity_at on linked records
    // ------------------------------------------------------------------
    ctx.actions.registerAction({
      block: 'crm',
      name: 'log_activity',
      description:
        'Log a call/email/meeting/task/note against a contact, company, and/or deal.',
      input: z
        .object({
          subject: z.string().min(1).max(255),
          type: z.enum(ACTIVITY_TYPES).optional().default('note'),
          direction: z.enum(['inbound', 'outbound']).optional(),
          notes: z.string().max(20_000).optional(),
          contact_id: z.string().uuid().optional(),
          company_id: z.string().uuid().optional(),
          deal_id: z.string().uuid().optional(),
          due_date: z.string().datetime().optional(),
          completed: z.boolean().optional(),
          duration_minutes: z.number().int().nonnegative().optional(),
        })
        .refine((v) => v.contact_id || v.company_id || v.deal_id, {
          message: 'Link the activity to at least one of contact_id, company_id, deal_id.',
        }),
      handler: async (actionCtx) => {
        const input = actionCtx.input as {
          subject: string;
          type: (typeof ACTIVITY_TYPES)[number];
          direction?: string;
          notes?: string;
          contact_id?: string;
          company_id?: string;
          deal_id?: string;
          due_date?: string;
          completed?: boolean;
          duration_minutes?: number;
        };
        const { dataService } = actionCtx;
        const now = new Date().toISOString();

        const created = await dataService.create(
          'activities',
          compact({
            subject: input.subject,
            type: input.type,
            direction: input.direction,
            notes: input.notes,
            contact_id: input.contact_id,
            company_id: input.company_id,
            deal_id: input.deal_id,
            due_date: input.due_date,
            completed: input.completed,
            completed_at: input.completed ? now : undefined,
            duration_minutes: input.duration_minutes,
          }),
        );

        // Direct POSTs to /api/v1/data/activities bypass this stamping — use
        // this action (or the crm_log_activity MCP tool) to keep it fresh.
        if (input.contact_id) {
          await dataService.update('contacts', input.contact_id, { last_activity_at: now });
        }
        if (input.deal_id) {
          await dataService.update('deals', input.deal_id, { last_activity_at: now });
        }

        return { activity_id: String(created.data.id) };
      },
    });

    // ------------------------------------------------------------------
    // Hook: web-to-lead capture (shared-token auth → create a lead)
    // ------------------------------------------------------------------
    const inboundLeadSchema = z
      .object({
        first_name: z.string().max(255).optional(),
        last_name: z.string().max(255).optional(),
        /** Free-form full name, split when first/last are not sent separately. */
        name: z.string().max(255).optional(),
        email: z.string().email().max(320).optional(),
        phone: z.string().max(50).optional(),
        company_name: z.string().max(255).optional(),
        title: z.string().max(255).optional(),
        /** Lands in the lead's notes field. */
        message: z.string().max(20_000).optional(),
        source: z.enum(LEAD_SOURCES).optional(),
      })
      .refine((v) => v.email || v.last_name || v.name, {
        message: 'Provide at least an email or a name.',
      });

    ctx.actions.registerHook({
      block: 'crm',
      name: 'inbound_lead',
      description: 'Verifies the shared x-crm-token header and creates a lead from a form payload.',
      handler: async (hookCtx) => {
        if (hookCtx.method.toUpperCase() !== 'POST') {
          return { status: 405, body: { error: 'POST only' } };
        }

        const secret = await hookCtx.secrets.get('crm_inbound_token');
        if (!secret) {
          return { status: 500, body: { error: 'crm_inbound_token is not configured' } };
        }
        const presented = hookCtx.headers['x-crm-token'];
        if (!tokenMatches(Array.isArray(presented) ? presented[0] : presented, secret)) {
          hookCtx.logger.warn('Rejected inbound lead: bad token');
          return { status: 401, body: { error: 'invalid token' } };
        }

        let payload: unknown;
        try {
          payload = JSON.parse(hookCtx.rawBody.toString('utf8'));
        } catch {
          return { status: 400, body: { error: 'body must be JSON' } };
        }
        const parsed = inboundLeadSchema.safeParse(payload);
        if (!parsed.success) {
          return { status: 422, body: { error: 'invalid payload', issues: parsed.error.issues } };
        }
        const form = parsed.data;

        // De-duplicate repeat form submissions against still-open leads.
        if (form.email) {
          const open = await hookCtx.dataService.list('leads', {
            filters: [
              { field: 'email', operator: 'eq', value: form.email },
              { field: 'status', operator: 'in', value: ['new', 'working'] },
            ],
            pagination: { page: 1, pageSize: 1 },
          });
          if (open.data.length > 0) {
            return {
              status: 200,
              body: { received: true, duplicate: true, lead_id: String(open.data[0].id) },
            };
          }
        }

        // last_name is required on leads (Salesforce convention); derive it
        // from the full name, falling back to the email's local part.
        const fromName = form.name ? splitFullName(form.name) : undefined;
        const lastName =
          form.last_name ?? fromName?.last_name ?? (form.email ? form.email.split('@')[0] : '');

        const created = await hookCtx.dataService.create(
          'leads',
          compact({
            first_name: form.first_name ?? fromName?.first_name,
            last_name: lastName,
            email: form.email,
            phone: form.phone,
            company_name: form.company_name,
            title: form.title,
            notes: form.message,
            source: form.source ?? 'website',
            status: 'new',
          }),
        );

        hookCtx.logger.info('Inbound lead captured', { leadId: String(created.data.id) });
        return { status: 201, body: { received: true, lead_id: String(created.data.id) } };
      },
    });
  },
});
