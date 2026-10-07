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
 *   - Each movement writes a **Credit movement** (`credit_movements`, #353): the cause,
 *     the booking it was for, who did it and the balance after — the history the member
 *     and staff read. A forfeit that leaves the balance alone (Late cancel, Keep credit,
 *     No-show) and an expiry are recorded too, through `recordMovement` / `recordExpired`.
 *   - Each movement also writes a `manual_adjustments` row (the free-text audit) unless
 *     the caller opts out — see `audit` below.
 *
 * Still writes these columns outside this module, deliberately:
 *   - `packages/adjust.ts` — admin manual adjust / set balance / set expiry. Already
 *     recomputes `active` correctly and owns portal-facing error codes. It records
 *     each edit through `recordAdjustment` here.
 *   - `packages/purchase.ts` — creates rows (initial balance, not a movement).
 *   - `packages/expire.ts`, `packages/activation.ts` `sweepExpired` — the time-trigger
 *     that flips `active` on expiry; each records what it ended through `recordExpired`.
 */
import { and, eq } from 'drizzle-orm'
import type { db } from '../../db'
import { clientPackages } from '../../db/schema/packages'
import { creditMovements, manualAdjustments } from '../../db/schema/ledger'
import type { CancellationSource, creditMovementActorEnum, creditMovementCauseEnum } from '../../db/enums'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { applyMovement } from './validity'

/** The handle `db.transaction(async tx => …)` hands its callback. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** A transaction, or the pooled handle for a write that is its own statement. */
type Handle = Pick<typeof db, 'select' | 'insert'>

export type CreditMovementCause = (typeof creditMovementCauseEnum.enumValues)[number]
/** Who moved the credits: the member themself, a staff member (named), or the studio's machinery. */
export type CreditMovementActor = (typeof creditMovementActorEnum.enumValues)[number]

/** Whose act a cancel was, from its source. */
export const actorOfSource = (source: CancellationSource): CreditMovementActor =>
  source === 'client' ? 'member' : source === 'system' ? 'system' : 'staff'

export interface CreditMovementInput {
  /**
   * The Tenant whose credits these are. Scopes the lookup alongside the owner,
   * so a package id borrowed from another studio names nothing here — a member's
   * credits are never spendable at a studio that did not sell them.
   */
  tenantId: string
  /** Owner of the package — also scopes the lookup, so a mismatched pair can't move credits. */
  clientId: string
  clientPackageId: string
  /** Unsigned whole number of credits/sessions. `debit` subtracts it, `refund` adds it. */
  amount: number
  /** Why the movement happened — written to the audit row. */
  reason: string
  /** What the Credit movement reads as. */
  cause: CreditMovementCause
  /** Who moved it. `staff` names `actedByStaffId`. */
  actor: CreditMovementActor
  /** The booking it was for, when there is one. */
  bookingId?: string | null
  /** Staff actor, when one initiated it (admin cancel). */
  actedByStaffId?: string | null
  /**
   * Write the `manual_adjustments` audit row. Default true.
   *
   * The Credit movement is written either way. `bookClass` opts out of the audit row,
   * as it always has: a class debit is on its booking, and `manual_adjustments` stays
   * the record of the reasons credits moved outside one.
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
      active: clientPackages.active,
      expiresAt: clientPackages.expiresAt,
      remaining: clientPackages.creditsOrSessionsRemaining,
    })
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.tenantId, input.tenantId),
        eq(clientPackages.id, input.clientPackageId),
        eq(clientPackages.clientId, input.clientId),
      ),
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

  // A refund into a spent package lands back on it with its expiry untouched,
  // whatever else of its Family is running (be/docs/adr/0010).
  await tx
    .update(clientPackages)
    .set({ creditsOrSessionsRemaining: result.remaining, active: result.active })
    .where(
      and(
        eq(clientPackages.tenantId, input.tenantId),
        eq(clientPackages.id, input.clientPackageId),
      ),
    )

  await tx.insert(creditMovements).values({
    tenantId: input.tenantId,
    clientId: input.clientId,
    clientPackageId: input.clientPackageId,
    bookingId: input.bookingId ?? null,
    cause: input.cause,
    delta: sign * input.amount,
    balanceAfter: result.remaining,
    actor: input.actor,
    actedByStaffId: input.actedByStaffId ?? null,
  })

  if (input.audit !== false) {
    await tx.insert(manualAdjustments).values({
      tenantId: input.tenantId,
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

export interface RecordedMovement {
  tenantId: string
  clientId: string
  clientPackageId: string
  cause: CreditMovementCause
  actor: CreditMovementActor
  /** The change the caller already made to the balance; 0 for a forfeit. */
  delta?: number
  bookingId?: string | null
  actedByStaffId?: string | null
  /** A staff adjustment's reason. */
  note?: string | null
}

/**
 * Record a Credit movement whose balance change (if any) is already written —
 * a forfeit (`kept`, `no_show`), or a staff edit `adjust.ts` made. The balance
 * after is read back from the package, in the caller's transaction.
 */
export async function recordMovement(tx: Handle, m: RecordedMovement): Promise<void> {
  const [pkg] = await tx
    .select({ remaining: clientPackages.creditsOrSessionsRemaining })
    .from(clientPackages)
    .where(and(eq(clientPackages.tenantId, m.tenantId), eq(clientPackages.id, m.clientPackageId)))
    .limit(1)
  if (!pkg) throw new NotFoundError('client_package_not_found')
  await tx.insert(creditMovements).values({
    tenantId: m.tenantId,
    clientId: m.clientId,
    clientPackageId: m.clientPackageId,
    bookingId: m.bookingId ?? null,
    cause: m.cause,
    delta: m.delta ?? 0,
    balanceAfter: pkg.remaining,
    actor: m.actor,
    actedByStaffId: m.actedByStaffId ?? null,
    note: m.note ?? null,
  })
}

/**
 * A staff edit to a package: the `manual_adjustments` audit row and its Credit
 * movement, together. `delta` is what the edit already did to the balance —
 * 0 for an expiry, Home Location, Bound instructor or Add-On edit.
 */
export async function recordAdjustment(
  tx: Handle,
  a: { tenantId: string; clientId: string; clientPackageId: string; delta: number; reason: string; actedByStaffId: string },
): Promise<void> {
  await tx.insert(manualAdjustments).values(a)
  await recordMovement(tx, {
    tenantId: a.tenantId,
    clientId: a.clientId,
    clientPackageId: a.clientPackageId,
    cause: 'adjusted',
    actor: 'staff',
    delta: a.delta,
    actedByStaffId: a.actedByStaffId,
    note: a.reason,
  })
}

/**
 * Packages an expiry sweep just ended, each recorded as `expired` with what it
 * still held. A package whose member was deleted has nobody's history to join.
 */
export async function recordExpired(
  tx: Handle,
  tenantId: string,
  ended: Array<{ id: string; clientId: string | null; remaining: number | null }>,
): Promise<void> {
  const rows = ended.flatMap(p =>
    p.clientId
      ? [{ tenantId, clientId: p.clientId, clientPackageId: p.id, cause: 'expired' as const, delta: 0, balanceAfter: p.remaining, actor: 'system' as const }]
      : [],
  )
  if (rows.length) await tx.insert(creditMovements).values(rows)
}
