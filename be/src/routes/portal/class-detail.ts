import type { ClassDetail } from '../../services/schedule/detail'
import { namedRuleJson } from '../../services/schedule/package-rules'
import { classSeatsJson } from './class-seats'

/**
 * A class as its detail page reads it: the Admin's
 * `GET /portal/admin/schedule/classes/:id` and the Instructor's roster read of a
 * class they teach (`GET /portal/instructor/sessions/class/:id/roster`). The
 * Instructor's has none of what the Admin alone sees: the main instructor's id,
 * any pay, the supporting instructors, when and by whom it was scheduled, and
 * its series. As for a private session (`./pt-session-detail.ts`), a field added
 * to the detail is shown to Instructors by being added outside the Admin block.
 */
export function classDetailJson(d: ClassDetail, opts: { admin: boolean }) {
  return {
    id: d.id,
    lifecycle: d.lifecycle,
    starts_at: d.startsAt.toISOString(),
    ends_at: d.endsAt.toISOString(),
    class_type: d.classType,
    difficulty: d.difficulty,
    instructor: d.instructor,
    ...(opts.admin
      ? {
          main_instructor_id: d.mainInstructorId,
          instructor_pay_sgd: d.instructorPaySgd,
          supporting_instructor_ids: d.supportingInstructorIds,
          supporting_instructors: d.supportingInstructors.map(s => ({
            id: s.id,
            name: s.name,
            pay_sgd: s.paySgd,
          })),
          instructor_ids: [d.mainInstructorId, ...d.supportingInstructorIds],
        }
      : {}),
    location: d.location,
    room: d.room,
    capacity_online: d.capacityOnline,
    capacity_waitlist: d.capacityWaitlist,
    capacity_buffer: d.capacityBuffer,
    credit_cost: d.creditCost,
    package_rule: namedRuleJson(d.packageRule),
    ...(opts.admin
      ? {
          // TRANSITIONAL — remove with the contract migration that drops the
          // column. A portal bundle from before the per-class window was retired
          // reads this field; null keeps its editor saving rather than refusing.
          cancel_window_hours: null,
        }
      : {}),
    ...classSeatsJson(d),
    check_in_state: d.checkInState,
    ...(opts.admin
      ? {
          created_at: d.createdAt.toISOString(),
          scheduled_by: d.scheduledBy,
          series_id: d.seriesId,
        }
      : {}),
  }
}
