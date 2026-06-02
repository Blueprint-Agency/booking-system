/** Global validity for PT packages — the PT catalog has no per-package validity. */
export const PT_VALIDITY_DAYS = 365

export interface PackageValidity {
  kind: 'credit_bundle' | 'unlimited' | 'trial' | 'pt'
  expiresAt: Date | null
  creditsOrSessionsRemaining: number | null
}

/** A package is consumable (active) when not expired AND (unlimited OR balance > 0). */
export function computeActive(p: PackageValidity, now: Date = new Date()): boolean {
  const notExpired = p.expiresAt === null || p.expiresAt > now
  if (!notExpired) return false
  if (p.kind === 'unlimited') return true
  return (p.creditsOrSessionsRemaining ?? 0) > 0
}
