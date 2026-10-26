import type { z } from 'zod'
import { BadRequestError } from '../shared/errors'

export const explainInvalid =
  (fallback: string, code: 'invalid_request' | 'invalid_policy' = 'invalid_request') =>
  (result: { success: boolean; error?: unknown }): void => {
    if (result.success) return
    const issues = (result.error as z.ZodError | undefined)?.issues
    throw new BadRequestError(code, { message: issues?.[0]?.message ?? fallback })
  }
