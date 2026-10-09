import { isLive } from './catalogue'
import { ConfigError, type CatalogueEntry, type StudioConfig } from './config'
import type { AccountBalanceRow, AttendanceRow, HoldingRow, MemberListRow, MembershipRow, OptionSaleRow, RetentionRow, RosterRow } from './readers'
import { fold, locationNamedIn } from './lookups'
import { registerMatcher } from './register'
import { packageMoney, type JoinedSales } from './sales'
import {
  dayNumber,
  isoDay,
  localDateOf,
  money,
  normaliseClassName,
  normaliseOptionName,
  normaliseStaffName,
  zonedToInstant,
  type CalendarDate,
  type LocalDateTime,
} from './values'

/**
 * The catalogue, and what every member still holds of it.
 *
 * Pure, like the rest of the mapper. The config's catalogue says what each
 * Mindbody pricing option is here; the Visits Remaining report says who holds
 * what. A holding becomes one `client_packages` row under the platform's own
 * rule (`be/docs/adr/0010`): any number of packages may run at once in a
 * Family, as they did in Mindbody.
 *
 *  - One Mindbody had started runs beside any others, with its Mindbody expiry.
 *  - One Mindbody had not started yet waits Dormant with its whole validity.
 *
 * Balances are the report's *unbooked* count: a booking here spends its credit
 * when it is made, so a visit already booked is a credit already spent.
 *
 * One exception, for PT: purchases of one bundle a member trained on with more
 * than one trainer are re-split by trainer (`byTrainer`), each bound to its own.
 */

type Row = Record<string, unknown>
type Migrated = Exclude<CatalogueEntry, { migrate: 'skip' }>
type Sold = Exclude<Migrated, { kind: 'access_pass' }>

/** Something a member holds in Mindbody that does not come across, for a person to settle by hand. */
export type NotMigrated = {
  clientId: string
  name: string
  option: string
  /** `3 left`, `unlimited`. */
  left: string
  /** The last day it is good for, `YYYY-MM-DD`, or `no expiry date` where Mindbody holds none. */
  expires: string
  reason: string
}

export type AccountBalance = { clientId: string; name: string; balance: string }

export type MappedPackages = {
  classPackages: Row[]
  ptPackages: Row[]
  clientPackages: Row[]
  notMigrated: NotMigrated[]
  balances: AccountBalance[]
  /**
   * Package id → credits Mindbody had already set aside for future bookings
   * (its Remaining less its Unbooked), which the package arrives without. The
   * mapper gives back whatever of it no imported booking accounts for.
   */
  bookedAhead: Map<string, number>
  /** Package id → the days its own purchase ran (register), where a holding was split into purchases. */
  runs: Map<string, { from: number; to: number }>
  /** What a person should know: holdings split into purchases, prices taken from the register. */
  notes: string[]
}

const catalogueKey = (e: CatalogueEntry) => normaliseOptionName(e.name)

/** A member's holding of one catalogue entry — one purchase, or several Mindbody combined — as one package. */
type Held = {
  clientId: string
  entry: Sold
  firstActivation: LocalDateTime | null
  lastExpiration: LocalDateTime
  paid: number
  /** Null on an Unlimited Plan. */
  balance: number | null
  /** Credits Mindbody had already set aside for future bookings (Remaining − Unbooked). */
  bookedAhead: number
  /** `#2`, `#3`… for the second and later purchases of a holding split back into its purchases. */
  suffix: string
  /** What a promotion took off its one purchase (Promotions); 0 where none did, or it is several combined. */
  discount: number
  /** The Location the option it was bought as names (`optionHome`), for a plan Mindbody sold once per Location. */
  home: string | null
  /** The **Bound Instructor**'s staff key (`normaliseStaffName`), where `byTrainer` bound this PT purchase; else null. */
  trainer: string | null
}

const count = (s: HoldingRow['remaining']) => (s && !s.unlimited ? s.count : 0)

function combine(clientId: string, entry: Sold, holdings: HoldingRow[], home: string | null = null): Held {
  const started = holdings.flatMap(h => (h.firstActivation ? [h.firstActivation] : []))
  const ends = holdings.map(h => h.lastExpiration!)
  const by = (pick: (a: number, b: number) => number, dates: LocalDateTime[]) =>
    dates.reduce((a, b) => (pick(dayNumber(a), dayNumber(b)) === dayNumber(a) ? a : b))
  const unlimited = entry.kind === 'unlimited'
  return {
    clientId,
    entry,
    firstActivation: started.length > 0 ? by(Math.min, started) : null,
    lastExpiration: by(Math.max, ends),
    paid: holdings.reduce((sum, h) => sum + h.totalPaid, 0),
    balance: unlimited ? null : holdings.reduce((sum, h) => sum + count(h.unbooked), 0),
    bookedAhead: unlimited ? 0 : holdings.reduce((sum, h) => sum + Math.max(0, count(h.remaining) - count(h.unbooked)), 0),
    suffix: '',
    discount: 0,
    home,
    trainer: null,
  }
}

/**
 * A combined holding split back into the purchases it is made of, from the
 * pricing-option register — each with its own start, expiry, price and credits,
 * so an earlier pack's credits keep the earlier pack's expiry.
 *
 * Only where the register accounts for the holding exactly: its live purchases'
 * credits add up to the report's Remaining. The credits Mindbody set aside for
 * future bookings come off the soonest-ending purchase first, the one a booking is paid by first.
 * Anything short of that and the holding stays combined, as Mindbody shows it.
 */
function split(combined: Held, holdings: HoldingRow[], purchases: OptionSaleRow[], discountOf: (p: OptionSaleRow) => number): Held[] | null {
  if (purchases.length < 2 || combined.entry.kind === 'trial') return null
  const ordered = [...purchases].sort(
    (a, b) => dayNumber(a.expiration) - dayNumber(b.expiration) || dayNumber(a.activation) - dayNumber(b.activation),
  )
  const unlimited = combined.entry.kind === 'unlimited'
  if (!unlimited) {
    const registered = ordered.reduce((sum, p) => sum + count(p.remaining), 0)
    const reported = holdings.reduce((sum, h) => sum + count(h.remaining), 0)
    if (registered !== reported) return null
  }
  let toTake = combined.bookedAhead
  return ordered.map((p, i) => {
    const credits = count(p.remaining)
    const taken = Math.min(credits, toTake)
    toTake -= taken
    return {
      clientId: combined.clientId,
      entry: combined.entry,
      firstActivation: p.activation,
      lastExpiration: p.expiration,
      paid: p.paid,
      balance: unlimited ? null : credits - taken,
      bookedAhead: taken,
      suffix: i === 0 ? '' : `#${i + 1}`,
      discount: discountOf(p),
      home: combined.home,
      trainer: null,
    }
  })
}

/** A PT session as far as which purchase should pay for it: who taught it (a staff key), and its day. */
type PtVisit = { trainer: string; day: number }

/**
 * A PT holding already split into its purchases, re-split by trainer.
 *
 * Mindbody records which pricing option a visit came off, never which purchase
 * of it, and nothing ties a purchase to a trainer. So a member who bought one
 * bundle for one trainer and a second of the same bundle for another sees
 * sessions with the second trainer taken off the first bundle, and the register's
 * balances carry that. The platform has the tie Mindbody lacked, the **Bound
 * Instructor**, and this restores it. Each purchase, oldest first, is bound to
 * the trainer who taught the most visits in its run (once taken, a trainer is
 * not offered again). Then each purchase's sessions left are what its trainer's
 * visits left, and sessions already booked ahead come off the purchase bound to
 * that appointment's trainer.
 *
 * Only where that accounts for Mindbody exactly: the visits by each purchase's
 * own trainer in its run add up to the sessions Mindbody used across the
 * purchases. The member's total sessions left is therefore Mindbody's, moved
 * between purchases and never made or lost. Anything short of that (a third
 * trainer, a visit outside every run, a past purchase sharing the window) is
 * `unsettled`, and the holding stays as Mindbody split it, unbound. Null where
 * there is nothing to do: fewer than two trainers.
 */
function byTrainer(
  parts: Held[],
  visits: PtVisit[],
  ahead: string[],
  today: number,
): { parts: Held[]; moved: number } | { unsettled: { trainers: number; used: number; taught: number } } | null {
  const entry = parts[0]!.entry
  if (entry.kind !== 'pt') return null
  const runs = parts.map(p => ({
    p,
    from: p.firstActivation ? dayNumber(p.firstActivation) : -Infinity,
    to: Math.min(dayNumber(p.lastExpiration), today),
  }))
  const earliest = Math.min(...runs.map(r => r.from))
  const seen = visits.filter(v => v.day >= earliest && v.day <= today)
  const trainers = new Set(seen.map(v => v.trainer))
  if (trainers.size < 2) return null

  const inRun = (r: (typeof runs)[number], v: PtVisit) => v.day >= r.from && v.day <= r.to
  const trainerOf = new Map<Held, string>()
  const taken = new Set<string>()
  for (const r of [...runs].sort((a, b) => a.from - b.from || dayNumber(a.p.lastExpiration) - dayNumber(b.p.lastExpiration))) {
    const tally = new Map<string, number>()
    for (const v of seen) if (inRun(r, v) && !taken.has(v.trainer)) tally.set(v.trainer, (tally.get(v.trainer) ?? 0) + 1)
    const best = [...tally].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0]?.[0]
    if (best === undefined) continue
    trainerOf.set(r.p, best)
    taken.add(best)
  }

  const taughtOn = (r: (typeof runs)[number]) => seen.filter(v => v.trainer === trainerOf.get(r.p) && inRun(r, v)).length
  // Mindbody's own sessions left on a purchase: its balance and what it set aside.
  const used = parts.reduce((sum, p) => sum + entry.credits - (p.balance! + p.bookedAhead), 0)
  const taught = runs.reduce((sum, r) => sum + taughtOn(r), 0)
  const unsettled = { unsettled: { trainers: trainers.size, used, taught } }
  if (trainerOf.size < parts.length || taught !== used || runs.some(r => taughtOn(r) > entry.credits)) return unsettled

  // Booked ahead: each appointment off its trainer's purchase, any left over
  // off the soonest-ending purchase with room, as `split` takes it.
  const left = new Map(runs.map(r => [r.p, entry.credits - taughtOn(r)]))
  const aside = new Map(parts.map(p => [p, 0]))
  let toTake = parts.reduce((sum, p) => sum + p.bookedAhead, 0)
  for (const p of parts) {
    const theirs = ahead.filter(t => t === trainerOf.get(p)).length
    const n = Math.min(theirs, toTake, left.get(p)!)
    aside.set(p, n)
    toTake -= n
  }
  for (const p of parts) {
    const n = Math.min(toTake, left.get(p)! - aside.get(p)!)
    aside.set(p, aside.get(p)! + n)
    toTake -= n
  }
  if (toTake > 0) return unsettled

  const moved = runs.reduce((sum, r) => sum + Math.max(0, left.get(r.p)! - (r.p.balance! + r.p.bookedAhead)), 0)
  return {
    parts: parts.map(p => ({
      ...p,
      balance: left.get(p)! - aside.get(p)!,
      bookedAhead: aside.get(p)!,
      trainer: trainerOf.get(p)!,
    })),
    moved,
  }
}

/**
 * An Unlimited Plan's Home Location, from the plan alone: the config's, else
 * the Location its name names, else the default — null for the default, so a
 * caller can say it was a guess. Every plan has one — the platform requires it —
 * past purchases included.
 */
function homeFromPlan(config: StudioConfig, entry: { name: string; mindbodyNames: string[]; location: string | null }): string | null {
  if (entry.location) return entry.location
  const spelled = [entry.name, ...entry.mindbodyNames].map(normaliseOptionName)
  return config.locations.find(l => spelled.some(s => s.includes(l.name.trim().toLowerCase())))?.key ?? null
}

export function planHome(config: StudioConfig, entry: { name: string; mindbodyNames: string[]; location: string | null }): string {
  return homeFromPlan(config, entry) ?? config.defaultLocation
}

/**
 * The Location a member's plan covers, read off the option they bought, where
 * Mindbody sold the plan once per Location (`Unlimited 6`, `Unlimited 6 -
 * <Location>`) and the catalogue holds it as one package (`foldLocationVariants`
 * in `./fill.ts`): the Location the spelling names, else — the unlabelled one —
 * the entry's own Location, else the default. Every purchase in Mindbody was
 * bound to the Location it was bought for, so this beats anything the reports
 * say of the member. Null for any other option: a plan whose spellings name no
 * Location is homed from the member (`memberHomes`), and only a plan has a home.
 */
export function optionHome(config: StudioConfig, entry: CatalogueEntry, option: string): string | null {
  if (entry.migrate === 'skip' || entry.kind !== 'unlimited') return null
  const named = locationNamedIn(config.locations, option)
  if (named) return named
  if (!entry.mindbodyNames.some(n => locationNamedIn(config.locations, n))) return null
  return entry.location ?? config.defaultLocation
}

/** Where a member's Home Location was read from, most trusted first. */
export const HOME_SOURCES = ['option', 'retention', 'membership', 'sold', 'plan', 'default'] as const
export type HomeSource = (typeof HOME_SOURCES)[number]
type MemberSource = Exclude<HomeSource, 'option' | 'plan' | 'default'>

/**
 * The Location each member belongs to, by what the reports say of them rather
 * than of their plan: Retention Management's location (a Mindbody location id),
 * then the Membership report's (a name), then where the options their visits
 * were paid from were most often sold.
 */
export function memberHomes(
  config: StudioConfig,
  reports: { retention: RetentionRow[]; membership: MembershipRow[]; attendance: AttendanceRow[] },
): Map<string, { location: string; source: MemberSource }> {
  const fold = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const byId = new Map(config.locations.flatMap(l => l.mindbodyIds.map(id => [id.trim(), l.key] as const)))
  const byName = new Map(config.locations.flatMap(l => [l.name, ...l.mindbodyNames].map(n => [fold(n), l.key] as const)))
  const homes = new Map<string, { location: string; source: MemberSource }>()

  const sold = new Map<string, Map<string, number>>()
  for (const v of reports.attendance) {
    const key = byName.get(fold(v.saleLocation))
    if (!key) continue
    const mine = sold.get(v.clientId) ?? new Map<string, number>()
    mine.set(key, (mine.get(key) ?? 0) + 1)
    sold.set(v.clientId, mine)
  }
  for (const [clientId, tally] of sold) {
    const [location] = [...tally].sort(([a, n], [b, m]) => m - n || a.localeCompare(b))[0]!
    homes.set(clientId, { location, source: 'sold' })
  }
  // An active membership says more than one that has lapsed.
  const memberships = [...reports.membership].sort((a, b) => Number(/^active$/i.test(a.status)) - Number(/^active$/i.test(b.status)))
  for (const m of memberships) {
    const key = byName.get(fold(m.location))
    if (key) homes.set(m.id, { location: key, source: 'membership' })
  }
  for (const r of reports.retention) {
    const key = byId.get(r.location.trim())
    if (key) homes.set(r.id, { location: key, source: 'retention' })
  }
  return homes
}

export function mapPackages(input: {
  holdings: HoldingRow[]
  balances: AccountBalanceRow[]
  config: StudioConfig
  tenantId: string
  id: (kind: string, key: string) => string
  /** Mindbody key → platform id, filled in here for the three package tables. */
  ids: Record<string, Record<string, string>>
  /** Every member being imported, by barcode. */
  memberNames: Map<string, string>
  /**
   * The pricing options that buy a place on a workshop coming across
   * (`./workshops.ts`), normalised. A place is not a package: it is a booking,
   * so it is neither wanted in the catalogue nor left behind in the preflight.
   */
  workshopOptions: Set<string>
  /** The pricing-option register (one row per purchase) and the member list, to split a combined holding. */
  optionSales: OptionSaleRow[]
  members: MemberListRow[]
  /** Every sale joined to its register row (`./sales.ts`): a returned purchase is not live, and a promotion is a real discount. */
  sales: JoinedSales
  /** The Location each member belongs to, where a report says (`memberHomes`): an Unlimited Plan's Home Location. */
  homes: ReturnType<typeof memberHomes>
  /** Past visits and the option each came off, and the appointments to come: who trained a member's PT purchases (`byTrainer`). */
  attendance: AttendanceRow[]
  roster: RosterRow[]
  /** Staff key (`normaliseStaffName`) → staff user id, for everyone coming across: a Bound Instructor must be one of them. */
  staffIds: Map<string, string>
}): MappedPackages {
  const { config, tenantId, id, ids, memberNames } = input
  const tz = config.studio.timezone
  const asOf = new Date(config.asOf)
  const today = localDateOf(asOf, tz)
  const endOfDay = (d: CalendarDate) =>
    zonedToInstant({ ...d, hour: 23, minute: 59, second: 59 }, tz).toISOString()
  const nameOf = (clientId: string) => memberNames.get(clientId) ?? `(not in the member list) ${clientId}`

  const entryOf = new Map<string, CatalogueEntry>()
  for (const e of config.catalogue) for (const s of e.mindbodyNames) entryOf.set(normaliseOptionName(s), e)

  /* ── The catalogue ─────────────────────────────────────────────────────── */

  ids.class_packages = {}
  ids.pt_packages = {}
  ids.client_packages = {}
  const catalogueId = new Map<CatalogueEntry, string>()
  const classPackages: Row[] = []
  const ptPackages: Row[] = []
  for (const e of config.catalogue) {
    if (e.migrate === 'skip' || e.kind === 'access_pass') continue
    const status = e.migrate === 'sell' ? 'active' : 'archived'
    const common = {
      tenant_id: tenantId,
      name: e.name,
      description: null,
      price_sgd: money(e.priceSgd ?? 0),
      status,
      archived_at: status === 'archived' ? asOf.toISOString() : null,
      deleted_at: null,
    }
    if (e.kind === 'pt') {
      const row = {
        id: id('pt-package', catalogueKey(e)),
        ...common,
        session_type: e.sessionType,
        num_sessions: e.credits,
        instructor_bound: e.instructorBound,
        validity_days: e.validityDays,
      }
      ptPackages.push(row)
      catalogueId.set(e, row.id)
      ids.pt_packages[e.name] = row.id
    } else {
      const row = {
        id: id('class-package', catalogueKey(e)),
        ...common,
        kind: e.kind,
        credits: e.kind === 'unlimited' ? null : e.credits,
        validity_days: e.kind === 'unlimited' ? null : e.validityDays,
        duration_months: e.kind === 'unlimited' ? e.durationMonths : null,
      }
      classPackages.push(row)
      catalogueId.set(e, row.id)
      ids.class_packages[e.name] = row.id
    }
  }

  /* ── Who holds what ────────────────────────────────────────────────────── */

  const onAWorkshop = (h: HoldingRow) => input.workshopOptions.has(normaliseOptionName(h.option))
  // A retreat or a workshop is its own service category (`workshopCategories`),
  // whatever its options are called: a place on one is not a package, even
  // where the catalogue did not know to skip it.
  const workshopCategories = new Set(config.workshopCategories.map(fold))
  const inAWorkshopCategory = (h: HoldingRow) => workshopCategories.has(fold(h.serviceCategory))

  // Visits Remaining leaves some live purchases out altogether — a plan started
  // the day before the download, one bought to start later — where the
  // register still has them. A live purchase of something the member holds
  // nothing of in Visits Remaining is a holding of its own, read off the
  // register. The register does not say how much of it is booked ahead, so all
  // of it is: the mapper gives back whatever no imported booking accounts for.
  const whoBought = registerMatcher(input.members)
  // A member's holdings of one catalogue entry are one group — every trial is
  // one — except a plan sold once per Location: each Location's is its own.
  const slotOf = (entry: CatalogueEntry, option: string) => {
    if (entry.migrate !== 'skip' && entry.kind === 'trial') return 'trial'
    const home = optionHome(config, entry, option)
    return home ? `${catalogueKey(entry)}@${home}` : catalogueKey(entry)
  }
  const groupOf = (option: string) => {
    const entry = entryOf.get(normaliseOptionName(option))
    return entry ? slotOf(entry, option) : normaliseOptionName(option)
  }
  const categoryOf = new Map(input.holdings.map(h => [normaliseOptionName(h.option), h.serviceCategory]))
  const heldInReport = new Set(input.holdings.map(h => `${h.clientId}/${groupOf(h.option)}`))
  const fromRegister: HoldingRow[] = []
  for (const sale of input.optionSales) {
    const left = sale.remaining !== null && (sale.remaining.unlimited || sale.remaining.count > 0)
    if (!left || dayNumber(sale.expiration) < dayNumber(today) || input.sales.refunded.has(sale)) continue
    if (!entryOf.has(normaliseOptionName(sale.option))) continue
    const match = whoBought(sale)
    if (match.outcome !== 'matched' || heldInReport.has(`${match.clientId}/${groupOf(sale.option)}`)) continue
    fromRegister.push({
      clientId: match.clientId!,
      serviceCategory: categoryOf.get(normaliseOptionName(sale.option)) ?? '',
      option: sale.option,
      firstActivation: sale.activation,
      lastExpiration: sale.expiration,
      totalPaid: sale.paid,
      purchased: sale.remaining,
      remaining: sale.remaining,
      unbooked: sale.remaining!.unlimited ? sale.remaining : { unlimited: false, count: 0 },
    })
  }
  const live = [...input.holdings.filter(h => isLive(h, today)), ...fromRegister].filter(h => !onAWorkshop(h))
  const unlisted = new Map<string, number>()
  for (const h of live) {
    if (!entryOf.has(normaliseOptionName(h.option))) unlisted.set(h.option, (unlisted.get(h.option) ?? 0) + 1)
  }
  if (unlisted.size > 0) {
    throw new ConfigError(
      [...unlisted]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([option, n]) => `catalogue: "${option}" is still held by ${n} member(s) and is not listed`),
    )
  }

  const notMigrated: NotMigrated[] = []
  const leftBehind = (h: HoldingRow, reason: string) =>
    notMigrated.push({
      clientId: h.clientId,
      name: nameOf(h.clientId),
      option: h.option,
      left: h.remaining?.unlimited ? 'unlimited' : `${h.remaining?.count ?? 0} left`,
      expires: h.lastExpiration ? isoDay(h.lastExpiration) : 'no expiry date',
      reason,
    })

  // Mindbody will sell a pricing option with no expiration at all. "Not expired
  // at the download" has no answer for such a row, and no package here runs
  // forever, so it does not come across — but a member holding credits must not
  // simply vanish from the reckoning. It is a line in the preflight instead.
  for (const h of input.holdings) {
    const somethingLeft = h.remaining !== null && (h.remaining.unlimited || h.remaining.count > 0)
    if (somethingLeft && h.lastExpiration === null && memberNames.has(h.clientId) && !onAWorkshop(h)) {
      leftBehind(h, 'no expiry date in Mindbody, and no package here runs forever')
    }
  }

  // Per member: their packages by catalogue entry, and their access passes.
  // Every trial is one entry here, whatever it was called — a member has one
  // trial, ever, and two spellings of it must not arrive as two.
  const grouped = new Map<string, Map<string, { entry: Sold; holdings: HoldingRow[]; home: string | null }>>()
  const passes = new Map<string, HoldingRow[]>()
  for (const h of live) {
    const entry = entryOf.get(normaliseOptionName(h.option))!
    if (!memberNames.has(h.clientId)) leftBehind(h, 'the client is not in the member list')
    else if (entry.migrate === 'skip') leftBehind(h, 'not a package here (skipped in the catalogue)')
    else if (inAWorkshopCategory(h)) leftBehind(h, `a place on a workshop or retreat (${h.serviceCategory}), not a package`)
    else if (entry.kind === 'access_pass') passes.set(h.clientId, [...(passes.get(h.clientId) ?? []), h])
    else {
      const mine = grouped.get(h.clientId) ?? new Map<string, { entry: Sold; holdings: HoldingRow[]; home: string | null }>()
      const key = slotOf(entry, h.option)
      const group = mine.get(key) ?? { entry, holdings: [], home: optionHome(config, entry, h.option) }
      group.holdings.push(h)
      mine.set(key, group)
      grouped.set(h.clientId, mine)
    }
  }

  const homeSources = new Map<HomeSource, number>(HOME_SOURCES.map(s => [s, 0]))
  /**
   * The Location the option it was bought as names; failing that, where the
   * member belongs, whatever the plan is called; failing that, what the plan
   * says; failing that, the default.
   */
  const homeOf = (clientId: string, entry: Extract<Sold, { kind: 'unlimited' }>, bought: string | null): string => {
    const member = bought ? null : input.homes.get(clientId)
    const plan = bought || member ? null : homeFromPlan(config, entry)
    const source: HomeSource = bought ? 'option' : member ? member.source : plan ? 'plan' : 'default'
    homeSources.set(source, homeSources.get(source)! + 1)
    return bought ?? member?.location ?? plan ?? config.defaultLocation
  }
  const passLocation = (h: HoldingRow) =>
    (entryOf.get(normaliseOptionName(h.option)) as Extract<Migrated, { kind: 'access_pass' }>).location

  const clientPackages: Row[] = []
  const hasTrial = new Set<string>()
  const bookedAhead = new Map<string, number>()
  const purchaseRuns = new Map<string, { from: number; to: number }>()
  const notes: string[] = []

  // The register's live purchases, by member and catalogue entry: live by the
  // same test the holdings use — something left, and not expired on the day.
  const livePurchases = new Map<string, OptionSaleRow[]>()
  for (const sale of input.optionSales) {
    const entry = entryOf.get(normaliseOptionName(sale.option))
    if (!entry || entry.migrate === 'skip' || entry.kind === 'access_pass') continue
    // Returned, so refunded: whatever the register says is left, nobody holds it.
    if (input.sales.refunded.has(sale)) continue
    const left = sale.remaining !== null && (sale.remaining.unlimited || sale.remaining.count > 0)
    if (!left || dayNumber(sale.expiration) < dayNumber(today)) continue
    const match = whoBought(sale)
    if (match.outcome !== 'matched') continue
    const key = `${match.clientId}/${slotOf(entry, sale.option)}`
    livePurchases.set(key, [...(livePurchases.get(key) ?? []), sale])
  }
  const discountOf = (p: OptionSaleRow) => input.sales.saleOf.get(p)?.discount ?? 0

  // Who taught each member's PT, for `byTrainer`: every past visit the report
  // says came off a PT option (an early cancel gave its session back), by member
  // and catalogue entry; and every PT appointment still to come, by member.
  const ptVisits = new Map<string, PtVisit[]>()
  for (const a of input.attendance) {
    const entry = a.option ? entryOf.get(normaliseOptionName(a.option)) : undefined
    if (!entry || entry.migrate === 'skip' || entry.kind !== 'pt' || /early cancel/i.test(a.status)) continue
    const key = `${a.clientId}/${slotOf(entry, a.option)}`
    ptVisits.set(key, [...(ptVisits.get(key) ?? []), { trainer: normaliseStaffName(a.staff), day: dayNumber(a.date) }])
  }
  const ptNames = new Set(config.ptAppointmentNames.map(normaliseClassName))
  const ptAhead = new Map<string, string[]>()
  for (const r of input.roster) {
    if (!ptNames.has(normaliseClassName(r.description)) || /cancel/i.test(r.status)) continue
    if (zonedToInstant({ ...r.date, hour: r.start.hour, minute: r.start.minute, second: 0 }, tz) <= asOf) continue
    ptAhead.set(r.clientId, [...(ptAhead.get(r.clientId) ?? []), normaliseStaffName(r.staff)])
  }
  const staffName = new Map(config.staff.map(s => [normaliseStaffName(s.mindbodyName), s.mindbodyName.trim()]))
  let splitHoldings = 0
  let splitInto = 0
  let pricedFromRegister = 0
  const splitParts = new Set<Held>()

  for (const clientId of [...grouped.keys()].sort()) {
    const held = [...grouped.get(clientId)!.entries()]
      .flatMap(([groupKey, g]) => {
        const combined = combine(clientId, g.entry, g.holdings, g.home)
        const purchases = livePurchases.get(`${clientId}/${groupKey}`) ?? []
        let parts = split(combined, g.holdings, purchases, discountOf)
        if (parts) {
          const resplit = byTrainer(parts, ptVisits.get(`${clientId}/${groupKey}`) ?? [], ptAhead.get(clientId) ?? [], dayNumber(today))
          const who = `packages: ${clientId} ${nameOf(clientId)}: ${g.entry.name}`
          const missing = resplit && 'parts' in resplit ? resplit.parts.filter(p => !input.staffIds.has(p.trainer!)) : []
          if (resplit && 'unsettled' in resplit) {
            const { trainers, used, taught } = resplit.unsettled
            notes.push(
              `${who} is ${parts.length} purchases used with ${trainers} trainers, but each purchase's own trainer taught ${taught} ` +
                `of the ${used} sessions Mindbody used — left as Mindbody split them, unbound: settle by hand`,
            )
          } else if (missing.length > 0) {
            notes.push(`${who} would be re-split by trainer, but ${missing.map(p => p.trainer).join(', ')} is not coming across — left as Mindbody split them, unbound: settle by hand`)
          } else if (resplit) {
            const name = (key: string) => staffName.get(key) ?? key
            const line = parts
              .map((p, i) => `${name(resplit.parts[i]!.trainer!)} ${p.balance! + p.bookedAhead} → ${resplit.parts[i]!.balance! + resplit.parts[i]!.bookedAhead}`)
              .join(', ')
            const moved = resplit.moved > 0 ? `${resplit.moved} moved: Mindbody had taken them off another trainer's purchase` : 'none moved'
            notes.push(`${who} re-split by trainer, sessions left ${line} (${moved}); each purchase is bound to its trainer`)
            parts = resplit.parts
          }
          parts.forEach(p => splitParts.add(p))
          splitHoldings++
          splitInto += parts.length
          return parts
        }
        // One purchase behind it: what that purchase cost, not the report's combined total.
        // Only where the holding is that one row of the report too: several rows
        // combined (a trial under two spellings) are several purchases, whatever
        // the register still calls live.
        if (purchases.length === 1 && g.holdings.length === 1) {
          combined.paid = purchases[0]!.paid
          combined.discount = discountOf(purchases[0]!)
          pricedFromRegister++
        }
        return [combined]
      })
      // Soonest-ending first; then by name, so the order never depends on the report's.
      .sort(
        (a, b) =>
          dayNumber(a.lastExpiration) - dayNumber(b.lastExpiration) ||
          catalogueKey(a.entry).localeCompare(catalogueKey(b.entry)) ||
          (a.home ?? '').localeCompare(b.home ?? '') ||
          a.suffix.localeCompare(b.suffix),
      )
    let addOnTaken = false

    for (const h of held) {
      const { entry } = h
      // Started in Mindbody: it runs, beside whatever else does. Not yet: Dormant,
      // and its clock starts on the first booking it pays for, as a purchase's does.
      const runs = h.firstActivation === null || dayNumber(h.firstActivation) <= dayNumber(today)
      if (entry.kind === 'trial') hasTrial.add(clientId)

      // The catalogue's length either way: a running package's end is its expiry, and a Dormant one has all of it to come.
      const length =
        entry.kind === 'unlimited'
          ? { duration_months: entry.durationMonths, validity_days: null }
          : { duration_months: null, validity_days: entry.validityDays }

      let home: string | null = null
      let addOn: string | null = null
      if (entry.kind === 'unlimited') {
        home = homeOf(clientId, entry, h.home)
        // A pass into the Location the plan is homed at opens nothing the plan does not: it is covered, not left behind.
        passes.set(clientId, (passes.get(clientId) ?? []).filter(p => passLocation(p) !== home))
        const elsewhere = passes.get(clientId)!
        // One Add-On per member, on the soonest-ending plan: the one the pass
        // was bought beside, and the first to pay for a class (`./schedule.ts`).
        if (!addOnTaken && elsewhere.length > 0) {
          addOn = money(elsewhere.reduce((sum, p) => sum + p.totalPaid, 0))
          addOnTaken = true
          passes.set(clientId, (passes.get(clientId) ?? []).filter(p => !elsewhere.includes(p)))
        }
      }

      const started = h.firstActivation ? zonedToInstant(h.firstActivation, tz) : asOf
      // A second or later purchase of a split holding is `…#2`: history finds it
      // by the name before the `#`. A plan sold once per Location is `…@<Location>`.
      const key = `${clientId}/${entry.kind === 'trial' ? 'trial' : entry.name}${h.home ? `@${h.home}` : ''}${h.suffix}`
      const row = {
        id: id('client-package', key),
        tenant_id: tenantId,
        client_id: ids.clients![clientId],
        kind: entry.kind,
        source_class_package_id: entry.kind === 'pt' ? null : catalogueId.get(entry),
        source_pt_package_id: entry.kind === 'pt' ? catalogueId.get(entry) : null,
        location_id: home ? ids.locations![home] : null,
        ...length,
        cross_location_paid_sgd: addOn,
        credits_or_sessions_remaining: h.balance,
        bound_instructor_id: h.trainer ? input.staffIds.get(h.trainer)! : null,
        expires_at: runs ? endOfDay(h.lastExpiration) : null,
        active: true,
        purchased_at: (started > asOf ? asOf : started).toISOString(),
        // What was paid, and a discount only where a promotion gave one: the
        // catalogue's price today says nothing about what this member was charged.
        ...packageMoney(entry, h.paid, h.discount),
        // No Purchase: Mindbody's sales reached no payment provider here, and none is invented.
        purchase_id: null,
      }
      clientPackages.push(row)
      ids.client_packages[key] = row.id
      if (h.bookedAhead > 0) bookedAhead.set(row.id, h.bookedAhead)
      if (h.suffix || splitParts.has(h)) {
        purchaseRuns.set(row.id, { from: h.firstActivation ? dayNumber(h.firstActivation) : -Infinity, to: dayNumber(h.lastExpiration) })
      }
    }
  }
  if (splitHoldings > 0) {
    notes.push(`packages: ${splitHoldings} holding(s) Mindbody combined were split back into their ${splitInto} purchases (register), each with its own expiry, credits and price`)
  }
  const homed = [...homeSources.values()].reduce((a, b) => a + b, 0)
  if (homed > 0) {
    const n = (s: HomeSource) => homeSources.get(s)!
    notes.push(
      `packages: Unlimited Plan Home Locations: ${n('retention')} from Retention Management, ${n('membership')} from Membership, ` +
        `${n('sold')} from where the member's visits were sold, ${n('plan')} from the plan, ${n('default')} at defaultLocation` +
        (n('default') > 0 ? ' — a guess: confirm those with the studio' : '') +
        (n('option') > 0 ? `; and ${n('option')} from the Location named by the option bought (a plan sold once per Location)` : ''),
    )
  }
  if (pricedFromRegister > 0) {
    notes.push(`packages: ${pricedFromRegister} package(s) carry the price their one purchase was sold at (register), not Visits Remaining's combined total`)
  }

  // A pass with no plan at the other Location beside it opens nothing here.
  for (const clientId of [...passes.keys()].sort()) {
    for (const p of passes.get(clientId)!) leftBehind(p, 'an access pass with no Unlimited Plan at the other Location')
  }

  /* ── A trial already used stays used ───────────────────────────────────── */

  const spentTrials = new Map<string, { entry: Sold & { validityDays: number }; holdings: HoldingRow[] }>()
  for (const h of input.holdings) {
    const entry = entryOf.get(normaliseOptionName(h.option))
    if (!entry || entry.migrate === 'skip' || entry.kind !== 'trial') continue
    if (hasTrial.has(h.clientId) || !memberNames.has(h.clientId) || !h.lastExpiration) continue
    const mine = spentTrials.get(h.clientId) ?? { entry, holdings: [] }
    mine.holdings.push(h)
    spentTrials.set(h.clientId, mine)
  }
  for (const clientId of [...spentTrials.keys()].sort()) {
    const { entry, holdings } = spentTrials.get(clientId)!
    const h = combine(clientId, entry, holdings)
    const started = h.firstActivation ? zonedToInstant(h.firstActivation, tz) : asOf
    const key = `${clientId}/trial`
    const row = {
      id: id('client-package', key),
      tenant_id: tenantId,
      client_id: ids.clients![clientId],
      kind: 'trial',
      source_class_package_id: catalogueId.get(entry),
      source_pt_package_id: null,
      location_id: null,
      duration_months: null,
      validity_days: entry.validityDays,
      cross_location_paid_sgd: null,
      credits_or_sessions_remaining: 0,
      bound_instructor_id: null,
      expires_at: endOfDay(h.lastExpiration),
      active: false,
      purchased_at: (started > asOf ? asOf : started).toISOString(),
      ...packageMoney(entry, h.paid),
      purchase_id: null,
    }
    clientPackages.push(row)
    ids.client_packages[key] = row.id
  }

  const balances = input.balances
    .filter(b => b.balance !== 0)
    .map(b => ({ clientId: b.clientId, name: nameOf(b.clientId), balance: money(b.balance) }))
    .sort((a, b) => a.clientId.localeCompare(b.clientId))

  notMigrated.sort((a, b) => a.clientId.localeCompare(b.clientId) || a.option.localeCompare(b.option))
  return { classPackages, ptPackages, clientPackages, notMigrated, balances, bookedAhead, runs: purchaseRuns, notes }
}
