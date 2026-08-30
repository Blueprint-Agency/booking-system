/**
 * Pure-ish function: cancellation cap + window evaluation per spec §4.
 * Reads cancellations table where source='client' and cancelled_at >= now - cycle_days,
 * plus global_policy. Admin path bypasses this entirely (always full refund).
 *
 * The cap is a SHARED bucket across class + PT client cancellations (one count, both kinds).
 * No-shows are NOT cancellations, so they never land in this table and never count.
 */
import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '../../db'
import { globalPolicy } from '../../db/schema/policy'
import { cancellations } from '../../db/schema/bookings'

export type CancellationKind = 'class' | 'pt'

export interface EvaluateInput {
  tenantId: string
  clientId: string
  kind: CancellationKind
  sessionStartsAt: Date
  now: Date
}

export interface EvaluateResult {
  allowed: true
  refund: 'full' | 'forfeit'
  reason: 'within_window_within_cap' | 'over_cap' | 'late' | 'late_and_over_cap'
  wasWithinWindow: boolean
  wasWithinCap: boolean
  /** The configured cancellation window for this kind, in hours (for messaging/gating). */
  windowHours: number
}

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

export async function evaluateCancellation(input: EvaluateInput): Promise<EvaluateResult> {
  const { tenantId, clientId, kind, sessionStartsAt, now } = input

  const [policy] = await db
    .select({
      cancelCapCount: globalPolicy.cancelCapCount,
      cancelCapCycleDays: globalPolicy.cancelCapCycleDays,
      classWindowHours: globalPolicy.classWindowHours,
      ptWindowHours: globalPolicy.ptWindowHours,
    })
    .from(globalPolicy)
    .where(eq(globalPolicy.tenantId, tenantId))
    .limit(1)
  if (!policy) throw new Error('global_policy_missing')

  // Window: the booking must be cancelled at least N hours before it starts.
  const windowHours = kind === 'class' ? policy.classWindowHours : policy.ptWindowHours
  const cutoff = new Date(sessionStartsAt.getTime() - windowHours * HOUR_MS)
  const wasWithinWindow = now <= cutoff

  // Cap: count this client's cancellations (class + PT, client-initiated) in the rolling cycle.
  const cycleStart = new Date(now.getTime() - policy.cancelCapCycleDays * DAY_MS)
  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cancellations)
    .where(
      and(
        eq(cancellations.tenantId, tenantId),
        eq(cancellations.clientId, clientId),
        eq(cancellations.source, 'client'),
        gte(cancellations.cancelledAt, cycleStart),
      ),
    )
  const priorCount = Number(counted?.n ?? 0)
  const wasWithinCap = priorCount < policy.cancelCapCount

  const refund: EvaluateResult['refund'] = wasWithinWindow && wasWithinCap ? 'full' : 'forfeit'
  const reason: EvaluateResult['reason'] =
    wasWithinWindow && wasWithinCap
      ? 'within_window_within_cap'
      : !wasWithinWindow && !wasWithinCap
        ? 'late_and_over_cap'
        : !wasWithinWindow
          ? 'late'
          : 'over_cap'

  return { allowed: true, refund, reason, wasWithinWindow, wasWithinCap, windowHours }
}

/**
 * Why a forfeited cancellation forfeited, as a whole sentence — the
 * `reason_line` the two `*_cancelled_forfeited` email templates render.
 *
 * It lives beside the union it reads because the union is defined here: a
 * forfeit has FOUR causes and only two of them are lateness, so a template that
 * hardcodes "you cancelled inside the window" tells the member who cancelled in
 * good time and merely ran out of allowance something that is simply untrue.
 * The renderer has no conditionals, so the choice has to be made in code (the
 * same rule §13 applies to the purchase confirmations).
 */
export function forfeitLine(reason: EvaluateResult['reason'], windowHours: number): string {
  switch (reason) {
    case 'late':
      return `This cancellation came inside the ${windowHours}-hour cancellation window, so the credit for it was not returned.`
    case 'over_cap':
      return 'You cancelled in good time, but this is past the number of cancellations the studio allows in one cycle, so the credit for it was not returned.'
    case 'late_and_over_cap':
      return `This cancellation came inside the ${windowHours}-hour cancellation window, and is past the number of cancellations the studio allows in one cycle. The credit for it was not returned.`
    // Not a forfeit at all — the caller sends the credit-returned template. The
    // sentence exists so an exhaustive switch stays exhaustive.
    case 'within_window_within_cap':
      return 'The credit for it has been returned to your account.'
  }
}
