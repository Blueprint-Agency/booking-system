import { and, eq, gte, inArray, ne } from 'drizzle-orm'
import { db } from '../../db'
import { bookings, classpassInboundEmails, classpassLocationMappings, clients } from '../../db/schema'
import { now as clockNow } from '../../lib/clock'
import { zonedInstant } from '../schedule/series-dates'
import { loadTenantById } from '../tenants/tenants'
import { matchClass } from './import-booking'
import { normaliseClassPassLocation } from './location-name'
import { textPieces } from './parse'

/**
 * The ClassPass Daily Roster check (#415).
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
 * Nothing is stored for the check: the roster email is kept as it came (#411),
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

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** `01:30pm`. */
const TIME = /^(\d{1,2}):(\d{2}) ?([ap])\.?m\.?$/i
/** `Fri, Sep 18`. */
const DAY = /^[a-z]{3,9}\.?,? ([a-z]{3,9})\.? (\d{1,2})$/i
const pad = (n: number) => String(n).padStart(2, '0')

function time(piece: string | undefined): string | null {
  const m = piece ? TIME.exec(piece) : null
  if (!m) return null
  const h = Number(m[1])
  if (h < 1 || h > 12 || Number(m[2]) > 59) return null
  return `${pad((h % 12) + (m[3]!.toLowerCase() === 'p' ? 12 : 0))}:${m[2]}`
}

/**
 * `Fri, Sep 18` has no year: it is the year that puts the day nearest the day
 * the roster arrived, so a roster sent on 31 December about `Fri, Jan 1` means
 * next year's.
 */
function day(piece: string | undefined, receivedLocalDate: string): string | null {
  const m = piece ? DAY.exec(piece) : null
  if (!m) return null
  const month = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase())
  const d = Number(m[2])
  if (month < 0) return null
  const received = Date.parse(`${receivedLocalDate}T00:00:00Z`)
  const year = Number(receivedLocalDate.slice(0, 4))
  let best: { at: number; date: Date } | null = null
  for (const y of [year - 1, year, year + 1]) {
    const date = new Date(Date.UTC(y, month, d))
    if (date.getUTCMonth() !== month) continue
    const at = Math.abs(date.getTime() - received)
    if (!best || at < best.at) best = { at, date }
  }
  if (!best) return null
  return `${best.date.getUTCFullYear()}-${pad(best.date.getUTCMonth() + 1)}-${pad(best.date.getUTCDate())}`
}

/** A class starts at a piece followed by its time and its day. */
const startsClass = (pieces: string[], i: number, receivedLocalDate: string) =>
  time(pieces[i + 1]) !== null && day(pieces[i + 2], receivedLocalDate) !== null

/** The roster's listing and classes. `receivedLocalDate` is the studio's day it arrived, `YYYY-MM-DD`. */
export function parseClassPassRoster(
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

function localDateOf(at: Date, timezone: string): string {
  const p: Record<string, string> = {}
  for (const part of new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)) {
    p[part.type] = part.value
  }
  return `${p.year}-${p.month}-${p.day}`
}

/**
 * The differences between the rosters received in the last week and the
 * ClassPass bookings held on their classes. Where two rosters list the same
 * class, the later one is ClassPass's word on it.
 */
export async function checkClassPassRosters(tenantId: string): Promise<RosterCheck> {
  const tenant = await loadTenantById(tenantId)
  const timezone = tenant?.timezone ?? 'UTC'
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

  const differences: RosterDifference[] = []
  for (const { locationId, cls, startsAt, receivedAt } of latest.values()) {
    const match = await matchClass(tenantId, locationId, startsAt, cls.className)
    const classId = 'classId' in match ? match.classId : null
    const held = classId ? await heldOn(tenantId, classId) : []
    const base = { classId, className: cls.className, startsAt, rosterReceivedAt: receivedAt }

    const unmatched = [...held]
    for (const name of cls.members) {
      const at = unmatched.findIndex(b => b.names.has(sameName(name)))
      if (at >= 0) unmatched.splice(at, 1)
      else differences.push({ ...base, difference: 'on_classpass_not_on_roster', memberName: name, bookingId: null })
    }
    for (const b of unmatched) {
      // Booked after ClassPass wrote this roster: it could not have listed them.
      if (b.bookedAt > receivedAt) continue
      differences.push({ ...base, difference: 'on_roster_not_on_classpass', memberName: b.name, bookingId: b.id })
    }
  }
  differences.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.memberName.localeCompare(b.memberName))
  return {
    differences,
    unchecked: [...unchecked.values()].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()),
  }
}

/**
 * The ClassPass bookings held on a class, each with the names it may appear
 * under on a roster: the member's name here, and the name ClassPass gave in
 * the booking email.
 */
async function heldOn(tenantId: string, classId: string) {
  const rows = await db
    .select({ id: bookings.id, bookedAt: bookings.bookedAt, name: clients.name })
    .from(bookings)
    .innerJoin(clients, eq(clients.id, bookings.clientId))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.classId, classId),
        eq(bookings.source, 'classpass'),
        ne(bookings.state, 'cancelled'),
      ),
    )
  if (rows.length === 0) return []
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
  return rows.map(r => ({
    ...r,
    names: new Set([r.name, ...emailed.filter(e => e.bookingId === r.id).map(e => e.name)].filter((n): n is string => !!n).map(sameName)),
  }))
}
