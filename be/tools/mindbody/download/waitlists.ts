import type { TableRow } from '../transform/html-table'
import type { ScheduledClassRow } from '../transform/readers'
import { isoClock, isoDay, normaliseClassName, normaliseStaffName, zonedToInstant, type ClockTime } from '../transform/values'

/**
 * The class waitlists, which no Mindbody report carries (spec-waitlist.md §12a).
 * Each class's line is only on its Class Sign In screen — queue order, name,
 * payment status — so the download opens that screen for every class still to
 * come on the Staff Schedule it has just written, and writes one workbook of
 * what it read: one row per waiting client, in order (`45 Class Waitlists.xlsx`,
 * read by `../transform/readers.ts` `readWaitlists`).
 *
 * The planning and the reading are here, pure and tested; `./engine.ts` only
 * drives the pages. Which page lists a day's classes, and how a sign-in link and
 * the Waitlist section look, are Mindbody's markup: `reports.ts` holds the path,
 * and the page-side code finds links and the section by what they say rather
 * than by position. A class whose screen cannot be found fails the report,
 * never passes as a class nobody waits on.
 */

/** The sheet's columns, which `readWaitlists` reads by name. */
export const WAITLIST_HEADER = ['Class date', 'Start', 'Description', 'Staff', 'Client ID', 'Client', 'Position', 'Payment status'] as const

export type FutureClass = Pick<ScheduledClassRow, 'date' | 'start' | 'description' | 'staff'>

/**
 * Every class the Staff Schedule has after `now`, once each. The report lists a
 * class under its teacher only, but a class with two names on it (a substitute
 * `***`) is still one screen.
 */
export function futureClasses(schedule: ScheduledClassRow[], now: Date, timeZone: string): FutureClass[] {
  const seen = new Map<string, FutureClass>()
  for (const r of schedule) {
    if (zonedToInstant({ ...r.date, ...r.start, second: 0 }, timeZone) <= now) continue
    const key = `${isoDay(r.date)} ${isoClock(r.start)} ${normaliseClassName(r.description)} ${normaliseStaffName(r.staff)}`
    if (!seen.has(key)) seen.set(key, { date: r.date, start: r.start, description: r.description, staff: r.staff })
  }
  return [...seen.values()].sort(
    (a, b) => isoDay(a.date).localeCompare(isoDay(b.date)) || isoClock(a.start).localeCompare(isoClock(b.start)) || a.description.localeCompare(b.description),
  )
}

/** A link on a day's class list, and the text of the row it sits in. */
export type DayLink = { href: string; rowText: string }

const CLOCK_IN_TEXT = /\b(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/gi

/** Every time of day a row's text shows (`7:00 pm`, `7:00pm`), as the 24-hour clock. */
function clocksIn(text: string): string[] {
  return [...text.matchAll(CLOCK_IN_TEXT)].map(m => {
    const hour = (Number(m[1]) % 12) + (m[3]!.toLowerCase() === 'p' ? 12 : 0)
    return isoClock({ hour, minute: Number(m[2]) } as ClockTime)
  })
}

/** A class's sign-in link: one whose href names a class, on the day list's row of that start time and class name. */
export const isSignInLink = (href: string) => /class_?id=\d+/i.test(href)

/**
 * The sign-in link for each class of one day, matched on the start time and the
 * class name its row shows — and, where two rows share both, the teacher.
 * A class with no link, or with two it cannot tell apart, is returned in
 * `missing` for the caller to refuse.
 */
export function matchSignInLinks(classes: FutureClass[], links: DayLink[]): { found: { cls: FutureClass; href: string }[]; missing: FutureClass[] } {
  const rows = links
    .filter(l => isSignInLink(l.href))
    .map(l => ({ ...l, clocks: clocksIn(l.rowText), text: normaliseClassName(l.rowText) }))
  const found: { cls: FutureClass; href: string }[] = []
  const missing: FutureClass[] = []
  for (const cls of classes) {
    const name = normaliseClassName(cls.description)
    const at = isoClock(cls.start)
    const hrefs = new Set(rows.filter(r => r.clocks[0] === at && r.text.includes(name)).map(r => r.href))
    let chosen = [...hrefs]
    if (chosen.length > 1) {
      const teacher = normaliseStaffName(cls.staff).split(' ')
      chosen = chosen.filter(h => {
        const words = normaliseStaffName(rows.find(r => r.href === h)!.rowText).split(' ')
        return teacher.every(w => words.includes(w))
      })
    }
    if (chosen.length === 1) found.push({ cls, href: chosen[0]! })
    else missing.push(cls)
  }
  return { found, missing }
}

const CLIENT_ID = /^(\d{9}|[A-Z]{2}\d{6})$/
const ID_IN_LINK = /(?:\/clients\/|client_?id=|clientid=|\bid=)([A-Z]{0,2}\d{6,9})\b/i

/** A waiting client read off a Class Sign In screen's Waitlist section. */
export type WaitingClient = { clientId: string; client: string; position: number; paymentStatus: string }

/**
 * The Waitlist section's table, as the page-side code read it, into waiting
 * clients in queue order. Its header is found by a name column; the position is
 * the row's own number where it shows one (`1`, `1.`, `#1`), else its place in
 * the table; the client id is a nine-digit cell or the id in the row's client
 * link. A row with no client id (a guest with no profile) is kept with an empty
 * id, and counted in `unread`.
 */
export function readWaitlistSection(rows: TableRow[]): { waiting: WaitingClient[]; unread: number } {
  const at = rows.findIndex(r => r.cells.some(c => /^(client|name|client name)$/i.test(c)))
  const header = at >= 0 ? rows[at]!.cells.map(c => c.toLowerCase()) : []
  const nameCol = header.findIndex(c => /^(client|name|client name)$/.test(c))
  const payCol = header.findIndex(c => /pay|status/.test(c))
  const waiting: WaitingClient[] = []
  let unread = 0
  for (const row of rows.slice(at + 1)) {
    if (!row.cells.some(Boolean)) continue
    const id =
      row.cells.find(c => CLIENT_ID.test(c)) ??
      row.links.map(l => (l ? ID_IN_LINK.exec(l)?.[1] : undefined)).find(x => x && CLIENT_ID.test(x.toUpperCase()))?.toUpperCase()
    // Written all the same, with no id: the transform names it in the preflight rather than it vanishing here.
    if (!id) unread++
    const numbered = row.cells.map(c => /^#?\s*(\d{1,3})\.?$/.exec(c)?.[1]).find(Boolean)
    waiting.push({
      clientId: id ?? '',
      client: nameCol >= 0 ? (row.cells[nameCol] ?? '') : '',
      position: numbered ? Number(numbered) : waiting.length + 1,
      paymentStatus: payCol >= 0 ? (row.cells[payCol] ?? '') : '',
    })
  }
  return { waiting, unread }
}

/** The workbook's rows: the header, then each class's line in order. A class nobody waits on writes nothing. */
export function waitlistSheet(lines: { cls: FutureClass; waiting: WaitingClient[] }[]): string[][] {
  const out: string[][] = [[...WAITLIST_HEADER]]
  for (const { cls, waiting } of lines) {
    for (const w of [...waiting].sort((a, b) => a.position - b.position)) {
      out.push([isoDay(cls.date), isoClock(cls.start), cls.description, cls.staff, w.clientId, w.client, String(w.position), w.paymentStatus])
    }
  }
  return out
}
