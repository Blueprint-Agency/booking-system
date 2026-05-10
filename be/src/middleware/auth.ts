import type { Request, Response, NextFunction } from 'express'

export interface AuthContext {
  userId: string
  role: 'client' | 'instructor' | 'studio_admin' | 'super_admin'
  actingAs?: string
  impersonatedBy?: string
}

declare global {
  namespace Express {
    interface Request {
      auth: AuthContext
    }
  }
}

export async function verifyAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' })
    return
  }

  const token = header.slice(7)

  try {
    const { verifyToken } = await import('@clerk/backend')
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    })

    const role = (payload.metadata as any)?.role
    if (!role) {
      res.status(403).json({ error: 'No role assigned' })
      return
    }

    req.auth = {
      userId: payload.sub,
      role,
    }

    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
