import type { BookingCoder } from './booking-codes'
import { ConfigError, type StudioConfig } from './config'
import type { PayRateRow, RosterRow, ScheduledClassRow } from './readers'
import {
  dayNumber,
  isoClock,
  isoDay,
  isoWeekday,
  money,
  normaliseClassName,
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
  /** The PT Class Type, where the config's Class Types do not already have it. */
  classTypes: Row[]
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

const fold = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

export function mapSchedule(input: {
  schedule: ScheduledClassRow[]
  roster: RosterRow[]
  payRates: PayRateRow[]
  config: StudioConfig
  tenantId: string
  id: (kind: string, key: string) => string
  /** Mindbody key → platform id. Read for Locations, Rooms, Class Types and members; filled in for what is written here. */
  ids: Record<string, Record<string, string>>
  memberNames: Map<string, string>
  /** Every staff member coming across, by normalised name. */
  staffIds: Map<string, string>
  /** Those of them who already have an instructor profile. */
  instructorIds: Set<string>
  ownerId: string
  /** The `client_packages` rows already mapped: a booking is paid by the member's running one. */
  clientPackages: Row[]
  /** The archive's one booking coder, shared with the workshop import so that no two bookings take one code. */
  codes: BookingCoder
}): MappedSchedule {
  const { config, tenantId, id, ids, memberNames, staffIds } = input
  const tz = config.studio.timezone
  const asOf = new Date(config.asOf)
  const instant = (d: CalendarDate, t: ClockTime) => zonedToInstant({ ...d, ...t, second: 0 }, tz)
  const notes: string[] = []
  const problems: string[] = []

  /* ── What the config calls things ──────────────────────────────────────── */

  const rooms = new Map<string, { id: string; location: string; capacity: number }>()
  for (const r of config.rooms) {
    const room = { id: id('room', `${r.location}/${r.name.trim().toLowerCase()}`), location: r.location, capacity: r.capacity }
    for (const spelling of [r.name, ...r.mindbodyNames]) rooms.set(fold(spelling), room)
  }
  const offSite = new Set(config.offSiteVenues.map(fold))
  const locations = new Map<string, string>()
  for (const l of config.locations) for (const s of [l.name, ...l.mindbodyNames]) locations.set(fold(s), l.key)
  const types = new Map<string, { id: string; capacity: number | null }>()
  for (const t of config.classTypes) {
    const type = { id: id('class-type', t.name.trim().toLowerCase()), capacity: t.capacity }
    for (const s of [t.name, ...t.mindbodyNames]) types.set(normaliseClassName(s), type)
  }
  const workshopCategories = new Set(config.workshopCategories.map(fold))
  const ptNames = new Set(config.ptAppointmentNames.map(normaliseClassName))
  const payPerClass = new Map(input.payRates.map(p => [normaliseStaffName(p.staff), p.perClass]))

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
    const room = rooms.get(fold(r.room))
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
      instructor_pay_sgd: pay ? money(pay) : null,
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

  /* ── Who is already booked ─────────────────────────────────────────────── */

  /**
   * The member's running package in a Family: the one a booking made today
   * would be paid by. A package that runs out before the session cannot pay
   * for it — the platform refuses exactly that (`plan_expires_before_class`) —
   * so a seat whose only package ends first is imported unpaid and listed,
   * rather than pinned to a package the studio could never charge.
   */
  const runningPackage = (clientId: string, family: 'class' | 'pt', startsAt: Date) =>
    input.clientPackages.find(
      p =>
        p.client_id === ids.clients![clientId] &&
        p.active === true &&
        p.expires_at != null &&
        String(p.expires_at) >= startsAt.toISOString() &&
        (p.kind === 'pt') === (family === 'pt'),
    )

  ids.classes = {}
  ids.bookings = {}
  const bookings: Row[] = []
  const booking = (key: string, clientId: string, target: Row, family: 'class' | 'pt', label: string, startsAt: Date): void => {
    const pkg = runningPackage(clientId, family, startsAt)
    if (!pkg) {
      const what = family === 'pt' ? 'PT' : 'class'
      const who = `${clientId} ${memberNames.get(clientId)}`
      notes.push(`${who}: booked into ${label} with no ${what} package that lasts until then to pay for it`)
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
    booking(`${cls.id}/${r.clientId}`, r.clientId, { class_id: cls.id }, 'class', label, instant(cls.date, cls.start))
  }
  for (const cls of classes.values()) {
    ids.classes[cls.label] = cls.id
    const booked = seated.get(cls.id)?.size ?? 0
    if (booked > cls.capacity) notes.push(`${cls.label}: ${booked} booked into ${cls.capacity} seats — check the capacity in the config`)
  }

  /* ── Future PT appointments ────────────────────────────────────────────── */

  // The PT Class Type: the config's own if it lists one by that name.
  const ptTypeKey = normaliseClassName(config.ptClassType)
  const classTypes: Row[] = []
  let ptTypeId = types.get(ptTypeKey)?.id
  const ptRequests: Row[] = []
  const ptSessions: Row[] = []
  const ptSessionClients: Row[] = []
  ids.pt_sessions = {}

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

    if (!ptTypeId) {
      ptTypeId = id('class-type', ptTypeKey)
      classTypes.push({ id: ptTypeId, tenant_id: tenantId, name: config.ptClassType })
      ids.class_types![config.ptClassType] = ptTypeId
    }
    teaches(instructorId)
    const room = rooms.get(fold(a.room))
    const location = room?.location ?? locations.get(fold(a.location)) ?? config.defaultLocation
    const startsAt = instant(a.date, a.start)
    const end = a.end ? instant(a.date, a.end) : startsAt
    const endsAt = end > startsAt ? end : new Date(startsAt.getTime() + 3_600_000)
    const sessionType = partner ? '2on1' : '1on1'
    const sessionId = id('pt-session', key)
    const requestId = id('pt-request', key)

    ptRequests.push({
      id: requestId,
      tenant_id: tenantId,
      client_id: ids.clients![requester!],
      class_type_id: ptTypeId,
      location_id: ids.locations![location],
      session_type: sessionType,
      co_client_id: partner ? ids.clients![partner] : null,
      message: null,
      status: 'scheduled',
      expires_at: startsAt.toISOString(),
      scheduled_pt_session_id: sessionId,
      debited_client_package_id: runningPackage(requester!, 'pt', startsAt)?.id ?? null,
      resolved_at: asOf.toISOString(),
      resolved_by_staff_id: input.ownerId,
      created_at: asOf.toISOString(),
    })
    ptSessions.push({
      id: sessionId,
      tenant_id: tenantId,
      pt_request_id: requestId,
      instructor_id: instructorId,
      location_id: ids.locations![location],
      room_id: room?.id ?? null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      session_type: sessionType,
      // Mindbody pays PT by percentage, which no report gives: Unpriced.
      instructor_pay_sgd: null,
      capacity_online: partner ? 2 : 1,
      capacity_waitlist: 0,
      capacity_buffer: 0,
      lifecycle: 'active',
      scheduled_at: asOf.toISOString(),
      scheduled_by_staff_id: input.ownerId,
      created_at: asOf.toISOString(),
    })
    ids.pt_sessions[key] = sessionId
    // Each of two members sharing a session was charged from their own package
    // in Mindbody, so each booking gives its own session back if cancelled.
    for (const clientId of partner ? [requester!, partner] : [requester!]) {
      ptSessionClients.push({ tenant_id: tenantId, pt_session_id: sessionId, client_id: ids.clients![clientId] })
      booking(`${sessionId}/${clientId}`, clientId, { pt_session_id: sessionId }, 'pt', label, startsAt)
    }
  }

  if (problems.length > 0) throw new ConfigError(problems)

  /* ── Class Series ──────────────────────────────────────────────────────── */

  ids.class_series = {}
  const classSeries: Row[] = []
  for (const s of config.series) {
    if (!s.migrate) continue
    const label = `${s.className}, weekday ${s.weekday} at ${s.startTime}`
    const type = types.get(normaliseClassName(s.className))!
    const room = rooms.get(fold(s.room))!
    const teacherId = staffIds.get(normaliseStaffName(s.teacher))!
    const mine = [...classes.values()]
      .filter(
        c =>
          c.typeId === type.id &&
          c.roomId === room.id &&
          isoWeekday(c.date) === s.weekday &&
          isoClock(c.start) === s.startTime &&
          isoClock(c.end) === s.endTime &&
          c.row.series_id === null,
      )
      .sort((a, b) => dayNumber(a.date) - dayNumber(b.date))
    if (mine.length === 0) {
      notes.push(`series ${label}: no future class matches it, so there is nothing to continue — create it in the portal instead`)
      continue
    }
    const [first, last] = [mine[0]!.date, mine.at(-1)!.date]
    const held = new Set(mine.map(c => dayNumber(c.date)))
    const excluded: string[] = []
    for (let d = dayNumber(first); d <= dayNumber(last); d += 7) {
      if (!held.has(d)) excluded.push(new Date(d * 86_400_000).toISOString().slice(0, 10))
    }
    const key = [s.weekday, s.startTime, s.endTime, room.id, type.id].join('|')
    const seriesId = id('class-series', key)
    teaches(teacherId)
    const pay = payPerClass.get(normaliseStaffName(s.teacher))
    // A series must carry a pay figure, so there is no Unpriced to fall back on.
    if (!pay) {
      notes.push(`series ${label}: ${s.teacher} has no per-class rate, so the series pays 0.00 — set it in the portal before extending`)
    }
    classSeries.push({
      id: seriesId,
      tenant_id: tenantId,
      class_type_id: type.id,
      main_instructor_id: teacherId,
      instructor_pay_sgd: money(pay ?? 0),
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
    classTypes,
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
