/**
 * Who may schedule a PT request, given the **Bound Instructor** of the package
 * it was debited from (#107 §Scheduling rule).
 *
 * Pure, and the refusal is returned rather than thrown, so the rule is
 * checkable without a database — the same seam the purchase rule uses. The
 * instructor queue filters bound-to-other requests out of sight; this is what
 * makes that filtering *true* rather than cosmetic, for the stale screen and
 * the hand-made request the filter never reached.
 */

export type MayScheduleRefusal = 'pt_request_bound_to_other_instructor'

export interface MayScheduleInput {
  /** The debited package's Bound Instructor. Null means open to anyone. */
  boundInstructorId: string | null
  /** The staff member doing the scheduling. */
  actorStaffId: string
  /**
   * Admins are never in the way: a bound instructor's illness must not block a
   * member, so an admin may put the session with somebody else for that one
   * session (#107 story 32). The service therefore does NOT force the bound
   * instructor onto an admin's booking — only the instructor route forces one,
   * and it forces `self`.
   */
  actorIsAdmin: boolean
}

export type MayScheduleResult = { ok: true } | { ok: false; error: MayScheduleRefusal }

export function maySchedulePtRequest(input: MayScheduleInput): MayScheduleResult {
  if (input.actorIsAdmin) return { ok: true }
  if (input.boundInstructorId === null) return { ok: true }
  if (input.boundInstructorId === input.actorStaffId) return { ok: true }
  return { ok: false, error: 'pt_request_bound_to_other_instructor' }
}
