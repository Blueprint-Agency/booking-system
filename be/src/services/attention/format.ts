/**
 * The wording the Attention copy shares. Dates are written in the studio's own
 * zone and look like "Tue 28 Oct, 7:00 pm"; ages look like "3 h ago".
 *
 * Only the parts of an `Intl` format are read, never its string, and the locale
 * is `en-US` because `en-GB` abbreviates September to "Sept".
 */

import { zoneFormat } from '../../lib/studio-time'

const zoned = (at: Date, timezone: string, opts: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(zoneFormat(timezone, 'en-US', opts).formatToParts(at).map(p => [p.type, p.value]))

/** "Tue 28 Oct, 7:00 pm", in `timezone`. */
export function formatWhen(at: Date, timezone: string): string {
  const parts = zoned(at, timezone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`
}

/** "Tue 28 Oct", in `timezone`. */
export function formatDay(at: Date, timezone: string): string {
  const p = zoned(at, timezone, { weekday: 'short', day: 'numeric', month: 'short' })
  return `${p.weekday} ${p.day} ${p.month}`
}

/** "7:00 pm", in `timezone`. */
export function formatClock(at: Date, timezone: string): string {
  const p = zoned(at, timezone, { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${p.hour}:${p.minute} ${String(p.dayPeriod).toLowerCase()}`
}

/** "Tuesday", in `timezone`. */
export function formatWeekday(at: Date, timezone: string): string {
  return String(zoned(at, timezone, { weekday: 'long' }).weekday)
}

/** "Tue 28 Oct" from a plain `YYYY-MM-DD` date, which has no zone to convert. */
export function formatPlainDay(date: string): string {
  return formatDay(new Date(`${date}T12:00:00Z`), 'UTC')
}

/** A portal path with `location={id}` on its query, so the shell opens it on that location. */
export function withLocation(path: string, locationId: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}location=${locationId}`
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function formatAge(since: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}
