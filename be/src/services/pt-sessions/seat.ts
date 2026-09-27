/**
 * May this package pay for one seat on a PT session? (#334)
 *
 * A manual session — one staff put on the calendar with no member request
 * behind it — is paid seat by seat: each attendee pays ONE session from their
 * own package, whatever the session's type. This is the rule that decides
 * whether a package can, with no database: the service reads and locks the
 * rows, calls in, and turns the answer into a typed error.
 *
 * Three answers:
 *  - allowed;
 *  - allowed with warnings — staff may charge it, but only once they say so
 *    (`override`), because it bends something the member bought:
 *      `session_type_mismatch`: a 1on1 package on a 2on1 session, or the reverse;
 *      `bound_to_other_instructor` (Admin only): the package was sold as
 *      sessions with a different coach from the session's;
 *  - refused, for a package that cannot pay at all, tested in this order:
 *      `not_a_pt_package`, `package_expired`, `insufficient_pt_credit`,
 *      `package_not_consumable` (Voided with sessions left), and for an
 *      Instructor `bound_to_other_instructor` — the same binding an Admin is
 *      only warned about (./binding.ts is its scheduling twin).
 *
 * The member app never reaches this: a member requesting across types is
 * refused outright by ./request.ts.
 */
import type { PackageKind } from '../packages/validity'
import type { PtSessionType } from './cost'

/** What one seat costs on a manual session: one session, for every type. */
export const SEAT_COST = 1

export interface SeatPackage {
  kind: PackageKind
  /** The PT type it was sold as. Null on a class package. */
  sessionType: PtSessionType | null
  creditsOrSessionsRemaining: number | null
  /** Null means Dormant. */
  expiresAt: Date | null
  /** Off once spent, expired or Voided. */
  active: boolean
  /** The **Bound Instructor**. Null means open to anyone. */
  boundInstructorId: string | null
}

export interface SeatSession {
  sessionType: PtSessionType
  instructorId: string
}

export type SeatRefusal =
  | 'not_a_pt_package'
  | 'package_expired'
  | 'insufficient_pt_credit'
  | 'package_not_consumable'
  | 'bound_to_other_instructor'

export type SeatWarning = 'session_type_mismatch' | 'bound_to_other_instructor'

export type SeatResult = { ok: true; warnings: SeatWarning[] } | { ok: false; refusal: SeatRefusal }

export interface MayPayForSeatInput {
  pkg: SeatPackage
  session: SeatSession
  actorIsAdmin: boolean
  now: Date
}

export function mayPayForSeat(input: MayPayForSeatInput): SeatResult {
  const { pkg, session, actorIsAdmin, now } = input
  if (pkg.kind !== 'pt') return { ok: false, refusal: 'not_a_pt_package' }
  // Ended at its date, whether or not the nightly sweep has flipped it off yet.
  if (pkg.expiresAt !== null && pkg.expiresAt <= now) return { ok: false, refusal: 'package_expired' }
  if ((pkg.creditsOrSessionsRemaining ?? 0) < SEAT_COST) return { ok: false, refusal: 'insufficient_pt_credit' }
  if (!pkg.active) return { ok: false, refusal: 'package_not_consumable' }

  const boundElsewhere = pkg.boundInstructorId !== null && pkg.boundInstructorId !== session.instructorId
  if (boundElsewhere && !actorIsAdmin) return { ok: false, refusal: 'bound_to_other_instructor' }

  const warnings: SeatWarning[] = []
  if (pkg.sessionType !== session.sessionType) warnings.push('session_type_mismatch')
  if (boundElsewhere) warnings.push('bound_to_other_instructor')
  return { ok: true, warnings }
}

/**
 * The **Default payer** order for a seat: packages of the session's type
 * first, running before Dormant, running ones soonest-ending first, then each
 * in the order bought. Callers filter out refused packages; what is left in
 * front is who pays when staff name nobody.
 */
export function orderSeatCandidates<T extends { pkg: SeatPackage; purchasedAt: Date }>(
  candidates: readonly T[],
  session: Pick<SeatSession, 'sessionType'>,
): T[] {
  return [...candidates].sort((a, b) => {
    const aMatch = a.pkg.sessionType === session.sessionType
    const bMatch = b.pkg.sessionType === session.sessionType
    if (aMatch !== bMatch) return aMatch ? -1 : 1
    const aRunning = a.pkg.expiresAt !== null
    const bRunning = b.pkg.expiresAt !== null
    if (aRunning !== bRunning) return aRunning ? -1 : 1
    if (aRunning) {
      const byEnd = a.pkg.expiresAt!.getTime() - b.pkg.expiresAt!.getTime()
      if (byEnd !== 0) return byEnd
    }
    return a.purchasedAt.getTime() - b.purchasedAt.getTime()
  })
}
