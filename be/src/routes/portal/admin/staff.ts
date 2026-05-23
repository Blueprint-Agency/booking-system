import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireRole } from '../../../middleware/require-role'
import * as svc from '../../../services/auth/invitations'
import { archiveStaff, isSeededSuperadminEmail } from '../../../services/auth/staff-archive'

const inviteSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(['admin', 'superadmin']).optional(), // default 'admin' in the service
  granted_location_ids: z.array(z.string().uuid()).optional(),
})

const idParam = z.object({ id: z.string().uuid() })

function serializeStaff(row: svc.StaffUserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    granted_location_ids: row.grantedLocationIds,
    invited_at: row.invitedAt,
    accepted_at: row.acceptedAt,
    archived_at: row.archivedAt,
    is_seeded_superadmin:
      row.role === 'superadmin' && isSeededSuperadminEmail(row.email),
  }
}

function serializeInvitation(
  inv: svc.ListStaffResult['invitations'][number],
) {
  return {
    id: inv.id,
    email: inv.email,
    role: inv.role,
    status: inv.status,
    granted_location_ids: inv.grantedLocationIds,
    expires_at: inv.expiresAt,
    created_at: inv.createdAt,
    invited_by_staff_name: inv.invitedByStaffName,
  }
}

const app = new Hono()
  // All staff routes are superadmin-only per spec. The parent router already
  // enforces superadmin in v0; declaring it here too keeps intent explicit.
  .use('*', requireRole('superadmin'))
  .get('/', async c => {
    const { staff, invitations } = await svc.listStaffAndInvitations()
    return c.json({
      staff: staff.map(serializeStaff),
      invitations: invitations.map(serializeInvitation),
    })
  })
  .post('/invite', zValidator('json', inviteSchema), async c => {
    const body = c.req.valid('json')
    const actor = c.get('staffUserId')
    const inv = await svc.inviteAdmin({
      email: body.email,
      role: body.role,
      grantedLocationIds: body.granted_location_ids,
      invitedByStaffId: actor,
    })
    c.set('auditTarget' as any, { table: 'staff_invitations', id: inv.id })
    return c.json(serializeInvitation({ ...inv, invitedByStaffName: null }), 201)
  })
  .post('/invitations/:id/revoke', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId')
    const inv = await svc.revokeInvitation(id, actor)
    c.set('auditTarget' as any, { table: 'staff_invitations', id })
    return c.json(serializeInvitation({ ...inv, invitedByStaffName: null }))
  })
  .post('/invitations/:id/resend', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId')
    const inv = await svc.resendInvitation(id, actor)
    c.set('auditTarget' as any, { table: 'staff_invitations', id })
    return c.json(serializeInvitation({ ...inv, invitedByStaffName: null }))
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId')
    const row = await archiveStaff({ targetStaffId: id, actorStaffId: actor })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json(serializeStaff(row))
  })

export default app
