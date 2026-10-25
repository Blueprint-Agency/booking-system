import type { z } from 'zod'
import { BadRequestError } from '../shared/errors'

/**
 * A `zValidator` hook: a body the schema refuses answers `400 invalid_request`
 * with its first issue's message, which the portal shows, instead of the raw
 * safeParse result. Every field a person can type into needs its own sentence
 * in the schema, or zod's default ("String must contain at most 120
 * character(s)") is what they read.
 */
export const explainInvalid =
  (fallback: string) =>
  (result: { success: boolean; error?: unknown }): void => {
    if (result.success) return
    const issues = (result.error as z.ZodError | undefined)?.issues
    throw new BadRequestError('invalid_request', { message: issues?.[0]?.message ?? fallback })
  }
