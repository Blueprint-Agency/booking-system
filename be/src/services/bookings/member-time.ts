/**
 * A member's own time: one body, one session at a time.
 *
 * A member may not hold two bookings whose times overlap — a class, a private
 * session, or a day of a workshop tier. Every path that gives a member a seat
 * asks `assertMemberFree` (or, for a waitlist promotion, `memberClash`) inside
 * its transaction, after `lockMemberTime`, so two bookings for one member made
 * at once are decided one after the other.
 *
 * Staff may book a member anyway once warned (`allowClash`); a member never may.
 *
 * Windows are half-open, [starts_at, ends_at): a class ending at 5:00 and one
 * starting at 5:00 do not clash — the rule is occupancy's `overlaps`, the one
 * rooms and instructors are held to. The database query only narrows to the
 * member's held bookings near the window; `firstClash` decides, and is pure.
 */
import { and, eq, gt, lt, sql, type AnyColumn } from 'drizzle-orm'
import { db } from '../../db'
import { bookings } from '../../db/schema/bookings'
import { classes, ptSessions, workshopDays, workshops, workshopTierDays } from '../../db/schema/schedule'
import { classTypes, locations } from '../../db/schema/catalog'
import { clients } from '../../db/schema/identity'
import { overlaps, type TimeWindow } from '../schedule/occupancy'
import type { Tx } from '../schedule/roster'
import { ConflictError } from '../../shared/errors'

export type HeldKind = 'class' | 'pt' | 'workshop'

/** One window the member holds: a booking, and when it takes their time. */
export interface HeldWindow extends TimeWindow {
  bookingId: string
  kind: HeldKind
  /** The class, private session or workshop the booking is for. */
  eventId: string
  title: string
  locationName: string | null
}

/** The event being booked, which never clashes with itself. */
export interface EventOf {
  kind: HeldKind
  id: string
}

/**
 * The earliest held window that overlaps `window`, leaving out the event being
 * booked. Null when the member is free.
 */
export function firstClash(held: readonly HeldWindow[], window: TimeWindow, exclude?: EventOf): HeldWindow | null {
  const hits = held
    .filter(h => !(exclude && h.kind === exclude.kind && h.eventId === exclude.id))
    .filter(h => overlaps(h, window))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  return hits[0] ?? null
}

type Reader = Tx | typeof db

/**
 * Every window the member holds that touches `[from, to)`: confirmed bookings
 * on active classes and private sessions, and each day of a confirmed workshop
 * tier on an active workshop.
 */
export async function heldWindows(
  reader: Reader,
  tenantId: string,
  clientId: string,
  range: TimeWindow,
): Promise<HeldWindow[]> {
  const mine = and(eq(bookings.tenantId, tenantId), eq(bookings.clientId, clientId), eq(bookings.state, 'confirmed'))
  // Narrows only: `firstClash` is the rule.
  const near = (starts: AnyColumn, ends: AnyColumn) => and(lt(starts, range.endsAt), gt(ends, range.startsAt))

  const classRows = await reader
    .select({
      bookingId: bookings.id,
      eventId: classes.id,
      startsAt: classes.startsAt,
      endsAt: classes.endsAt,
      title: classTypes.name,
      locationName: locations.name,
    })
    .from(bookings)
    .innerJoin(classes, and(eq(classes.tenantId, bookings.tenantId), eq(classes.id, bookings.classId)))
    .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .leftJoin(locations, eq(locations.id, classes.locationId))
    .where(and(mine, eq(bookings.kind, 'class'), eq(classes.lifecycle, 'active'), near(classes.startsAt, classes.endsAt)))

  const ptRows = await reader
    .select({
      bookingId: bookings.id,
      eventId: ptSessions.id,
      startsAt: ptSessions.startsAt,
      endsAt: ptSessions.endsAt,
      locationName: locations.name,
    })
    .from(bookings)
    .innerJoin(ptSessions, and(eq(ptSessions.tenantId, bookings.tenantId), eq(ptSessions.id, bookings.ptSessionId)))
    .leftJoin(locations, eq(locations.id, ptSessions.locationId))
    .where(
      and(mine, eq(bookings.kind, 'pt'), eq(ptSessions.lifecycle, 'active'), near(ptSessions.startsAt, ptSessions.endsAt)),
    )

  const workshopRows = await reader
    .select({
      bookingId: bookings.id,
      eventId: workshops.id,
      startsAt: workshopDays.startsAt,
      endsAt: workshopDays.endsAt,
      title: workshops.name,
      locationName: locations.name,
    })
    .from(bookings)
    .innerJoin(
      workshopTierDays,
      and(eq(workshopTierDays.tenantId, bookings.tenantId), eq(workshopTierDays.workshopTierId, bookings.workshopTierId)),
    )
    .innerJoin(workshopDays, eq(workshopDays.id, workshopTierDays.workshopDayId))
    .innerJoin(workshops, eq(workshops.id, workshopDays.workshopId))
    .leftJoin(locations, eq(locations.id, workshops.locationId))
    .where(
      and(
        mine,
        eq(bookings.kind, 'workshop'),
        eq(workshops.lifecycle, 'active'),
        near(workshopDays.startsAt, workshopDays.endsAt),
      ),
    )

  return [
    ...classRows.map(r => ({ ...r, kind: 'class' as const })),
    ...ptRows.map(r => ({ ...r, kind: 'pt' as const, title: 'Private session' })),
    ...workshopRows.map(r => ({ ...r, kind: 'workshop' as const })),
  ]
}

/** The member's first booking that overlaps `window`, leaving out `exclude`. */
export async function memberClash(
  reader: Reader,
  tenantId: string,
  clientId: string,
  window: TimeWindow,
  exclude?: EventOf,
): Promise<HeldWindow | null> {
  return firstClash(await heldWindows(reader, tenantId, clientId, window), window, exclude)
}

/**
 * Hold these members' time for the rest of the transaction: a second booking
 * for one of them waits here until the first commits, then sees it. Keys are
 * taken in one order, so two bookings of the same pair cannot deadlock. Take it
 * after the event's own lock (the class row, the PT request, the slot).
 */
export async function lockMemberTime(tx: Tx, tenantId: string, clientIds: readonly string[]): Promise<void> {
  const keys = [...new Set(clientIds)].map(id => `member-time:${tenantId}:${id}`).sort()
  for (const key of keys) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`)
}

/** The `clash` a `time_clash` refusal carries: what the member already holds, and when. */
export function clashJson(h: HeldWindow) {
  return {
    booking_id: h.bookingId,
    kind: h.kind,
    title: h.title,
    starts_at: h.startsAt.toISOString(),
    ends_at: h.endsAt.toISOString(),
    location_name: h.locationName,
  }
}

/**
 * Refuse a booking that would put a member in two places at once: 409
 * `time_clash` naming the member and what they already hold. `allowClash` is
 * staff's "Book anyway", given after they were shown the clash.
 */
export async function assertMemberFree(
  tx: Tx,
  tenantId: string,
  clientId: string,
  window: TimeWindow,
  opts: { exclude?: EventOf; allowClash?: boolean } = {},
): Promise<void> {
  if (opts.allowClash) return
  const clash = await memberClash(tx, tenantId, clientId, window, opts.exclude)
  if (clash) throw await clashError(tx, tenantId, clientId, clash)
}

/** The 409 `time_clash` for a member's clash, named so staff know whose it is. */
export async function clashError(reader: Reader, tenantId: string, clientId: string, clash: HeldWindow) {
  const [client] = await reader
    .select({ name: clients.name })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, clientId)))
    .limit(1)
  return new ConflictError('time_clash', {
    client_id: clientId,
    client_name: client?.name ?? null,
    clash: clashJson(clash),
  })
}
