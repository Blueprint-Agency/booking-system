import type { CatalogueEntry, StudioConfig } from './config'
import { fold, type ConfigLookups } from './lookups'
import { planHome } from './packages'
import type { MemberListRow, OptionSaleRow, PromotionRow, SaleRow } from './readers'
import { registerCandidates } from './register'
import {
  dayNumber,
  isoDay,
  money,
  normaliseOptionName,
  zonedToInstant,
  type CalendarDate,
} from './values'

/**
 * The studio's takings, sale by sale, from Big Spenders (Detail, accrual).
 *
 * Big Spenders is the one report that knows who bought what by **client id**,
 * on what day, where, and what was given back. Pricing Option Expirations
 * knows what each purchase *became* — when it started, when it runs out, what
 * is left — but names its buyer only by name and phone. So each sale line is
 * joined to the register row it created: the same member (the register row
 * could be theirs by name, and by phone where a name is shared), the same
 * option after folding, activated on or after the sale — the latest such sale,
 * the price it was sold for first. The member always comes from the sale; the
 * register only lends its dates.
 *
 * A return (quantity −1) is joined to the sale it reverses: the same member and
 * option, sold no later than the return, not already reversed, the same amount
 * first, latest first. The register row of a returned sale is a refunded
 * purchase, which is never a live holding.
 *
 * Pure, like the rest of the mapper.
 */

type Row = Record<string, unknown>

/** A sale line that sold something, with what the other reports say about it. */
export type JoinedSale = {
  sale: SaleRow & { clientId: string }
  /** The register row it created, or null where the register has none (a day pass, a promo bundle, a workshop place). */
  register: OptionSaleRow | null
  /** The return that reversed it, if any. */
  returnedBy: SaleRow | null
  /** What a promotion took off it (Promotions), in dollars; 0 where none did. */
  discount: number
}

export type JoinedSales = {
  /** Every line that sold something, oldest first. */
  sold: JoinedSale[]
  /** Returns that reverse no sale. */
  unreversed: SaleRow[]
  /** Lines in a block with no client id. */
  noClient: SaleRow[]
  /** Register rows whose sale was returned: refunded, so never live. */
  refunded: Set<OptionSaleRow>
  /** Register row → the sale that created it. */
  saleOf: Map<OptionSaleRow, JoinedSale>
}

const bySale = (a: SaleRow, b: SaleRow) =>
  dayNumber(a.soldAt) - dayNumber(b.soldAt) || Number(a.saleId) - Number(b.saleId) || a.description.localeCompare(b.description)

export function joinSales(input: {
  sales: SaleRow[]
  optionSales: OptionSaleRow[]
  promotions: PromotionRow[]
  members: MemberListRow[]
}): JoinedSales {
  const candidatesOf = registerCandidates(input.members)
  const discountOf = new Map<string, number>()
  for (const p of input.promotions) {
    const key = `${p.saleId}/${normaliseOptionName(p.item)}`
    discountOf.set(key, (discountOf.get(key) ?? 0) + p.discount)
  }

  const sold: JoinedSale[] = []
  const noClient: SaleRow[] = []
  const unreversed: SaleRow[] = []
  const lines = [...input.sales].sort(bySale)

  for (const sale of lines) {
    if (sale.quantity < 0) continue
    if (!sale.clientId) {
      noClient.push(sale)
      continue
    }
    // Taken once: a sale of two of one option carries its promotion's discount
    // on one of them, not the whole of it on each.
    const promoted = `${sale.saleId}/${normaliseOptionName(sale.description)}`
    sold.push({
      sale: { ...sale, clientId: sale.clientId },
      register: null,
      returnedBy: null,
      discount: discountOf.get(promoted) ?? 0,
    })
    discountOf.delete(promoted)
  }

  // Each register row to the sale that created it: the latest sale of its
  // option, to a member it could be, on or before the day it started. Asked
  // from the register's side, because a sale the register never recorded (a
  // pack sold years ago, or one it lost) must not reach forward and take a
  // later purchase's row. Twice over: first at the price it was sold for, then
  // at any price.
  const salesFor = new Map<string, JoinedSale[]>()
  for (const j of sold) {
    const key = `${j.sale.clientId}/${normaliseOptionName(j.sale.description)}`
    salesFor.set(key, [...(salesFor.get(key) ?? []), j])
  }
  const register = [...input.optionSales].sort(
    (a, b) => dayNumber(a.activation) - dayNumber(b.activation) || a.client.localeCompare(b.client) || a.paid - b.paid,
  )
  const taken = new Set<OptionSaleRow>()
  for (const samePrice of [true, false]) {
    for (const r of register) {
      if (taken.has(r)) continue
      const option = normaliseOptionName(r.option)
      const start = dayNumber(r.activation)
      const created = candidatesOf(r)
        .flatMap(clientId => salesFor.get(`${clientId}/${option}`) ?? [])
        .filter(j => !j.register && dayNumber(j.sale.soldAt) <= start && (!samePrice || money(j.sale.total) === money(r.paid)))
        .sort((a, b) => bySale(b.sale, a.sale))[0]
      if (!created) continue
      created.register = r
      taken.add(r)
    }
  }

  for (const back of lines) {
    if (back.quantity >= 0) continue
    if (!back.clientId) {
      noClient.push(back)
      continue
    }
    const option = normaliseOptionName(back.description)
    const candidates = sold
      .filter(
        j =>
          !j.returnedBy &&
          j.sale.clientId === back.clientId &&
          normaliseOptionName(j.sale.description) === option &&
          dayNumber(j.sale.soldAt) <= dayNumber(back.soldAt),
      )
      .reverse()
    const reversed = candidates.find(j => money(j.sale.total) === money(-back.total)) ?? candidates[0]
    if (reversed) reversed.returnedBy = back
    else unreversed.push(back)
  }

  const refunded = new Set<OptionSaleRow>()
  const saleOf = new Map<OptionSaleRow, JoinedSale>()
  for (const j of sold) {
    if (!j.register) continue
    saleOf.set(j.register, j)
    if (j.returnedBy) refunded.add(j.register)
  }
  return { sold, unreversed, noClient, refunded, saleOf }
}

/**
 * What an imported package cost: List Price is what was paid, plus whatever a
 * promotion took off, so a discount shows only where one really happened. A
 * package that cost nothing and was not discounted to nothing is
 * **Complimentary** — a free pass, a ClassPass visit — except a Trial the
 * catalogue sells for money, which is a Trial at a price even when this one
 * was free.
 */
export function packageMoney(entry: { kind: string; priceSgd?: number | null }, paid: number, discount = 0) {
  return {
    amount_paid_sgd: money(paid),
    list_price_sgd: money(paid + discount),
    complimentary: paid === 0 && discount === 0 && !(entry.kind === 'trial' && (entry.priceSgd ?? 0) > 0),
  }
}

/** A past purchase as history needs it, to point a past visit at the package that paid for it. */
export type PastSlot = { clientId: string; entry: CatalogueEntry; id: string; kind: string; from: number; to: number }

type Sold = Exclude<CatalogueEntry, { migrate: 'skip' } | { kind: 'access_pass' }>

/**
 * Every sale line in the history window that is not a live holding, as a past,
 * inactive package on the member whose id is on the sale — dated on the sale
 * date, at its sale Location where the platform can hold one — and every
 * return as a Refund on the purchase it reverses. What cannot be placed is
 * counted, with its money, for the preflight.
 */
export function pastPackages(input: {
  joined: JoinedSales
  from: string
  today: CalendarDate
  config: StudioConfig
  tenantId: string
  id: (kind: string, key: string) => string
  ids: Record<string, Record<string, string>>
  memberNames: Map<string, string>
  lookups: ConfigLookups
  workshopOptions: Set<string>
  /** Members who already came across holding a trial, live or spent: a member has one, ever. */
  hasTrial: Set<string>
}): { clientPackages: Row[]; purchases: Row[]; slots: PastSlot[]; notes: string[] } {
  const { joined, from, today, config, tenantId, id, ids, memberNames } = input
  const tz = config.studio.timezone
  const endOfDay = (d: CalendarDate) => zonedToInstant({ ...d, hour: 23, minute: 59, second: 59 }, tz).toISOString()
  const startOf = (d: CalendarDate) => zonedToInstant({ ...d, hour: 0, minute: 0, second: 0 }, tz).toISOString()
  const entryOf = new Map<string, CatalogueEntry>()
  for (const e of config.catalogue) for (const s of e.mindbodyNames) entryOf.set(normaliseOptionName(s), e)
  const catalogueIds = { ...ids.class_packages, ...ids.pt_packages }

  const clientPackages: Row[] = []
  const purchases: Row[] = []
  const slots: PastSlot[] = []
  const notes: string[] = []
  const taken = new Set<string>()
  const trials = new Set(input.hasTrial)

  /** Why a line was not placed → the lines, and their money. */
  const unplaced = new Map<string, { n: number; total: number }>()
  const miss = (sale: SaleRow, why: string) => {
    const key = `"${sale.description}" — ${why}`
    const had = unplaced.get(key) ?? { n: 0, total: 0 }
    unplaced.set(key, { n: had.n + 1, total: had.total + sale.total })
  }
  const trialsPaidFor = new Map<string, number>()
  let refunds = 0

  /** Why a line of this option cannot be a package here, or the entry it is. */
  const placeable = (description: string): Sold | string => {
    const option = normaliseOptionName(description)
    if (input.workshopOptions.has(option)) return 'a place on a workshop, which is a booking, not a package'
    const entry = entryOf.get(option)
    if (!entry) return 'in no catalogue entry'
    if (entry.migrate === 'skip') return 'skipped in the catalogue'
    if (entry.kind === 'access_pass') return 'an access pass, which is no package here'
    return entry
  }
  const inWindow = (sale: SaleRow) => isoDay(sale.soldAt) >= from

  let locationsDropped = 0
  for (const j of joined.sold) {
    const { sale, register, returnedBy } = j
    if (!inWindow(sale)) {
      // Its sale is before the cutoff and did not come across, so there is nothing here to refund.
      if (returnedBy && inWindow(returnedBy)) miss(returnedBy, `returns a sale from before ${from}, which did not come across`)
      continue
    }
    const entry = placeable(sale.description)
    if (typeof entry === 'string') {
      miss(sale, entry)
      if (returnedBy) miss(returnedBy, entry)
      continue
    }
    if (!memberNames.has(sale.clientId)) {
      miss(sale, `client ${sale.clientId} is not in the member list`)
      if (returnedBy) miss(returnedBy, `client ${sale.clientId} is not in the member list`)
      continue
    }
    // Still live at the download, by the same test the live packages use:
    // something left and not expired. It came across as a running package. A
    // returned one is refunded, and is history whatever the register says.
    const left = register?.remaining != null && (register.remaining.unlimited || register.remaining.count > 0)
    if (!returnedBy && register && left && dayNumber(register.expiration) >= dayNumber(today)) continue

    // A member has one trial, ever — the platform holds them to it — so a
    // second is not written; the money it took is named instead.
    if (entry.kind === 'trial' && trials.has(sale.clientId)) {
      if (sale.total > 0) trialsPaidFor.set(`${memberNames.get(sale.clientId)} (${sale.clientId}) — ${sale.description}, ${money(sale.total)}`, 1)
      continue
    }
    if (entry.kind === 'trial') trials.add(sale.clientId)

    const day = isoDay(sale.soldAt)
    let key = `past/${sale.clientId}/${day}/${entry.name}`
    for (let n = 2; taken.has(key); n++) key = `past/${sale.clientId}/${day}/${entry.name}#${n}`
    taken.add(key)

    const expiry = register?.expiration ?? lastDay(sale.soldAt, entry)
    const catalogueId = catalogueIds[entry.name] ?? null
    const soldAt = zonedToInstant(sale.soldAt, tz).toISOString()
    // A refund needs a Purchase to hang from: provider-less, because the sale
    // never reached a payment provider here, and closed as refunded on the day
    // of the return.
    const refund = returnedBy && sale.total > 0 ? returnedBy : null
    const purchaseId = refund ? id('purchase', key) : null
    const row: Row = {
      id: id('client-package', key),
      tenant_id: tenantId,
      client_id: ids.clients![sale.clientId],
      kind: entry.kind,
      source_class_package_id: entry.kind === 'pt' ? null : catalogueId,
      source_pt_package_id: entry.kind === 'pt' ? catalogueId : null,
      // Only a plan holds a Location here, and it must: its Home Location is
      // where it was sold, where that is a Location.
      location_id:
        entry.kind === 'unlimited' ? ids.locations![input.lookups.locations.get(fold(sale.location)) ?? planHome(config, entry)] : null,
      ...(entry.kind === 'unlimited'
        ? { duration_months: entry.durationMonths, validity_days: null }
        : { duration_months: null, validity_days: entry.validityDays }),
      cross_location_paid_sgd: null,
      // Used up, or given back: either way it is history, not a live holding.
      credits_or_sessions_remaining: entry.kind === 'unlimited' ? null : 0,
      expires_at: endOfDay(expiry),
      active: false,
      purchased_at: soldAt,
      ...packageMoney(entry, sale.total, j.discount),
      purchase_id: purchaseId,
    }
    clientPackages.push(row)
    ids.client_packages![key] = row.id as string
    if (entry.kind !== 'unlimited' && input.lookups.locations.has(fold(sale.location))) locationsDropped++
    slots.push({
      clientId: sale.clientId,
      entry,
      id: row.id as string,
      kind: entry.kind,
      from: dayNumber(register?.activation ?? sale.soldAt),
      to: dayNumber(expiry),
    })

    if (refund && purchaseId) {
      refunds++
      purchases.push({
        id: purchaseId,
        tenant_id: tenantId,
        client_id: ids.clients![sale.clientId],
        kind: entry.kind === 'pt' ? 'pt_package' : 'class_package',
        total_sgd: money(sale.total),
        // A refunded Purchase holds nothing, as one refunded here does.
        amount_paid_sgd: '0.00',
        status: 'refunded',
        settled_at: soldAt,
        refunded_at: startOf(refund.soldAt),
        created_at: soldAt,
      })
      if (money(-refund.total) !== money(sale.total)) {
        notes.push(
          `history purchases: ${memberNames.get(sale.clientId)} (${sale.clientId}) — "${sale.description}" sold ${day} for ${money(sale.total)} was returned for ${money(-refund.total)}; a Refund here is the whole purchase back`,
        )
      }
    }
  }

  for (const back of joined.unreversed) {
    if (!inWindow(back)) continue
    const entry = placeable(back.description)
    if (typeof entry === 'string') miss(back, entry)
    else {
      notes.push(
        `history purchases: a return of "${back.description}" on ${isoDay(back.soldAt)} for ${memberNames.get(back.clientId!) ?? back.clientId} (${back.clientId}), ${money(back.total)}, reverses no sale, so no Refund was written`,
      )
    }
  }
  for (const line of joined.noClient) if (inWindow(line)) miss(line, 'no client id on the sale')

  if (unplaced.size > 0) {
    const all = [...unplaced.values()].reduce((sum, u) => ({ n: sum.n + u.n, total: sum.total + u.total }), { n: 0, total: 0 })
    notes.push(`history purchases: ${all.n} sale line(s) totalling ${money(all.total)} were not placed on any member's package`)
    for (const [what, u] of [...unplaced].sort(([a], [b]) => a.localeCompare(b))) {
      notes.push(`history purchases: ${what} — ${u.n} sale line(s), ${money(u.total)}`)
    }
  }
  for (const what of [...trialsPaidFor.keys()].sort()) {
    notes.push(`history purchases: ${what} — a trial for a member who already came across holding one, so the money is not in Finance; a member may hold only one trial ever`)
  }
  if (locationsDropped > 0) {
    notes.push(
      `history purchases: ${locationsDropped} past package(s) were sold at a Location, which is not recorded: the platform keeps a Location only on an Unlimited Plan, so Finance shows them Unattributed`,
    )
  }
  if (refunds > 0) notes.push(`history purchases: ${refunds} return(s) came across as a Refund on the purchase each reverses`)
  return { clientPackages, purchases, slots, notes }
}

/** The last day a package bought that day was good for, where no register row says: its validity from the sale. */
function lastDay(soldAt: CalendarDate, entry: Sold): CalendarDate {
  const d =
    entry.kind === 'unlimited'
      ? new Date(Date.UTC(soldAt.year, soldAt.month - 1 + entry.durationMonths, soldAt.day - 1))
      : new Date(Date.UTC(soldAt.year, soldAt.month - 1, soldAt.day + entry.validityDays - 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}
