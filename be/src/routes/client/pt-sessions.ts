import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { submitPtRequest } from '../../services/pt-sessions/request'
import { cancelPtRequest } from '../../services/pt-sessions/cancel'
import { listClientPtRequests, lookupPartnerByEmail } from '../../services/pt-sessions/list'
import { tenantId } from '../../middleware/tenant'

const slotSchema = z.object({
  proposedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
})

const requestSchema = z.object({
  classTypeId: z.string().uuid(),
  locationId: z.string().uuid(),
  sessionType: z.enum(['1on1', '2on1']),
  clientPackageId: z.string().uuid(),
  slots: z.array(slotSchema).min(1),
  message: z.string().max(2000).optional(),
  partner: z
    .union([
      z.object({ kind: z.literal('existing'), coClientId: z.string().uuid() }),
      z.object({ kind: z.literal('new'), name: z.string().min(1).max(160), email: z.string().email() }),
    ])
    .optional(),
})

function serializeRequest(r: Awaited<ReturnType<typeof listClientPtRequests>>[number]) {
  return {
    id: r.id,
    class_type_id: r.classTypeId,
    class_name: r.className,
    location_id: r.locationId,
    location_name: r.locationName,
    session_type: r.sessionType,
    status: r.status,
    role: r.role,
    host_name: r.requesterName,
    message: r.message,
    co_client_name: r.coClientName,
    created_at: r.createdAt,
    expires_at: r.expiresAt,
    refund_outcome: r.refundOutcome,
    slots: r.slots.map(s => ({ proposed_date: s.proposedDate, start_time: s.startTime, end_time: s.endTime })),
    session: r.session
      ? {
          starts_at: r.session.startsAt.toISOString(),
          ends_at: r.session.endsAt.toISOString(),
          instructor_name: r.session.instructorName,
          room_name: r.session.roomName,
        }
      : null,
    booking: r.booking
      ? {
          qr_token: r.booking.qrToken,
          code: r.booking.code,
          check_in_state: r.booking.checkInState,
          refund_outcome: r.booking.refundOutcome,
        }
      : null,
  }
}

const app = new Hono()
  .get('/', async c => {
    const rows = await listClientPtRequests(tenantId(c), c.get('clientId'))
    return c.json({ pt_requests: rows.map(serializeRequest) })
  })
  .get('/partner-lookup', zValidator('query', z.object({ email: z.string().email() })), async c => {
    const { email } = c.req.valid('query')
    const r = await lookupPartnerByEmail(tenantId(c), email, c.get('clientId'))
    return c.json({ found: r.found, client_id: r.clientId ?? null, name: r.name ?? null })
  })
  .post('/request', zValidator('json', requestSchema), async c => {
    const body = c.req.valid('json')
    const { ptRequestId } = await submitPtRequest(tenantId(c), {
      clientId: c.get('clientId'),
      ...body,
    })
    return c.json({ pt_request_id: ptRequestId }, 201)
  })
  .post('/:id/cancel', async c => {
    const result = await cancelPtRequest(tenantId(c), {
      ptRequestId: c.req.param('id'),
      source: 'client',
      clientId: c.get('clientId'),
    })
    return c.json({ ok: true, ...result })
  })

export default app
