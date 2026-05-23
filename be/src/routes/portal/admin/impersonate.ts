import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { mintClientImpersonation } from '../../../services/impersonation/mint'
import { BadRequestError, NotFoundError } from '../../../shared/errors'

const idParam = z.object({ id: z.string().uuid() })

const app = new Hono().post(
  '/clients/:id/impersonate',
  zValidator('param', idParam),
  async c => {
    const { id } = c.req.valid('param')
    const staffRow = c.get('staffRow')
    if (staffRow.role !== 'superadmin') {
      return c.json({ error: 'impersonation_requires_superadmin' }, 403)
    }
    try {
      const res = await mintClientImpersonation({
        clientId: id,
        superadminStaffId: staffRow.id,
      })
      c.set('auditTarget' as any, { table: 'clients', id })
      return c.json({
        ticket: res.ticket,
        grant: res.grant,
        fe_client_url: res.feClientUrl,
      })
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json({ error: 'client_not_found' }, 404)
      }
      if (err instanceof BadRequestError) {
        return c.json({ error: err.message }, 422)
      }
      throw err
    }
  },
)

export default app
