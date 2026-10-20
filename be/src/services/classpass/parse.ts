/**
 * Reading a ClassPass booking email (#411): the fields the import needs, each
 * found by its label rather than its position, because ClassPass has moved its
 * labels about before (`docs/md/research-classpass-integration.md`).
 *
 * This reads the HTML layout ClassPass has sent since March 2026:
 *
 * ```
 * Reservation        Yoga Stretch
 * Date and time      Sep 18, 2026 @ 1:30 PM
 * Location           <Studio>-<Location>
 * Reservation ID     76ada2434e044c31b181fa605321a07f
 * Member information
 *   <Member Name>
 *   <member@example.com>
 * ```
 *
 * Pure: the date and time are returned as the studio's wall clock, and the
 * caller reads them in the studio's timezone.
 */

export type ClassPassBookingFields = {
  /** 32 hex characters, lower-cased. */
  reservationId: string | null
  className: string | null
  /** As ClassPass wrote it. */
  locationName: string | null
  /** `YYYY-MM-DD`, the studio's own calendar day. */
  localDate: string | null
  /** `HH:MM`, 24-hour, the studio's own wall clock. */
  localTime: string | null
  memberName: string | null
  /** Lower-cased. */
  memberEmail: string | null
}

/** Every field the booking needs, so a booking email missing one is `unparsed`. */
export type CompleteClassPassBooking = { [K in keyof ClassPassBookingFields]: NonNullable<ClassPassBookingFields[K]> }

export function isComplete(fields: ClassPassBookingFields): fields is CompleteClassPassBooking {
  return Object.values(fields).every(v => v !== null)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** A reference to a code point no character has (`&#99999999;`) is left as written. */
function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, name: string) => {
    const lower = name.toLowerCase()
    if (!lower.startsWith('#')) return ENTITIES[lower] ?? whole
    const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10)
    return Number.isInteger(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

/**
 * The email's visible text as a list of pieces: every run of text between two
 * tags, line breaks, or a gap of two spaces or a tab (as a plain-text table
 * lays out a label and its value), trimmed, with empties dropped.
 */
export function textPieces(message: { html: string | null; text: string | null }): string[] {
  const visible = message.html
    ? decode(
        message.html
          .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '\n')
          .replace(/<[^>]*>/g, '\n'),
      )
    : (message.text ?? '')
  return visible
    .split(/\n|\t| {2,}/)
    .map(piece => piece.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

const label = (piece: string) => piece.replace(/:$/, '').trim().toLowerCase()

/** Every label in the layout, so an empty value never reads the next label as itself. */
const LABELS = new Set([
  'reservation details',
  'reservation',
  'date and time',
  'location',
  'reservation id',
  'member information',
  'schedule details',
])

/** The piece after the one that is exactly `name`, ignoring case and a trailing colon. */
function after(pieces: string[], name: string): string | null {
  const at = pieces.findIndex(p => label(p) === name.toLowerCase())
  const value = at >= 0 ? pieces[at + 1] : undefined
  return value === undefined || LABELS.has(label(value)) ? null : value
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const RESERVATION_ID = /^[0-9a-f]{32}$/i
/* ── dates and times as ClassPass writes them (the roster reads them too) ── */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')

/** `Sep`, `Sept`, `September` (any case): the month, 0-based; -1 for no month. */
export function monthOf(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase())
}

/** `1`, `30`, `p` (12-hour, `a`/`p`) as `13:30`; null for a time no clock shows. */
export function clock24(hour: string, minute: string, half: string): string | null {
  const h = Number(hour)
  if (h < 1 || h > 12 || Number(minute) > 59) return null
  return `${pad((h % 12) + (half.toLowerCase() === 'p' ? 12 : 0))}:${minute}`
}

/** `YYYY-MM-DD` for day `day` of 0-based `month`; null for a day the month doesn't have (Feb 30). */
export function calendarDate(year: number, month: number, day: number): string | null {
  const check = new Date(Date.UTC(year, month, day))
  if (month < 0 || check.getUTCMonth() !== month || check.getUTCDate() !== day) return null
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

/** `Sep 18, 2026 @ 1:30 PM`. */
const WHEN = /^([a-z]+)\.? (\d{1,2}), (\d{4}) @ (\d{1,2}):(\d{2}) ?([ap])\.?m\.?$/i

function when(value: string | null): { localDate: string; localTime: string } | null {
  const m = value ? WHEN.exec(value) : null
  if (!m) return null
  const [, monthName, day, year, hour, minute, half] = m
  const localDate = calendarDate(Number(year), monthOf(monthName!), Number(day))
  const localTime = clock24(hour!, minute!, half!)
  return localDate && localTime ? { localDate, localTime } : null
}

/** Not the member's name: what ClassPass prints under it. */
const NOT_A_NAME = /^(returning|new) customer$/i
const SECTION_END = /^schedule details$/i

function member(pieces: string[]): { memberName: string | null; memberEmail: string | null } {
  const at = pieces.findIndex(p => label(p) === 'member information')
  if (at < 0) return { memberName: null, memberEmail: null }
  const end = pieces.findIndex((p, i) => i > at && SECTION_END.test(p))
  const section = pieces.slice(at + 1, end < 0 ? undefined : end)
  const email = section.find(p => EMAIL.test(p)) ?? null
  const name = section.find(p => !EMAIL.test(p) && !NOT_A_NAME.test(p)) ?? null
  return { memberName: name, memberEmail: email?.toLowerCase() ?? null }
}

/**
 * The plain-text layout ClassPass sent from late 2025 to early 2026:
 *
 * ```
 * You received a ClassPass reservation
 * Reservation key: <32 hex>
 * Reservation details:
 *   Arm Balance
 *   at <Studio> - <Location>
 *   Dec 4, 2025 @ 6:30 PM
 * Reservation made by:
 *   Name: <Member Name>
 *   Email: <member@example.com>
 * ```
 *
 * A label's value is on its own line or after the colon on the label's line.
 */
const SECTIONS_2025 = ['reservation key', 'reservation details', 'reservation made by']
const LABELS_2025 = [...SECTIONS_2025, 'name', 'email']

/** `Label: value` on one line, or `Label:` with the value as the next piece. */
function labelled(pieces: string[], name: string): string | null {
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!
    if (label(piece) === name) {
      const next = pieces[i + 1]
      return next === undefined || LABELS_2025.includes(label(next)) ? null : next
    }
    const inline = new RegExp(`^${name}\\s*:\\s*(.+)$`, 'i').exec(piece)
    if (inline) return inline[1]!.trim()
  }
  return null
}

/** The pieces after the label `name` up to the next label of the layout. */
function section(pieces: string[], name: string): string[] {
  const at = pieces.findIndex(p => label(p) === name)
  if (at < 0) return []
  const end = pieces.findIndex((p, i) => i > at && SECTIONS_2025.some(l => label(p) === l || label(p).startsWith(`${l}:`)))
  return pieces.slice(at + 1, end < 0 ? undefined : end)
}

const AT_LOCATION = /^at\s+(.+)$/i

function parse2025(pieces: string[]): ClassPassBookingFields {
  const reservationId = labelled(pieces, 'reservation key')
  const details = section(pieces, 'reservation details')
  const time = when(details.find(p => WHEN.test(p)) ?? null)
  const location = details.map(p => AT_LOCATION.exec(p)?.[1]?.trim()).find(Boolean) ?? null
  const first = details[0]
  const className = first !== undefined && !AT_LOCATION.test(first) && !WHEN.test(first) ? first : null
  const madeBy = section(pieces, 'reservation made by')
  const memberName = labelled(madeBy, 'name')
  const memberEmail = labelled(madeBy, 'email')
  return {
    reservationId: reservationId && RESERVATION_ID.test(reservationId) ? reservationId.toLowerCase() : null,
    className,
    locationName: location,
    localDate: time?.localDate ?? null,
    localTime: time?.localTime ?? null,
    memberName,
    memberEmail: memberEmail && EMAIL.test(memberEmail) ? memberEmail.toLowerCase() : null,
  }
}

/** Whether the email is in the 2025 plain-text layout, by its `Reservation key` label. */
const is2025 = (pieces: string[]) => pieces.some(p => /^reservation key\s*:/i.test(p) || label(p) === 'reservation key')

/**
 * The booking fields of a `ClassPass user reservation` email, in either
 * layout, each null when it can't be read.
 */
export function parseClassPassBooking(message: { html: string | null; text: string | null }): ClassPassBookingFields {
  const pieces = textPieces(message)
  if (is2025(pieces)) return parse2025(pieces)
  const reservationId = after(pieces, 'Reservation ID')
  const time = when(after(pieces, 'Date and time'))
  return {
    reservationId: reservationId && RESERVATION_ID.test(reservationId) ? reservationId.toLowerCase() : null,
    className: after(pieces, 'Reservation'),
    locationName: after(pieces, 'Location'),
    localDate: time?.localDate ?? null,
    localTime: time?.localTime ?? null,
    ...member(pieces),
  }
}
