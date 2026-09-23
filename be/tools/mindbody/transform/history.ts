import type { BookingCoder } from './booking-codes'
import type { CatalogueEntry, StudioConfig } from './config'
import { fold, roomFor, type ConfigLookups } from './lookups'
import { ptAppointmentRows, ptClients } from './pt'
import { personKey } from './register'
import { pastPackages, type JoinedSales } from './sales'
import type {
  AttendanceRow,
  CancellationRow,
  GroupCancellationRow,
  PayrollRow,
  RosterRow,
  ScheduledClassRow,
} from './readers'
import {
  dayNumber,
  isoClock,
  isoDay,
  localDateOf,
  money,
  normaliseClassName,
  normaliseOptionName,
  normaliseStaffName,
  zonedToInstant,
  type CalendarDate,
  type ClockTime,
} from './values'

/**
 * The studio's past: the classes it held, who came, who did not, who cancelled
 * late, the PT it ran, and — if the studio asks for them — the packages members
 * bought and used up before launch.
 *
 * Optional, and bounded by a cutoff date in the config, because a rehearsal
 * wants to be quick and a launch wants to be complete. Pure, like the rest of
 * the mapper.
 *
 * Three reports meet here. The **staff schedule** says which classes were on,
 * including ones nobody booked; the **roster** adds any session the schedule
 * report does not reach, so a class with a member on it is never lost; and the
 * **attendance** report (Date view) says, per visit, who was booked and how it
 * ended — which is what a booking, a check-in and a cancellation are made from.
 * A fourth, the **payroll Detail** report, gives what the teacher was actually
 * paid, so historical Instructor Pay is real money rather than Unpriced.
 *
 * Nothing here is a hard failure. History is the part of a migration that a
 * studio can launch without: a class name nobody teaches any more, a room that
 * closed, a teacher left out of the config — each is a preflight line and its
 * classes stay behind, rather than a config error that stops the import.
 */

type Row = Record<string, unknown>

export type MappedHistory = {
  classes: Row[]
  bookings: Row[]
  checkIns: Row[]
  cancellations: Row[]
  ptRequests: Row[]
  ptSessions: Row[]
  ptSessionClients: Row[]
  /** Packages bought and used up before launch. Empty unless `history.purchases`. */
  clientPackages: Row[]
  /** A provider-less Purchase per past package that was returned, closed as refunded. Empty unless `history.purchases`. */
  purchases: Row[]
  /** Payroll that fits no class or PT session that came across: a workshop, a retreat share, a PT line with no session. */
  manualPayrollEntries: Row[]
  /** Staff who taught something in history and had no instructor profile yet. */
  instructors: Row[]
  /** What a person should look at: a class that could not be placed, a visit with no class, a purchase with no member. */
  notes: string[]
}

/** What Mindbody wrote in a visit's Status column, as the platform understands it. */
type Outcome = 'attended' | 'absent' | 'late_cancel' | 'early_cancel' | 'booked'

// Mindbody's "unpaid" is a visit nothing paid for, not one nobody came to:
// attended, and with no package (`UNPAID`).
const ATTENDED = /^(signed in|attended|completed|checked in|unpaid)\b/i
const ABSENT = /^(absent|no[ -]?show)\b/i
const UNPAID = /^unpaid\b/i
const LATE_CANCEL = /late\s*cancel/i
const EARLY_CANCEL = /cancel/i

function outcomeOf(status: string): Outcome {
  if (ATTENDED.test(status)) return 'attended'
  if (ABSENT.test(status)) return 'absent'
  if (LATE_CANCEL.test(status)) return 'late_cancel'
  // Every other cancellation is an early one, which the studio never charged
  // for and the platform never has to show.
  if (EARLY_CANCEL.test(status)) return 'early_cancel'
  // Booked and never marked: the studio did not take attendance that day. The
  // seat was real, so it comes across — as a seat, not as a visit.
  return 'booked'
}

/** What a booking looks like once it has ended that way. */
const SETTLEMENT = {
  attended: { state: 'confirmed', check_in_state: 'attended', refund_outcome: 'n_a' },
  absent: { state: 'no_show', check_in_state: 'no_show', refund_outcome: 'forfeited' },
  late_cancel: { state: 'cancelled', check_in_state: 'n_a', refund_outcome: 'forfeited' },
  booked: { state: 'confirmed', check_in_state: 'pending', refund_outcome: 'n_a' },
} as const

const DAY_MS = 86_400_000

export function mapHistory(input: {
  history: { from: string; purchases: boolean }
  schedule: ScheduledClassRow[]
  roster: RosterRow[]
  attendance: AttendanceRow[]
  payroll: PayrollRow[]
  /** When each booking was cancelled, and by whom. Empty where the report was not downloaded. */
  cancellations: CancellationRow[]
  /** The classes the studio called off. Empty where the report was not downloaded. */
  groupCancellations: GroupCancellationRow[]
  /** Every sale line, joined to what it became and what reversed it (`./sales.ts`), for past purchases. */
  sales: JoinedSales
  config: StudioConfig
  tenantId: string
  id: (kind: string, key: string) => string
  ids: Record<string, Record<string, string>>
  memberNames: Map<string, string>
  staffIds: Map<string, string>
  instructorIds: Set<string>
  ownerId: string
  lookups: ConfigLookups
  ensurePtType: () => string
  /** The live `client_packages` already mapped, so a past visit can point at the one that paid for it. */
  clientPackages: Row[]
  /** Live package id → the days its own purchase ran, where a holding was split into purchases. */
  packageRuns?: Map<string, { from: number; to: number }>
  /** The pricing options that buy a place on a workshop: never a package. */
  workshopOptions: Set<string>
  codes: BookingCoder
}): MappedHistory {
  const { config, tenantId, id, ids, memberNames, staffIds, lookups } = input
  const tz = config.studio.timezone
  const asOf = new Date(config.asOf)
  const today = localDateOf(asOf, tz)
  const instant = (d: CalendarDate, t: ClockTime) => zonedToInstant({ ...d, ...t, second: 0 }, tz)
  const endOfDay = (d: CalendarDate) => zonedToInstant({ ...d, hour: 23, minute: 59, second: 59 }, tz).toISOString()
  const notes: string[] = []
  const from = input.history.from
  /** Inside the window: on or after the cutoff, and already over at the download. */
  const inWindow = (d: CalendarDate, t: ClockTime) => isoDay(d) >= from && instant(d, t) <= asOf

  const count = (tally: Map<string, number>, key: string) => tally.set(key, (tally.get(key) ?? 0) + 1)
  const listed = (tally: Map<string, number>, say: (what: string, n: number) => string) =>
    [...tally].sort(([a], [b]) => a.localeCompare(b)).forEach(([what, n]) => notes.push(say(what, n)))

  const extraInstructors = new Set<string>()
  const teaches = (staffId: string) => {
    if (!input.instructorIds.has(staffId)) extraInstructors.add(staffId)
  }

  // A studio that asked for its past and did not download the two reports its
  // past is made of gets an empty timetable and no word about why. Said here
  // rather than refused, because either report on its own is still worth having.
  if (input.attendance.length === 0) {
    notes.push('history: no Attendance (Date) report was downloaded, so the past classes came across with nobody on them')
  }
  if (input.payroll.length === 0) {
    notes.push('history: no Payroll (Detail) report was downloaded, so every past class is Unpriced for an admin to settle')
  }

  /* ── Past purchases (opt-in) ───────────────────────────────────────────── */

  const entryOf = new Map<string, CatalogueEntry>()
  for (const e of config.catalogue) for (const s of e.mindbodyNames) entryOf.set(normaliseOptionName(s), e)

  const clientPackages: Row[] = []
  /**
   * A member's packages of one option: the one they still hold, with no dates
   * because it is the fallback, then every past purchase in the order they were
   * bought. `paidBy` reads it.
   */
  const packagesByOption = new Map<string, { id: string; kind: string; from: number; to: number }[]>()
  const optionSlot = (clientId: string, entry: CatalogueEntry) =>
    `${clientId}/${entry.migrate !== 'skip' && entry.kind === 'trial' ? 'trial' : entry.name}`

  const mappedById = new Map(input.clientPackages.map(p => [String(p.id), p]))
  for (const [key, packageId] of Object.entries(ids.client_packages ?? {})) {
    const row = mappedById.get(packageId)
    if (!row) continue
    // A holding split into its purchases is `…#2` after the first; each knows the days it ran.
    const slotKey = key.replace(/#\d+$/, '')
    const slot = packagesByOption.get(slotKey) ?? []
    const run = input.packageRuns?.get(packageId)
    slot.push({ id: packageId, kind: String(row.kind), from: run?.from ?? -Infinity, to: run?.to ?? Infinity })
    packagesByOption.set(slotKey, slot)
  }

  const purchases: Row[] = []
  if (input.history.purchases) {
    // Sale by sale, on the member whose id is on the sale (`./sales.ts`).
    const barcodeOf = new Map(Object.entries(ids.clients ?? {}).map(([barcode, clientId]) => [clientId, barcode]))
    const past = pastPackages({
      joined: input.sales,
      from,
      today,
      config,
      tenantId,
      id,
      ids,
      memberNames,
      lookups,
      workshopOptions: input.workshopOptions,
      hasTrial: new Set(input.clientPackages.filter(p => p.kind === 'trial').map(p => barcodeOf.get(String(p.client_id))!)),
    })
    clientPackages.push(...past.clientPackages)
    purchases.push(...past.purchases)
    notes.push(...past.notes)
    for (const s of past.slots) {
      const slot = optionSlot(s.clientId, s.entry)
      packagesByOption.set(slot, [...(packagesByOption.get(slot) ?? []), { id: s.id, kind: s.kind, from: s.from, to: s.to }])
    }
  }

  /**
   * The package a past visit was taken from: the member's holding of the option
   * the attendance report names, choosing one that covered the day where more
   * than one is known. Null where that option did not come across — a booking
   * pointing at the wrong package would be worse than one pointing at none.
   */
  const paidBy = (clientId: string, option: string, on: CalendarDate) => {
    const entry = entryOf.get(normaliseOptionName(option))
    if (!entry || entry.migrate === 'skip' || entry.kind === 'access_pass') return undefined
    const held = packagesByOption.get(optionSlot(clientId, entry))
    if (!held) return undefined
    const day = dayNumber(on)
    // A purchase whose own run covered the day answers it exactly; failing
    // that, the package the member still holds of that option, which is what
    // Mindbody would have spent. A purchase whose run did *not* cover the day
    // is no answer at all — the seat names no package rather than a guess.
    const dated = held.filter(h => Number.isFinite(h.from))
    return dated.find(h => day >= h.from && day <= h.to) ?? held.find(h => !Number.isFinite(h.from))
  }

  /* ── Past classes: the schedule report, and any session only the roster has ─ */

  type Class = {
    row: Row
    id: string
    date: CalendarDate
    start: ClockTime
    label: string
    capacity: number
    /** The class name as the report wrote it, for matching against a Group cancellation's cut-down one. */
    description: string
    /** Whether a payroll line paid for it: a class somebody was paid for ran. */
    paid: boolean
  }
  const classes = new Map<string, Class>()
  /** Every session already looked at, placed or not. */
  const placed = new Set<string>()
  const byTime = new Map<string, Class | null>()
  const workshopTimes = new Set<string>()
  const unknownNames = new Map<string, number>()
  const unknownRooms = new Map<string, number>()
  const unknownTeachers = new Map<string, number>()
  const unknownLocations = new Map<string, number>()

  const largestRoomAt = new Map<string, number>()
  for (const r of config.rooms) largestRoomAt.set(r.location, Math.max(largestRoomAt.get(r.location) ?? 0, r.capacity))
  const largestRoom = config.rooms.length ? Math.max(...config.rooms.map(r => r.capacity)) : undefined

  /**
   * What payroll paid, by date, time and teacher: the lines of one class (a
   * percentage-rate class has one per client) or one PT appointment add up.
   * Every key a class or a PT session takes is marked used, so what is left at
   * the end — a line at no set time, a class that did not come across — is
   * reported rather than lost from the studio's figures in silence.
   */
  const payOf = new Map<string, number>()
  const payKey = (d: CalendarDate, t: ClockTime, staff: string) => `${isoDay(d)} ${isoClock(t)} ${normaliseStaffName(staff)}`
  for (const p of input.payroll) {
    if (!p.start || isoDay(p.date) < from) continue
    const key = payKey(p.date, p.start, p.staff)
    payOf.set(key, (payOf.get(key) ?? 0) + p.earnings)
  }
  const payUsed = new Set<string>()
  const paid = (d: CalendarDate, t: ClockTime, staff: string) => {
    const key = payKey(d, t, staff)
    const amount = payOf.get(key)
    if (amount !== undefined) payUsed.add(key)
    return amount
  }

  /** One session that ran, from whichever report reached it. */
  type Session = {
    date: CalendarDate
    start: ClockTime
    end: ClockTime | null
    description: string
    staff: string
    room: string
    location: string
    /** The schedule report's `***`: `staff` is the substitute who taught it. */
    substitute?: boolean
  }
  /**
   * Classes a substitute taught. The class already names the teacher who taught
   * it; the platform has no field to say a substitute stood in, so they are counted.
   */
  let substituted = 0

  const place = (s: Session): void => {
    const name = normaliseClassName(s.description)
    const timeKey = `${isoDay(s.date)} ${isoClock(s.start)} ${name}`
    if (lookups.ptNames.has(name)) return
    const staffKey = normaliseStaffName(s.staff)
    const key = `${timeKey} ${staffKey}`
    // Once per session, however many reports reached it — including one that
    // could not be placed, or its preflight line would be counted twice.
    if (placed.has(key)) return
    placed.add(key)

    const type = lookups.types.get(name)
    const room = roomFor(lookups, s.room, type?.id)
    const teacherId = staffIds.get(staffKey)
    const location = room?.location ?? lookups.locations.get(fold(s.location)) ?? config.defaultLocation
    if (!type) count(unknownNames, s.description)
    if (!room && s.room && !lookups.offSite.has(fold(s.room))) count(unknownRooms, s.room)
    if (!teacherId) count(unknownTeachers, s.staff)
    // Only where the Room did not already answer it: a known Room in a Location
    // spelled some other way is not something a person has to look at.
    if (!room && !lookups.locations.has(fold(s.location))) count(unknownLocations, s.location)
    // A class that has been and gone with no Room behind it (Mindbody left the
    // room blank, or it was held off-site) and no capacity of its own still ran:
    // it is sized like the largest Room of its Location, so it and its visits
    // are kept. Seats on the past are not sold, so the figure only has to hold them.
    const capacity = type?.capacity ?? room?.capacity ?? largestRoomAt.get(location) ?? largestRoom
    if (!type || !teacherId || !capacity) return

    const startsAt = instant(s.date, s.start)
    const end = s.end ? instant(s.date, s.end) : startsAt
    const endsAt = end > startsAt ? end : new Date(startsAt.getTime() + 3_600_000)
    teaches(teacherId)
    const earned = paid(s.date, s.start, s.staff)
    const row: Row = {
      id: id('class', key),
      tenant_id: tenantId,
      class_type_id: type.id,
      main_instructor_id: teacherId,
      location_id: ids.locations![location],
      room_id: room?.id ?? null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      capacity_online: capacity,
      capacity_waitlist: 0,
      capacity_buffer: 0,
      credit_cost: 1,
      // What payroll actually paid for it, so Finance's historical Instructor
      // Pay is the studio's own figure and not a rate applied after the fact.
      instructor_pay_sgd: earned === undefined ? null : money(earned),
      lifecycle: 'active',
      cancelled_at: null,
      cancelled_by_staff_id: null,
      series_id: null,
      created_at: asOf.toISOString(),
      created_by_staff_id: input.ownerId,
    }
    const cls: Class = {
      row,
      id: row.id as string,
      date: s.date,
      start: s.start,
      label: `${s.description} on ${isoDay(s.date)} at ${isoClock(s.start)}`,
      capacity,
      description: s.description,
      paid: earned !== undefined,
    }
    if (s.substitute) substituted++
    classes.set(key, cls)
    byTime.set(timeKey, byTime.has(timeKey) ? null : cls)
  }

  for (const r of input.schedule) {
    if (!inWindow(r.date, r.start)) continue
    const timeKey = `${isoDay(r.date)} ${isoClock(r.start)} ${normaliseClassName(r.description)}`
    if (lookups.workshopCategories.has(fold(r.serviceCategory))) {
      workshopTimes.add(timeKey)
      continue
    }
    place(r)
  }

  // Anything the roster knows ran and the schedule report did not reach: the
  // download's schedule range may start later than the cutoff, and a class with
  // a member on it must not be lost to that.
  const rostered = [...input.roster].sort(
    (a, b) => dayNumber(a.date) - dayNumber(b.date) || isoClock(a.start).localeCompare(isoClock(b.start)) || a.clientId.localeCompare(b.clientId),
  )
  for (const r of rostered) {
    if (!inWindow(r.date, r.start)) continue
    const timeKey = `${isoDay(r.date)} ${isoClock(r.start)} ${normaliseClassName(r.description)}`
    if (workshopTimes.has(timeKey) || byTime.has(timeKey)) continue
    place(r)
  }

  listed(unknownNames, (w, n) => `history: "${w}" ran ${n} time(s) in the window and is in no Class Type, so those classes stayed behind`)
  listed(unknownRooms, (w, n) => `history: "${w}" held ${n} past class(es) and is neither a Room nor an off-site venue`)
  listed(
    unknownTeachers,
    (w, n) => `history: ${w} taught ${n} past class(es) and is not coming across — migrate them as archived staff to keep that history`,
  )
  listed(unknownLocations, (w, n) => `history: "${w}" held ${n} past class(es) and no Location is called that — they were filed under ${config.defaultLocation}`)
  if (substituted > 0) {
    notes.push(
      `history: ${substituted} past class(es) were taught by a substitute (*** in Mindbody); each names the teacher who taught it, and the platform has no field to mark the substitution`,
    )
  }

  /* ── Past bookings, check-ins and late cancels ─────────────────────────── */

  ids.classes ??= {}
  ids.bookings ??= {}
  const bookings: Row[] = []
  const checkIns: Row[] = []
  const cancellations: Row[] = []
  const seated = new Map<string, Set<string>>()
  const unplaced = new Map<string, number>()
  /** Seats on a class that has been and gone that the studio never marked either way. */
  const unmarked = new Map<string, number>()

  /**
   * A late cancel inside the current cap cycle is written as the *studio's*
   * cancellation, not the member's.
   *
   * The platform counts a member's client-sourced cancellations over a rolling
   * cycle to cap them. Imported history would land inside that cycle and spend
   * an allowance the member never spent here, so launch day would begin with
   * someone already over the cap for something they did in Mindbody.
   */
  const capCycleStart = asOf.getTime() - config.policy.cancelCapCycleDays * DAY_MS
  const sourceOf = (cancelledAt: Date, by: 'client' | 'admin') => (cancelledAt.getTime() >= capCycleStart ? 'admin' : by)

  /**
   * When each late cancel really happened, and who did it, from the
   * Cancellations report — joined on the member's name and the class's start,
   * because that report has no client id. Where it has no line (or was not
   * downloaded) the cancel is dated at the class's start, as before. The member
   * themselves, or ClassPass on their behalf, is `client`; anyone else — a
   * member of staff, a front-desk login — is the studio's, `admin`.
   */
  const lateCancels = new Map<string, { at: Date; by: 'client' | 'admin'; staffId: string | null }>()
  for (const c of input.cancellations) {
    if (c.method !== 'late' || !c.start) continue
    const key = `${personKey(c.client)} ${instant(c.date, c.start).toISOString()}`
    const self = personKey(c.cancelledBy) === personKey(c.client) || /^client$/i.test(c.cancelledBy) || /classpass/i.test(c.cancelledBy)
    const by: 'client' | 'admin' = self ? 'client' : 'admin'
    const at = zonedToInstant(c.cancelledAt, tz)
    const had = lateCancels.get(key)
    // Cancelled, rebooked and cancelled again: the last one is the one that stands.
    if (!had || had.at < at) lateCancels.set(key, { at, by, staffId: self ? null : (staffIds.get(normaliseStaffName(c.cancelledBy)) ?? null) })
  }
  const lateCancelOf = (clientId: string, startsAt: Date) => lateCancels.get(`${personKey(memberNames.get(clientId) ?? '')} ${startsAt.toISOString()}`)
  let cancelTimesFound = 0

  /**
   * What the roster says of each visit, by day, time and member. The attendance
   * report says a visit ended in a late cancel or a no-show; for anything else
   * the roster's Status is what tells a visit the studio marked from a seat
   * nobody ever marked (the report's own rows on the day of the download).
   */
  const rosterStatus = new Map<string, string>()
  for (const r of input.roster) if (r.status) rosterStatus.set(`${isoDay(r.date)} ${isoClock(r.start)} ${r.clientId}`, r.status)
  const statusOf = (v: AttendanceRow) =>
    v.fromFlags && outcomeOf(v.status) === 'attended'
      ? (rosterStatus.get(`${isoDay(v.date)} ${isoClock(v.start)} ${v.clientId}`) ?? v.status)
      : v.status

  const settle = (args: {
    key: string
    clientId: string
    outcome: Exclude<Outcome, 'early_cancel'>
    kind: 'class' | 'pt'
    target: Row
    option: string
    on: CalendarDate
    startsAt: Date
  }) => {
    const pkg = paidBy(args.clientId, args.option, args.on)
    const made = input.codes(args.key)
    const settlement = SETTLEMENT[args.outcome]
    const at = args.startsAt.toISOString()
    const cancel = args.outcome === 'late_cancel' ? lateCancelOf(args.clientId, args.startsAt) : undefined
    if (cancel) cancelTimesFound++
    const cancelledAt = cancel ? cancel.at.toISOString() : at
    // A seat cannot be given up before it was taken: where the cancel came
    // before the class (it always does), the booking is dated no later than it.
    const bookedAt = cancelledAt < at ? cancelledAt : at
    const row: Row = {
      id: id('booking', args.key),
      tenant_id: tenantId,
      client_id: ids.clients![args.clientId],
      kind: args.kind,
      class_id: null,
      pt_session_id: null,
      ...args.target,
      client_package_id: pkg?.id ?? null,
      state: settlement.state,
      credits_or_sessions_used: pkg && pkg.kind !== 'unlimited' ? 1 : 0,
      refund_outcome: settlement.refund_outcome,
      check_in_state: settlement.check_in_state,
      qr_token: made.qrToken,
      code: made.code,
      // No report says when a seat was taken; the session's own start is the one
      // moment the platform can stand behind (or the cancel, where that came first).
      booked_at: bookedAt,
      cancelled_at: args.outcome === 'late_cancel' ? cancelledAt : null,
    }
    bookings.push(row)
    ids.bookings![args.key] = row.id as string

    if (args.outcome === 'attended') {
      checkIns.push({
        id: id('check-in', args.key),
        tenant_id: tenantId,
        booking_id: row.id,
        checked_in_at: at,
        checked_in_by_staff_id: input.ownerId,
        // Nobody scanned a code in Mindbody: the studio marked them present.
        method: 'manual',
      })
    }
    if (args.outcome === 'late_cancel') {
      cancellations.push({
        id: id('cancellation', args.key),
        tenant_id: tenantId,
        booking_id: row.id,
        client_id: ids.clients![args.clientId],
        kind: args.kind,
        source: sourceOf(new Date(cancelledAt), cancel?.by ?? 'client'),
        // Late by definition, and nothing was given back for it.
        was_within_window: false,
        was_within_cap: true,
        refund_fired: false,
        cancelled_at: cancelledAt,
      })
    }
  }

  type Appointment = {
    date: CalendarDate
    start: ClockTime
    end: ClockTime | null
    staff: string
    location: string
    room: string
    /** Client id → how their visit ended, what paid for it, and whether it counted towards the trainer's pay. */
    clients: Map<string, { outcome: Exclude<Outcome, 'early_cancel'>; option: string; staffPaid: boolean | null }>
  }
  const appointments = new Map<string, Appointment>()

  /**
   * A member with two rows on one class — they cancelled late and booked
   * again — has one seat here, and it is the one that says what happened: the
   * visit they turned up for. So the strongest outcome sorts first and the rest
   * fall away behind it.
   */
  const strength = { attended: 0, booked: 1, absent: 2, late_cancel: 3, early_cancel: 4 } as const
  const visits = input.attendance
    .map(v => {
      const status = statusOf(v)
      // Nothing paid for it, so it names no package, whatever option the report wrote.
      return UNPAID.test(status) ? { ...v, status, option: '' } : { ...v, status }
    })
    .sort(
      (a, b) =>
        dayNumber(a.date) - dayNumber(b.date) ||
        isoClock(a.start).localeCompare(isoClock(b.start)) ||
        a.clientId.localeCompare(b.clientId) ||
        strength[outcomeOf(a.status)] - strength[outcomeOf(b.status)],
    )
  for (const v of visits) {
    if (!inWindow(v.date, v.start)) continue
    const outcome = outcomeOf(v.status)
    // An early cancellation is a booking the studio never kept and the member
    // was never charged for. It is not history; it is a thing that did not happen.
    if (outcome === 'early_cancel') continue
    const name = normaliseClassName(v.description)
    const timeKey = `${isoDay(v.date)} ${isoClock(v.start)} ${name}`
    const label = `${v.description} on ${isoDay(v.date)} at ${isoClock(v.start)}`
    if (!memberNames.has(v.clientId)) {
      notes.push(`${v.clientId}: has history on ${label} and is not in the member list`)
      continue
    }

    if (lookups.ptNames.has(name)) {
      const key = `${isoDay(v.date)} ${isoClock(v.start)} ${normaliseStaffName(v.staff)}`
      const appointment = appointments.get(key) ?? {
        date: v.date,
        start: v.start,
        end: v.end,
        staff: v.staff,
        location: v.location,
        room: v.room,
        clients: new Map(),
      }
      if (!appointment.clients.has(v.clientId)) {
        appointment.clients.set(v.clientId, { outcome, option: v.option, staffPaid: v.staffPaid ?? null })
      }
      appointments.set(key, appointment)
      continue
    }

    const cls = classes.get(`${timeKey} ${normaliseStaffName(v.staff)}`) ?? byTime.get(timeKey)
    if (!cls) {
      if (!workshopTimes.has(timeKey)) count(unplaced, label)
      continue
    }
    const seats = seated.get(cls.id) ?? new Set<string>()
    seated.set(cls.id, seats)
    if (seats.has(v.clientId)) continue
    seats.add(v.clientId)
    if (outcome === 'booked') count(unmarked, v.status || '(blank)')
    settle({
      key: `${cls.id}/${v.clientId}`,
      clientId: v.clientId,
      outcome,
      kind: 'class',
      target: { class_id: cls.id },
      option: v.option,
      on: cls.date,
      startsAt: instant(cls.date, cls.start),
    })
  }
  listed(unplaced, (w, n) => `history: ${n} visit(s) on ${w}, which is not among the classes that came across`)
  // The seat was real and comes across, but nobody was ever marked present or
  // absent on it — so it counts towards bookings and towards nothing else.
  listed(
    unmarked,
    (w, n) => `history: ${n} seat(s) on a class that has been and gone are still "${w}" in Mindbody, so they came across booked and never checked in`,
  )

  /* ── Past classes the studio called off ────────────────────────────────── */

  /**
   * A class in the timetable that nobody came to, cancelled or not, and that
   * payroll paid nobody for, is one of two things: a class that ran empty, or
   * one the studio called off. The Group cancellations report tells them apart —
   * a block per class called off, with the members it sent home — so a class it
   * names is cancelled, as the portal cancels one: at the time it was called
   * off, by the member of staff who did it where they are coming across. A
   * class the report names that did have a visit or a payroll line ran, and
   * stays as it is.
   */
  const calledOff = new Map<string, { name: string; at: Date; by: string }[]>()
  for (const g of input.groupCancellations) {
    if (!g.start) continue
    const key = `${isoDay(g.date)} ${isoClock(g.start)}`
    const at = zonedToInstant(g.cancelledAt, tz)
    const name = normaliseClassName(g.description)
    const same = (calledOff.get(key) ?? []).find(c => c.name === name)
    if (same) {
      if (at < same.at) Object.assign(same, { at, by: g.cancelledBy })
    } else calledOff.set(key, [...(calledOff.get(key) ?? []), { name, at, by: g.cancelledBy }])
  }
  let cancelledClasses = 0
  let emptyClasses = 0
  for (const cls of classes.values()) {
    if (cls.paid || seated.has(cls.id)) continue
    const name = normaliseClassName(cls.description)
    // Mindbody cuts the class name in this report to 14 characters.
    const off = calledOff.get(`${isoDay(cls.date)} ${isoClock(cls.start)}`)?.find(c => c.name && name.startsWith(c.name))
    if (!off) {
      emptyClasses++
      continue
    }
    cancelledClasses++
    Object.assign(cls.row, {
      lifecycle: 'cancelled',
      cancelled_at: off.at.toISOString(),
      cancelled_by_staff_id: staffIds.get(normaliseStaffName(off.by)) ?? null,
    })
  }
  if (cancelledClasses > 0) {
    notes.push(`history: ${cancelledClasses} past class(es) the studio called off (Group cancellations) came across cancelled`)
  }
  if (emptyClasses > 0) {
    notes.push(
      `history: ${emptyClasses} past class(es) had nobody on them, no payroll line and no group cancellation, so they came across as classes that ran — and Unpriced`,
    )
  }

  for (const cls of classes.values()) ids.classes[cls.label] = cls.id

  /* ── Past PT ───────────────────────────────────────────────────────────── */

  /**
   * The roster's line for each appointment, one per member on it: the
   * attendance report has no Room, and its flagged form no end time, no notes
   * and nobody who booked it — the roster has all four.
   */
  const rosterPt = new Map<string, RosterRow[]>()
  for (const r of input.roster) {
    if (!lookups.ptNames.has(normaliseClassName(r.description))) continue
    const key = `${isoDay(r.date)} ${isoClock(r.start)} ${normaliseStaffName(r.staff)}`
    rosterPt.set(key, [...(rosterPt.get(key) ?? []), r])
  }
  const rosterPtRoom = (key: string) => rosterPt.get(key)?.find(r => r.room)?.room
  let ptRoomsFilled = 0
  let ptHourGuessed = 0
  let ptPaidButCancelled = 0
  /** Past PT the owner is recorded as booking, by who Mindbody says booked it. */
  const bookedByOwner = new Map<string, number>()
  let bookerUnknown = 0
  const ptRequests: Row[] = []
  const ptSessions: Row[] = []
  const ptSessionClients: Row[] = []
  ids.pt_sessions ??= {}

  for (const key of [...appointments.keys()].sort()) {
    const a = appointments.get(key)!
    const label = `PT on ${isoDay(a.date)} at ${isoClock(a.start)} with ${a.staff}`
    const instructorId = staffIds.get(normaliseStaffName(a.staff))
    if (!instructorId) {
      notes.push(`history: ${a.staff} took ${label} and is not coming across, so it stayed behind`)
      continue
    }
    // The requester is whoever's visit says most about the session — the one who
    // came, before one who did not — so the request and the session tell the
    // same story. Only where every member late-cancelled is the session cancelled.
    const [requester, partner, ...others] = [...a.clients.keys()].sort(
      (x, y) => strength[a.clients.get(x)!.outcome] - strength[a.clients.get(y)!.outcome] || x.localeCompare(y),
    )
    for (const extra of others) {
      notes.push(`${extra} ${memberNames.get(extra)}: a third member on ${label} — a PT session here seats two, so this seat was not imported`)
    }

    const ptTypeId = input.ensurePtType()
    teaches(instructorId)
    const lines = rosterPt.get(key) ?? []
    const line = lines.find(r => r.clientId === requester) ?? lines[0]
    const room = roomFor(lookups, a.room || rosterPtRoom(key) || '', ptTypeId)
    if (room) ptRoomsFilled++
    const location = room?.location ?? lookups.locations.get(fold(a.location)) ?? config.defaultLocation
    const startsAt = instant(a.date, a.start)
    const pay = paid(a.date, a.start, a.staff)
    // The roster's end is the appointment as booked; an hour only where no report has one.
    const endClock = lines.find(r => r.end)?.end ?? a.end
    const end = endClock ? instant(a.date, endClock) : startsAt
    const endsAt = end > startsAt ? end : new Date(startsAt.getTime() + 3_600_000)
    if (end <= startsAt) ptHourGuessed++
    const sessionId = id('pt-session', key)
    const mine = a.clients.get(requester!)!
    // The request is the requester's own story, ending where the platform's
    // own would: `attended` once the session is over — a no-show too, whose
    // booking is what says nobody came, so the end-of-session job has nothing
    // left to move — or cancelled after it was scheduled. A slot the studio
    // never marked either way is still a scheduled session that has passed.
    const status =
      mine.outcome === 'attended' || mine.outcome === 'absent'
        ? 'attended'
        : mine.outcome === 'late_cancel'
          ? 'cancelled_after_scheduled'
          : 'scheduled'
    const cancel = mine.outcome === 'late_cancel' ? lateCancelOf(requester!, startsAt) : undefined
    if (mine.outcome === 'late_cancel' && pay !== undefined) ptPaidButCancelled++

    // Who booked it: a member of staff coming across, or else the owner, counted.
    const booker = line ? staffIds.get(normaliseStaffName(line.scheduledBy)) : undefined
    if (!line) bookerUnknown++
    else if (!booker) count(bookedByOwner, line.scheduledBy || '(blank)')

    const rows = ptAppointmentRows({
      tenantId,
      requestId: id('pt-request', key),
      sessionId,
      requesterId: ids.clients![requester!]!,
      partnerId: partner ? ids.clients![partner]! : null,
      classTypeId: ptTypeId,
      locationId: ids.locations![location]!,
      roomId: room?.id ?? null,
      instructorId,
      startsAt,
      endsAt,
      status,
      debitedClientPackageId: paidBy(requester!, mine.option, a.date)?.id ?? null,
      ownerId: input.ownerId,
      scheduledById: booker ?? null,
      // Settled when it happened, not at the download: it is the studio's past.
      settledAt: startsAt.toISOString(),
      // No payroll line, and Mindbody marked every visit on it as not counting
      // towards the trainer's pay (an unpaid no-show): the trainer was paid
      // nothing, which is $0 and not something for an admin to price.
      instructorPaySgd:
        pay !== undefined ? money(pay) : [...a.clients.values()].every(v => v.staffPaid === false) ? money(0) : null,
      message: line?.notes,
      twoPerson: [...a.clients.values()].some(c => {
        const entry = entryOf.get(normaliseOptionName(c.option))
        return entry !== undefined && entry.migrate !== 'skip' && entry.kind === 'pt' && entry.sessionType === '2on1'
      }),
      cancelled:
        mine.outcome === 'late_cancel'
          ? { at: (cancel?.at ?? startsAt).toISOString(), byStaffId: cancel?.staffId ?? null }
          : null,
    })
    ptRequests.push(rows.request)
    ptSessions.push(rows.session)
    ptSessionClients.push(...rows.sessionClients)
    ids.pt_sessions[key] = sessionId

    for (const clientId of ptClients({ requesterId: requester!, partnerId: partner ?? null })) {
      const visit = a.clients.get(clientId)!
      settle({
        key: `${sessionId}/${clientId}`,
        clientId,
        outcome: visit.outcome,
        kind: 'pt',
        target: { pt_session_id: sessionId },
        option: visit.option,
        on: a.date,
        startsAt,
      })
    }
  }
  const ptRoomless = [...appointments.keys()].filter(k => rosterPtRoom(k) && !lookups.rooms.has(fold(rosterPtRoom(k)!)))
  if (ptRoomless.length > 0) {
    const spellings = [...new Set(ptRoomless.map(k => rosterPtRoom(k)!))].sort().join('", "')
    notes.push(`history: ${ptRoomless.length} past PT session(s) were held in "${spellings}", which is no Room, so they came across with none (${ptRoomsFilled} got theirs from the roster)`)
  }
  if (ptHourGuessed > 0) {
    notes.push(`history: ${ptHourGuessed} past PT session(s) have no end time in the roster or the attendance report, so they are one hour long`)
  }
  if (ptPaidButCancelled > 0) {
    notes.push(
      `history: ${ptPaidButCancelled} late-cancelled past PT session(s) were paid for in payroll; they came across cancelled, so that pay is not in Finance's Instructor Pay`,
    )
  }
  listed(
    bookedByOwner,
    (w, n) => `history: ${n} past PT session(s) were booked by "${w}", who is not staff coming across, so the owner is recorded as scheduling them`,
  )
  if (bookerUnknown > 0) {
    notes.push(`history: ${bookerUnknown} past PT session(s) have no roster line to say who booked them, so the owner is recorded as scheduling them`)
  }

  if (cancellations.length > 0) {
    notes.push(
      input.cancellations.length === 0
        ? `history: no Cancellations report was downloaded, so the ${cancellations.length} late cancel(s) are dated at the class's start`
        : `history: ${cancelTimesFound} of ${cancellations.length} late cancel(s) carry their real time from the Cancellations report; the rest are dated at the class's start`,
    )
  }

  /* ── Payroll that found nothing to belong to: Manual Payroll Entries ───── */

  /**
   * A payroll line no class or PT session took — a workshop's per-client lines,
   * a retreat's revenue share at no set time, a PT line with no session — is
   * still money the studio paid, so it becomes a Manual Payroll Entry for the
   * teacher on its own date: that is what keeps Finance's historical Instructor
   * Pay equal to Mindbody's Payroll total. The lines of one class, or one
   * appointment, on one rate are one entry, as they are one payment.
   */
  type Entry = { staffId: string; date: CalendarDate; start: ClockTime | null; label: string; amount: number }
  const entries = new Map<string, Entry>()
  const notComing = new Map<string, number>()
  let payrollTotal = 0
  let payrollPlaced = 0
  for (const p of input.payroll) {
    if (isoDay(p.date) < from) continue
    payrollTotal += p.earnings
    if (p.start && payUsed.has(payKey(p.date, p.start, p.staff))) {
      payrollPlaced += p.earnings
      continue
    }
    const staffId = staffIds.get(normaliseStaffName(p.staff))
    if (!staffId) {
      notComing.set(p.staff, (notComing.get(p.staff) ?? 0) + p.earnings)
      continue
    }
    const kind = p.table === 'appointment' ? 'PT appointment' : p.table === 'class_per_client' ? 'class paid per client' : 'class'
    const when = p.start ? ` at ${isoClock(p.start)}` : ', no set time'
    const rate = p.rate ? ` (${p.rate.name}${p.rate.percent === null ? '' : ` ${p.rate.percent}%`})` : ''
    const label = `Mindbody payroll: ${p.description || kind}${when}${rate}`
    const key = `${staffId} ${isoDay(p.date)} ${p.start ? isoClock(p.start) : 'TBD'} ${label}`
    const entry = entries.get(key) ?? { staffId, date: p.date, start: p.start, label, amount: 0 }
    entry.amount += p.earnings
    entries.set(key, entry)
  }

  ids.manual_payroll_entries ??= {}
  const manualPayrollEntries: Row[] = []
  let payrollManual = 0
  for (const [key, e] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    const amount = Math.round(e.amount * 100) / 100
    if (amount === 0) continue
    teaches(e.staffId)
    const row: Row = {
      id: id('manual-payroll-entry', key),
      tenant_id: tenantId,
      instructor_id: e.staffId,
      amount_sgd: money(amount),
      label: e.label,
      // At its own time, or — a line at no set time — the start of its day.
      entry_date: (e.start ? instant(e.date, e.start) : zonedToInstant({ ...e.date, hour: 0, minute: 0, second: 0 }, tz)).toISOString(),
      created_by_staff_id: input.ownerId,
      created_at: asOf.toISOString(),
    }
    manualPayrollEntries.push(row)
    ids.manual_payroll_entries[key] = row.id as string
    payrollManual += amount
    // Kept, or the totals would not be Mindbody's; but the portal edits an entry only at 0 or more.
    if (amount < 0) {
      notes.push(`history payroll: "${e.label}" on ${isoDay(e.date)} nets to ${money(amount)} (a reversal) — imported as it is; the portal cannot edit a negative entry`)
    }
  }

  if (input.payroll.length > 0) {
    // To the cent, and never "-0.00": thousands of lines in floating point leave dust behind.
    const cents = (n: number) => money(Math.round(n * 100) / 100 + 0)
    notes.push(
      `history payroll: ${cents(payrollTotal)} paid from ${from}; ${cents(payrollPlaced)} is on the classes and PT sessions that came across, ` +
        `${cents(payrollManual)} on ${manualPayrollEntries.length} Manual Payroll Entries, ${cents(payrollTotal - payrollPlaced - payrollManual)} is not`,
    )
    for (const [staff, amount] of [...notComing].sort(([a], [b]) => a.localeCompare(b))) {
      if (amount !== 0) notes.push(`history payroll: ${money(amount)} ${staff} — is not coming across, so it was not imported`)
    }
  }

  return {
    classes: [...classes.values()].map(c => c.row),
    bookings,
    checkIns,
    cancellations,
    ptRequests,
    ptSessions,
    ptSessionClients,
    clientPackages,
    purchases,
    manualPayrollEntries,
    instructors: [...extraInstructors].sort().map(staffId => ({ staff_user_id: staffId, tenant_id: tenantId })),
    notes,
  }
}
