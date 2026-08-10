import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/leave/requests'
import { MEDICAL_CERT_MAX_BYTES } from '../../../services/leave/rules'
import { BadRequestError } from '../../../shared/errors'

/**
 * Instructor leave — the caller's OWN requests only.
 *
 * The acting instructor is always `staffUserId` from the auth context and is
 * never read from the body or the query, so nobody can file, withdraw or read
 * leave as someone else. Approve / reject / revoke are the admin's and are not
 * mounted here.
 */

const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

const submitSchema = z.object({
  type: z.enum(['annual', 'medical']),
  start_date: plainDate,
  end_date: plainDate,
  // Only valid on a single date — the service refuses it on a range.
  half_day: z.enum(['none', 'morning', 'afternoon']).default('none'),
  reason: z.string().trim().min(1).max(500),
})

function serialize(r: svc.LeaveRequestRow) {
  return {
    id: r.id,
    type: r.type,
    start_date: r.startDate,
    end_date: r.endDate,
    half_day: r.halfDay,
    days: Number(r.days),
    leave_year: r.leaveYear,
    status: r.status,
    reason: r.reason,
    decision_reason: r.decisionReason,
    decided_at: r.decidedAt,
    created_at: r.createdAt,
    // The key itself is never sent anywhere — only whether there is one, so the
    // portal knows to offer the link that mints a signed URL.
    has_certificate: r.medicalCertR2Key !== null,
  }
}

const app = new Hono()
  .get('/', zValidator('query', z.object({ year: z.coerce.number().int().optional() })), async c => {
    // No year given means the current leave year — which year that is, is the
    // service's call, so the route passes through what it was given or nothing.
    const res = await svc.getOwnLeave(c.get('staffUserId'), c.req.valid('query').year)
    return c.json({
      leave_year: res.leave_year,
      balances: res.balances,
      requests: res.requests.map(serialize),
    })
  })
  .post('/', zValidator('json', submitSchema), async c => {
    const body = c.req.valid('json')
    const row = await svc.submitLeaveRequest({
      instructorId: c.get('staffUserId'), // forced — never from the body
      type: body.type,
      startDate: body.start_date,
      endDate: body.end_date,
      halfDay: body.half_day,
      reason: body.reason,
    })
    c.set('auditTarget' as any, { table: 'leave_requests', id: row.id })
    return c.json(serialize(row), 201)
  })
  /**
   * Attach a medical certificate — multipart, field name `file`.
   *
   * The upload comes THROUGH the API rather than straight to storage from the
   * browser: type and size are then checked on the server, and the private
   * bucket needs no CORS. `bodyLimit` stops an oversized body before it is
   * buffered at all; the service re-checks the real byte length, because a
   * content-length header is only a claim.
   */
  .post(
    '/:id/certificate',
    bodyLimit({
      maxSize: MEDICAL_CERT_MAX_BYTES,
      onError: c =>
        c.json(
          {
            error: 'certificate_too_large',
            message: `A certificate can be at most ${MEDICAL_CERT_MAX_BYTES / (1024 * 1024)}MB.`,
          },
          413,
        ),
    }),
    zValidator('param', z.object({ id: z.string().uuid() })),
    async c => {
      const { id } = c.req.valid('param')
      const file = (await c.req.formData()).get('file')
      if (!file || typeof file === 'string') {
        throw new BadRequestError('certificate_required', {
          message: 'Attach a JPG, PNG or PDF file.',
        })
      }
      const row = await svc.attachMedicalCertificate({
        instructorId: c.get('staffUserId'), // forced — his own request only
        id,
        contentType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })
      c.set('auditTarget' as any, { table: 'leave_requests', id })
      return c.json(serialize(row))
    },
  )
  // A signed GET, minted per click. The service refuses anyone but the owning
  // instructor (admins reach the same service through the admin route).
  .get('/:id/certificate', zValidator('param', z.object({ id: z.string().uuid() })), async c =>
    c.json(
      await svc.medicalCertificateUrl(
        svc.leaveViewer(c.get('staffRow')),
        c.req.valid('param').id,
      ),
    ),
  )
  .post('/:id/withdraw', zValidator('param', z.object({ id: z.string().uuid() })), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.transitionOwnLeaveRequest('withdraw', c.get('staffUserId'), id)
    c.set('auditTarget' as any, { table: 'leave_requests', id })
    return c.json(serialize(row))
  })
  .post('/:id/cancel', zValidator('param', z.object({ id: z.string().uuid() })), async c => {
    const { id } = c.req.valid('param')
    const row = await svc.transitionOwnLeaveRequest('cancel', c.get('staffUserId'), id)
    c.set('auditTarget' as any, { table: 'leave_requests', id })
    return c.json(serialize(row))
  })

export default app
