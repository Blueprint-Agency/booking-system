import { proposeCatalogue } from './catalogue'
import type { OfflineMethod } from './config'
import type { MindbodyReports } from './mapper'
import type { CancellationRow } from './readers'
import { dayNumber, normaliseClassName, normaliseOptionName, normaliseStaffName, type CalendarDate } from './values'

/**
 * What only the reports know, gathered for filling in a studio config
 * (`./fill.ts`): every class name ever run, the service categories, what is on
 * sale now and at what, the largest class each room has held, and who teaches.
 *
 * Generic: nothing here knows any studio. What counts as off-site comes from
 * the studio's answers.
 */

const DEFAULT_PT = /\bpt\b|personal training/i

export type ReportFacts = {
  /** Every class name the studio ever ran (schedule + visits), one entry per normalised name. */
  classTypes: { name: string; mindbodyNames: string[] }[]
  categories: string[]
  /** What the roster and the attendance report call a PT appointment. */
  ptNames: string[]
  /** The largest headcount seen on one class, per room spelling. */
  maxByRoom: Record<string, number>
  /** Sales at a price, per option: when last sold, and the prices of the 90 days up to the download. */
  sold: Record<string, { lastSoldDaysAgo: number; sold90: number; prices90: Record<string, number> }>
  /** Class names held somewhere that is no Room (blank, or an off-site venue). */
  roomless: Record<string, { held: number; alsoInRooms: number }>
  /** Every pricing option ever sold, proposed like the catalogue: past purchases need an entry each. */
  everySold: ReturnType<typeof proposeCatalogue>
  /** The class cancellation window the members' own cancels show, or null where they show none. */
  classWindow: CancellationWindow | null
  /**
   * Every payment method label the Sales report shows money taken by, with the
   * platform method it looks like, or null where it looks like none: a
   * proposal for the answers file's `paymentMethods`, never read by the transform.
   */
  paymentMethods: Record<string, OfflineMethod | null>
  /** Per service category, what its timetable and its sales say — for `fill` to complete a workshop entry. */
  workshops: WorkshopFact[]
}

/**
 * What the reports say of one service category taken as a workshop: no report
 * holds a workshop's own settings, so each is read back from its days and from
 * what was sold under it.
 */
export type WorkshopFact = {
  category: string
  /** The class name its days were held under most: the workshop's title, where the category's is cut short. */
  title: string | null
  /** The Mindbody Location its days were held at most. */
  location: string | null
  /** How many occurrences it has on the timetable. */
  days: number
  /** The most members who came to one run of it (days no more than a month apart), or who hold a place on it now. */
  capacity: number
  /**
   * The room types it was sold as: the pricing options held under the
   * category, each on the one category it was held under most. The price is
   * the commonest paid for one (Sales), else the commonest paid for a holding.
   */
  tiers: { name: string; mindbodyNames: string[]; priceSgd: number; held: number }[]
}

export type CancellationWindow = {
  /** Cancelled fewer than this many hours before the class, a member's cancel is late. */
  hours: number
  /** The members' own early and late cancels it was read from. */
  early: number
  late: number
  /** Of those, the ones on the wrong side of it (a changed rule, a class moved after the cancel). */
  misfits: number
}

/** The longest window looked for: a week. */
const MAX_WINDOW_HOURS = 168

/**
 * The studio's late-cancel cut-off, from the lead time of each member's own
 * cancel (`Cancelled By` is the client) and whether Mindbody called it early or
 * late: the smallest whole hour that puts the fewest on the wrong side. A cancel
 * made by staff or by an app says nothing of the rule a member meets. Null
 * without both kinds, since a cut-off only shows between them.
 */
export function cancellationWindow(rows: CancellationRow[]): CancellationWindow | null {
  const lead: { minutes: number; late: boolean }[] = []
  for (const c of rows) {
    if (!c.start || (c.method !== 'early' && c.method !== 'late')) continue
    if (normaliseStaffName(c.cancelledBy) !== normaliseStaffName(c.client)) continue
    const at = c.cancelledAt
    const minutes =
      (dayNumber(c.date) - dayNumber(at)) * 1440 + c.start.hour * 60 + c.start.minute - (at.hour * 60 + at.minute + at.second / 60)
    lead.push({ minutes, late: c.method === 'late' })
  }
  const late = lead.filter(l => l.late).length
  const early = lead.length - late
  if (late === 0 || early === 0) return null
  let best = { hours: 0, misfits: Infinity }
  for (let hours = 0; hours <= MAX_WINDOW_HOURS; hours++) {
    const misfits = lead.filter(l => l.late !== l.minutes < hours * 60).length
    if (misfits < best.misfits) best = { hours, misfits }
  }
  return { hours: best.hours, early, late, misfits: best.misfits }
}

/** What a Mindbody payment method label looks like here, by its words alone. A proposal for a person to confirm. */
export function proposePaymentMethod(label: string): OfflineMethod | null {
  if (/^cash\b/i.test(label)) return 'cash'
  if (/paynow/i.test(label)) return 'paynow'
  if (/credit card|debit card|\b(visa|master ?card|mc|amex|nets)\b/i.test(label)) return 'card'
  if (/bank|transfer|giro/i.test(label)) return 'bank_transfer'
  return null
}

export function reportFacts(
  r: MindbodyReports,
  asOf: CalendarDate,
  opts: { offSiteVenues: string[]; pt?: RegExp },
): ReportFacts {
  const PT = opts.pt ?? DEFAULT_PT
  const today = dayNumber(asOf)

  const names = new Map<string, Map<string, number>>()
  const add = (raw: string) => {
    if (!raw || PT.test(raw)) return
    const k = normaliseClassName(raw)
    const m = names.get(k) ?? new Map<string, number>()
    m.set(raw, (m.get(raw) ?? 0) + 1)
    names.set(k, m)
  }
  for (const s of r.schedule) add(s.description)
  for (const a of r.attendance) add(a.description)
  const classTypes = [...names].sort(([a], [b]) => a.localeCompare(b)).map(([, m]) => {
    const spellings = [...m].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    return { name: spellings[0]![0], mindbodyNames: spellings.map(([s]) => s).sort() }
  })

  const categories = [...new Set(r.schedule.map(s => s.serviceCategory))].sort()
  const ptNames = [...new Set([...r.roster, ...r.attendance].map(x => x.description).filter(d => PT.test(d)))].sort()

  // Roster: one row per client per class.
  const perClass = new Map<string, { room: string; n: number }>()
  for (const x of r.roster) {
    if (/cancel/i.test(x.status)) continue
    const k = `${x.date.year}-${x.date.month}-${x.date.day} ${x.start.hour}:${x.start.minute} ${x.description} ${x.staff}`
    const c = perClass.get(k) ?? { room: x.room, n: 0 }
    c.n++
    perClass.set(k, c)
  }
  const maxByRoom: Record<string, number> = {}
  for (const c of perClass.values()) maxByRoom[c.room || '(blank)'] = Math.max(maxByRoom[c.room || '(blank)'] ?? 0, c.n)

  const sold: ReportFacts['sold'] = {}
  for (const s of r.sales) {
    if (s.quantity !== 1 || s.total <= 0) continue
    const k = normaliseOptionName(s.description)
    const ago = today - dayNumber(s.soldAt)
    const x = (sold[k] ??= { lastSoldDaysAgo: ago, sold90: 0, prices90: {} })
    x.lastSoldDaysAgo = Math.min(x.lastSoldDaysAgo, ago)
    if (ago >= 0 && ago <= 90) {
      x.sold90++
      x.prices90[s.total.toFixed(2)] = (x.prices90[s.total.toFixed(2)] ?? 0) + 1
    }
  }

  const offSite = new Set(opts.offSiteVenues.map(v => v.trim().toLowerCase()))
  const noRoom = (room: string) => room.trim() === '' || offSite.has(room.trim().toLowerCase())
  const roomless: ReportFacts['roomless'] = {}
  for (const s of r.schedule) {
    const k = normaliseClassName(s.description)
    const x = (roomless[k] ??= { held: 0, alsoInRooms: 0 })
    if (noRoom(s.room)) x.held++
    else x.alsoInRooms++
  }
  for (const k of Object.keys(roomless)) if (roomless[k]!.held === 0) delete roomless[k]

  const everySold = proposeCatalogue(r, asOf, { everySold: true })
  const labels = [...new Set(r.saleMethods.filter(m => m.amount > 0).map(m => m.methodLabel))].sort()
  const paymentMethods = Object.fromEntries(labels.map(l => [l, proposePaymentMethod(l)]))
  return {
    classTypes,
    categories,
    ptNames,
    maxByRoom,
    sold,
    roomless,
    everySold,
    classWindow: cancellationWindow(r.cancellations),
    paymentMethods,
    workshops: workshopFacts(r, asOf),
  }
}

/** The value seen most often; between equals the first in sort order, so report order never decides. */
function commonest<T extends string | number>(values: T[]): T | null {
  const counts = new Map<T, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].sort(([a, n], [b, m]) => m - n || (a < b ? -1 : a > b ? 1 : 0))[0]?.[0] ?? null
}

/** A day's class name as a workshop's title: plain letters, no "Day 1", "Session 2:" or "Batch 1", no stray separators. */
function titleOfDay(description: string): string {
  return description
    .normalize('NFKC')
    .replace(/\b(day|session|batch)\s*\d+\w*\s*:?/gi, ' ')
    .replace(/\s*[|:–—-]\s*(?=[|:–—-]|$)/g, ' ')
    .replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A run's title: what its days are all called, or the words they all begin
 * with (two at least) — "Hip Opening" and "Arm Balance" days of one
 * "Enhanced Practice Workshop". Null where they share nothing.
 */
function titleOfRun(descriptions: string[]): string | null {
  const titles = [...new Set(descriptions.map(titleOfDay).filter(Boolean))]
  if (titles.length === 0) return null
  if (titles.length === 1) return titles[0]!
  const words = titles.map(t => t.split(' '))
  const shared: string[] = []
  for (let i = 0; words.every(w => i < w.length && w[i]!.toLowerCase() === words[0]![i]!.toLowerCase()); i++) shared.push(words[0]![i]!)
  const title = shared.join(' ').replace(/[\s|:–—&+-]+$/, '')
  return title.split(' ').length >= 2 ? title : null
}

function workshopFacts(r: MindbodyReports, asOf: CalendarDate): WorkshopFact[] {
  const fold = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const today = dayNumber(asOf)
  const spelled = new Map<string, string>()
  const note = (category: string) => {
    const k = fold(category)
    if (k && !spelled.has(k)) spelled.set(k, category.trim())
    return k
  }

  // Its days, and who came to each: a visit is on a category's day by its date, start and class name.
  const rows = new Map<string, typeof r.schedule>()
  const dayOf = new Map<string, string>()
  const visitKey = (d: CalendarDate, t: { hour: number; minute: number }, name: string) =>
    `${dayNumber(d)} ${t.hour}:${t.minute} ${normaliseClassName(name)}`
  for (const s of r.schedule) {
    const k = note(s.serviceCategory)
    if (!k) continue
    rows.set(k, [...(rows.get(k) ?? []), s])
    dayOf.set(visitKey(s.date, s.start, s.description), `${k}\n${dayNumber(s.date)} ${s.start.hour}:${s.start.minute}`)
  }
  const cameOn = new Map<string, Set<string>>()
  for (const a of r.attendance) {
    if (/early/i.test(a.status)) continue
    const day = dayOf.get(visitKey(a.date, a.start, a.description))
    if (!day) continue
    cameOn.set(day, (cameOn.get(day) ?? new Set()).add(a.clientId))
  }

  // Each option on the one category it was held under most.
  const categoriesOf = new Map<string, string[]>()
  for (const h of r.holdings) {
    const k = note(h.serviceCategory)
    if (!k) continue
    const o = normaliseOptionName(h.option)
    categoriesOf.set(o, [...(categoriesOf.get(o) ?? []), k])
  }
  const optionsOf = new Map<string, string[]>()
  for (const [o, ks] of categoriesOf) {
    const k = commonest(ks)!
    optionsOf.set(k, [...(optionsOf.get(k) ?? []), o])
  }
  const salePrices = new Map<string, number[]>()
  for (const s of r.sales) {
    if (s.quantity !== 1 || s.total <= 0) continue
    const o = normaliseOptionName(s.description)
    salePrices.set(o, [...(salePrices.get(o) ?? []), s.total])
  }

  return [...spelled.keys()].sort().map(k => {
    const days = rows.get(k) ?? []
    const tiers = (optionsOf.get(k) ?? []).sort().map(o => {
      const held = r.holdings.filter(h => normaliseOptionName(h.option) === o)
      const heldPaid = held.map(h => h.totalPaid).filter(p => p > 0)
      return {
        name: commonest(held.map(h => h.option))!,
        mindbodyNames: [...new Set(held.map(h => h.option))].sort(),
        priceSgd: commonest(salePrices.get(o) ?? []) ?? commonest(heldPaid) ?? 0,
        held: held.length,
      }
    })
    const options = new Set(optionsOf.get(k) ?? [])
    const holders = new Set(
      r.holdings
        .filter(h => options.has(normaliseOptionName(h.option)) && h.lastExpiration !== null && dayNumber(h.lastExpiration) >= today)
        .map(h => h.clientId),
    )
    // Past places are one per member per run (days no more than a month apart), so a run's capacity is everyone who came to it.
    const came = [...cameOn]
      .filter(([day]) => day.startsWith(`${k}\n`))
      .map(([day, who]) => ({ on: Number(day.split('\n')[1]!.split(' ')[0]), who }))
      .sort((a, b) => a.on - b.on)
    let mostInARun = 0
    let run = new Set<string>()
    let last: number | null = null
    for (const d of came) {
      if (last !== null && d.on - last > 31) run = new Set()
      for (const c of d.who) run.add(c)
      mostInARun = Math.max(mostInARun, run.size)
      last = d.on
    }
    // One title for every run, or none: a category that ran different workshops keeps its own name.
    const runTitles = new Set<string | null>()
    let runDays: string[] = []
    let lastDay: number | null = null
    for (const s of [...days].sort((a, b) => dayNumber(a.date) - dayNumber(b.date))) {
      if (lastDay !== null && dayNumber(s.date) - lastDay > 31) {
        runTitles.add(titleOfRun(runDays))
        runDays = []
      }
      runDays.push(s.description)
      lastDay = dayNumber(s.date)
    }
    if (runDays.length > 0) runTitles.add(titleOfRun(runDays))
    const [title] = runTitles.size === 1 ? [...runTitles] : [null]
    return {
      category: spelled.get(k)!,
      title: title ?? null,
      location: commonest(days.map(s => s.location.trim()).filter(Boolean)),
      days: new Set(days.map(s => `${dayNumber(s.date)} ${s.start.hour}:${s.start.minute}`)).size,
      capacity: Math.max(mostInARun, holders.size),
      tiers,
    }
  })
}

export type StaffFact = {
  name: string
  active: boolean
  teacherFlag: boolean
  email: string | null
  lastTaught: string | null
  onFutureTimetable: boolean
  pt: boolean
  /** Taught in the 12 months up to the download, or is on the timetable after it. */
  instructor: boolean
  perClassRate: number | null
}

/** Who the staff are, from every staff-related report: the Phone Book, and who taught what when. */
export function staffFacts(r: MindbodyReports, asOf: CalendarDate, opts: { pt?: RegExp } = {}): StaffFact[] {
  const PT = opts.pt ?? DEFAULT_PT
  const today = dayNumber(asOf)
  const yearAgo = today - 365
  const last = new Map<string, number>()
  const future = new Set<string>()
  const pt = new Set<string>()
  const see = (name: string, d: number, isPt = false) => {
    const k = normaliseStaffName(name)
    if (d > today) future.add(k)
    else last.set(k, Math.max(last.get(k) ?? -Infinity, d))
    if (isPt && d >= yearAgo) pt.add(k)
  }
  for (const s of r.schedule) see(s.staff, dayNumber(s.date))
  for (const a of r.attendance) see(a.staff, dayNumber(a.date), PT.test(a.description))
  for (const x of r.roster) see(x.staff, dayNumber(x.date), PT.test(x.description))
  for (const p of r.payroll) see(p.staff, dayNumber(p.date))
  const rate = new Map(r.payRates.map(p => [normaliseStaffName(p.staff), p.perClass]))

  return r.phoneBook.map(p => {
    const k = normaliseStaffName(p.name)
    const lastDay = last.get(k)
    return {
      name: p.name,
      active: p.active,
      teacherFlag: p.teacher,
      email: p.email,
      lastTaught: lastDay === undefined || !Number.isFinite(lastDay) ? null : new Date(lastDay * 86_400_000).toISOString().slice(0, 10),
      onFutureTimetable: future.has(k),
      pt: pt.has(k),
      instructor: future.has(k) || (lastDay !== undefined && lastDay >= yearAgo),
      perClassRate: rate.get(k) ?? null,
    }
  })
}
