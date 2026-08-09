/**
 * The credit ledger — the ONLY code that writes `client_packages.credits_or_sessions_remaining`
 * and `client_packages.active` for a credit/session movement.
 *
 * Why it exists: `active` is what `bookClass` filters candidate packages on, and
 * `computeActive` (./validity.ts) is the stated rule for it. Two refund paths used to
 * bump the balance with raw SQL and never re-derive the flag, so a bundle that hit zero
 * (active=false) and was then refunded ended up holding credits nothing would spend.
 * Every movement now goes through here, so the flag can't drift from the balance again.
 *
 * Contract:
 *   - `debit` / `refund` take the caller's transaction handle — they NEVER open their own,
 *     so a movement commits or rolls back with the booking change that caused it.
 *   - The package row is locked FOR UPDATE inside the movement (re-locking a row the caller
 *     already locked in the same transaction is a no-op), so the read-modify-write is safe.
 *   - Overdraw is refused here, so every caller gets the same typed error.
 *   - Each movement writes a `manual_adjustments` row (the existing credit-movement audit
 *     table) unless the caller opts out — see `audit` below.
 *
 * Still writes these columns outside this module, deliberately:
 *   - `packages/adjust.ts` — admin manual adjust / set balance / set expiry. Already
 *     recomputes `active` correctly and owns portal-facing error codes.
 *   - `packages/purchase.ts` — creates rows (initial balance, not a movement).
 *   - `packages/expire.ts` — the nightly time-trigger that flips `active` on expiry.
 */
import { and, eq } from 'drizzle-orm'
import type { db } from '../../db'
import { clientPackages } from '../../db/schema/packages'
import { manualAdjustments } from '../../db/schema/ledger'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { applyMovement } from './validity'

/** The handle `db.transaction(async tx => …)` hands its callback. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface CreditMovementInput {
  /** Owner of the package — also scopes the lookup, so a mismatched pair can't move credits. */
  clientId: string
  clientPackageId: string
  /** Unsigned whole number of credits/sessions. `debit` subtracts it, `refund` adds it. */
  amount: number
  /** Why the movement happened — written to the audit row. */
  reason: string
  /** Staff actor, when one initiated it (admin cancel). */
  actedByStaffId?: string | null
  /**
   * Write the `manual_adjustments` audit row. Default true.
   *
   * ponytail: `manual_adjustments` doubles as the admin client-profile "Package
   * adjustments" panel (last 50 rows), so per-class-booking debits would bury the
   * admin-initiated entries it exists to show. `bookClass` therefore opts out, which
   * preserves today's behaviour. Upgrade path: a dedicated `credit_movements` table
   * (needs a migration — out of scope here), after which this flag goes away.
   */
  audit?: boolean
}

export interface MovementOutcome {
  remaining: number
  active: boolean
}

async function move(tx: Tx, input: CreditMovementInput, sign: 1 | -1): Promise<MovementOutcome> {
  if (!Number.isInteger(input.amount) || input.amount < 0) {
    throw new BadRequestError('invalid_credit_amount')
  }

  const [pkg] = await tx
    .select({
      kind: clientPackages.kind,
      expiresAt: clientPackages.expiresAt,
      remaining: clientPackages.creditsOrSessionsRemaining,
    })
    .from(clientPackages)
    .where(
      and(eq(clientPackages.id, input.clientPackageId), eq(clientPackages.clientId, input.clientId)),
    )
    .for('update')
    .limit(1)
  if (!pkg) throw new NotFoundError('client_package_not_found')

  const result = applyMovement(
    { kind: pkg.kind, expiresAt: pkg.expiresAt, creditsOrSessionsRemaining: pkg.remaining },
    sign * input.amount,
  )
  if (!result.ok) {
    if (result.refusal === 'overdraw') throw new ConflictError('insufficient_credits')
    if (result.refusal === 'unlimited_has_no_balance') {
      throw new BadRequestError('cannot_adjust_unlimited_package')
    }
    throw new BadRequestError('invalid_credit_amount')
  }

  await tx
    .update(clientPackages)
    .set({ creditsOrSessionsRemaining: result.remaining, active: result.active })
    .where(eq(clientPackages.id, input.clientPackageId))

  if (input.audit !== false) {
    await tx.insert(manualAdjustments).values({
      clientId: input.clientId,
      clientPackageId: input.clientPackageId,
      delta: sign * input.amount,
      reason: input.reason,
      actedByStaffId: input.actedByStaffId ?? null,
    })
  }

  return { remaining: result.remaining, active: result.active }
}

/** Spend `amount` credits/sessions. Throws 409 `insufficient_credits` rather than overdrawing. */
export function debitCredits(tx: Tx, input: CreditMovementInput): Promise<MovementOutcome> {
  return move(tx, input, -1)
}

/** Return `amount` credits/sessions. Re-derives `active`, so an emptied bundle becomes spendable again. */
export function refundCredits(tx: Tx, input: CreditMovementInput): Promise<MovementOutcome> {
  return move(tx, input, 1)
}
