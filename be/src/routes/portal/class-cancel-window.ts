import { z } from 'zod'
import { classCancelWindow, type HasCancelWindow } from '../../services/policy/cancel-window'

/**
 * A class's own Cancellation Window on the wire, shared by the admin and
 * instructor schedule routes and the series routes (be/CONTEXT.md §
 * Cancellation Window). Formatting and shape only: what the window means is
 * `services/policy/cancel-window`.
 */

// The same bound as the studio's class window on Global Policy
// (routes/portal/admin/policy.ts): whole hours, 0 or more, no ceiling.
const MESSAGE = 'The cancellation window must be a whole number of hours, 0 or more.'

/** Whole hours, 0 or more. `null` = follow the studio's window. */
export const cancelWindowHoursSchema = z.number({ message: MESSAGE }).int(MESSAGE).min(0, MESSAGE).nullable()

/** A portal class row's two window fields: the class's own (nullable) and the one that applies. */
export async function cancelWindowJson(tenantId: string, cls: HasCancelWindow) {
  return {
    cancel_window_hours: cls.cancelWindowHours,
    effective_cancel_window_hours: await classCancelWindow(tenantId, cls),
  }
}
