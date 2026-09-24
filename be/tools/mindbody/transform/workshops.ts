import type { BookingCoder } from './booking-codes'
import { isLive } from './catalogue'
import { ConfigError, type StudioConfig } from './config'
import { outcomeOf, SETTLEMENT, type Outcome } from './history'
import type { AttendanceRow, HoldingRow, PayrollRow, ScheduledClassRow } from './readers'
import type { JoinedSale, JoinedSales } from './sales'
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
 * The workshops and retreats — still to come, and, for a studio bringing its
 * past, already held — and the members who have a place on one.
 *
 * Pure, like the rest of the mapper. A workshop is a Mindbody *service
 * category* — a workshop, a retreat or a course has one of its own — so its
 * days are the rows of the staff schedule filed under it, one Day per
 * occurrence, and the teachers on those rows are its instructors: whoever leads
 * the most days is the main one and the rest are supporting.
 *
 * Its Tiers are the room types it was sold by (twin, single, non-resident),
 * which Mindbody sells as pricing options; the config names them and prices
 * them, because no report holds a workshop's price list. A tier grants every
 * day unless the config says which (`tiers[].days`).
 *
 * **To come**: the days after the download are one Workshop. A member holding
 * one of its options is an attendee: one booking, at the tier they bought, for
 * what they paid. Several holdings — a deposit and its balance, a twin place
 * and a top-up to single — are one booking whose amount is their sum, at the
 * dearest tier they hold, because a top-up is what moves a member up. The
 * booking is dated on the first sale of it in Big Spenders, so Finance shows a
 * prepaid place in the month it was paid for, not on import day.
 *
 * **Held** (inside `history`): a category that ran more than once ran as
 * separate Workshops, so its past days are split into runs wherever more than
 * a month passes between two of them, one Workshop each. Its attendees are the
 * members the Attendance report has on its days, each at the dearest tier their
 * visits or their sales name; what they paid is their sale lines of its options
 * (Big Spenders, returns taken off, a promotion's discount added back for List
 * Price), dated on the first sale. What Payroll paid on its days is its
 * instructors' pay — on the Workshop, not a Manual Payroll Entry.
 *
 * A tier's pricing options come across as bookings, so they are kept out of the
 * catalogue and out of the "not migrated" list (`./packages.ts`). Every place
 * that does not become a booking after all is a preflight line, and so is every
 * past workshop the config leaves behind (`migrate: false`), with its visits,
 * sales and pay counted, so that money paid is never passed over in silence.
 *
 * Nothing here spends a package: a workshop place is bought outright, and its
 * money lives on the booking (`amount_paid_sgd`), which is how Finance sees it.
 */

type Row = Record<string, unknown>

export type MappedWorkshops = {
  workshops: Row[]
  workshopDays: Row[]
  workshopTiers: Row[]
  workshopTierDays: Row[]
  workshopInstructors: Row[]
  /** The places members hold, as `kind: 'workshop'` bookings. */
  bookings: Row[]
  /** A past place the member came to, as a past class visit is checked in. */
  checkIns: Row[]
  /** Staff who lead a workshop and had no instructor profile yet. */
  instructors: Row[]
  /** Sale lines that are on a place: history's past purchases leave them alone. */
  placedSales: Set<JoinedSale>
  /** Payroll lines that are a past Workshop's pay: history makes no Manual Entry of them. */
  placedPayroll: Set<PayrollRow>
  /** What a person should look at: a workshop with no days left, a member who paid for two tiers. */
  notes: string[]
}

const fold = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** More days than this between two of a category's past days, and they were two runs of it. */
const RUN_GAP_DAYS = 31

/** How strongly a visit says what happened: a member who came once came. */
const STRENGTH: Record<Exclude<Outcome, 'early_cancel'>, number> = { attended: 0, booked: 1, absent: 2, late_cancel: 3 }

/** Every pricing option that buys a place on a workshop coming across, normalised. */
export function workshopOptionKeys(config: StudioConfig): Set<string> {
  const keys = new Set<string>()
  for (const w of config.workshops) {
    if (!w.migrate) continue
    for (const t of w.tiers) for (const s of t.mindbodyNames) keys.add(normaliseOptionName(s))
  }
  return keys
}

type Tier = { id: string; name: string; priceSgd: number; ord: number }

/** One occurrence, however many teachers the report files it under. */
type Occurrence = {
  date: CalendarDate
  start: ClockTime
  end: ClockTime
  rooms: string[]
  staff: Set<string>
  /** Its class names, normalised: how a visit or a payroll line is known to be on it. */
  names: Set<string>
}

/**
 * What each member has paid towards one workshop, for the workshops that do not
 * come across. Only those with something live against it: a place used up years
 * ago at a repeat of the same retreat is not a place on this one.
 */
function paidTowards(
  workshop: StudioConfig['workshops'][number],
  holdings: HoldingRow[],
  today: CalendarDate,
): [string, number][] {
  const options = new Set(workshop.tiers.flatMap(t => t.mindbodyNames).map(normaliseOptionName))
  const paid = new Map<string, number>()
  for (const h of holdings) {
    if (!options.has(normaliseOptionName(h.option)) || !isLive(h, today)) continue
    paid.set(h.clientId, (paid.get(h.clientId) ?? 0) + h.totalPaid)
  }
  return [...paid].sort(([a], [b]) => a.localeCompare(b))
}

export function mapWorkshops(input: {
  schedule: ScheduledClassRow[]
  holdings: HoldingRow[]
  /** Every past visit: who came to a workshop that has been held. Empty without history. */
  attendance: AttendanceRow[]
  /** What each teacher was paid: a past workshop's pay. */
  payroll: PayrollRow[]
  /** Every sale line, joined (`./sales.ts`): what a place cost, and when it was bought. */
  sales: JoinedSales
  /** How far back the studio's past goes, or null for none: no past workshop comes across without it. */
  history: { from: string } | null
  config: StudioConfig
  tenantId: string
  id: (kind: string, key: string) => string
  /** Mindbody key → platform id. Read for Locations and members; filled in for what is written here. */
  ids: Record<string, Record<string, string>>
  memberNames: Map<string, string>
  /** Every staff member coming across, by normalised name. */
  staffIds: Map<string, string>
  /** Those of them who already have an instructor profile. */
  instructorIds: Set<string>
  ownerId: string
  codes: BookingCoder
}): MappedWorkshops {
  const { config, tenantId, id, ids, memberNames, staffIds } = input
  const tz = config.studio.timezone
  const asOf = new Date(config.asOf)
  const today = localDateOf(asOf, tz)
  const instant = (d: CalendarDate, t: ClockTime) => zonedToInstant({ ...d, ...t, second: 0 }, tz)
  const notes: string[] = []
  const problems: string[] = []
  const nameOf = (clientId: string) => memberNames.get(clientId) ?? '(not in the member list)'
  const from = input.history?.from ?? null

  const rooms = new Map<string, { id: string; location: string }>()
  for (const r of config.rooms) {
    const room = { id: id('room', `${r.location}/${r.name.trim().toLowerCase()}`), location: r.location }
    for (const spelling of [r.name, ...r.mindbodyNames]) rooms.set(fold(spelling), room)
  }

  const extraInstructors = new Set<string>()
  const workshops: Row[] = []
  const workshopDays: Row[] = []
  const workshopTiers: Row[] = []
  const workshopTierDays: Row[] = []
  const workshopInstructors: Row[] = []
  const bookings: Row[] = []
  const checkIns: Row[] = []
  const placedSales = new Set<JoinedSale>()
  const placedPayroll = new Set<PayrollRow>()
  const workshopIds: Record<string, string> = (ids.workshops = {})
  const tierIds: Record<string, string> = (ids.workshop_tiers = {})
  const bookingIds: Record<string, string> = (ids.bookings ??= {})

  /** A schedule row's own occurrence key: `YYYY-MM-DD HH:MM HH:MM`, so sorting it sorts by when. */
  const occurrenceKey = (r: { date: CalendarDate; start: ClockTime; end: ClockTime }) =>
    `${isoDay(r.date)} ${isoClock(r.start)} ${isoClock(r.end)}`
  const visitKey = (d: CalendarDate, t: ClockTime, name: string) => `${isoDay(d)} ${isoClock(t)} ${normaliseClassName(name)}`

  /** A category's rows, as occurrences: the staff schedule repeats a class in every teacher's section. */
  const occurrencesOf = (category: string, name: string, keep: (startsAt: Date, day: CalendarDate) => boolean) => {
    const occurrences = new Map<string, Occurrence>()
    for (const r of input.schedule) {
      if (fold(r.serviceCategory) !== fold(category)) continue
      const startsAt = instant(r.date, r.start)
      if (!keep(startsAt, r.date)) continue
      if (instant(r.date, r.end) <= startsAt) {
        notes.push(`${name} on ${isoDay(r.date)} at ${isoClock(r.start)}: ends before it starts in Mindbody, so that day was not imported`)
        continue
      }
      const key = occurrenceKey(r)
      const day = occurrences.get(key) ?? { date: r.date, start: r.start, end: r.end, rooms: [], staff: new Set(), names: new Set() }
      if (r.room) day.rooms.push(r.room)
      day.staff.add(r.staff)
      day.names.add(normaliseClassName(r.description))
      occurrences.set(key, day)
    }
    return occurrences
  }

  /** Runs of past days, split wherever more than `RUN_GAP_DAYS` pass between two. */
  const runsOf = (occurrences: Map<string, Occurrence>): Map<string, Occurrence>[] => {
    const runs: Map<string, Occurrence>[] = []
    let last: number | null = null
    for (const key of [...occurrences.keys()].sort()) {
      const day = occurrences.get(key)!
      if (last === null || dayNumber(day.date) - last > RUN_GAP_DAYS) runs.push(new Map())
      runs.at(-1)!.set(key, day)
      last = dayNumber(day.date)
    }
    return runs
  }

  /**
   * The payroll lines paid for a run's days: on one of its dates, at one of its
   * start times (or at no set time — a retreat's share), and under one of its
   * class names where the line names one. Never a PT appointment's, and never
   * a line another run has already taken. A line with no class name (a
   * per-client line) at a minute an ordinary class also starts could be that
   * class's, so it is left for history rather than guessed.
   */
  const payrollOn = (run: Map<string, Occurrence>) => {
    const onDay = new Map<string, Occurrence[]>()
    for (const day of run.values()) onDay.set(isoDay(day.date), [...(onDay.get(isoDay(day.date)) ?? []), day])
    return input.payroll.filter(p => {
      if (p.table === 'appointment' || placedPayroll.has(p)) return false
      const days = onDay.get(isoDay(p.date))
      if (!days) return false
      if (p.start && !p.description && classStarts.has(`${isoDay(p.date)} ${isoClock(p.start)}`)) return false
      return days.some(
        d =>
          (!p.start || isoClock(p.start) === isoClock(d.start)) &&
          (!p.description || d.names.has(normaliseClassName(p.description))),
      )
    })
  }
  /** When an ordinary class — one on the timetable, not under a workshop category — starts. */
  const workshopCategories = new Set(config.workshopCategories.map(fold))
  const classStarts = new Set(
    input.schedule.filter(r => !workshopCategories.has(fold(r.serviceCategory))).map(r => `${isoDay(r.date)} ${isoClock(r.start)}`),
  )

  const workshopOptionsOf = (w: StudioConfig['workshops'][number]) =>
    new Set(w.tiers.flatMap(t => t.mindbodyNames).map(normaliseOptionName))

  /**
   * One Workshop: its row, its Days, who leads it and its Tiers. `key` tells a
   * past run's rows from the rows of the one to come.
   */
  const writeWorkshop = (
    w: StudioConfig['workshops'][number],
    key: string,
    name: string,
    occurrences: Map<string, Occurrence>,
    past: boolean,
  ) => {
    const dayKeys = [...occurrences.keys()].sort()
    const workshopId = id('workshop', key)
    workshops.push({
      id: workshopId,
      tenant_id: tenantId,
      name,
      cover_r2_key: null,
      description_html: null,
      location_id: ids.locations![w.location],
      lifecycle: 'active',
      cancelled_at: null,
      cancelled_by_staff_id: null,
      created_at: asOf.toISOString(),
      created_by_staff_id: input.ownerId,
    })
    workshopIds[name] = workshopId

    const dayIds: string[] = []
    dayKeys.forEach((dayKey, i) => {
      const day = occurrences.get(dayKey)!
      // The first spelling the config knows — named beside its Room, so a
      // mismatch names the spelling that caused it and not whatever was listed
      // first, which may be a venue the config has never heard of.
      const spelled = day.rooms.find(r => rooms.has(fold(r)))
      const named = spelled ? rooms.get(fold(spelled))! : undefined
      // A Day's Room must be at the workshop's own Location; one somewhere else
      // would fail the portal's own rule the first time an admin opened it.
      if (named && named.location !== w.location) {
        notes.push(`${name} on ${isoDay(day.date)}: it is in ${spelled}, which is not at its Location, so no Room was set`)
      }
      const dayId = id('workshop-day', `${w.category}/${dayKey}`)
      dayIds.push(dayId)
      workshopDays.push({
        id: dayId,
        tenant_id: tenantId,
        workshop_id: workshopId,
        ord: i + 1,
        room_id: named?.location === w.location ? named.id : null,
        starts_at: instant(day.date, day.start).toISOString(),
        ends_at: instant(day.date, day.end).toISOString(),
        // The money is on the Tiers; the per-day figure is only a reference,
        // and the portal no longer asks for one.
        base_price_sgd: money(0),
        capacity_online: w.capacity,
        capacity_waitlist: 0,
        capacity_buffer: 0,
      })
    })

    /* ── Who leads it ──────────────────────────────────────────────────── */

    const leads = new Map<string, { name: string; days: number; first: number }>()
    dayKeys.forEach((dayKey, i) => {
      for (const staff of occurrences.get(dayKey)!.staff) {
        const staffKey = normaliseStaffName(staff)
        const lead = leads.get(staffKey) ?? { name: staff, days: 0, first: i }
        lead.days += 1
        leads.set(staffKey, lead)
      }
    })
    const ranked = [...leads]
      .filter(([staffKey, lead]) => {
        if (staffIds.has(staffKey)) return true
        // The past is never a refusal: its days still came, led by whoever is coming across.
        if (past) notes.push(`${name}: ${lead.name} led it and is not coming across, so is not among its instructors`)
        else problems.push(`staff: ${lead.name} leads the workshop "${w.name}" and is not coming across — migrate them, or take it off the timetable`)
        return false
      })
      // Whoever leads the most days is the main one; then whoever is there
      // first, then by name, so the report's order never decides.
      .sort(([a, x], [b, y]) => y.days - x.days || x.first - y.first || a.localeCompare(b))
    const instructorRows = new Map<string, Row>()
    ranked.forEach(([staffKey], i) => {
      const staffId = staffIds.get(staffKey)!
      // Leading a workshop makes a staff member an instructor, if they were
      // not one already: the row points at an instructor profile.
      if (!input.instructorIds.has(staffId)) extraInstructors.add(staffId)
      const row: Row = {
        tenant_id: tenantId,
        workshop_id: workshopId,
        instructor_id: staffId,
        role: i === 0 ? 'main' : 'supporting',
        // Mindbody pays a workshop by agreement: Unpriced, unless Payroll says (a past one).
        pay_sgd: null,
      }
      workshopInstructors.push(row)
      instructorRows.set(staffId, row)
    })

    /* ── Its tiers ─────────────────────────────────────────────────────── */

    const tierOf = new Map<string, Tier>()
    w.tiers.forEach((t, i) => {
      const tierId = id('workshop-tier', `${key}/${normaliseOptionName(t.name)}`)
      const tier: Tier = { id: tierId, name: t.name, priceSgd: t.priceSgd, ord: i + 1 }
      workshopTiers.push({
        id: tierId,
        tenant_id: tenantId,
        workshop_id: workshopId,
        name: t.name,
        description: null,
        regular_price_sgd: money(t.priceSgd),
        early_bird_price_sgd: null,
        early_bird_quota: null,
        early_bird_cutoff_at: null,
        ord: i + 1,
      })
      tierIds[`${name} / ${t.name}`] = tierId
      // A room type is the whole workshop — nobody buys a bed for one night of
      // a retreat — so a tier grants every day, unless the config says which.
      const beyond = (t.days ?? []).filter(d => d > dayIds.length)
      if (beyond.length > 0) {
        notes.push(`${name} / ${t.name}: grants day(s) ${beyond.join(', ')}, and it has ${dayIds.length} day(s)`)
      }
      const granted = t.days ? dayIds.filter((_, d) => t.days!.includes(d + 1)) : dayIds
      for (const dayId of granted) {
        workshopTierDays.push({ tenant_id: tenantId, workshop_tier_id: tierId, workshop_day_id: dayId })
      }
      for (const spelling of t.mindbodyNames) tierOf.set(normaliseOptionName(spelling), tier)
    })

    return { workshopId, tierOf, instructorRows }
  }

  /** The dearest of the tiers named: a top-up costs less than the tier it buys, so the room type's price decides. */
  const dearest = (tiers: Tier[]) => [...tiers].sort((a, b) => b.priceSgd - a.priceSgd || a.ord - b.ord)[0]

  const soldAt = (j: JoinedSale) => zonedToInstant(j.sale.soldAt, tz)
  /**
   * A sale made by a run's last day that was for a later run: the place it
   * bought (its register row) runs on more than a run's gap past that day.
   */
  const forLater = (j: JoinedSale, lastDay: number) =>
    j.register !== null && dayNumber(j.register.expiration) - lastDay > RUN_GAP_DAYS
  const firstSale = (sold: JoinedSale[]) => [...sold].sort((a, b) => soldAt(a).getTime() - soldAt(b).getTime())[0]

  const booking = (workshopId: string, clientId: string, tier: Tier, fields: Row): Row => {
    const key = `${workshopId}/${clientId}`
    const made = input.codes(key)
    const row: Row = {
      id: id('booking', key),
      tenant_id: tenantId,
      client_id: ids.clients![clientId],
      kind: 'workshop',
      class_id: null,
      workshop_id: workshopId,
      workshop_tier_id: tier.id,
      pt_session_id: null,
      client_package_id: null,
      state: 'confirmed',
      // A workshop place is bought outright: there is no credit to give back.
      credits_or_sessions_used: null,
      refund_outcome: 'n_a',
      check_in_state: 'pending',
      qr_token: made.qrToken,
      code: made.code,
      ...fields,
    }
    bookings.push(row)
    bookingIds[key] = row.id as string
    return row
  }

  for (const w of config.workshops) {
    if (!w.migrate) {
      // Off the timetable, or its days came across as classes and nothing is left behind.
      const offTimetable = config.workshopCategories.some(c => fold(c) === fold(w.category))
      if (from !== null && offTimetable) leftBehind(w.name ?? w.category, w.category, workshopOptionsOf(w), '(migrate: false)')
      continue
    }

    const future = occurrencesOf(w.category, w.name, startsAt => startsAt > asOf)
    const firstToCome = future.size > 0 ? Math.min(...[...future.values()].map(d => dayNumber(d.date))) : null
    // Every run already held, the whole timetable over. One still going at the
    // download — its last past day within a run's gap of a day to come — is the
    // workshop to come, not a past one: its places are the holdings' and not
    // its sales' twice over.
    const heldRuns = runsOf(occurrencesOf(w.category, w.name, startsAt => startsAt <= asOf))
    const lastOf = (run: Map<string, Occurrence>) => Math.max(...[...run.values()].map(d => dayNumber(d.date)))
    const going =
      heldRuns.at(-1) && firstToCome !== null && firstToCome - lastOf(heldRuns.at(-1)!) <= RUN_GAP_DAYS ? heldRuns.pop()! : null
    if (going && from !== null) {
      notes.push(
        `workshop ${w.name}: ${going.size} of its day(s) were before the download and it goes on after it, so it came across as the workshop to come, with only its days to come`,
      )
    }
    // The category's last day of a run already over: a sale after it is for the next run.
    const lastHeld = heldRuns.length > 0 ? lastOf(heldRuns.at(-1)!) : null
    const runs = from === null ? [] : heldRuns.filter(run => isoDay([...run.values()][0]!.date) >= from)
    // One name for one Workshop; where the category ran more than once, each past run is named by its first day.
    const several = runs.length + (future.size > 0 ? 1 : 0) > 1

    /* ── The runs already held ─────────────────────────────────────────── */

    // Sales before a run the window leaves out were for that run, not the first one in it.
    const before = heldRuns.filter(run => !runs.includes(run))
    let heldBefore: number | null = before.length > 0 ? lastOf(before.at(-1)!) : null
    for (const run of runs) {
      const days = [...run.values()].sort((a, b) => occurrenceKey(a).localeCompare(occurrenceKey(b)))
      const first = isoDay(days[0]!.date)
      const lastDay = dayNumber(days.at(-1)!.date)
      const name = several ? `${w.name} (${first})` : w.name
      const made = writeWorkshop(w, `${w.category}/${first}`, name, run, true)
      const startOf = (day: Occurrence) => instant(day.date, day.start)

      // Who came: every visit on one of its days, under one of its names.
      const dayOf = new Map<string, Occurrence>()
      for (const day of days) for (const n of day.names) dayOf.set(visitKey(day.date, day.start, n), day)
      const visits = new Map<string, { outcome: Exclude<Outcome, 'early_cancel'>; option: string; day: Occurrence }[]>()
      for (const v of input.attendance) {
        const day = dayOf.get(visitKey(v.date, v.start, v.description))
        const outcome = outcomeOf(v.status)
        if (!day || outcome === 'early_cancel') continue
        visits.set(v.clientId, [...(visits.get(v.clientId) ?? []), { outcome, option: v.option, day }])
      }

      // What each attendee bought of it: sold after the run before it and by its
      // last day — unless what the sale bought runs on well past this run, when
      // it was a place on a later one (a deposit paid ahead).
      const salesOf = (clientId: string) =>
        input.sales.sold.filter(j => {
          const sold = dayNumber(j.sale.soldAt)
          return (
            j.sale.clientId === clientId &&
            made.tierOf.has(normaliseOptionName(j.sale.description)) &&
            sold <= lastDay &&
            (heldBefore === null || sold > heldBefore) &&
            !forLater(j, lastDay)
          )
        })

      let unsold = 0
      for (const clientId of [...visits.keys()].sort()) {
        const mine = visits.get(clientId)!
        if (!memberNames.has(clientId)) {
          notes.push(`${clientId}: came to ${name} and is not in the member list`)
          continue
        }
        const sold = salesOf(clientId)
        const tier = dearest(
          [...mine.map(v => v.option), ...sold.map(j => j.sale.description)].flatMap(o => made.tierOf.get(normaliseOptionName(o)) ?? []),
        )
        if (!tier) {
          notes.push(`${clientId} ${nameOf(clientId)}: came to ${name} and no visit or sale of theirs names one of its tiers, so no place was imported`)
          continue
        }
        for (const j of sold) placedSales.add(j)
        // A return takes back what it gave; a promotion's discount is money the List Price still carries.
        const paid = sold.reduce((sum, j) => sum + j.sale.total + (j.returnedBy?.total ?? 0), 0)
        const discount = sold.reduce((sum, j) => sum + j.discount, 0)
        if (sold.length === 0) unsold++
        const outcome = mine.map(v => v.outcome).sort((a, b) => STRENGTH[a] - STRENGTH[b])[0]!
        const settlement = SETTLEMENT[outcome]
        const came = mine.filter(v => v.outcome === 'attended').map(v => startOf(v.day)).sort((a, b) => a.getTime() - b.getTime())[0]
        const firstDay = startOf(days[0]!)
        const bought = firstSale(sold)
        const row = booking(made.workshopId, clientId, tier, {
          state: settlement.state,
          refund_outcome: settlement.refund_outcome,
          check_in_state: settlement.check_in_state,
          list_price_sgd: money(Math.round((paid + discount) * 100) / 100),
          amount_paid_sgd: money(Math.round(paid * 100) / 100),
          // Dated on the sale, so Finance shows the money in the month it was taken.
          booked_at: (bought ? soldAt(bought) : firstDay).toISOString(),
          cancelled_at: outcome === 'late_cancel' ? firstDay.toISOString() : null,
        })
        if (came) {
          checkIns.push({
            id: id('check-in', `${made.workshopId}/${clientId}`),
            tenant_id: tenantId,
            booking_id: row.id,
            checked_in_at: came.toISOString(),
            checked_in_by_staff_id: input.ownerId,
            // Nobody scanned a code in Mindbody: the studio marked them present.
            method: 'manual',
          })
        }
      }
      if (unsold > 0) {
        notes.push(`${name}: ${unsold} place(s) have no sale of its options in Big Spenders, so they came across paid 0.00`)
      }

      // What Payroll paid for its days is its instructors' pay, whoever was paid.
      const pay = new Map<string, number>()
      for (const p of payrollOn(run)) {
        const staffId = staffIds.get(normaliseStaffName(p.staff))
        // Not coming across: left for history, which names it with the rest.
        if (!staffId) continue
        placedPayroll.add(p)
        pay.set(staffId, (pay.get(staffId) ?? 0) + p.earnings)
      }
      for (const [staffId, amount] of [...pay].sort(([a], [b]) => a.localeCompare(b))) {
        const cents = Math.round(amount * 100) / 100
        const row = made.instructorRows.get(staffId)
        if (row) row.pay_sgd = money(cents)
        else {
          // Paid for it without being on its timetable: a supporting instructor, so the pay has somewhere to be.
          if (!input.instructorIds.has(staffId)) extraInstructors.add(staffId)
          workshopInstructors.push({
            tenant_id: tenantId,
            workshop_id: made.workshopId,
            instructor_id: staffId,
            role: made.instructorRows.size === 0 ? 'main' : 'supporting',
            pay_sgd: money(cents),
          })
          made.instructorRows.set(staffId, workshopInstructors.at(-1)!)
        }
      }
      heldBefore = lastDay
    }

    /* ── The days to come ──────────────────────────────────────────────── */

    if (future.size === 0) {
      notes.push(
        runs.length > 0
          ? `workshop ${w.name}: nothing under the service category "${w.category}" is still to come, so only its past came across`
          : `workshop ${w.name}: nothing under the service category "${w.category}" is still to come, so it was not imported`,
      )
      // Nobody's paid place vanishes unsaid. Its pricing options are excluded
      // from the catalogue and the preflight on the promise that they come
      // across as bookings; with no day to book, this is where that is said.
      for (const [clientId, paid] of paidTowards(w, input.holdings, today)) {
        notes.push(
          `${clientId} ${nameOf(clientId)}: holds a place on ${w.name} worth ${money(paid)}, which did not come across`,
        )
      }
      continue
    }

    const made = writeWorkshop(w, w.category, w.name, future, false)

    /* ── Who has paid for a place ──────────────────────────────────────── */

    // Every holding of a tier's pricing option, live or not. That option buys
    // this workshop and nothing else, so all of it is money for this place —
    // including a deposit Mindbody sold with no visits on it at all, which is
    // money and never "live". What decides whether a place is held is whether
    // any one of them is.
    const held = new Map<string, { tier: Tier; holding: HoldingRow }[]>()
    for (const h of input.holdings) {
      const tier = made.tierOf.get(normaliseOptionName(h.option))
      if (!tier) continue
      held.set(h.clientId, [...(held.get(h.clientId) ?? []), { tier, holding: h }])
    }

    let undated = 0
    for (const clientId of [...held.keys()].sort()) {
      const mine = held.get(clientId)!
      const paid = mine.reduce((sum, h) => sum + h.holding.totalPaid, 0)
      if (!mine.some(h => isLive(h.holding, today))) {
        // Spent, expired, or sold with no expiry date at all: no place, and a
        // line for a person rather than silence where money was paid.
        if (paid > 0) {
          notes.push(`${clientId} ${nameOf(clientId)}: paid ${money(paid)} towards ${w.name} and holds nothing live against it, so no place was imported`)
        }
        continue
      }
      if (!memberNames.has(clientId)) {
        notes.push(`${clientId}: holds a place on ${w.name} and is not in the member list`)
        continue
      }
      const tier = dearest(mine.map(h => h.tier))!
      const tiers = new Set(mine.map(h => h.tier.id))
      if (tiers.size > 1) {
        notes.push(
          `${clientId} ${memberNames.get(clientId)}: holds ${tiers.size} tiers of ${w.name} — imported once at ${tier.name}, for ${money(paid)}`,
        )
      }
      // When it was bought: the first sale of one of its options since the
      // category last ran, and by the download. Finance dates the place on it.
      const sold = input.sales.sold.filter(
        j =>
          j.sale.clientId === clientId &&
          made.tierOf.has(normaliseOptionName(j.sale.description)) &&
          !placedSales.has(j) &&
          (lastHeld === null || dayNumber(j.sale.soldAt) > lastHeld || forLater(j, lastHeld)) &&
          soldAt(j) <= asOf,
      )
      for (const j of sold) placedSales.add(j)
      const bought = firstSale(sold)
      if (!bought) undated++
      booking(made.workshopId, clientId, tier, {
        // A place paid for in instalments can have cost more than the tier's
        // price, and a List Price below what was paid reads as a negative discount.
        list_price_sgd: money(Math.max(tier.priceSgd, paid)),
        amount_paid_sgd: money(paid),
        booked_at: (bought ? soldAt(bought) : asOf).toISOString(),
      })
    }
    if (undated > 0) {
      notes.push(
        `workshop ${w.name}: ${undated} place(s) have no sale in Big Spenders, so they are dated on the download day — Finance shows their money then`,
      )
    }
  }

  // A category kept off the timetable with no workshop entry at all: its past is left out too, and said.
  if (from !== null) {
    const entries = new Set(config.workshops.map(w => fold(w.category)))
    for (const category of config.workshopCategories) {
      if (!entries.has(fold(category))) leftBehind(category, category, new Set(), '(no workshops entry)')
    }
  }

  if (problems.length > 0) throw new ConfigError(problems)

  return {
    workshops,
    workshopDays,
    workshopTiers,
    workshopTierDays,
    workshopInstructors,
    bookings,
    checkIns,
    instructors: [...extraInstructors].sort().map(staffId => ({ staff_user_id: staffId, tenant_id: tenantId })),
    placedSales,
    placedPayroll,
    notes,
  }

  /**
   * A category whose past does not come across: its visits, its sales and its
   * pay inside the history window, counted, so the loss is visible. Its pay is
   * not lost — history keeps it as Manual Payroll Entries.
   */
  function leftBehind(name: string, category: string, options: Set<string>, why: string) {
    const held = occurrencesOf(category, name, (startsAt, day) => startsAt <= asOf && isoDay(day) >= from!)
    if (held.size === 0) return
    const known = new Set<string>()
    for (const day of held.values()) for (const n of day.names) known.add(visitKey(day.date, day.start, n))
    const visits = input.attendance.filter(
      v => known.has(visitKey(v.date, v.start, v.description)) && outcomeOf(v.status) !== 'early_cancel',
    ).length
    const last = Math.max(...[...held.values()].map(d => dayNumber(d.date)))
    const sold = input.sales.sold.filter(
      j => options.has(normaliseOptionName(j.sale.description)) && isoDay(j.sale.soldAt) >= from! && dayNumber(j.sale.soldAt) <= last,
    )
    const takings = sold.reduce((sum, j) => sum + j.sale.total, 0)
    const pay = payrollOn(held).reduce((sum, p) => sum + p.earnings, 0)
    notes.push(
      `workshop ${name} is not migrated ${why}: ${visits} past visit(s) on ${held.size} day(s), ${sold.length} sale line(s) totalling ${money(takings)}, ` +
        `and ${money(Math.round(pay * 100) / 100)} of payroll were left out of Workshops — the payroll came across as Manual Payroll Entries`,
    )
  }
}
