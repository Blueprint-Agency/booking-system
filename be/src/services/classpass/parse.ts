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

function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, name: string) => {
    const lower = name.toLowerCase()
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16))
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10))
    return ENTITIES[lower] ?? whole
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
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** `Sep 18, 2026 @ 1:30 PM`. */
const WHEN = /^([a-z]+)\.? (\d{1,2}), (\d{4}) @ (\d{1,2}):(\d{2}) ?([ap])\.?m\.?$/i

function when(value: string | null): { localDate: string; localTime: string } | null {
  const m = value ? WHEN.exec(value) : null
  if (!m) return null
  const [, monthName, day, year, hour, minute, half] = m
  const month = MONTHS.indexOf(monthName!.slice(0, 3).toLowerCase())
  const d = Number(day)
  const h = Number(hour)
  if (month < 0 || h < 1 || h > 12 || Number(minute) > 59) return null
  // A day the month doesn't have (Feb 30) is not a date.
  const check = new Date(Date.UTC(Number(year), month, d))
  if (check.getUTCMonth() !== month || check.getUTCDate() !== d) return null
  const h24 = (h % 12) + (half!.toLowerCase() === 'p' ? 12 : 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { localDate: `${year}-${pad(month + 1)}-${pad(d)}`, localTime: `${pad(h24)}:${minute}` }
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

/** The booking fields of a `ClassPass user reservation` email, each null when it can't be read. */
export function parseClassPassBooking(message: { html: string | null; text: string | null }): ClassPassBookingFields {
  const pieces = textPieces(message)
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
