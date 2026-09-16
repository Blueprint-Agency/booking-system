/**
 * What Resend says became of a message, filed on its `email_log` row.
 *
 * Resend reports each email's fate by webhook (`routes/webhooks/resend.ts`).
 * This answers "I never got my code" from the log, and it is how bounces and
 * spam complaints are heard before Resend's own thresholds (4% bounces, 0.08%
 * complaints) pause sending for every studio at once.
 *
 * The event names its tenant only through the `tenant` tag the send path put
 * on it (`lib/mailer.ts`), so that tag is the one door into a Tenant context —
 * and inside it RLS limits the update to that tenant's rows. An event tagged
 * for one studio cannot reach another studio's row whatever message id it
 * carries.
 *
 * Nothing here throws for an event we cannot place: an untagged event, an
 * unknown message id and super portal mail are acknowledged and logged. A
 * retry from Resend would change none of them.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db, withTenant } from '../../db'
import { emailLog } from '../../db/schema/content'
import { logger, reportError } from '../../shared/logger'

type Status = (typeof emailLog.status.enumValues)[number]
type Outcome = Extract<Status, 'delivered' | 'bounced' | 'complained' | 'delivery_delayed' | 'suppressed'>

const OUTCOME_FOR_EVENT: Record<string, Outcome> = {
  'email.delivery_delayed': 'delivery_delayed',
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.suppressed': 'suppressed',
}

/**
 * Outcomes only move forward. Webhooks arrive late, twice and out of order, so
 * a row takes an outcome only from a status ranked below it: a late `delivered`
 * never overwrites `bounced`, and a repeat of the same event changes nothing.
 * A complaint follows a delivery, so it outranks it. The three final outcomes
 * share a rank — none of them replaces another.
 */
const RANK: Record<Status, number> = {
  queued: 0,
  failed: 0,
  sent: 1,
  delivery_delayed: 2,
  delivered: 3,
  bounced: 4,
  complained: 4,
  suppressed: 4,
}

const below = (outcome: Outcome): Status[] =>
  (Object.keys(RANK) as Status[]).filter(status => RANK[status] < RANK[outcome])

export type OutcomeAlertCode = 'mail_hard_bounce' | 'mail_complaint' | 'mail_suppressed'

/** Names the tenant, the template and the kind of recipient — never the address. */
export interface OutcomeAlert {
  code: OutcomeAlertCode
  tenantId: string
  template: string
  recipientKind: 'client' | 'staff'
}

export interface OutcomeReporter {
  alert(alert: OutcomeAlert): void
}

const loggingReporter: OutcomeReporter = {
  alert: ({ code, ...context }) =>
    reportError(new Error(`mail: ${code}`), `mail: ${code}`, { code, ...context }),
}

let reporter: OutcomeReporter = loggingReporter

/** Swap the alert sink — for tests. Returns the undo. */
export function useOutcomeReporter(next: OutcomeReporter): () => void {
  const previous = reporter
  reporter = next
  return () => {
    reporter = previous
  }
}

/** The part of a Resend email event this reads. */
export interface ResendEmailEvent {
  type: string
  created_at?: string
  data?: {
    email_id?: string
    created_at?: string
    tags?: Record<string, string> | { name: string; value: string }[]
    bounce?: { type?: string }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function tag(event: ResendEmailEvent, name: string): string | undefined {
  const tags = event.data?.tags
  if (Array.isArray(tags)) return tags.find(t => t.name === name)?.value
  return tags?.[name]
}

function alertFor(outcome: Outcome, event: ResendEmailEvent): OutcomeAlertCode | null {
  if (outcome === 'complained') return 'mail_complaint'
  if (outcome === 'suppressed') return 'mail_suppressed'
  // A soft bounce is Resend still trying; only a permanent one costs reputation.
  if (outcome === 'bounced' && event.data?.bounce?.type?.toLowerCase() === 'permanent') return 'mail_hard_bounce'
  return null
}

export async function handleResendEvent(event: ResendEmailEvent): Promise<void> {
  const outcome = OUTCOME_FOR_EVENT[event.type]
  if (!outcome) return

  const messageId = event.data?.email_id
  const template = tag(event, 'template')
  const tenantId = tag(event, 'tenant')
  const context = { eventType: event.type, messageId, template }

  if (!tenantId) {
    // Super portal mail carries no tenant tag by design and has no `email_log`
    // row to update.
    logger.info({ ...context, kind: tag(event, 'kind') }, 'resend-webhook: no tenant tag, logged only')
    return
  }
  if (!UUID.test(tenantId) || !messageId) {
    logger.warn({ ...context, tenantId }, 'resend-webhook: unusable tenant tag or message id, ignored')
    return
  }

  const occurredAt = new Date(event.created_at ?? event.data?.created_at ?? Date.now())
  const at = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt

  const updated = await withTenant(tenantId, async () => {
    const [row] = await db
      .update(emailLog)
      .set({ status: outcome, outcomeAt: at })
      .where(
        and(
          eq(emailLog.tenantId, tenantId),
          eq(emailLog.smtpMessageId, messageId),
          inArray(emailLog.status, below(outcome)),
        ),
      )
      .returning({ template: emailLog.templateSlug, recipientKind: emailLog.recipientUserKind })
    if (row) return row

    const [known] = await db
      .select({ status: emailLog.status })
      .from(emailLog)
      .where(and(eq(emailLog.tenantId, tenantId), eq(emailLog.smtpMessageId, messageId)))
      .limit(1)
    if (known) {
      logger.debug({ ...context, tenantId, status: known.status }, 'resend-webhook: already past this outcome')
    } else {
      logger.warn({ ...context, tenantId }, 'resend-webhook: no email_log row for this message')
    }
    return null
  })
  if (!updated) return

  const code = alertFor(outcome, event)
  if (code) reporter.alert({ code, tenantId, template: updated.template, recipientKind: updated.recipientKind })
}
