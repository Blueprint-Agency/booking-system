import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireRole } from '../../../middleware/require-role'
import * as svc from '../../../services/auth/invitations'
import {
  archiveStaff,
  isSeededSuperadminEmail,
  softDeleteStaff,
  unarchiveStaff,
  updateStaffProfile,
} from '../../../services/auth/staff-archive'

const inviteSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(['admin', 'superadmin', 'instructor']).optional(), // default 'admin' in the service
  granted_location_ids: z.array(z.string().uuid()).optional(),
})

const genderEnum = z.enum(['female', 'male', 'non_binary', 'prefer_not_to_say'])

const updateStaffSchema = z.object({
  first_name: z.string().trim().min(1).max(120).optional(),
  last_name: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  gender: genderEnum.nullable().optional(),
  bio: z.string().max(4000).nullable().optional(),
  languages: z.array(z.string().trim().min(1).max(60)).optional(),
  role: z.enum(['admin', 'superadmin', 'instructor']).optional(),
  granted_location_ids: z.array(z.string().uuid()).optional(),
})

const idParam = z.object({ id: z.string().uuid() })

function serializeStaff(row: svc.StaffUserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    first_name: row.firstName,
    last_name: row.lastName,
    phone: row.phone,
    address: row.address,
    gender: row.gender,
    bio: row.bio,
    languages: row.languages,
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
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateStaffSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const actor = c.get('staffUserId')
    const row = await updateStaffProfile({
      targetStaffId: id,
      actorStaffId: actor,
      patch: {
        ...(body.first_name !== undefined ? { firstName: body.first_name } : {}),
        ...(body.last_name !== undefined ? { lastName: body.last_name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.gender !== undefined ? { gender: body.gender } : {}),
        ...(body.bio !== undefined ? { bio: body.bio } : {}),
        ...(body.languages !== undefined ? { languages: body.languages } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.granted_location_ids !== undefined
          ? { grantedLocationIds: body.granted_location_ids }
          : {}),
      },
    })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json(serializeStaff(row))
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId')
    const row = await archiveStaff({ targetStaffId: id, actorStaffId: actor })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json(serializeStaff(row))
  })
  .post('/:id/unarchive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId')
    const row = await unarchiveStaff({ targetStaffId: id, actorStaffId: actor })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json(serializeStaff(row))
  })
  .delete('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId')
    await softDeleteStaff({ targetStaffId: id, actorStaffId: actor })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.body(null, 204)
  })

export default app
