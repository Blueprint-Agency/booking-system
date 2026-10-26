/**
 * The wording the Attention copy shares. Dates are written in the studio's own
 * zone and look like "Tue 28 Oct, 7:00 pm"; ages look like "3 h ago".
 */

/** "Tue 28 Oct, 7:00 pm", in `timezone`. */
export function formatWhen(at: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .formatToParts(at)
      .map(p => [p.type, p.value]),
  )
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`
}

/** "Tue 28 Oct", in `timezone`. */
export function formatDay(at: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short' })
      .formatToParts(at)
      .map(p => [p.type, p.value]),
  )
  return `${parts.weekday} ${parts.day} ${parts.month}`
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
