import { z } from 'zod'
import type { RosterAssignment } from '../../services/schedule/classes'

/** A schema whose parsed result is `Body`, whatever it accepts: what a shared module asks of each surface's body. */
export type BodyOf<Body> = z.ZodType<Body, z.ZodTypeDef, unknown>

/** A session ends after it starts: the check every body that names both times makes (`.refine(endsAfterStart, endsAfterStartIssue)`). */
export const endsAfterStart = (v: { starts_at: string; ends_at: string }) => new Date(v.ends_at) > new Date(v.starts_at)
export const endsAfterStartIssue = { message: 'ends_at must be after starts_at', path: ['ends_at'] }

/** A path that names one row by its id. */
export const idParam = z.object({ id: z.string().uuid() })

/** One supporting instructor in a body: who, and what they are paid (omitted = leave as recorded, null = Unpriced). */
export const supportingInstructorSchema = z.object({
  instructor_id: z.string().uuid(),
  pay_sgd: z.number().min(0).nullable().optional(),
})

/**
 * snake_case → the roster module's shape, and nothing else. An OMITTED `pay_sgd`
 * stays omitted (the roster keeps whatever is recorded); an explicit `null`
 * stays null (unpriced). What either means is the roster module's business —
 * see services/schedule/roster-merge.ts.
 */
export function toAssignments(supporting: z.infer<typeof supportingInstructorSchema>[]): RosterAssignment[] {
  return supporting.map(s => ({
    instructorId: s.instructor_id,
    ...(s.pay_sgd !== undefined ? { paySgd: s.pay_sgd } : {}),
  }))
}
