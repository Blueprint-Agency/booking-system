import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { classpassInboundEmails, classpassSettings } from '../../db/schema'
import type { ClassPassEmailKind, ClassPassEmailOutcome } from '../../db/enums'
import { ensureClassPassSettings } from './settings'

/**
 * The one way into the ClassPass import (#407): every email that reaches a
 * studio's ClassPass address comes through `receiveClassPassEmail`, whether the
 * Resend webhook delivered it or a test built it. It decides what the email is,
 * and records it with its outcome, in the caller's Tenant transaction.
 *
 * So far (#409) it records and nothing more: a ClassPass email is `ignored`,
 * one that can't be trusted is `refused`, and Gmail's forwarding confirmation
 * gives up its code to the ClassPass page. Later tickets add what a booking,
 * a cancellation and a roster do, behind this same entry.
 */

/** A received email, as Resend's receiving API returns it. */
export interface InboundEmail {
  /** The email's own Message-ID header: the per-studio dedupe key. */
  messageId: string
  /** The From header as sent, display name included. */
  from: string
  to: string[]
  subject: string
  text: string | null
  html: string | null
  headers: Record<string, string> | null
  /**
   * The receiving server's verdict, which the sender cannot forge. Null when
   * Resend has none for the message.
   */
  authentication: { dkim?: string | null; spf?: string | null; dmarc?: string | null } | null
  /** When it reached us. */
  receivedAt: Date
}

export type ReceivedClassPassEmail = {
  id: string
  kind: ClassPassEmailKind
  outcome: ClassPassEmailOutcome
  /** The same Message-ID was already kept for this studio; nothing was done again. */
  duplicate: boolean
}

export const CLASSPASS_SENDER = 'noreply@info.classpass.com'
export const GMAIL_FORWARDING_SENDER = 'forwarding-noreply@google.com'

const KIND_BY_SUBJECT: Record<string, ClassPassEmailKind> = {
  'classpass user reservation': 'booking',
  'classpass reservation canceled by user': 'cancellation',
  'classpass daily roster': 'roster',
}

/** The bare, lower-cased address of a header like `ClassPass <noreply@info.classpass.com>`. */
export function addressOf(header: string): string {
  const angled = /<([^<>\s]+@[^<>\s]+)>/.exec(header)
  return (angled?.[1] ?? header).trim().toLowerCase()
}

type Decision = { kind: ClassPassEmailKind; outcome: ClassPassEmailOutcome; gmailCode?: string }

/**
 * What the email is and what becomes of it.
 *
 * Trust rests on Resend's DKIM verdict together with the From address: Resend
 * reports `dkim: pass` only for a signature aligned with the From domain, so a
 * pass on mail From `noreply@info.classpass.com` is ClassPass's own signature.
 * SPF is ignored, because forwarding breaks it. Resend exposes no signing
 * domain (`d=`) or `Authentication-Results`; if it ever does, also require
 * `d=info.classpass.com` here.
 */
function decide(message: InboundEmail): Decision {
  const from = addressOf(message.from)
  const signed = message.authentication?.dkim === 'pass'

  if (from === CLASSPASS_SENDER) {
    const kind = KIND_BY_SUBJECT[message.subject.trim().toLowerCase()] ?? 'marketing'
    if (!signed) return { kind, outcome: 'refused' }
    // Nothing is imported yet: every trusted ClassPass email is kept, whether
    // the studio's switch is on or off.
    return { kind, outcome: 'ignored' }
  }

  if (from === GMAIL_FORWARDING_SENDER && /gmail forwarding confirmation/i.test(message.subject)) {
    if (!signed) return { kind: 'gmail_confirmation', outcome: 'refused' }
    return { kind: 'gmail_confirmation', outcome: 'ignored', gmailCode: gmailCode(message) }
  }

  return { kind: 'other', outcome: 'refused' }
}

/** `Confirmation code: 123456789` in the body, or `(#123456789)` in the subject. */
function gmailCode(message: InboundEmail): string | undefined {
  const body = `${message.text ?? ''}\n${(message.html ?? '').replace(/<[^>]*>/g, ' ')}`
  return (
    /confirmation code:\s*(\d{4,})/i.exec(body)?.[1] ?? /\(#(\d{4,})\)/.exec(message.subject)?.[1] ?? undefined
  )
}

/** Runs inside the studio's Tenant context (`withTenant`), as every service does. */
export async function receiveClassPassEmail(tenantId: string, message: InboundEmail): Promise<ReceivedClassPassEmail> {
  await ensureClassPassSettings(tenantId)
  const decision = decide(message)

  const [inserted] = await db
    .insert(classpassInboundEmails)
    .values({
      tenantId,
      receivedAt: message.receivedAt,
      messageId: message.messageId,
      fromAddress: message.from,
      subject: message.subject,
      kind: decision.kind,
      outcome: decision.outcome,
      authentication: message.authentication,
      headers: message.headers,
      text: message.text,
      html: message.html,
    })
    .onConflictDoNothing({ target: [classpassInboundEmails.tenantId, classpassInboundEmails.messageId] })
    .returning({ id: classpassInboundEmails.id })

  if (!inserted) {
    const [kept] = await db
      .select({ id: classpassInboundEmails.id, kind: classpassInboundEmails.kind, outcome: classpassInboundEmails.outcome })
      .from(classpassInboundEmails)
      .where(and(eq(classpassInboundEmails.tenantId, tenantId), eq(classpassInboundEmails.messageId, message.messageId)))
    // Invariant: the conflict that skipped the insert is this row.
    if (!kept) throw new Error('classpass inbound email conflict without a kept row')
    return { ...kept, duplicate: true }
  }

  if (decision.gmailCode) {
    await db
      .update(classpassSettings)
      .set({ gmailConfirmationCode: decision.gmailCode, gmailConfirmationAt: message.receivedAt, updatedAt: new Date() })
      .where(eq(classpassSettings.tenantId, tenantId))
  }

  return { id: inserted.id, kind: decision.kind, outcome: decision.outcome, duplicate: false }
}
