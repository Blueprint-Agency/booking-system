/**
 * On the referee's first successful payment, credit the referrer.
 * Idempotency via clients.referral_credit_granted_at column.
 * See backend-architecture.md §6 Referral conversion crediting + be-client.md §4g.
 */
export async function onRefereeFirstPayment(_refereeClientId: string): Promise<void> {
  // Inside the same transaction as the package grant or workshop booking insert:
  // 1. Load referee; skip if referred_by_client_id IS NULL OR referral_credit_granted_at IS NOT NULL
  // 2. Pick referrer's most recent active client_packages OR insert a 90-day referral credit pkg
  // 3. Insert manual_adjustments with reason='referral_conversion'
  // 4. UPDATE clients SET referral_credit_granted_at = now() WHERE id = referee
  // 5. Insert audit_log with actor_type='system', action='referral.converted'
  // 6. enqueueEmail('referral_credited', ...)
  throw new Error('not implemented')
}

/** Resolve a referral code at registration — public endpoint. */
export async function resolveReferralCode(_code: string): Promise<{ valid: boolean; referrerName?: string }> {
  return { valid: false }
}

/** Compute deterministic referral code from clients.id. */
export function computeReferralCode(clientId: string): string {
  // First 5 hex bytes of UUID, base32-Crockford-ish (no I/L/O/U)
  const hex = clientId.replace(/-/g, '').slice(0, 10)
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  let code = ''
  for (let i = 0; i < 10; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16)
    code += ALPHABET[byte % 32]
  }
  return code
}
