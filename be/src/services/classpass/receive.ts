import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { classpassInboundEmails, classpassSettings } from '../../db/schema'
import type { ClassPassEmailKind, ClassPassEmailOutcome, ClassPassReviewReason } from '../../db/enums'
import { placeClassPassBooking } from './import-booking'
import { parseClassPassCancellation, placeClassPassCancellation } from './import-cancellation'
import { parseClassPassBooking } from './parse'
import { ensureClassPassSettings } from './settings'

/**
 * The one way into the ClassPass import (#407): every email that reaches a
 * studio's ClassPass address comes through `receiveClassPassEmail`, whether the
 * Resend webhook delivered it or a test built it. It decides what the email is,
 * and records it with its outcome, in the caller's Tenant transaction.
 *
 * One that can't be trusted is `refused`, and Gmail's forwarding confirmation
 * gives up its code to the ClassPass page (#409). With the import on, a
 * booking email books the member (#411, `import-booking.ts`): `imported`, or
 * `noop` for a reservation already booked, or `review` / `unparsed` with the
 * reason it could not be placed. A cancellation cancels the ClassPass booking
 * it names (#412, `import-cancellation.ts`): `cancelled`, or `noop` when
 * there is no live booking for it. Every other ClassPass email is `ignored`;
 * a roster is kept so, and read when the ClassPass page is (#415, `roster.ts`).
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
  /** Why it was not placed, for ClassPass review; null when it was, or was never meant to be. */
  reason: ClassPassReviewReason | null
  /** The ClassPass booking it made, or the one it found already made. */
  bookingId: string | null
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
    // A booking is placed (#411) when the switch is on; anything else trusted
    // is kept as it came.
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
  const settings = await ensureClassPassSettings(tenantId)
  const decision = decide(message)
  // A trusted booking email is read whether or not the import is on, so what
  // it says is kept with it; it is placed only when it is on.
  const booking = decision.kind === 'booking' && decision.outcome !== 'refused'
  const fields = booking ? parseClassPassBooking(message) : null
  const cancellation = decision.kind === 'cancellation' && decision.outcome !== 'refused'
  const cancelledKey = cancellation ? parseClassPassCancellation(message) : null

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
      reservationId: fields?.reservationId ?? cancelledKey,
      className: fields?.className,
      locationName: fields?.locationName,
      memberName: fields?.memberName,
      memberEmail: fields?.memberEmail,
    })
    .onConflictDoNothing({ target: [classpassInboundEmails.tenantId, classpassInboundEmails.messageId] })
    .returning({ id: classpassInboundEmails.id })

  if (!inserted) {
    const [kept] = await db
      .select({
        id: classpassInboundEmails.id,
        kind: classpassInboundEmails.kind,
        outcome: classpassInboundEmails.outcome,
        reason: classpassInboundEmails.reviewReason,
        bookingId: classpassInboundEmails.bookingId,
      })
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

  if (fields && settings.enabled) {
    const placed = await placeClassPassBooking(tenantId, fields)
    await db
      .update(classpassInboundEmails)
      .set({
        outcome: placed.outcome,
        reviewReason: placed.reason,
        startsAt: placed.startsAt,
        clientId: placed.clientId,
        bookingId: placed.bookingId,
      })
      .where(and(eq(classpassInboundEmails.tenantId, tenantId), eq(classpassInboundEmails.id, inserted.id)))
    return {
      id: inserted.id,
      kind: decision.kind,
      outcome: placed.outcome,
      reason: placed.reason,
      bookingId: placed.bookingId,
      duplicate: false,
    }
  }

  if (cancellation && settings.enabled) {
    const placed = await placeClassPassCancellation(tenantId, cancelledKey)
    const reason = placed.outcome === 'unparsed' ? ('unparsed' as const) : null
    await db
      .update(classpassInboundEmails)
      .set({ outcome: placed.outcome, reviewReason: reason, clientId: placed.clientId, bookingId: placed.bookingId })
      .where(and(eq(classpassInboundEmails.tenantId, tenantId), eq(classpassInboundEmails.id, inserted.id)))
    return {
      id: inserted.id,
      kind: decision.kind,
      outcome: placed.outcome,
      reason,
      bookingId: placed.bookingId,
      duplicate: false,
    }
  }

  return { id: inserted.id, kind: decision.kind, outcome: decision.outcome, reason: null, bookingId: null, duplicate: false }
}
