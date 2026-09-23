/**
 * The three rows a personal-training appointment is, written the way the portal
 * writes one it has scheduled: a resolved `pt_requests` row, the `pt_sessions`
 * row it points at, and a `pt_session_clients` row per member on it.
 *
 * One place, because the timetable still to come (`./schedule.ts`) and the
 * studio's past (`./history.ts`) write the same three rows and differ only in
 * how the appointment ended and when it was settled. Two copies would be two
 * places to remember a column added to either table.
 */

type Row = Record<string, unknown>

export type PtAppointmentRows = { request: Row; session: Row; sessionClients: Row[] }

export function ptAppointmentRows(input: {
  tenantId: string
  requestId: string
  sessionId: string
  /** Platform client ids. A PT session here seats two, so there is one partner at most. */
  requesterId: string
  partnerId: string | null
  /** The Class Type the request's focus is. */
  classTypeId: string
  locationId: string
  roomId: string | null
  instructorId: string
  startsAt: Date
  endsAt: Date
  /** `scheduled` for one still to come; `attended` or `cancelled_after_scheduled` for one that has been. */
  status: 'scheduled' | 'attended' | 'cancelled_after_scheduled'
  debitedClientPackageId: string | null
  /** The studio's owner: who the platform says scheduled it, where nobody else is known to have. */
  ownerId: string
  /** The member of staff who booked it in Mindbody, where they are coming across. */
  scheduledById?: string | null
  /** When the platform is to say it was settled, scheduled and created. */
  settledAt: string
  /** What the instructor was paid for it (payroll Detail), as money; absent is Unpriced. */
  instructorPaySgd?: string | null
  /** What was written on the appointment. */
  message?: string | null
  /** Paid from a package for two: two places, whether or not a partner was ever named. */
  twoPerson?: boolean
  /** Cancelled after it was scheduled, as the portal cancels one: when, and by which member of staff. */
  cancelled?: { at: string; byStaffId: string | null } | null
}): PtAppointmentRows {
  const { tenantId, sessionId, requestId, partnerId } = input
  // The session seats two wherever the package did. The request says 2on1 only
  // with a partner named, because a 2on1 request always names one.
  const sessionType = partnerId || input.twoPerson ? '2on1' : '1on1'
  const requestType = partnerId ? '2on1' : '1on1'
  const scheduledBy = input.scheduledById ?? input.ownerId

  return {
    request: {
      id: requestId,
      tenant_id: tenantId,
      client_id: input.requesterId,
      class_type_id: input.classTypeId,
      location_id: input.locationId,
      session_type: requestType,
      co_client_id: partnerId,
      message: input.message || null,
      status: input.status,
      expires_at: input.startsAt.toISOString(),
      scheduled_pt_session_id: sessionId,
      debited_client_package_id: input.debitedClientPackageId,
      resolved_at: input.settledAt,
      resolved_by_staff_id: scheduledBy,
      created_at: input.settledAt,
    },
    session: {
      id: sessionId,
      tenant_id: tenantId,
      pt_request_id: requestId,
      instructor_id: input.instructorId,
      location_id: input.locationId,
      room_id: input.roomId,
      starts_at: input.startsAt.toISOString(),
      ends_at: input.endsAt.toISOString(),
      session_type: sessionType,
      // What payroll actually paid for a session that has been; a future one is
      // Unpriced, because Mindbody pays PT by a percentage of a sale not yet made.
      instructor_pay_sgd: input.instructorPaySgd ?? null,
      capacity_online: sessionType === '2on1' ? 2 : 1,
      capacity_waitlist: 0,
      capacity_buffer: 0,
      lifecycle: input.cancelled ? 'cancelled' : 'active',
      cancelled_at: input.cancelled?.at ?? null,
      cancelled_by_staff_id: input.cancelled?.byStaffId ?? null,
      scheduled_at: input.settledAt,
      scheduled_by_staff_id: scheduledBy,
      created_at: input.settledAt,
    },
    // Each of two members sharing a session was charged from their own package
    // in Mindbody, so each is on the session in their own right.
    sessionClients: ptClients(input).map(client_id => ({ tenant_id: tenantId, pt_session_id: sessionId, client_id })),
  }
}

/** Who is on the session, requester first — the order their bookings are written in. */
export function ptClients<T>(who: { requesterId: T; partnerId: T | null }): T[] {
  return who.partnerId ? [who.requesterId, who.partnerId] : [who.requesterId]
}
