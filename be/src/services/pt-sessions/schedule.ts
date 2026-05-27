/**
 * Schedule a pending PT request (admin action — the implicit "approval").
 *
 * Creates the pt_sessions row, per-client bookings (with QR/codes), flips
 * pt_requests.status='scheduled', stamps scheduled_pt_session_id, and emails
 * the client + partner. If the request used a "new" partner (name + email
 * only, not yet a member), the admin is expected to create the partner's
 * client record first via /admin/clients then re-open the schedule dialog —
 * this service refuses to schedule until co_client_id is populated.
 *
 * Replaces the old approvePtSession() — there is no separate approval anymore.
 * See docs/md/be-portal.md §PT for the full contract.
 */
import { assertRoomAvailable, assertRoomInLocation } from '../schedule/room-conflicts'

export interface SchedulePtRequestInput {
  ptRequestId: string
  /** Admin-assigned instructor — chosen at scheduling, not requested by client. */
  instructorId: string
  locationId: string
  /** Room the session runs in. Must belong to locationId and be clash-free. */
  roomId: string
  /** Final agreed start/end (timezone-aware ISO). Need not match any proposed slot. */
  startsAt: Date
  endsAt: Date
  actorStaffId: string
}

export async function schedulePtRequest(input: SchedulePtRequestInput): Promise<{ ptSessionId: string }> {
  // Room validation is live; the rest of the schedule flow is still pending.
  await assertRoomInLocation(input.roomId, input.locationId)
  await assertRoomAvailable(input.roomId, input.startsAt, input.endsAt)
  throw new Error('not implemented')
}
