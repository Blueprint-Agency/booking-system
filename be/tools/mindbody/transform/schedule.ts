import type { BookingCoder } from './booking-codes'
import { ConfigError, type StudioConfig } from './config'
import { fold, roomFor, type ConfigLookups } from './lookups'
import { ptAppointmentRows, ptClients, ptRates } from './pt'
import type { HoldingRow, PayRateRow, PayrollRow, RosterRow, ScheduledClassRow } from './readers'
import {
  dayNumber,
  isoClock,
  isoDay,
  isoWeekday,
  money,
  normaliseClassName,
  normaliseOptionName,
  normaliseStaffName,
  zonedToInstant,
  type CalendarDate,
  type ClockTime,
} from './values'

/**
 * The timetable still to come, and the seats members already hold on it.
 *
 * Pure, like the rest of the mapper. Classes come from the all-teachers staff
 * schedule — the one report that lists a class nobody has booked yet — and the
 * bookings from the roster over future dates, joined on date, start time, class
 * name and teacher. A roster row under a PT appointment name is no class: it is
 * a PT session, written the way the portal writes one it has scheduled.
 *
 * A booking spends nothing here. Its credit was spent in Mindbody, which is why
 * the package it points at arrives with the report's *unbooked* balance
 * (`./packages.ts`); it carries the 1 it cost so that cancelling returns it.
 */

type Row = Record<string, unknown>

export type MappedSchedule = {
  /** Staff who lead something imported and had no instructor profile yet. */
  instructors: Row[]
  classSeries: Row[]
  classes: Row[]
  ptRequests: Row[]
  ptSessions: Row[]
  ptSessionClients: Row[]
  bookings: Row[]
  /** What a person should look at: a booking with no class, a class over its capacity, a series with nothing to link. */
  notes: string[]
}

export function mapSchedule(input: {
  schedule: ScheduledClassRow[]
  roster: RosterRow[]
  payRates: PayRateRow[]
  /** What each teacher was paid, and on what rate: where a future PT session's rate comes from. */
  payroll: PayrollRow[]
  config: StudioConfig
  tenantId: string
  id: (kind: string, key: string) => string
  /** What the config calls Rooms, Locations, Class Types and the rest (`./lookups.ts`). */
  lookups: ConfigLookups
  /** The PT Class Type's id, making it if neither this nor the history import has yet. */
  ensurePtType: () => string
  /** Mindbody key → platform id. Read for Locations, Rooms, Class Types and members; filled in for what is written here. */
  ids: Record<string, Record<string, string>>
  memberNames: Map<string, string>
  /** Every staff member coming across, by normalised name. */
  staffIds: Map<string, string>
  /** Those of them who already have an instructor profile. */
  instructorIds: Set<string>
  ownerId: string
  /** The `client_packages` rows already mapped: a booking is paid by the member's running one, or the one waiting behind it. */
  clientPackages: Row[]
  /** What members hold in Mindbody, to say whether a seat nothing here pays for was unpaid there too. */
  holdings: HoldingRow[]
  /** The `pt_packages` rows already mapped: how many sessions a PT package's price bought. */
  ptPackages: Row[]
  /** The archive's one booking coder, shared with the workshop import so that no two bookings take one code. */
  codes: BookingCoder
}): MappedSchedule {
  const { config, tenantId, id, ids, memberNames, staffIds } = input
  const tz = config.studio.timezone
  const asOf = new Date(config.asOf)
  const instant = (d: CalendarDate, t: ClockTime) => zonedToInstant({ ...d, ...t, second: 0 }, tz)
  const notes: string[] = []
  const problems: string[] = []

  /* ── What the config calls things (`./lookups.ts`) ─────────────────────── */

  const { offSite, locations, types, workshopCategories, ptNames } = input.lookups
  const payPerClass = new Map(input.payRates.map(p => [normaliseStaffName(p.staff), p.perClass]))
  const payPerHead = new Map(input.payRates.map(p => [normaliseStaffName(p.staff), p]))
  const ptRateOf = ptRates(input.payroll)
  const ptCatalogue = new Map(input.ptPackages.map(p => [String(p.id), { sessions: Number(p.num_sessions), price: Number(p.price_sgd) }]))
  /**
   * The sessions a member's PT package paid for. Usually the catalogue's count;
   * but a holding Mindbody combined and the register could not split back
   * (`./packages.ts`) carries the price of every pack in it, so its sessions
   * are the catalogue's count times the packs its price amounts to.
   */
  const sessionsBought = (pkg: Row) => {
    const entry = ptCatalogue.get(String(pkg.source_pt_package_id))
    if (!entry?.sessions) return undefined
    const packs = entry.price > 0 ? Math.max(1, Math.round(Number(pkg.amount_paid_sgd) / entry.price)) : 1
    return entry.sessions * packs
  }

  /** Leading something imported makes a staff member an instructor, if they were not one already. */
  const extraInstructors = new Set<string>()
  const teaches = (staffId: string) => {
    if (!input.instructorIds.has(staffId)) extraInstructors.add(staffId)
  }
  const count = (tally: Map<string, number>, key: string) => tally.set(key, (tally.get(key) ?? 0) + 1)

  /* ── Future classes ────────────────────────────────────────────────────── */

  type Class = {
    row: Row
    id: string
    date: CalendarDate
    start: ClockTime
    end: ClockTime
    name: string
    roomId: string | null
    typeId: string
    capacity: number
    label: string
  }
  const classes = new Map<string, Class>()
  /**
   * A class by date, time and name alone. The join is on the teacher too, but
   * the two reports disagree about them oftener than they should — a class
   * covered at short notice, a name spelled a third way — and dropping the
   * seat would lose a booking a member holds. Where exactly one class is on at
   * that minute under that name there is nothing to be wrong about, so the
   * seat goes on it; where two share the slot the entry is null and the seat
   * is a preflight line instead.
   */
  const byTime = new Map<string, Class | null>()
  /** What is scheduled under a workshop category: its roster rows are the workshop import's, not unmatched. */
  const workshopTimes = new Set<string>()
  const unknownNames = new Map<string, number>()
  const unknownRooms = new Map<string, number>()
  const unknownLocations = new Map<string, number>()
  const unknownTeachers = new Map<string, number>()
  const needCapacity = new Map<string, number>()
  /** Future classes, by teacher, whose teacher Mindbody also pays per head. */
  const perHeadClasses = new Map<string, number>()

  for (const r of input.schedule) {
    const startsAt = instant(r.date, r.start)
    if (startsAt <= asOf) continue
    const name = normaliseClassName(r.description)
    const timeKey = `${isoDay(r.date)} ${isoClock(r.start)} ${name}`
    if (workshopCategories.has(fold(r.serviceCategory))) {
      workshopTimes.add(timeKey)
      continue
    }
    const staffKey = normaliseStaffName(r.staff)
    const key = `${timeKey} ${staffKey}`
    if (classes.has(key)) continue

    const type = types.get(name)
    const room = roomFor(input.lookups, r.room, type?.id)
    const teacherId = staffIds.get(staffKey)
    const location = room?.location ?? locations.get(fold(r.location))
    if (!type) count(unknownNames, r.description)
    if (!room && r.room && !offSite.has(fold(r.room))) count(unknownRooms, r.room)
    if (!location) count(unknownLocations, r.location)
    if (!teacherId) count(unknownTeachers, r.staff)
    const capacity = type?.capacity ?? room?.capacity
    if (type && !capacity && (!r.room || offSite.has(fold(r.room)))) count(needCapacity, r.description)
    if (!type || !teacherId || !location || !capacity) continue

    const endsAt = instant(r.date, r.end)
    const label = `${r.description} on ${isoDay(r.date)} at ${isoClock(r.start)}`
    if (endsAt <= startsAt) {
      notes.push(`${label}: ends before it starts in Mindbody, so it was not imported`)
      continue
    }
    teaches(teacherId)
    const pay = payPerClass.get(staffKey)
    if (payPerHead.get(staffKey)?.perClient != null) count(perHeadClasses, staffKey)
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
      // No per-class rate for this teacher: Unpriced, for an admin to settle.
      // A rate of 0 is a rate: the teacher really is paid nothing.
      instructor_pay_sgd: pay == null ? null : money(pay),
      lifecycle: 'active',
      series_id: null,
      created_at: asOf.toISOString(),
      created_by_staff_id: input.ownerId,
    }
    const cls: Class = {
      row,
      id: row.id as string,
      date: r.date,
      start: r.start,
      end: r.end,
      name,
      roomId: room?.id ?? null,
      typeId: type.id,
      capacity,
      label,
    }
    classes.set(key, cls)
    byTime.set(timeKey, byTime.has(timeKey) ? null : cls)
  }

  const listed = (tally: Map<string, number>, say: (what: string, n: number) => string) =>
    [...tally].sort(([a], [b]) => a.localeCompare(b)).forEach(([what, n]) => problems.push(say(what, n)))
  listed(unknownNames, (w, n) => `classTypes: "${w}" is on the timetable ${n} time(s) and is in no Class Type`)
  listed(unknownRooms, (w, n) => `rooms: "${w}" holds ${n} future class(es) and is neither a Room nor an off-site venue`)
  listed(unknownLocations, (w, n) => `locations: "${w}" holds ${n} future class(es) and no Location is called that (name or mindbodyNames)`)
  listed(
    unknownTeachers,
    (w, n) => `staff: ${w} teaches ${n} future class(es) and is not coming across — migrate them, or take the classes off the timetable`,
  )
  listed(needCapacity, (w, n) => `classTypes: "${w}" is held off-site ${n} time(s), so its Class Type needs a capacity`)

  // A pay rule the platform has no place for: a class here pays one fixed
  // figure, whoever comes. So the per-head part of a teacher's pay is named,
  // with what their classes came across carrying instead.
  for (const [staffKey, n] of [...perHeadClasses].sort(([a], [b]) => a.localeCompare(b))) {
    const rate = payPerHead.get(staffKey)!
    notes.push(
      `pay: ${rate.staff} is paid ${money(rate.perClient!)} per client in Mindbody, which the platform has no pay rule for — ` +
        (rate.perClass == null
          ? `${n} future class(es) came across Unpriced; set their pay in the portal`
          : `${n} future class(es) came across paying only the per-class ${money(rate.perClass)}`),
    )
  }

  /* ── Who is already booked ─────────────────────────────────────────────── */

  /**
   * The package that pays for a member's session: the one running in its
   * Family, where it lasts until then; else the first one waiting behind it
   * that will still be running then — it starts when the running one ends (or
   * today, where none runs) and lasts its whole validity. A package that runs
   * out before the session cannot pay for it — the platform refuses exactly that
   * (`plan_expires_before_class`) — so a seat nothing can pay for is imported
   * unpaid and listed, rather than pinned to a package the studio could never charge.
   */
  const payingPackage = (clientId: string, family: 'class' | 'pt', startsAt: Date) => {
    const mine = input.clientPackages.filter(
      p => p.client_id === ids.clients![clientId] && p.active === true && (p.kind === 'pt') === (family === 'pt'),
    )
    const running = mine.find(p => p.expires_at != null)
    if (running && String(running.expires_at) >= startsAt.toISOString()) return running
    // The waiting ones run one after another, in the order they queue.
    let until = running ? new Date(String(running.expires_at)) : asOf
    for (const p of mine.filter(p => p.expires_at == null)) {
      const from = until
      until = new Date(from)
      if (p.duration_months != null) until.setUTCMonth(until.getUTCMonth() + Number(p.duration_months))
      else until.setTime(until.getTime() + Number(p.validity_days) * 86_400_000)
      if (startsAt > from && startsAt <= until) return p
    }
    return undefined
  }

  /**
   * Whether anything the member holds in Mindbody would have paid for the
   * session: something left, not expired by then, in that Family. What cannot
   * be paid for here was unpaid in Mindbody too, or else it is unmatched — a
   * holding that did not come across as a package that lasts.
   */
  const entryOf = new Map(config.catalogue.flatMap(e => e.mindbodyNames.map(s => [normaliseOptionName(s), e] as const)))
  const heldInMindbody = (clientId: string, family: 'class' | 'pt', on: CalendarDate) =>
    input.holdings.some(h => {
      if (h.clientId !== clientId) return false
      const entry = entryOf.get(normaliseOptionName(h.option))
      if (!entry || entry.migrate === 'skip' || entry.kind === 'access_pass') return false
      const left = h.remaining !== null && (h.remaining.unlimited || h.remaining.count > 0)
      return left && (entry.kind === 'pt') === (family === 'pt') && (h.lastExpiration === null || dayNumber(h.lastExpiration) >= dayNumber(on))
    })
  const unpaid = { mindbody: 0, unmatched: 0 }

  // `??=`, never `=`: the history import fills the same three maps, and
  // whichever of the two runs second must add to them rather than empty them.
  ids.classes ??= {}
  ids.bookings ??= {}
  const bookings: Row[] = []
  const booking = (key: string, clientId: string, target: Row, family: 'class' | 'pt', label: string, startsAt: Date, on: CalendarDate): void => {
    const pkg = payingPackage(clientId, family, startsAt)
    if (!pkg) {
      const what = family === 'pt' ? 'PT' : 'class'
      const who = `${clientId} ${memberNames.get(clientId)}`
      const held = heldInMindbody(clientId, family, on)
      unpaid[held ? 'unmatched' : 'mindbody']++
      notes.push(
        `${who}: booked into ${label} with no ${what} package to pay for it — ` +
          (held
            ? 'unmatched: Mindbody has something to pay for it that did not come across as a package lasting until then'
            : 'unpaid in Mindbody too: nothing they hold there lasts until then'),
      )
    }
    const made = input.codes(key)
    const row: Row = {
      id: id('booking', key),
      tenant_id: tenantId,
      client_id: ids.clients![clientId],
      kind: family,
      class_id: null,
      pt_session_id: null,
      ...target,
      client_package_id: pkg?.id ?? null,
      state: 'confirmed',
      // What cancelling gives back. An Unlimited Plan was never charged a credit.
      credits_or_sessions_used: pkg && pkg.kind !== 'unlimited' ? 1 : 0,
      refund_outcome: 'n_a',
      check_in_state: 'pending',
      qr_token: made.qrToken,
      code: made.code,
      booked_at: asOf.toISOString(),
    }
    bookings.push(row)
    ids.bookings![key] = row.id as string
  }

  type Appointment = {
    date: CalendarDate
    start: ClockTime
    end: ClockTime | null
    staff: string
    location: string
    room: string
    clients: Set<string>
  }
  const appointments = new Map<string, Appointment>()
  const seated = new Map<string, Set<string>>()

  const roster = [...input.roster].sort(
    (a, b) =>
      dayNumber(a.date) - dayNumber(b.date) ||
      isoClock(a.start).localeCompare(isoClock(b.start)) ||
      a.clientId.localeCompare(b.clientId),
  )
  for (const r of roster) {
    if (instant(r.date, r.start) <= asOf || /cancel/i.test(r.status)) continue
    const name = normaliseClassName(r.description)
    const timeKey = `${isoDay(r.date)} ${isoClock(r.start)} ${name}`
    const staffKey = normaliseStaffName(r.staff)
    const label = `${r.description} on ${isoDay(r.date)} at ${isoClock(r.start)}`
    if (!memberNames.has(r.clientId)) {
      notes.push(`${r.clientId}: booked into ${label} and is not in the member list`)
      continue
    }

    if (ptNames.has(name)) {
      const key = `${isoDay(r.date)} ${isoClock(r.start)} ${staffKey}`
      const appointment = appointments.get(key) ?? {
        date: r.date,
        start: r.start,
        end: r.end,
        staff: r.staff,
        location: r.location,
        room: r.room,
        clients: new Set<string>(),
      }
      appointment.clients.add(r.clientId)
      appointments.set(key, appointment)
      continue
    }

    const cls = classes.get(`${timeKey} ${staffKey}`) ?? byTime.get(timeKey)
    if (!cls) {
      if (!workshopTimes.has(timeKey)) {
        notes.push(`${r.clientId} ${memberNames.get(r.clientId)}: booked into ${label}, which is not on the timetable`)
      }
      continue
    }
    const seats = seated.get(cls.id) ?? new Set<string>()
    seated.set(cls.id, seats)
    if (seats.has(r.clientId)) {
      notes.push(`${r.clientId} ${memberNames.get(r.clientId)}: booked twice into ${label} (a guest?) — one seat was imported`)
      continue
    }
    seats.add(r.clientId)
    booking(`${cls.id}/${r.clientId}`, r.clientId, { class_id: cls.id }, 'class', label, instant(cls.date, cls.start), cls.date)
  }
  for (const cls of classes.values()) {
    ids.classes[cls.label] = cls.id
    const booked = seated.get(cls.id)?.size ?? 0
    if (booked > cls.capacity) notes.push(`${cls.label}: ${booked} booked into ${cls.capacity} seats — check the capacity in the config`)
  }

  /* ── Future PT appointments ────────────────────────────────────────────── */

  const ptRequests: Row[] = []
  const ptSessions: Row[] = []
  const ptSessionClients: Row[] = []
  ids.pt_sessions ??= {}

  const ptUnrated = new Map<string, number>()
  const ptUnvalued = new Map<string, number>()
  /**
   * What a future PT session pays its trainer, on the rate Payroll last paid
   * them for PT: flat, or their percentage of what one session of each member's
   * package is worth (what was paid for it over the sessions it bought), as
   * Mindbody's "Rev. per Session" works it out. Unpriced where no rate is known,
   * or a member on it has no package to value the session by.
   */
  const ptPay = (staff: string, clients: string[], startsAt: Date): string | null => {
    const rate = ptRateOf.get(normaliseStaffName(staff))
    if (!rate) {
      count(ptUnrated, staff)
      return null
    }
    if (rate.flat !== undefined) return money(rate.flat)
    const worth = clients.map(clientId => {
      const pkg = runningPackage(clientId, 'pt', startsAt)
      const sessions = pkg ? sessionsBought(pkg) : undefined
      return pkg && sessions ? Number(pkg.amount_paid_sgd) / sessions : null
    })
    if (worth.some(w => w === null)) {
      count(ptUnvalued, `${staff} (PT ${rate.percent}%)`)
      return null
    }
    const earned = (rate.percent / 100) * worth.reduce<number>((sum, w) => sum + w!, 0)
    return money(Math.round(earned * 100) / 100)
  }

  for (const key of [...appointments.keys()].sort()) {
    const a = appointments.get(key)!
    const label = `PT on ${isoDay(a.date)} at ${isoClock(a.start)} with ${a.staff}`
    const instructorId = staffIds.get(normaliseStaffName(a.staff))
    if (!instructorId) {
      problems.push(
        `staff: ${a.staff} has a future PT appointment (${isoDay(a.date)} ${isoClock(a.start)}) and is not coming across`,
      )
      continue
    }
    const [requester, partner, ...others] = [...a.clients].sort()
    for (const extra of others) {
      notes.push(`${extra} ${memberNames.get(extra)}: a third member on ${label} — a PT session here seats two, so this seat was not imported`)
    }

    const ptTypeId = input.ensurePtType()
    teaches(instructorId)
    const room = roomFor(input.lookups, a.room, ptTypeId)
    const location = room?.location ?? locations.get(fold(a.location)) ?? config.defaultLocation
    const startsAt = instant(a.date, a.start)
    const end = a.end ? instant(a.date, a.end) : startsAt
    const endsAt = end > startsAt ? end : new Date(startsAt.getTime() + 3_600_000)
    const sessionId = id('pt-session', key)
    const pay = ptPay(a.staff, ptClients({ requesterId: requester!, partnerId: partner ?? null }), startsAt)
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
      // Still to come, so it is a session the studio has scheduled and nothing
      // has yet become of.
      status: 'scheduled',
      debitedClientPackageId: (payingPackage(requester!, 'pt', startsAt)?.id as string | undefined) ?? null,
      ownerId: input.ownerId,
      settledAt: asOf.toISOString(),
      instructorPaySgd: pay,
    })
    ptRequests.push(rows.request)
    ptSessions.push(rows.session)
    ptSessionClients.push(...rows.sessionClients)
    ids.pt_sessions[key] = sessionId
    // Each of two members sharing a session was charged from their own package
    // in Mindbody, so each booking gives its own session back if cancelled.
    for (const clientId of ptClients({ requesterId: requester!, partnerId: partner ?? null })) {
      booking(`${sessionId}/${clientId}`, clientId, { pt_session_id: sessionId }, 'pt', label, startsAt, a.date)
    }
  }
  if (unpaid.mindbody + unpaid.unmatched > 0) {
    notes.push(`future bookings with no package: ${unpaid.mindbody} unpaid in Mindbody too, ${unpaid.unmatched} unmatched — each is listed above`)
  }

  const tallied = (tally: Map<string, number>, say: (what: string, n: number) => string) =>
    [...tally].sort(([a], [b]) => a.localeCompare(b)).forEach(([what, n]) => notes.push(say(what, n)))
  tallied(ptUnrated, (w, n) => `pay: ${w} has ${n} future PT session(s) and no PT rate in Payroll, so they are Unpriced`)
  tallied(
    ptUnvalued,
    (w, n) => `pay: ${w} has ${n} future PT session(s) with a member holding no PT package to value them by, so they are Unpriced`,
  )

  if (problems.length > 0) throw new ConfigError(problems)

  /* ── Class Series ──────────────────────────────────────────────────────── */

  ids.class_series = {}
  const classSeries: Row[] = []
  for (const s of config.series) {
    if (!s.migrate) continue
    const label = `${s.className}, weekday ${s.weekday} at ${s.startTime}`
    const type = types.get(normaliseClassName(s.className))!
    const room = roomFor(input.lookups, s.room, type.id)!
    const teacherId = staffIds.get(normaliseStaffName(s.teacher))!
    const inSlot = (c: { typeId?: string; roomId?: string | null; date: CalendarDate; start: ClockTime; end: ClockTime }) =>
      c.typeId === type.id &&
      c.roomId === room.id &&
      isoWeekday(c.date) === s.weekday &&
      isoClock(c.start) === s.startTime &&
      isoClock(c.end) === s.endTime
    const mine = [...classes.values()]
      .filter(c => inSlot(c) && c.row.series_id === null)
      .sort((a, b) => dayNumber(a.date) - dayNumber(b.date))
    // The published timetable runs only days past the download, so a weekly
    // class often has nothing still to come. It is written all the same, ending
    // on its last class before the download: launch day's extend carries it on.
    const dates = mine.length > 0
      ? mine.map(c => c.date)
      : input.schedule
          .filter(r => instant(r.date, r.start) <= asOf)
          .filter(r => inSlot({ ...r, typeId: types.get(normaliseClassName(r.description))?.id, roomId: roomFor(input.lookups, r.room, type.id)?.id }))
          .map(r => r.date)
          .sort((a, b) => dayNumber(a) - dayNumber(b))
          .slice(-1)
    if (dates.length === 0) {
      notes.push(`series ${label}: no class on the timetable matches it, so there is nothing to continue — create it in the portal instead`)
      continue
    }
    const [first, last] = [dates[0]!, dates.at(-1)!]
    if (mine.length === 0) notes.push(`series ${label}: no class of it is on the timetable after the download, so it ends on ${isoDay(last)} — extend it on launch day`)
    const held = new Set(dates.map(dayNumber))
    const excluded: string[] = []
    for (let d = dayNumber(first); d <= dayNumber(last); d += 7) {
      if (!held.has(d)) excluded.push(new Date(d * 86_400_000).toISOString().slice(0, 10))
    }
    const key = [s.weekday, s.startTime, s.endTime, room.id, type.id].join('|')
    const seriesId = id('class-series', key)
    teaches(teacherId)
    const pay = payPerClass.get(normaliseStaffName(s.teacher))
    // No known rate is Unpriced, never 0: so are the classes it links and
    // every class it extends to, until an admin sets the series' pay.
    if (pay == null) {
      notes.push(
        `series ${label}: ${s.teacher} has no per-class rate, so the series is Unpriced — its classes, and every class an extend adds, need their pay set in Finance`,
      )
    }
    classSeries.push({
      id: seriesId,
      tenant_id: tenantId,
      class_type_id: type.id,
      main_instructor_id: teacherId,
      instructor_pay_sgd: pay == null ? null : money(pay),
      location_id: ids.locations![room.location],
      room_id: room.id,
      weekday: s.weekday,
      start_time: `${s.startTime}:00`,
      end_time: `${s.endTime}:00`,
      capacity_online: type.capacity ?? room.capacity,
      capacity_waitlist: 0,
      capacity_buffer: 0,
      credit_cost: 1,
      first_date: isoDay(first),
      // The last class that came across: launch day starts with an extend.
      last_date: isoDay(last),
      excluded_dates: excluded,
      ended_from: null,
      created_at: asOf.toISOString(),
      created_by_staff_id: input.ownerId,
    })
    ids.class_series[label] = seriesId
    for (const c of mine) c.row.series_id = seriesId
  }

  return {
    instructors: [...extraInstructors].sort().map(staffId => ({ staff_user_id: staffId, tenant_id: tenantId })),
    classSeries,
    classes: [...classes.values()].map(c => c.row),
    ptRequests,
    ptSessions,
    ptSessionClients,
    bookings,
    notes,
  }
}
