/**
 * The small value formats every Mindbody report shares, read one way.
 */

/** A wall-clock date and time with no zone: what a Mindbody report prints. */
export type LocalDateTime = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/**
 * Which way round a column writes its dates.
 *
 * Not guessed from the value. Mindbody mixes both orders across reports and even
 * within one row (Retention Management's "Member Since" is D/M, its "Membership
 * Expiration" M/D), and a guess is right for every date whose day is 12 or less
 * and silently wrong for the others. Each reader states the order per column.
 */
export type DateOrder = 'DM' | 'MD'

const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?$/i

/** `24/4/2023 8:38:19 pm`, `29/5/2023`, `11/26/2026 3:04:00 PM` — or null for `-`, blank or nonsense. */
export function parseMindbodyDate(raw: string, order: DateOrder): LocalDateTime | null {
  const m = DATE.exec(raw.trim())
  if (!m) return null
  const [first, second] = [Number(m[1]), Number(m[2])]
  const day = order === 'DM' ? first : second
  const month = order === 'DM' ? second : first
  const year = Number(m[3])
  let hour = m[4] ? Number(m[4]) : 0
  const meridiem = m[7]?.toLowerCase()
  if (meridiem === 'am' && hour === 12) hour = 0
  if (meridiem === 'pm' && hour < 12) hour += 12

  // Round-tripped through a Date so 31/2 is refused instead of becoming 2/3.
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null
  }
  return { year, month, day, hour, minute: m[5] ? Number(m[5]) : 0, second: m[6] ? Number(m[6]) : 0 }
}

/**
 * A studio-local wall-clock time as an instant, in the studio's timezone.
 *
 * Every Mindbody date is studio-local. The offset is read for that moment, not
 * once, so a zone with daylight saving is right on both sides of the change.
 */
export function zonedToInstant(local: LocalDateTime, timeZone: string): Date {
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second)
  // Two passes: the first offset is read at the naive instant, which is off by
  // the offset itself; reading again at the corrected instant settles it.
  let instant = asUtc - offsetMs(new Date(asUtc), timeZone)
  instant = asUtc - offsetMs(new Date(instant), timeZone)
  return new Date(instant)
}

/** A time of day on the studio's clock. */
export type ClockTime = { hour: number; minute: number }

/**
 * A workbook's date cell: a count of days since 30 December 1899, as Excel
 * keeps it. A real workbook date has no D/M or M/D to get wrong.
 */
export function excelDate(raw: string): CalendarDate | null {
  const serial = Number(raw)
  if (!raw.trim() || !Number.isFinite(serial) || serial < 1) return null
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/** A workbook's time cell: the fraction of a day gone, so 0.375 is 9:00. Rounded to the minute. */
export function excelTime(raw: string): ClockTime | null {
  const fraction = Number(raw)
  if (!raw.trim() || !Number.isFinite(fraction) || fraction < 0) return null
  const minutes = Math.round((fraction % 1) * 1440) % 1440
  return { hour: Math.floor(minutes / 60), minute: minutes % 60 }
}

const CLOCK = /^(\d{1,2}):(\d{2})\s*([ap]m)$/i

/** `11:15 am`, `1:45 PM`. */
export function parseClock(raw: string): ClockTime | null {
  const m = CLOCK.exec(raw.trim())
  if (!m) return null
  let hour = Number(m[1]) % 12
  if (m[3]!.toLowerCase() === 'pm') hour += 12
  return { hour, minute: Number(m[2]) }
}

/**
 * One key for a class's name, however a report writes it: padded, in two cases,
 * and — on the staff schedule — with `***` after it where a substitute taught.
 * NFKC folds the "fancy" bold letters some names are typed in back to plain ones.
 */
export function normaliseClassName(raw: string): string {
  return raw.normalize('NFKC').replace(/\*+\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** A day on the studio's calendar. Every `LocalDateTime` is one. */
export type CalendarDate = { year: number; month: number; day: number }

/** A calendar day as a count of days, for comparing two and measuring between them. */
export function dayNumber(d: CalendarDate): number {
  return Date.UTC(d.year, d.month - 1, d.day) / 86_400_000
}

/** A calendar day as `YYYY-MM-DD`: how a `date` column is written, and how days sort. */
export function isoDay(d: CalendarDate): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

/** A time of day as `HH:MM`: how a `time` column is written, and how times sort. */
export function isoClock(t: ClockTime): string {
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`
}

/** ISO weekday of a calendar day: Monday 1 … Sunday 7. */
export function isoWeekday(d: CalendarDate): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const js = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()
  return (js === 0 ? 7 : js) as 1 | 2 | 3 | 4 | 5 | 6 | 7
}

/** An amount as a `numeric(…, 2)` column holds it. */
export function money(n: number): string {
  return n.toFixed(2)
}

/** The day an ISO timestamp names in the offset it was written with: its first ten characters. */
export function dateOfIso(iso: string): CalendarDate {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  return { year: year!, month: month!, day: day! }
}

/** The day it is at the studio at some instant. */
export function localDateOf(at: Date, timeZone: string): CalendarDate {
  const wall = new Date(at.getTime() + offsetMs(at, timeZone))
  return { year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate() }
}

/**
 * One formatter per timezone, kept.
 *
 * Building an `Intl.DateTimeFormat` is expensive — tens of microseconds — and
 * every date this transform reads is converted through one, twice. A studio
 * importing its whole history converts hundreds of thousands of them, and a
 * fresh formatter each time is most of the run.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = FORMATTERS.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    FORMATTERS.set(timeZone, formatter)
  }
  return formatter
}

function offsetMs(at: Date, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(at)
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return wall - Math.floor(at.getTime() / 1000) * 1000
}

/** Mindbody's "no phone entered": `1` and ten zeros. */
const PLACEHOLDER_PHONE = '10000000000'

/**
 * A phone as the platform keeps it: digits (and a leading `+`), or empty.
 *
 * Punctuation goes because some records carry a US input mask over a local
 * number — `(912) 345-6789` — which is formatting, not data.
 */
export function cleanPhone(raw: string): string {
  const trimmed = raw.trim()
  const digits = trimmed.replace(/[^\d]/g, '')
  if (!digits || digits === PLACEHOLDER_PHONE) return ''
  return trimmed.startsWith('+') ? `+${digits}` : digits
}

/** Shallow on purpose, like the platform's own check: a bounce is the authority on deliverability. */
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Trimmed and lower-cased, or null for `-`, blank, or anything that is not an address. */
export function cleanEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return EMAIL.test(email) ? email : null
}

/** `$1,439.20`, `-850.00`, `3600` — dollars as a number, or null for blank or nonsense. */
export function parseMoney(raw: string): number | null {
  const text = raw.replace(/[$,\s]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null
  return Number(text)
}

/**
 * Mindbody has no "unlimited": it writes 9,999, 99,999 or 999,999 sessions —
 * doubled where two holdings are combined — and counts down from there. Nobody
 * holds nine thousand real sessions, so anything from there up is the sentinel.
 */
const UNLIMITED_FROM = 9_000

export type SessionCount = { unlimited: true } | { unlimited: false; count: number }

/** A session count, with Mindbody's sentinel read as what it means. Null for blank or nonsense. */
export function parseSessions(raw: string): SessionCount | null {
  const n = parseMoney(raw)
  if (n === null || !Number.isInteger(n)) return null
  return n >= UNLIMITED_FROM ? { unlimited: true } : { unlimited: false, count: n }
}

/**
 * One key for a pricing option's name, however a report writes it: the same
 * option turns up in two cases, with doubled spaces, and once behind a stray
 * control character.
 */
export function normaliseOptionName(raw: string): string {
  return raw.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * One key for a staff member's name, however a report writes it.
 *
 * Staff have no id in any report, so name is the join. The payroll and schedule
 * reports write `Last, First`, the phone book `First Last`, some upper-case, most
 * with stray spaces. The key is the name's words, case-folded and sorted — so
 * word order stops mattering, which is the whole of the difference between those
 * forms.
 */
export function normaliseStaffName(raw: string): string {
  return raw
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .sort()
    .join(' ')
}

/** Collapse runs of spaces and trim. */
export function tidy(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}
