/**
 * Pure function: cancellation cap + window evaluation per spec §4.
 * Reads cancellations table where source='client' and cancelled_at >= now - cycle_days,
 * plus global_policy. Admin path bypasses this entirely.
 */
export type CancellationKind = 'class' | 'pt'

export interface EvaluateInput {
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
}

export async function evaluateCancellation(_input: EvaluateInput): Promise<EvaluateResult> {
  return {
    allowed: true,
    refund: 'forfeit',
    reason: 'late',
    wasWithinWindow: false,
    wasWithinCap: true,
  }
}
