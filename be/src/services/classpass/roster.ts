import { and, eq, gte, inArray, ne } from 'drizzle-orm'
import { db } from '../../db'
import { bookings, classes, classpassInboundEmails, classpassLocationMappings, classTypes, clients } from '../../db/schema'
import { now as clockNow } from '../../lib/clock'
import { localDateOf, zonedInstant } from '../schedule/series-dates'
import { tenantTimezone } from '../tenants/tenants'
import { pickClass, type ClassAtTime } from './import-booking'
import { normaliseClassPassLocation } from './location-name'
import { calendarDate, clock24, monthOf, textPieces } from './parse'

/**
 * The ClassPass Daily Roster check.
 *
 * ClassPass sends a `ClassPass Daily Roster` per listing, about twice a day:
 *
 * ```
 * Your Roster Recap
 * <STUDIO> - <LOCATION>            (or cut short: `<STUDIO> -`)
 * Below are your ClassPass reservations for today, 09/17.*
 *   YOGA STRETCH
 *   01:30pm
 *   Fri, Sep 18
 *   <Member Name>
 *   <Member Name>
 * ```
 *
 * Names only: no emails, no reservation IDs, so it can create or cancel
 * nothing. It only checks the import: each class it lists is compared with the
 * ClassPass bookings held on that class at the mapped Location, by name,
 * ignoring case and spacing.
 *
 * Nothing is stored for the check: the roster email is kept as it came,
 * and the differences are worked out whenever the ClassPass page is read, so a
 * booking email that arrives after the roster settles its difference.
 */

export type RosterClass = {
  className: string
  /** `YYYY-MM-DD`, the studio's own calendar day; the year inferred from when the roster arrived. */
  localDate: string
  /** `HH:MM`, 24-hour. */
  localTime: string
  members: string[]
}

export type ParsedRoster = {
  /** The listing as ClassPass wrote it; null when the roster has none. */
  locationName: string | null
  classes: RosterClass[]
}

/** `01:30pm`. */
const TIME = /^(\d{1,2}):(\d{2}) ?([ap])\.?m\.?$/i
/** `Fri, Sep 18`. */
const DAY = /^[a-z]{3,9}\.?,? ([a-z]{3,9})\.? (\d{1,2})$/i

function time(piece: string | undefined): string | null {
  const m = piece ? TIME.exec(piece) : null
  return m ? clock24(m[1]!, m[2]!, m[3]!) : null
}

/**
 * `Fri, Sep 18` has no year: it is the year that puts the day nearest the day
 * the roster arrived, so a roster sent on 31 December about `Fri, Jan 1` means
 * next year's.
 */
function day(piece: string | undefined, receivedLocalDate: string): string | null {
  const m = piece ? DAY.exec(piece) : null
  if (!m) return null
  const month = monthOf(m[1]!)
  const d = Number(m[2])
  const received = Date.parse(`${receivedLocalDate}T00:00:00Z`)
  const year = Number(receivedLocalDate.slice(0, 4))
  let best: { at: number; date: string } | null = null
  for (const y of [year - 1, year, year + 1]) {
    const date = calendarDate(y, month, d)
    if (!date) continue
    const at = Math.abs(Date.parse(`${date}T00:00:00Z`) - received)
    if (!best || at < best.at) best = { at, date }
  }
  return best?.date ?? null
}

/** A class starts at a piece followed by its time and its day. */
const startsClass = (pieces: string[], i: number, receivedLocalDate: string) =>
  time(pieces[i + 1]) !== null && day(pieces[i + 2], receivedLocalDate) !== null

/** The roster's listing and classes. `receivedLocalDate` is the studio's day it arrived, `YYYY-MM-DD`. */
function parseClassPassRoster(
  message: { html: string | null; text: string | null },
  receivedLocalDate: string,
): ParsedRoster {
  const pieces = textPieces(message)
  const recap = pieces.findIndex(p => /^your roster recap$/i.test(p))
  const locationName = recap >= 0 ? (pieces[recap + 1] ?? null) : null
  const start = pieces.findIndex(p => /^below are your classpass reservations/i.test(p))
  const classes: RosterClass[] = []
  if (start < 0) return { locationName, classes }

  for (let i = start + 1; i < pieces.length; i++) {
    const piece = pieces[i]!
    // The footnote the `*` in the heading points to ends the list.
    if (piece.startsWith('*')) break
    if (startsClass(pieces, i, receivedLocalDate)) {
      classes.push({
        className: piece,
        localTime: time(pieces[i + 1])!,
        localDate: day(pieces[i + 2], receivedLocalDate)!,
        members: [],
      })
      i += 2
    } else if (classes.length > 0) {
      classes[classes.length - 1]!.members.push(piece)
    }
  }
  return { locationName, classes }
}

/* ── the check ──────────────────────────────────────────────────────────── */

export type RosterDifferenceKind = 'on_classpass_not_on_roster' | 'on_roster_not_on_classpass'

export type RosterDifference = {
  difference: RosterDifferenceKind
  /** Null when no class at the Location and time is the one the roster lists. */
  classId: string | null
  className: string
  startsAt: Date
  memberName: string
  /** The ClassPass booking ClassPass doesn't list; null for a member we don't hold. */
  bookingId: string | null
  rosterReceivedAt: Date
}

/** A roster whose listing has no ClassPass location mapping: it could not be checked. */
export type UncheckedRoster = { locationName: string | null; receivedAt: Date }

export type RosterCheck = { differences: RosterDifference[]; unchecked: UncheckedRoster[] }

/** How far back rosters are checked. */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const sameName = (name: string) => name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * The differences between the rosters received in the last week and the
 * ClassPass bookings held on their classes. Where two rosters list the same
 * class, the later one is ClassPass's word on it. A booking cancelled after a
 * roster was sent still counts as held for that roster.
 */
export async function checkClassPassRosters(tenantId: string): Promise<RosterCheck> {
  const timezone = await tenantTimezone(tenantId)
  const rosters = await db
    .select({ receivedAt: classpassInboundEmails.receivedAt, text: classpassInboundEmails.text, html: classpassInboundEmails.html })
    .from(classpassInboundEmails)
    .where(
      and(
        eq(classpassInboundEmails.tenantId, tenantId),
        eq(classpassInboundEmails.kind, 'roster'),
        ne(classpassInboundEmails.outcome, 'refused'),
        gte(classpassInboundEmails.receivedAt, new Date(clockNow().getTime() - WINDOW_MS)),
      ),
    )
  const mappings = new Map(
    (
      await db
        .select({ name: classpassLocationMappings.locationName, locationId: classpassLocationMappings.locationId })
        .from(classpassLocationMappings)
        .where(eq(classpassLocationMappings.tenantId, tenantId))
    ).map(m => [m.name, m.locationId]),
  )

  type Listed = { locationId: string; cls: RosterClass; startsAt: Date; receivedAt: Date }
  const latest = new Map<string, Listed>()
  const unchecked = new Map<string, UncheckedRoster>()
  for (const r of rosters) {
    const parsed = parseClassPassRoster(r, localDateOf(r.receivedAt, timezone))
    const locationId = parsed.locationName ? mappings.get(normaliseClassPassLocation(parsed.locationName)) : undefined
    if (!locationId) {
      const key = parsed.locationName ? normaliseClassPassLocation(parsed.locationName) : ''
      const seen = unchecked.get(key)
      if (!seen || seen.receivedAt < r.receivedAt) unchecked.set(key, { locationName: parsed.locationName, receivedAt: r.receivedAt })
      continue
    }
    for (const cls of parsed.classes) {
      const startsAt = zonedInstant(cls.localDate, cls.localTime, timezone)
      const key = `${locationId}|${startsAt.toISOString()}|${sameName(cls.className)}`
      const seen = latest.get(key)
      if (!seen || seen.receivedAt < r.receivedAt) latest.set(key, { locationId, cls, startsAt, receivedAt: r.receivedAt })
    }
  }

  const listed = [...latest.values()]
  const classesAt = await classesAtTimes(tenantId, listed)
  const matched = listed.map(l => {
    const match = pickClass(classesAt.get(`${l.locationId}|${l.startsAt.toISOString()}`) ?? [], l.cls.className)
    return { ...l, classId: 'classId' in match ? match.classId : null }
  })
  const booked = await classPassBookingsOn(
    tenantId,
    matched.flatMap(m => (m.classId ? [m.classId] : [])),
  )

  const differences: RosterDifference[] = []
  for (const { cls, startsAt, receivedAt, classId } of matched) {
    // Held for this roster: live now, or cancelled only after ClassPass wrote it.
    const held = (booked.get(classId ?? '') ?? []).filter(
      b => b.state !== 'cancelled' || (b.cancelledAt !== null && b.cancelledAt > receivedAt),
    )
    const base = { classId, className: cls.className, startsAt, rosterReceivedAt: receivedAt }

    const unmatched = [...held]
    for (const name of cls.members) {
      const at = unmatched.findIndex(b => b.names.has(sameName(name)))
      if (at >= 0) unmatched.splice(at, 1)
      else differences.push({ ...base, difference: 'on_classpass_not_on_roster', memberName: name, bookingId: null })
    }
    for (const b of unmatched) {
      // Booked after ClassPass wrote this roster: it could not have listed them.
      // Cancelled since: nothing is held to put right.
      if (b.bookedAt > receivedAt || b.state === 'cancelled') continue
      differences.push({ ...base, difference: 'on_roster_not_on_classpass', memberName: b.name, bookingId: b.id })
    }
  }
  differences.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.memberName.localeCompare(b.memberName))
  return {
    differences,
    unchecked: [...unchecked.values()].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()),
  }
}

/** Every class at the listed Locations and starts, in one read, keyed `locationId|startsAt`. */
async function classesAtTimes(
  tenantId: string,
  listed: { locationId: string; startsAt: Date }[],
): Promise<Map<string, ClassAtTime[]>> {
  const byKey = new Map<string, ClassAtTime[]>()
  if (listed.length === 0) return byKey
  const rows = await db
    .select({ id: classes.id, lifecycle: classes.lifecycle, typeName: classTypes.name, locationId: classes.locationId, startsAt: classes.startsAt })
    .from(classes)
    .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .where(
      and(
        eq(classes.tenantId, tenantId),
        inArray(classes.locationId, [...new Set(listed.map(l => l.locationId))]),
        inArray(classes.startsAt, [...new Map(listed.map(l => [l.startsAt.getTime(), l.startsAt])).values()]),
      ),
    )
  for (const r of rows) {
    const key = `${r.locationId}|${r.startsAt.toISOString()}`
    byKey.set(key, [...(byKey.get(key) ?? []), r])
  }
  return byKey
}

/**
 * The ClassPass bookings on the classes, cancelled ones too, each with the
 * names it may appear under on a roster: the member's name here, and the name
 * ClassPass gave in the booking email. Keyed by class; two reads in all.
 */
async function classPassBookingsOn(tenantId: string, classIds: string[]) {
  const byClass = new Map<
    string,
    { id: string; bookedAt: Date; cancelledAt: Date | null; state: string; name: string; names: Set<string> }[]
  >()
  if (classIds.length === 0) return byClass
  const rows = await db
    .select({
      id: bookings.id,
      classId: bookings.classId,
      bookedAt: bookings.bookedAt,
      cancelledAt: bookings.cancelledAt,
      state: bookings.state,
      name: clients.name,
    })
    .from(bookings)
    .innerJoin(clients, eq(clients.id, bookings.clientId))
    .where(and(eq(bookings.tenantId, tenantId), inArray(bookings.classId, [...new Set(classIds)]), eq(bookings.source, 'classpass')))
  if (rows.length === 0) return byClass
  const emailed = await db
    .select({ bookingId: classpassInboundEmails.bookingId, name: classpassInboundEmails.memberName })
    .from(classpassInboundEmails)
    .where(
      and(
        eq(classpassInboundEmails.tenantId, tenantId),
        inArray(
          classpassInboundEmails.bookingId,
          rows.map(r => r.id),
        ),
      ),
    )
  for (const r of rows) {
    const names = new Set(
      [r.name, ...emailed.filter(e => e.bookingId === r.id).map(e => e.name)].filter((n): n is string => !!n).map(sameName),
    )
    const entry = { id: r.id, bookedAt: r.bookedAt, cancelledAt: r.cancelledAt, state: r.state, name: r.name, names }
    byClass.set(r.classId!, [...(byClass.get(r.classId!) ?? []), entry])
  }
  return byClass
}
