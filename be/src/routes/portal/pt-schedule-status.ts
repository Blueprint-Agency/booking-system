import type { SchedulePtRequestError } from '../../services/pt-sessions/schedule'

/**
 * The HTTP status each `schedulePtRequest` refusal answers with.
 *
 * One copy, shared by the admin and instructor surfaces, so the status of a
 * refusal cannot differ by who asked — and so adding a refusal to the union is
 * one edit rather than two switches that quietly drift.
 *
 * Room and instructor clashes are NOT here: they throw
 * `ConflictError('schedule_conflict')` from the occupancy module and are
 * answered by the error middleware, the same 409 every scheduling path returns.
 */
export function statusForScheduleError(error: SchedulePtRequestError): 400 | 403 | 404 | 409 | 422 {
  switch (error) {
    case 'request_not_found':
      return 404
    case 'not_pending':
      return 409
    case 'partner_account_required':
      return 422
    case 'bad_time_range':
      return 400
    // Not 404: an instructor's screen may still be showing a request from
    // before an admin bound the package, and "you may not take this one" is
    // the answer that stops them retrying. An admin never sees it — the rule
    // does not refuse them.
    case 'pt_request_bound_to_other_instructor':
      return 403
  }
}
