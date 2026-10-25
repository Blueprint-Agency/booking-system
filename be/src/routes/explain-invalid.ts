import type { z } from 'zod'
import { BadRequestError } from '../shared/errors'

export const explainInvalid =
  (fallback: string) =>
  (result: { success: boolean; error?: unknown }): void => {
    if (result.success) return
    const issues = (result.error as z.ZodError | undefined)?.issues
    throw new BadRequestError('invalid_request', { message: issues?.[0]?.message ?? fallback })
  }
