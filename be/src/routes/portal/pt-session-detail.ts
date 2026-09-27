import type { PtSessionDetail } from '../../services/schedule/detail'

/**
 * A private session as its detail page reads it: the Admin's
 * `GET /portal/admin/schedule/pt/:id` and the instructor's own-session read
 * (#338). The instructor's has no pay or supporting-instructor roster, as on
 * their class roster.
 */
export function ptSessionDetailJson(d: PtSessionDetail, opts: { admin: boolean }) {
  return {
    id: d.id,
    pt_request_id: d.ptRequestId,
    // `portal` marks a manual session staff created (#334).
    origin: d.origin,
    lifecycle: d.lifecycle,
    starts_at: d.startsAt.toISOString(),
    ends_at: d.endsAt.toISOString(),
    session_type: d.sessionType,
    instructor: d.instructor,
    main_instructor_id: d.mainInstructorId,
    ...(opts.admin
      ? {
          instructor_pay_sgd: d.instructorPaySgd,
          supporting_instructor_ids: d.supportingInstructorIds,
          supporting_instructors: d.supportingInstructors,
          instructor_ids: [d.mainInstructorId, ...d.supportingInstructorIds],
        }
      : {}),
    location: d.location,
    room: d.room,
    capacity_online: d.capacityOnline,
    capacity_waitlist: d.capacityWaitlist,
    capacity_buffer: d.capacityBuffer,
    clients: d.clients.map(cl => ({
      id: cl.id,
      name: cl.name,
      code: cl.code,
      check_in_state: cl.checkInState,
      is_requester: cl.isRequester,
      package: cl.package
        ? { id: cl.package.id, name: cl.package.name, sessions_left: cl.package.sessionsLeft }
        : null,
    })),
    check_in_state: d.checkInState,
  }
}
