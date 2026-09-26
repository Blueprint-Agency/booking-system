/**
 * Pure-ish function: cancellation cap + window evaluation per spec §4.
 * Reads cancellations table where source='client' and cancelled_at >= now - cycle_days,
 * plus global_policy. Admin path bypasses this entirely (always full refund).
 *
 * The cap is a SHARED bucket across class + PT client cancellations (one count, both kinds).
 * No-shows are NOT cancellations, so they never land in this table and never count.
 * With the cap switched off every cancel is within it — they are still recorded,
 * so switching it back on counts the ones already inside the cycle.
 *
 * A member's class cancel is decided here (#318): once the class has started it
 * is refused `class_started`; inside the window it is a **Late cancel** — let
 * through, the credit kept, and counted toward the cap like any other.
 */
import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '../../db'
import { globalPolicy } from '../../db/schema/policy'
import { cancellations } from '../../db/schema/bookings'
import { AppError, NotFoundError } from '../../shared/errors'
import { effectiveCancelWindow, insideCancelWindow } from './cancel-window'

export type CancellationKind = 'class' | 'pt'

export interface EvaluateInput {
  tenantId: string
  clientId: string
  kind: CancellationKind
  sessionStartsAt: Date
  /**
   * A class's own Cancellation Window (`classes.cancel_window_hours`); null or
   * absent = the studio's. A class caller must pass what the row holds, or the
   * class is judged by the studio's window. Ignored for PT.
   */
  classOwnWindowHours?: number | null
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

const DAY_MS = 86_400_000

/** What a member's cancellation is judged by. */
export interface CancellationPolicy {
  /** Off: every cancel is within the cap, whatever the count says. */
  cancelCapEnabled: boolean
  cancelCapCount: number
  cancelCapCycleDays: number
  classWindowHours: number
  ptWindowHours: number
}

/**
 * This studio's cancellation rules — the same read `evaluateCancellation` makes,
 * so what a member is told and what the server enforces are one row.
 */
export async function readCancellationPolicy(tenantId: string): Promise<CancellationPolicy> {
  const [policy] = await db
    .select({
      cancelCapEnabled: globalPolicy.cancelCapEnabled,
      cancelCapCount: globalPolicy.cancelCapCount,
      cancelCapCycleDays: globalPolicy.cancelCapCycleDays,
      classWindowHours: globalPolicy.classWindowHours,
      ptWindowHours: globalPolicy.ptWindowHours,
    })
    .from(globalPolicy)
    .where(eq(globalPolicy.tenantId, tenantId))
    .limit(1)
  if (!policy) throw new NotFoundError('policy_not_seeded')
  return policy
}

/**
 * The window a cancel of this kind is judged by, in hours: a class's effective
 * window (its own, else the studio's), or the studio's PT window. A staff
 * cancel records it the same way a member's is decided by it.
 */
export function cancelWindowHoursFor(
  policy: CancellationPolicy,
  kind: CancellationKind,
  classOwnWindowHours: number | null,
): number {
  return kind === 'class' ? effectiveCancelWindow(classOwnWindowHours, policy.classWindowHours) : policy.ptWindowHours
}

/**
 * Judge a member's cancel. Throws `class_started` for a class that has begun —
 * a member can cancel a class until it starts, never after. A PT session is
 * refused earlier, at its window, by its callers (`cancellation_window_passed`).
 */
export async function evaluateCancellation(input: EvaluateInput): Promise<EvaluateResult> {
  const { tenantId, clientId, kind, sessionStartsAt, now } = input

  if (kind === 'class' && now >= sessionStartsAt) throw new AppError(422, 'class_started')

  const policy = await readCancellationPolicy(tenantId)

  // Window: the booking must be cancelled at least N hours before it starts —
  // for a class, its effective window (./cancel-window).
  const windowHours = cancelWindowHoursFor(policy, kind, input.classOwnWindowHours ?? null)
  const wasWithinWindow = !insideCancelWindow(sessionStartsAt, windowHours, now)

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
  const wasWithinCap = !policy.cancelCapEnabled || priorCount < policy.cancelCapCount

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
