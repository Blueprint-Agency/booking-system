import type { Request, Response, NextFunction } from 'express'
import type { AuthContext } from './auth'

export function requireRole(...roles: AuthContext['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {}
}
