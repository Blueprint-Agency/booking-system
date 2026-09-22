import type { BookingCoder } from './booking-codes'
import { isLive } from './catalogue'
import { ConfigError, type StudioConfig } from './config'
import type { HoldingRow, ScheduledClassRow } from './readers'
import {
  isoClock,
  isoDay,
  localDateOf,
  money,
  normaliseOptionName,
  normaliseStaffName,
  zonedToInstant,
  type CalendarDate,
  type ClockTime,
} from './values'

/**
 * The workshops and retreats still to come, and the members who have paid for
 * a place on one.
 *
 * Pure, like the rest of the mapper. A workshop is a Mindbody *service
 * category* — a workshop, a retreat or a course has one of its own — so its
 * days are the future rows of the staff schedule filed under it, one Day per
 * occurrence, and the teachers on those rows are its instructors: whoever leads
 * the most days is the main one and the rest are supporting.
 *
 * Its Tiers are the room types it was sold by (twin, single, non-resident),
 * which Mindbody sells as pricing options; the config names them and prices
 * them, because no report holds a workshop's price list. A member holding one
 * of those options is an attendee: one booking, at the tier they bought, for
 * what they paid. Several holdings — a deposit and its balance, a twin place
 * and a top-up to single — are one booking whose amount is their sum, at the
 * dearest tier they hold, because a top-up is what moves a member up.
 *
 * A tier's pricing options come across as bookings, so they are kept out of the
 * catalogue and out of the "not migrated" list (`./packages.ts`). Every place
 * that does not become a booking after all — a workshop with no day left to
 * come, a holding spent or sold with no expiry date — is a preflight line, so
 * that money paid is never passed over in silence.
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
  /** Staff who lead a workshop and had no instructor profile yet. */
  instructors: Row[]
  /** What a person should look at: a workshop with no days left, a member who paid for two tiers. */
  notes: string[]
}

const fold = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

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
  const workshopIds: Record<string, string> = (ids.workshops = {})
  const tierIds: Record<string, string> = (ids.workshop_tiers = {})
  const bookingIds: Record<string, string> = (ids.bookings ??= {})

  for (const w of config.workshops) {
    if (!w.migrate) continue

    /* ── Its days ──────────────────────────────────────────────────────── */

    // One occurrence, however many teachers the report files it under: the
    // staff schedule repeats a class in every teacher's section, and a workshop
    // with two teachers is one day led by both.
    type Occurrence = { date: CalendarDate; start: ClockTime; end: ClockTime; rooms: string[]; staff: Set<string> }
    const occurrences = new Map<string, Occurrence>()
    for (const r of input.schedule) {
      if (fold(r.serviceCategory) !== fold(w.category)) continue
      const startsAt = instant(r.date, r.start)
      if (startsAt <= asOf) continue
      const label = `${w.name} on ${isoDay(r.date)} at ${isoClock(r.start)}`
      if (instant(r.date, r.end) <= startsAt) {
        notes.push(`${label}: ends before it starts in Mindbody, so that day was not imported`)
        continue
      }
      const key = `${isoDay(r.date)} ${isoClock(r.start)} ${isoClock(r.end)}`
      const day = occurrences.get(key) ?? { date: r.date, start: r.start, end: r.end, rooms: [], staff: new Set() }
      if (r.room) day.rooms.push(r.room)
      day.staff.add(r.staff)
      occurrences.set(key, day)
    }
    if (occurrences.size === 0) {
      notes.push(`workshop ${w.name}: nothing under the service category "${w.category}" is still to come, so it was not imported`)
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
    // The key is `YYYY-MM-DD HH:MM HH:MM`, so sorting it sorts by when.
    const dayKeys = [...occurrences.keys()].sort()

    const workshopId = id('workshop', w.category)
    workshops.push({
      id: workshopId,
      tenant_id: tenantId,
      name: w.name,
      cover_r2_key: null,
      description_html: null,
      location_id: ids.locations![w.location],
      lifecycle: 'active',
      cancelled_at: null,
      cancelled_by_staff_id: null,
      created_at: asOf.toISOString(),
      created_by_staff_id: input.ownerId,
    })
    workshopIds[w.name] = workshopId

    const dayIds: string[] = []
    dayKeys.forEach((key, i) => {
      const day = occurrences.get(key)!
      // The first spelling the config knows — named beside its Room, so a
      // mismatch names the spelling that caused it and not whatever was listed
      // first, which may be a venue the config has never heard of.
      const spelled = day.rooms.find(r => rooms.has(fold(r)))
      const named = spelled ? rooms.get(fold(spelled))! : undefined
      // A Day's Room must be at the workshop's own Location; one somewhere else
      // would fail the portal's own rule the first time an admin opened it.
      if (named && named.location !== w.location) {
        notes.push(`${w.name} on ${isoDay(day.date)}: it is in ${spelled}, which is not at its Location, so no Room was set`)
      }
      const dayId = id('workshop-day', `${w.category}/${key}`)
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
    dayKeys.forEach((key, i) => {
      for (const staff of occurrences.get(key)!.staff) {
        const staffKey = normaliseStaffName(staff)
        const lead = leads.get(staffKey) ?? { name: staff, days: 0, first: i }
        lead.days += 1
        leads.set(staffKey, lead)
      }
    })
    const ranked = [...leads]
      .filter(([staffKey, lead]) => {
        if (staffIds.has(staffKey)) return true
        problems.push(`staff: ${lead.name} leads the workshop "${w.name}" and is not coming across — migrate them, or take it off the timetable`)
        return false
      })
      // Whoever leads the most days is the main one; then whoever is there
      // first, then by name, so the report's order never decides.
      .sort(([a, x], [b, y]) => y.days - x.days || x.first - y.first || a.localeCompare(b))
    ranked.forEach(([staffKey], i) => {
      const staffId = staffIds.get(staffKey)!
      // Leading a workshop makes a staff member an instructor, if they were
      // not one already: the row points at an instructor profile.
      if (!input.instructorIds.has(staffId)) extraInstructors.add(staffId)
      workshopInstructors.push({
        tenant_id: tenantId,
        workshop_id: workshopId,
        instructor_id: staffId,
        role: i === 0 ? 'main' : 'supporting',
        // Mindbody pays a workshop by agreement, which no report gives: Unpriced.
        pay_sgd: null,
      })
    })

    /* ── Its tiers ─────────────────────────────────────────────────────── */

    const tierOf = new Map<string, Tier>()
    w.tiers.forEach((t, i) => {
      const tierId = id('workshop-tier', `${w.category}/${normaliseOptionName(t.name)}`)
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
      tierIds[`${w.name} / ${t.name}`] = tierId
      // A room type is the whole workshop: nobody buys a bed for one night of a
      // retreat, so every tier grants every day.
      for (const dayId of dayIds) {
        workshopTierDays.push({ tenant_id: tenantId, workshop_tier_id: tierId, workshop_day_id: dayId })
      }
      for (const spelling of t.mindbodyNames) tierOf.set(normaliseOptionName(spelling), tier)
    })

    /* ── Who has paid for a place ──────────────────────────────────────── */

    // Every holding of a tier's pricing option, live or not. That option buys
    // this workshop and nothing else, so all of it is money for this place —
    // including a deposit Mindbody sold with no visits on it at all, which is
    // money and never "live". What decides whether a place is held is whether
    // any one of them is.
    const held = new Map<string, { tier: Tier; holding: HoldingRow }[]>()
    for (const h of input.holdings) {
      const tier = tierOf.get(normaliseOptionName(h.option))
      if (!tier) continue
      held.set(h.clientId, [...(held.get(h.clientId) ?? []), { tier, holding: h }])
    }

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
      // The dearest tier held. A top-up costs less than the tier it buys, so
      // the amount paid cannot decide; the price of the room type can.
      const tier = [...mine].sort((a, b) => b.tier.priceSgd - a.tier.priceSgd || a.tier.ord - b.tier.ord)[0]!.tier
      const tiers = new Set(mine.map(h => h.tier.id))
      if (tiers.size > 1) {
        notes.push(
          `${clientId} ${memberNames.get(clientId)}: holds ${tiers.size} tiers of ${w.name} — imported once at ${tier.name}, for ${money(paid)}`,
        )
      }
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
        // A place paid for in instalments can have cost more than the tier's
        // price, and a List Price below what was paid reads as a negative discount.
        list_price_sgd: money(Math.max(tier.priceSgd, paid)),
        amount_paid_sgd: money(paid),
        // A workshop place is bought outright: there is no credit to give back.
        credits_or_sessions_used: null,
        refund_outcome: 'n_a',
        check_in_state: 'pending',
        qr_token: made.qrToken,
        code: made.code,
        booked_at: asOf.toISOString(),
      }
      bookings.push(row)
      bookingIds[key] = row.id as string
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
    instructors: [...extraInstructors].sort().map(staffId => ({ staff_user_id: staffId, tenant_id: tenantId })),
    notes,
  }
}
