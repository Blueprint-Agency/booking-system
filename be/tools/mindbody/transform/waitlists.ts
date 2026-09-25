import type { WaitlistRow } from './readers'
import { dayNumber, isoClock, isoDay, zonedToInstant, type CalendarDate, type ClockTime } from './values'

/**
 * The live waitlists: who is waiting for a seat on each class still to come,
 * in the order Mindbody's Class Sign In screen puts them (spec-waitlist.md §12a).
 *
 * Pure, like the rest of the mapper. Each waiting client becomes a `waiting`
 * entry on the class they wait for, joined the way a roster seat is
 * (`./schedule.ts`): date, start, class name and teacher, or the lone class on
 * at that minute under that name. Anything that cannot be placed is a
 * preflight line and no row, never a guess.
 *
 * Past promotions are not rebuilt: each one is already a booking the roster
 * brought across, and the only record of it is Contact Logs, which the
 * cutover does not download. Workshops have no waitlist in v1 (§12).
 */

type Row = Record<string, unknown>

/** A class the timetable import wrote, as much of it as a waitlist needs. */
export type WaitlistClass = { id: string; label: string; capacity: number; waitlist: number; date: CalendarDate; start: ClockTime }

export function mapWaitlists(input: {
  /** Null where the download has no Class Waitlists file. */
  waitlists: WaitlistRow[] | null
  asOf: Date
  timeZone: string
  tenantId: string
  id: (kind: string, key: string) => string
  /** Filled in with `waitlist_entries`: class and member → entry id. */
  ids: Record<string, Record<string, string>>
  memberNames: Map<string, string>
  /** The imported class a waiting row is for, joined as a roster row is; undefined where none came across. */
  classFor: (r: WaitlistRow) => WaitlistClass | undefined
  /** Whether the member already holds a seat on the class. */
  seated: (classId: string, clientId: string) => boolean
  /** Seats taken on a class by the bookings imported onto it. */
  booked: (classId: string) => number
  /** Whether the row is for a day of a workshop, which has no waitlist here. */
  isWorkshop: (r: WaitlistRow) => boolean
}): { entries: Row[]; notes: string[] } {
  const { asOf, memberNames } = input
  const notes: string[] = []
  const entries: Row[] = []
  const map = (input.ids.waitlist_entries ??= {})
  if (input.waitlists === null) {
    notes.push('waitlists: this download has no Class Waitlists file, so no waiting member came across — download it (`--profile cutover`) before the final transform')
    return { entries, notes }
  }
  notes.push(
    'waitlists: past waitlist promotions are not re-created as promoted entries — each promoted member is already an ordinary booking; ' +
      'Contact Logs, not downloaded, is their only record',
  )

  // Queue order within a class, whatever order the file was read in.
  const rows = [...input.waitlists].sort(
    (a, b) =>
      dayNumber(a.date) - dayNumber(b.date) ||
      isoClock(a.start).localeCompare(isoClock(b.start)) ||
      a.description.localeCompare(b.description) ||
      a.position - b.position,
  )
  const lines = new Map<string, { cls: WaitlistClass; waiting: { r: WaitlistRow }[] }>()
  const workshops = new Map<string, number>()
  for (const r of rows) {
    const label = `${r.description} on ${isoDay(r.date)} at ${isoClock(r.start)}`
    const who = `${r.clientId} ${memberNames.get(r.clientId) ?? r.client}`
    if (zonedToInstant({ ...r.date, ...r.start, second: 0 }, input.timeZone) <= asOf) {
      notes.push(`${who}: waiting on ${label}, which had started by the download — not imported`)
      continue
    }
    if (input.isWorkshop(r)) {
      workshops.set(label, (workshops.get(label) ?? 0) + 1)
      continue
    }
    if (!r.clientId) {
      notes.push(`${r.client || 'a client'}: waiting on ${label} with no Mindbody client id (a guest with no profile?) — not imported`)
      continue
    }
    if (!memberNames.has(r.clientId)) {
      notes.push(`${who}: waiting on ${label} and is not in the member list — not imported`)
      continue
    }
    const cls = input.classFor(r)
    if (!cls) {
      notes.push(`${who}: waiting on ${label}, which did not come across as a class — not imported`)
      continue
    }
    if (input.seated(cls.id, r.clientId)) {
      notes.push(`${who}: waiting on ${cls.label} and already Reserved on it — the seat came across, the waitlist place did not`)
      continue
    }
    const line = lines.get(cls.id) ?? { cls, waiting: [] }
    lines.set(cls.id, line)
    if (line.waiting.some(w => w.r.clientId === r.clientId)) {
      notes.push(`${who}: on the waitlist of ${cls.label} twice — one place was imported`)
      continue
    }
    line.waiting.push({ r })
  }
  for (const [label, n] of [...workshops].sort(([a], [b]) => a.localeCompare(b))) {
    notes.push(`waitlists: ${n} waiting on ${label}, a workshop day — workshop waitlists are not migrated; offer them a place by hand`)
  }

  for (const { cls, waiting } of lines.values()) {
    // No screen shows when a member joined. Their joins are placed in the
    // seconds before the download, head of the line earliest, so the order is
    // exactly Mindbody's and every entry predates the freeze: the last of a
    // line of L joined 1 s before `asOf`, the head L s before it.
    const last = Math.max(...waiting.map(w => w.r.position))
    for (const { r } of waiting) {
      const key = `${cls.id}/${r.clientId}`
      const row: Row = {
        id: input.id('waitlist-entry', key),
        tenant_id: input.tenantId,
        client_id: input.ids.clients![r.clientId],
        class_id: cls.id,
        status: 'waiting',
        joined_at: new Date(asOf.getTime() - (last + 1 - r.position) * 1000).toISOString(),
        resolved_at: null,
        booking_id: null,
        resolved_by: null,
      }
      entries.push(row)
      map[`${cls.label} / ${r.clientId}`] = row.id as string
    }
    if (waiting.length > cls.waitlist) {
      notes.push(
        `${cls.label}: ${waiting.length} waiting, more than its waitlist of ${cls.waitlist} — all came across; the size only stops new joins`,
      )
    }
    const free = cls.capacity - input.booked(cls.id)
    if (free > 0) {
      notes.push(
        `${cls.label}: ${waiting.length} waiting with ${free} seat(s) free — a freed seat promotes only on a cancel, so staff should Add to class from the waitlist`,
      )
    }
  }
  return { entries, notes }
}
