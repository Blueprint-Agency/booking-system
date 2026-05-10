import type { EvaluateResult } from '../policy/evaluate-cancellation'

export type RefundOutcome =
  | 'credit_returned'
  | 'session_returned'
  | 'stripe_refunded'
  | 'forfeited'
  | 'n_a'

/**
 * Decides which refund_outcome to record on a booking based on kind + evaluation.
 */
export function decideOutcome(
  kind: 'class' | 'workshop' | 'pt',
  source: 'client' | 'admin',
  evaluation?: EvaluateResult,
): RefundOutcome {
  if (source === 'admin') {
    if (kind === 'workshop') return 'stripe_refunded'
    if (kind === 'class') return 'credit_returned'
    return 'session_returned'
  }
  if (kind === 'workshop') return 'forfeited'
  if (!evaluation) return 'forfeited'
  if (evaluation.refund === 'forfeit') return 'forfeited'
  return kind === 'class' ? 'credit_returned' : 'session_returned'
}
