/**
 * Studio-wide promotional discount codes.
 * These are separate from the friend-referral system.
 * Add new codes here and redeploy — no DB table needed for now.
 */
export const PROMO_CODES: Record<string, { discountSgd: number; description: string }> = {
  SADHANA20: { discountSgd: 20, description: 'S$20 off' },
  FRIEND10: { discountSgd: 10, description: 'S$10 off' },
}

export function validatePromoCode(code: string): { valid: true; discountSgd: number; description: string } | { valid: false } {
  const entry = PROMO_CODES[code.trim().toUpperCase()]
  if (!entry) return { valid: false }
  return { valid: true, ...entry }
}
