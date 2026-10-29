import { z } from 'zod'
import type { SeatCandidate } from '../../services/pt-sessions/manual'
import { dateTime } from '../../shared/date-time'
import { endsAfterStart, endsAfterStartIssue } from './parse'

/**
 * `POST …/manual`: a private session staff create with its members, no member
 * request behind it (#334). One shape for the admin and instructor surfaces;
 * the instructor route drops `instructor_id` and uses the caller.
 *
 * `members` names every attendee — one for a 1on1, up to two for a 2on1,
 * never none. Each may name the package that pays; absent, the Default payer
 * does. `override` is staff saying "Add anyway" to a `seat_needs_override`.
 */

const manualFields = {
  session_type: z.enum(['1on1', '2on1']),
  location_id: z.string().uuid(),
  room_id: z.string().uuid(),
  starts_at: dateTime('A start time'),
  ends_at: dateTime('An end time'),
  instructor_pay_sgd: z.number().min(0).nullable().optional(),
  members: z
    .array(
      z.object({
        client_id: z.string().uuid(),
        client_package_id: z.string().uuid().optional(),
      }),
    )
    .min(1),
  override: z.boolean().optional(),
  // "Book anyway" after `time_clash`: a member holds a booking at an overlapping time.
  allow_clash: z.boolean().optional(),
}

export const adminManualSessionSchema = z
  .object({ ...manualFields, instructor_id: z.string().uuid() })
  .refine(endsAfterStart, endsAfterStartIssue)

export const instructorManualSessionSchema = z.object(manualFields).refine(endsAfterStart, endsAfterStartIssue)

type ManualBody = z.infer<typeof instructorManualSessionSchema>

/** The body's fields in the service's shape, bar the instructor and the actor. */
export function manualSessionFields(body: ManualBody) {
  return {
    sessionType: body.session_type,
    locationId: body.location_id,
    roomId: body.room_id,
    startsAt: new Date(body.starts_at),
    endsAt: new Date(body.ends_at),
    instructorPaySgd: body.instructor_pay_sgd ?? null,
    members: body.members.map(m => ({ clientId: m.client_id, clientPackageId: m.client_package_id ?? null })),
    override: body.override === true,
    allowClash: body.allow_clash === true,
  }
}

/**
 * `POST …/sessions/:id/members`: one more member on a manual session (#337),
 * with the same seat rule, package pick and `override` as at creation.
 */
export const addManualMemberSchema = z.object({
  client_id: z.string().uuid(),
  client_package_id: z.string().uuid().optional(),
  override: z.boolean().optional(),
  allow_clash: z.boolean().optional(),
})

type AddMemberBody = z.infer<typeof addManualMemberSchema>

export function addManualMemberFields(body: AddMemberBody) {
  return {
    clientId: body.client_id,
    clientPackageId: body.client_package_id ?? null,
    override: body.override === true,
    allowClash: body.allow_clash === true,
  }
}

export function addedMemberJson(clientId: string, seat: { bookingId: string; clientPackageId: string }) {
  return { booking: { id: seat.bookingId, client_id: clientId, client_package_id: seat.clientPackageId } }
}

/**
 * `DELETE …/sessions/:id/members/:clientId`: one member off a manual session
 * (#335), their session returned to their own package.
 */
export const removeMemberParam = z.object({ id: z.string().uuid(), clientId: z.string().uuid() })

export function removedMemberJson(res: { refundOutcome: string; refundedSessions: number }) {
  return { refund_outcome: res.refundOutcome, refunded_sessions: res.refundedSessions }
}

/**
 * `GET …/seat-candidates`: the member's PT packages read against a session's
 * shape and, once chosen, its start, so the form can ask before the session
 * exists. The instructor route drops `instructor_id` and reads against the
 * caller.
 */
const seatCandidateFields = {
  client_id: z.string().uuid(),
  session_type: z.enum(['1on1', '2on1']),
  starts_at: dateTime('A start time').optional(),
}

export const adminSeatCandidatesQuery = z.object({ ...seatCandidateFields, instructor_id: z.string().uuid() })
export const instructorSeatCandidatesQuery = z.object(seatCandidateFields)

export function seatCandidatesJson(res: { defaultClientPackageId: string | null; packages: SeatCandidate[] }) {
  return {
    default_client_package_id: res.defaultClientPackageId,
    packages: res.packages.map(p => ({
      id: p.id,
      name: p.name,
      session_type: p.sessionType,
      sessions_left: p.sessionsLeft,
      expires_at: p.expiresAt ? p.expiresAt.toISOString() : null,
      bound_instructor: p.boundInstructor,
      eligible: p.eligible,
      reason: p.refusal,
      warnings: p.warnings,
      // Dormant only: the end date adding the member would stamp on it now.
      activation_end_if_picked: p.activateUntil ? p.activateUntil.toISOString() : null,
    })),
  }
}
