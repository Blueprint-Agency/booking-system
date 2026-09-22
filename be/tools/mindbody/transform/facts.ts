import { proposeCatalogue } from './catalogue'
import type { MindbodyReports } from './mapper'
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
  return { classTypes, categories, ptNames, maxByRoom, sold, roomless, everySold }
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
