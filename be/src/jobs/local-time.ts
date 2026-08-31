/**
 * "Daily at 01:00" — in whose 01:00?
 *
 * The six scheduled jobs used to answer that with a hardcoded UTC offset
 * (`0 17 * * *` = 01:00 SGT), which is right for exactly one studio and wrong
 * for every other one. It is also quietly wrong on the server itself: the
 * Postgres container runs `Asia/Kuala_Lumpur` and the process runs whatever the
 * host says, so "the daily hour" was being inferred from three different clocks
 * that only happen to agree today.
 *
 * The fix is to stop scheduling in UTC-with-an-offset entirely. Cron ticks on a
 * fixed grid; each tick asks every tenant "is it your hour yet?", answered from
 * that tenant's IANA zone. So a tenant is never configured into a schedule —
 * its `timezone` column is the whole configuration — and adding a tenant needs
 * no job wiring at all.
 */

/** How often the cron grid ticks. Every real IANA offset is a whole number of
 *  quarter-hours (`Asia/Kolkata` is +05:30, `Asia/Kathmandu` +05:45), so a
 *  15-minute grid lands on a tenant's hour boundary in every zone — an hourly
 *  grid would miss the half-hour zones forever. */
export const SLOT_MINUTES = 15
export const SLOT_CRON = `*/${SLOT_MINUTES} * * * *`

/**
 * Wall-clock hour and minute in `timezone` at instant `at`.
 *
 * `Intl` is the only thing in the runtime that knows the current offset for a
 * zone — including whether daylight saving is in effect on this date — so the
 * conversion goes through it rather than through any stored offset.
 *
 * Throws `RangeError` on a zone name the runtime does not know; the caller
 * treats that as one tenant's problem, not the sweep's.
 */
export function localClock(timezone: string, at: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)

  const read = (type: 'hour' | 'minute') => {
    const part = parts.find(p => p.type === type)
    if (!part) throw new RangeError(`no ${type} for timezone ${timezone}`)
    return Number(part.value)
  }

  return { hour: read('hour'), minute: read('minute') }
}

/**
 * Is `at` the one tick of the day on which a tenant in `timezone` should run its
 * `localHour` job?
 *
 * True for the first slot of that local hour and no other, so a job fires
 * exactly once per local day. On a spring-forward day where the target hour does
 * not exist locally the job does not run that day — the same thing a
 * timezone-aware cron does, and the reason the daily hours here are ones no zone
 * skips.
 */
export function isDailySlot(timezone: string, localHour: number, at: Date): boolean {
  const { hour, minute } = localClock(timezone, at)
  return hour === localHour && minute < SLOT_MINUTES
}
