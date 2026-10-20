import { randomBytes } from 'node:crypto'
import { and, asc, count, eq, gt, inArray, max, min, ne, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  bookings,
  classes,
  classpassInboundEmails,
  classpassLocationMappings,
  classpassSettings,
  classTypes,
  clients,
} from '../../db/schema'
import { now as clockNow } from '../../lib/clock'
import { classpassEmailOutcomeEnum, type ClassPassEmailKind, type ClassPassEmailOutcome } from '../../db/enums'
import { currentEnv } from '../../env'
import { isOpen } from './review-items'
import { checkClassPassRosters, type RosterCheck } from './roster'

/** The kinds of email ClassPass itself sends (`receive.ts`); Gmail's confirmation and strangers' mail are not. */
const CLASSPASS_SENT_KINDS: ClassPassEmailKind[] = ['booking', 'cancellation', 'roster', 'marketing']

/**
 * A studio's ClassPass address and switch (#409), and what has arrived at it.
 *
 * The address is `<token>@<CLASSPASS_INBOUND_DOMAIN>`. The token is random, not
 * the Slug, so the address can't be guessed from the studio's name, and a
 * leaked one is replaced by regenerating it.
 */

export type ClassPassSettingsRow = typeof classpassSettings.$inferSelect

export type ClassPassStatus = {
  /** Null when this deployment has no inbound domain configured. */
  address: string | null
  enabled: boolean
  /** The code in Gmail's older forwarding confirmation; null when none came, or the newer one carried none. */
  gmailConfirmationCode: string | null
  /** The `https://mail-settings.google.com/mail/vf-…` link that confirms the address when Gmail's owner opens it. */
  gmailConfirmationLink: string | null
  gmailConfirmationAt: Date | null
  /** When the last email of any outcome arrived; null before the first. */
  lastReceivedAt: Date | null
  counts: Record<ClassPassEmailOutcome, number>
  /**
   * ClassPass bookings holding an Overbook seat on a class that hasn't ended
   * (#411): ClassPass sold a seat the class did not have. Gone once the class
   * ends or the booking is cancelled. Soonest first.
   */
  overbooked: OverbookedClassPassBooking[]
  /** What the ClassPass page's setup guide ticks each step on. */
  setup: ClassPassSetup
}

/**
 * The facts the ClassPass page's setup guide reads, each worked out from what
 * the studio has done and what has reached its ClassPass address; nothing is
 * stored for the guide itself.
 */
export type ClassPassSetup = {
  /** Step 1: the import is switched on. */
  enabled: boolean
  /** Step 2: Gmail's forwarding confirmation for the current address arrived, and when. */
  gmailConfirmationReceived: boolean
  gmailConfirmationAt: Date | null
  /**
   * Step 3: when the first email ClassPass sent arrived and was trusted (it
   * passed the DKIM and sender check, so its outcome isn't `refused`), of any
   * kind: a booking, a cancellation, a Daily Roster or marketing. Gmail's own
   * confirmation is not ClassPass's and does not count. Null before the first.
   */
  firstClassPassEmailAt: Date | null
  /** Step 4: the studio's ClassPass location mappings, and the open review items no mapping places. */
  locationMappings: number
  unmappedLocationReviews: number
  /** Step 5: when the first ClassPass booking was made, cancelled since or not. Null before the first. */
  firstClassPassBookingAt: Date | null
}

/** The ClassPass page as it is read: its status, and the roster check, which only a read works out. */
export type ClassPassPage = ClassPassStatus & {
  /** What the ClassPass Daily Rosters of the last week say we hold wrongly (#415). */
  rosterCheck: RosterCheck
}

export type OverbookedClassPassBooking = {
  bookingId: string
  classId: string
  className: string
  startsAt: Date
  clientName: string
}

/** 128 random bits, lower-case hex: safe as an email local part. */
export function newAddressToken(): string {
  return randomBytes(16).toString('hex')
}

export function classPassAddress(token: string): string | null {
  const domain = currentEnv('CLASSPASS_INBOUND_DOMAIN')?.trim().toLowerCase()
  return domain ? `${token}@${domain}` : null
}

/** The studio's settings row, made with a fresh token (and the import off) the first time it is asked for. */
export async function ensureClassPassSettings(tenantId: string): Promise<ClassPassSettingsRow> {
  await db
    .insert(classpassSettings)
    .values({ tenantId, addressToken: newAddressToken() })
    .onConflictDoNothing({ target: classpassSettings.tenantId })
  const [row] = await db.select().from(classpassSettings).where(eq(classpassSettings.tenantId, tenantId))
  // Invariant: the insert above leaves exactly one row for the Tenant.
  if (!row) throw new Error('classpass settings row missing after insert')
  return row
}

export async function readClassPass(tenantId: string): Promise<ClassPassStatus> {
  const settings = await ensureClassPassSettings(tenantId)
  const rows = await db
    .select({ outcome: classpassInboundEmails.outcome, n: count(), last: max(classpassInboundEmails.receivedAt) })
    .from(classpassInboundEmails)
    .where(eq(classpassInboundEmails.tenantId, tenantId))
    .groupBy(classpassInboundEmails.outcome)

  const counts = Object.fromEntries(classpassEmailOutcomeEnum.enumValues.map(o => [o, 0])) as Record<
    ClassPassEmailOutcome,
    number
  >
  let lastReceivedAt: Date | null = null
  for (const row of rows) {
    counts[row.outcome] = Number(row.n)
    const last = row.last ? new Date(row.last) : null
    if (last && (!lastReceivedAt || last > lastReceivedAt)) lastReceivedAt = last
  }

  return {
    address: classPassAddress(settings.addressToken),
    enabled: settings.enabled,
    gmailConfirmationCode: settings.gmailConfirmationCode,
    gmailConfirmationLink: settings.gmailConfirmationLink,
    gmailConfirmationAt: settings.gmailConfirmationAt,
    lastReceivedAt,
    counts,
    overbooked: await overbookedClassPassBookings(tenantId),
    setup: await classPassSetup(tenantId, settings),
  }
}

/** Three aggregate queries over the studio's own rows. */
async function classPassSetup(tenantId: string, settings: ClassPassSettingsRow): Promise<ClassPassSetup> {
  const [emails] = await db
    .select({
      firstTrusted: sql<string | null>`min(${classpassInboundEmails.receivedAt}) FILTER (WHERE ${and(
        inArray(classpassInboundEmails.kind, CLASSPASS_SENT_KINDS),
        ne(classpassInboundEmails.outcome, 'refused'),
      )})`,
      unmapped: sql<number>`count(*) FILTER (WHERE ${and(
        isOpen,
        eq(classpassInboundEmails.reviewReason, 'unmapped_location'),
      )})`,
    })
    .from(classpassInboundEmails)
    .where(eq(classpassInboundEmails.tenantId, tenantId))
  const [mappings] = await db
    .select({ n: count() })
    .from(classpassLocationMappings)
    .where(eq(classpassLocationMappings.tenantId, tenantId))
  const [booked] = await db
    .select({ first: min(bookings.bookedAt) })
    .from(bookings)
    .where(and(eq(bookings.tenantId, tenantId), eq(bookings.source, 'classpass')))

  return {
    enabled: settings.enabled,
    gmailConfirmationReceived: settings.gmailConfirmationCode !== null || settings.gmailConfirmationLink !== null,
    gmailConfirmationAt: settings.gmailConfirmationAt,
    firstClassPassEmailAt: emails?.firstTrusted ? new Date(emails.firstTrusted) : null,
    locationMappings: Number(mappings?.n ?? 0),
    unmappedLocationReviews: Number(emails?.unmapped ?? 0),
    firstClassPassBookingAt: booked?.first ? new Date(booked.first) : null,
  }
}

/** `readClassPass` with the roster check, for reading the page; a change answers without it. */
export async function readClassPassPage(tenantId: string): Promise<ClassPassPage> {
  return { ...(await readClassPass(tenantId)), rosterCheck: await checkClassPassRosters(tenantId) }
}

async function overbookedClassPassBookings(tenantId: string): Promise<OverbookedClassPassBooking[]> {
  return db
    .select({
      bookingId: bookings.id,
      classId: classes.id,
      className: classTypes.name,
      startsAt: classes.startsAt,
      clientName: clients.name,
    })
    .from(bookings)
    .innerJoin(classes, eq(classes.id, bookings.classId))
    .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .innerJoin(clients, eq(clients.id, bookings.clientId))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.source, 'classpass'),
        eq(bookings.state, 'confirmed'),
        eq(bookings.seat, 'overbook'),
        eq(classes.lifecycle, 'active'),
        gt(classes.endsAt, clockNow()),
      ),
    )
    .orderBy(asc(classes.startsAt), asc(clients.name))
}

export async function setClassPassEnabled(tenantId: string, enabled: boolean): Promise<ClassPassStatus> {
  await ensureClassPassSettings(tenantId)
  await db
    .update(classpassSettings)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(classpassSettings.tenantId, tenantId))
  return readClassPass(tenantId)
}

/**
 * A new address. The old token is overwritten, so mail to it resolves to no
 * studio from now on. The Gmail code belonged to the old address and goes too:
 * Gmail asks the new one to confirm afresh.
 */
export async function regenerateClassPassAddress(tenantId: string): Promise<ClassPassStatus> {
  await ensureClassPassSettings(tenantId)
  await db
    .update(classpassSettings)
    .set({
      addressToken: newAddressToken(),
      gmailConfirmationCode: null,
      gmailConfirmationLink: null,
      gmailConfirmationAt: null,
      updatedAt: new Date(),
    })
    .where(eq(classpassSettings.tenantId, tenantId))
  return readClassPass(tenantId)
}
