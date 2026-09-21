import type { BookingCoder } from './booking-codes'
import type { CatalogueEntry, StudioConfig } from './config'
import { fold, type ConfigLookups } from './lookups'
import { ptAppointmentRows, ptClients } from './pt'
import type {
  AttendanceRow,
  MemberListRow,
  OptionSaleRow,
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
  /** Staff who taught something in history and had no instructor profile yet. */
  instructors: Row[]
  /** What a person should look at: a class that could not be placed, a visit with no class, a purchase with no member. */
  notes: string[]
}

/** What Mindbody wrote in a visit's Status column, as the platform understands it. */
type Outcome = 'attended' | 'absent' | 'late_cancel' | 'early_cancel' | 'booked'

const ATTENDED = /^(signed in|attended|completed|checked in)\b/i
const ABSENT = /^(absent|no[ -]?show|unpaid)\b/i
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
  /** The pricing-option register: every option ever sold, for past purchases. */
  optionSales: OptionSaleRow[]
  members: MemberListRow[]
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
  const catalogueIds = { ...ids.class_packages, ...ids.pt_packages }

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
    const slot = packagesByOption.get(key) ?? []
    slot.push({ id: packageId, kind: String(row.kind), from: -Infinity, to: Infinity })
    packagesByOption.set(key, slot)
  }

  /**
   * A person's name as a key: its words, case-folded and sorted — the same fold
   * staff names use. A full stop goes with the commas, because that is what a
   * Mindbody record with no surname carries, and a member is not two people
   * depending on which report is writing them down.
   */
  const nameKey = (raw: string) => normaliseStaffName(raw.replace(/\./g, ' '))

  if (input.history.purchases) {
    const byName = new Map<string, MemberListRow[]>()
    for (const m of input.members) {
      const key = nameKey(`${m.firstName} ${m.lastName}`)
      const same = byName.get(key)
      if (same) same.push(m)
      else byName.set(key, [m])
    }
    const unmatched = new Map<string, number>()
    const unlisted = new Map<string, number>()
    const trialsPaidFor = new Map<string, number>()
    const taken = new Set<string>()

    // Oldest first, so the ids a rerun writes never depend on report order.
    const sales = [...input.optionSales].sort(
      (a, b) =>
        dayNumber(a.activation) - dayNumber(b.activation) ||
        a.client.localeCompare(b.client) ||
        a.option.localeCompare(b.option),
    )
    for (const sale of sales) {
      if (isoDay(sale.activation) < from) continue
      // Still live at the download, by the same test the live packages use
      // (`./catalogue.ts`): something left *and* not expired. Those already came
      // across as running packages. A purchase that is merely unexpired and
      // spent is not one of them, and would otherwise reach neither path.
      const left = sale.remaining !== null && (sale.remaining.unlimited || sale.remaining.count > 0)
      if (left && dayNumber(sale.expiration) >= dayNumber(today)) continue
      const optionKey = normaliseOptionName(sale.option)
      if (input.workshopOptions.has(optionKey)) continue
      const entry = entryOf.get(optionKey)
      if (!entry) {
        count(unlisted, sale.option)
        continue
      }
      if (entry.migrate === 'skip' || entry.kind === 'access_pass') continue
      // A member has one trial, ever — the platform holds them to it with a
      // unique key, and `./packages.ts` has already written the spent one for
      // anybody who used theirs. A second row for the same trial is the same
      // trial twice, so history does not write one; the money it took is named
      // instead, rather than quietly missing from Finance.
      if (entry.kind === 'trial') {
        if (sale.paid > 0) count(trialsPaidFor, `${sale.client} — ${sale.option}, ${money(sale.paid)}`)
        continue
      }

      const candidates = byName.get(nameKey(sale.client)) ?? []
      const digits = sale.phone.replace(/\D/g, '')
      const narrowed =
        candidates.length > 1 && digits ? candidates.filter(m => m.phone.replace(/\D/g, '') === digits) : candidates
      if (narrowed.length !== 1) {
        count(unmatched, `${sale.client} — ${sale.option}`)
        continue
      }
      const clientId = narrowed[0]!.id

      // One key per purchase. Two of one option activated on one day is a real
      // thing (a member buying two packs at the till), so the repeat is counted
      // rather than folded into the first and lost.
      let key = `past/${clientId}/${isoDay(sale.activation)}/${entry.name}`
      for (let n = 2; taken.has(key); n++) key = `past/${clientId}/${isoDay(sale.activation)}/${entry.name}#${n}`
      taken.add(key)

      const catalogueId = catalogueIds[entry.name] ?? null
      const length =
        entry.kind === 'unlimited'
          ? { duration_months: entry.durationMonths, validity_days: null }
          : { duration_months: null, validity_days: entry.validityDays }
      const row: Row = {
        id: id('client-package', key),
        tenant_id: tenantId,
        client_id: ids.clients![clientId],
        kind: entry.kind,
        source_class_package_id: entry.kind === 'pt' ? null : catalogueId,
        source_pt_package_id: entry.kind === 'pt' ? catalogueId : null,
        location_id: null,
        ...length,
        cross_location_paid_sgd: null,
        // Used up, which is why it is history rather than a live holding.
        credits_or_sessions_remaining: entry.kind === 'unlimited' ? null : 0,
        expires_at: endOfDay(sale.expiration),
        active: false,
        purchased_at: zonedToInstant(sale.activation, tz).toISOString(),
        amount_paid_sgd: money(sale.paid),
        list_price_sgd: money(Math.max(entry.priceSgd ?? 0, sale.paid)),
        purchase_id: null,
        complimentary: false,
      }
      clientPackages.push(row)
      ids.client_packages![key] = row.id as string

      const slot = optionSlot(clientId, entry)
      const held = packagesByOption.get(slot) ?? []
      held.push({ id: row.id as string, kind: entry.kind, from: dayNumber(sale.activation), to: dayNumber(sale.expiration) })
      packagesByOption.set(slot, held)
    }

    listed(unmatched, (w, n) => `history purchases: ${w} — ${n} purchase(s) match no member by name and phone, so they were not imported`)
    listed(unlisted, (w, n) => `history purchases: "${w}" was sold ${n} time(s) in the window and is in no catalogue entry, so it was not imported`)
    listed(
      trialsPaidFor,
      (w, n) =>
        `history purchases: ${w} — ${n} trial(s) a member has already come across holding, so the money is not in Finance; a member may hold only one trial ever`,
    )
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

  const payOf = new Map<string, number>()
  for (const p of input.payroll) {
    const key = `${isoDay(p.date)} ${isoClock(p.start)} ${normaliseStaffName(p.staff)}`
    payOf.set(key, (payOf.get(key) ?? 0) + p.earnings)
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
  }

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
    const room = lookups.rooms.get(fold(s.room))
    const teacherId = staffIds.get(staffKey)
    const location = room?.location ?? lookups.locations.get(fold(s.location)) ?? config.defaultLocation
    if (!type) count(unknownNames, s.description)
    if (!room && s.room && !lookups.offSite.has(fold(s.room))) count(unknownRooms, s.room)
    if (!teacherId) count(unknownTeachers, s.staff)
    // Only where the Room did not already answer it: a known Room in a Location
    // spelled some other way is not something a person has to look at.
    if (!room && !lookups.locations.has(fold(s.location))) count(unknownLocations, s.location)
    const capacity = type?.capacity ?? room?.capacity
    if (!type || !teacherId || !capacity) return

    const startsAt = instant(s.date, s.start)
    const end = s.end ? instant(s.date, s.end) : startsAt
    const endsAt = end > startsAt ? end : new Date(startsAt.getTime() + 3_600_000)
    teaches(teacherId)
    const earned = payOf.get(`${isoDay(s.date)} ${isoClock(s.start)} ${staffKey}`)
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
    }
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
  const sourceOf = (cancelledAt: Date) => (cancelledAt.getTime() >= capCycleStart ? 'admin' : 'client')

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
      // No report says when a seat was taken or given up; the session's own
      // start is the one moment the platform can stand behind.
      booked_at: at,
      cancelled_at: args.outcome === 'late_cancel' ? at : null,
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
        source: sourceOf(args.startsAt),
        // Late by definition, and nothing was given back for it.
        was_within_window: false,
        was_within_cap: true,
        refund_fired: false,
        cancelled_at: at,
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
    /** Client id → how their visit ended, and what paid for it. */
    clients: Map<string, { outcome: Exclude<Outcome, 'early_cancel'>; option: string }>
  }
  const appointments = new Map<string, Appointment>()

  /**
   * A member with two rows on one class — they cancelled late and booked
   * again — has one seat here, and it is the one that says what happened: the
   * visit they turned up for. So the strongest outcome sorts first and the rest
   * fall away behind it.
   */
  const strength = { attended: 0, booked: 1, absent: 2, late_cancel: 3, early_cancel: 4 } as const
  const visits = [...input.attendance].sort(
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
      if (!appointment.clients.has(v.clientId)) appointment.clients.set(v.clientId, { outcome, option: v.option })
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

  for (const cls of classes.values()) ids.classes[cls.label] = cls.id

  /* ── Past PT ───────────────────────────────────────────────────────────── */

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
    const [requester, partner, ...others] = [...a.clients.keys()].sort()
    for (const extra of others) {
      notes.push(`${extra} ${memberNames.get(extra)}: a third member on ${label} — a PT session here seats two, so this seat was not imported`)
    }

    const ptTypeId = input.ensurePtType()
    teaches(instructorId)
    const room = lookups.rooms.get(fold(a.room))
    const location = room?.location ?? lookups.locations.get(fold(a.location)) ?? config.defaultLocation
    const startsAt = instant(a.date, a.start)
    const end = a.end ? instant(a.date, a.end) : startsAt
    const endsAt = end > startsAt ? end : new Date(startsAt.getTime() + 3_600_000)
    const sessionId = id('pt-session', key)
    const mine = a.clients.get(requester!)!
    // The request is the requester's own story: they came, or they gave the
    // slot up after it was scheduled. Anything else is a slot the studio never
    // marked either way, which is still a scheduled session that has passed.
    const status =
      mine.outcome === 'attended' ? 'attended' : mine.outcome === 'late_cancel' ? 'cancelled_after_scheduled' : 'scheduled'

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
      // Settled when it happened, not at the download: it is the studio's past.
      settledAt: startsAt.toISOString(),
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

  return {
    classes: [...classes.values()].map(c => c.row),
    bookings,
    checkIns,
    cancellations,
    ptRequests,
    ptSessions,
    ptSessionClients,
    clientPackages,
    instructors: [...extraInstructors].sort().map(staffId => ({ staff_user_id: staffId, tenant_id: tenantId })),
    notes,
  }
}
