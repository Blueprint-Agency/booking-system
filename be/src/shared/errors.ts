import { AppError } from '../middleware/error'
import type { ErrorCode } from './error-codes'

// AppError lives in middleware/error.ts (canonical). We re-export here and add
// convenience subclasses so services don't need to remember status codes.
export { AppError }

export class BadRequestError extends AppError {
  constructor(code: ErrorCode = 'bad_request', details?: Record<string, unknown>) {
    super(400, code, details)
  }
}

export class ForbiddenError extends AppError {
  constructor(code: ErrorCode = 'forbidden', details?: Record<string, unknown>) {
    super(403, code, details)
  }
}

export class NotFoundError extends AppError {
  constructor(code: ErrorCode = 'not_found', details?: Record<string, unknown>) {
    super(404, code, details)
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode = 'conflict', details?: Record<string, unknown>) {
    super(409, code, details)
  }
}
