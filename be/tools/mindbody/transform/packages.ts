import { isLive } from './catalogue'
import { ConfigError, type CatalogueEntry, type StudioConfig } from './config'
import type { AccountBalanceRow, HoldingRow, MemberListRow, OptionSaleRow } from './readers'
import { registerMatcher } from './register'
import { packageMoney, type JoinedSales } from './sales'
import {
  dayNumber,
  isoDay,
  localDateOf,
  money,
  normaliseOptionName,
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
 * rule (ADR 0004): one package runs per Family, and the rest wait Dormant.
 *
 *  - The package ending soonest runs, and keeps its Mindbody expiry.
 *  - The others wait with the time they had left, so nothing is lost by queueing.
 *  - One that Mindbody had not started yet waits with its whole validity.
 *
 * Balances are the report's *unbooked* count: a booking here spends its credit
 * when it is made, so a visit already booked is a credit already spent.
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
}

const count = (s: HoldingRow['remaining']) => (s && !s.unlimited ? s.count : 0)

function combine(clientId: string, entry: Sold, holdings: HoldingRow[]): Held {
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
  }
}

/**
 * A combined holding split back into the purchases it is made of, from the
 * pricing-option register — each with its own start, expiry, price and credits,
 * so an earlier pack's credits keep the earlier pack's expiry.
 *
 * Only where the register accounts for the holding exactly: its live purchases'
 * credits add up to the report's Remaining. The credits Mindbody set aside for
 * future bookings come off the soonest-ending purchase first, the one that runs.
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
    }
  })
}

/**
 * An Unlimited Plan's Home Location: the config's, else the Location its name
 * names, else the default. Every plan has one — the platform requires it — past
 * purchases included.
 */
export function planHome(config: StudioConfig, entry: { name: string; mindbodyNames: string[]; location: string | null }): string {
  if (entry.location) return entry.location
  const spelled = [entry.name, ...entry.mindbodyNames].map(normaliseOptionName)
  const named = config.locations.find(l => spelled.some(s => s.includes(l.name.trim().toLowerCase())))
  return named?.key ?? config.defaultLocation
}

/** The fewest whole calendar months from `from` that reach `to`: a waiting plan is never shortened. */
function monthsToReach(from: CalendarDate, to: CalendarDate): number {
  const whole = (to.year - from.year) * 12 + (to.month - from.month) + (to.day > from.day ? 1 : 0)
  return Math.max(1, whole)
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
        instructor_bound: false,
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
  const live = input.holdings.filter(h => isLive(h, today) && !onAWorkshop(h))
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
  const grouped = new Map<string, Map<string, { entry: Sold; holdings: HoldingRow[] }>>()
  const passes = new Map<string, HoldingRow[]>()
  for (const h of live) {
    const entry = entryOf.get(normaliseOptionName(h.option))!
    if (!memberNames.has(h.clientId)) leftBehind(h, 'the client is not in the member list')
    else if (entry.migrate === 'skip') leftBehind(h, 'not a package here (skipped in the catalogue)')
    else if (entry.kind === 'access_pass') passes.set(h.clientId, [...(passes.get(h.clientId) ?? []), h])
    else {
      const mine = grouped.get(h.clientId) ?? new Map<string, { entry: Sold; holdings: HoldingRow[] }>()
      const key = entry.kind === 'trial' ? 'trial' : catalogueKey(entry)
      const group = mine.get(key) ?? { entry, holdings: [] }
      group.holdings.push(h)
      mine.set(key, group)
      grouped.set(h.clientId, mine)
    }
  }

  const homeOf = (entry: Extract<Sold, { kind: 'unlimited' }>): string => planHome(config, entry)
  const passLocation = (h: HoldingRow) =>
    (entryOf.get(normaliseOptionName(h.option)) as Extract<Migrated, { kind: 'access_pass' }>).location

  const clientPackages: Row[] = []
  const hasTrial = new Set<string>()
  const bookedAhead = new Map<string, number>()
  const purchaseRuns = new Map<string, { from: number; to: number }>()
  const notes: string[] = []

  // The register's live purchases, by member and catalogue entry: live by the
  // same test the holdings use — something left, and not expired on the day.
  const whoBought = registerMatcher(input.members)
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
    const key = `${match.clientId}/${entry.kind === 'trial' ? 'trial' : catalogueKey(entry)}`
    livePurchases.set(key, [...(livePurchases.get(key) ?? []), sale])
  }
  const discountOf = (p: OptionSaleRow) => input.sales.saleOf.get(p)?.discount ?? 0
  let splitHoldings = 0
  let splitInto = 0
  let pricedFromRegister = 0
  const splitParts = new Set<Held>()

  for (const clientId of [...grouped.keys()].sort()) {
    const held = [...grouped.get(clientId)!.entries()]
      .flatMap(([groupKey, g]) => {
        const combined = combine(clientId, g.entry, g.holdings)
        const purchases = livePurchases.get(`${clientId}/${groupKey}`) ?? []
        const parts = split(combined, g.holdings, purchases, discountOf)
        if (parts) {
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
          a.suffix.localeCompare(b.suffix),
      )
    const running = new Set<'class' | 'pt'>()
    let addOnTaken = false

    for (const h of held) {
      const { entry } = h
      const family = entry.kind === 'pt' ? 'pt' : 'class'
      const notStarted = h.firstActivation !== null && dayNumber(h.firstActivation) > dayNumber(today)
      const runs = !notStarted && !running.has(family)
      if (runs) running.add(family)
      if (entry.kind === 'trial') hasTrial.add(clientId)

      // Waiting: the days (or, for a plan, the months) it had left — today
      // counts, as it would have in Mindbody. Not yet started: all of it.
      const daysLeft = dayNumber(h.lastExpiration) - dayNumber(today) + 1
      const length =
        entry.kind === 'unlimited'
          ? { duration_months: runs || notStarted ? entry.durationMonths : monthsToReach(today, h.lastExpiration), validity_days: null }
          : { duration_months: null, validity_days: runs || notStarted ? entry.validityDays : daysLeft }

      let home: string | null = null
      let addOn: string | null = null
      if (entry.kind === 'unlimited') {
        home = homeOf(entry)
        const elsewhere = (passes.get(clientId) ?? []).filter(p => passLocation(p) !== home)
        // One Add-On per member, on the plan that is running (or next to run):
        // that is the plan the pass was bought beside.
        if (!addOnTaken && elsewhere.length > 0) {
          addOn = money(elsewhere.reduce((sum, p) => sum + p.totalPaid, 0))
          addOnTaken = true
          passes.set(clientId, (passes.get(clientId) ?? []).filter(p => !elsewhere.includes(p)))
        }
      }

      const started = h.firstActivation ? zonedToInstant(h.firstActivation, tz) : asOf
      // A second or later purchase of a split holding is `…#2`: history finds it by the name before the `#`.
      const key = `${clientId}/${entry.kind === 'trial' ? 'trial' : entry.name}${h.suffix}`
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
