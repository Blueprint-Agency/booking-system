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
  type StaffProfileRow,
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
  // Assigned Days — instructors only; the service refuses them on anyone else.
  annual_leave_days: z.number().int().min(0).max(365).optional(),
  medical_leave_days: z.number().int().min(0).max(365).optional(),
  study_leave_days: z.number().int().min(0).max(365).optional(),
  // The Remaining for the current Leave Year, which back-solves that year's
  // Pool. Half-grained like every leave day count. Negatives are let through
  // the schema so the domain refusal — which names the floor and the ceiling —
  // is what the admin is shown.
  annual_remaining_days: z.number().multipleOf(0.5).min(-365).max(365).optional(),
  medical_remaining_days: z.number().multipleOf(0.5).min(-365).max(365).optional(),
  study_remaining_days: z.number().multipleOf(0.5).min(-365).max(365).optional(),
})

const idParam = z.object({ id: z.string().uuid() })

function serializeStaff(row: StaffProfileRow) {
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
    // Assigned Days: present on instructors, absent on everyone else rather
    // than null — a non-instructor has no leave figure to report.
    ...(row.annualLeaveDays !== undefined
      ? {
          annual_leave_days: row.annualLeaveDays,
          medical_leave_days: row.medicalLeaveDays,
          study_leave_days: row.studyLeaveDays,
        }
      : {}),
    // This Leave Year's Carried, Pool and Remaining, so the edit form prefills
    // the Remaining fields and can show what they are bounded by.
    ...(row.leave
      ? {
          annual_carried_days: row.leave.annual.carried_days,
          annual_pool_days: row.leave.annual.pool_days,
          annual_remaining_days: row.leave.annual.remaining_days,
          medical_carried_days: row.leave.medical.carried_days,
          medical_pool_days: row.leave.medical.pool_days,
          medical_remaining_days: row.leave.medical.remaining_days,
          study_carried_days: row.leave.study.carried_days,
          study_pool_days: row.leave.study.pool_days,
          study_remaining_days: row.leave.study.remaining_days,
        }
      : {}),
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

const superadminOnly = requireRole('superadmin')

const app = new Hono()
  // The list and the profile PATCH are reachable by admin as well as superadmin
  // (spec-instructor-leave-pools.md § Permissions). Everything that changes an
  // account's existence or privileges carries superadminOnly on its own route.
  // The rank rules (who may edit whom, and that role/grants are superadmin-only)
  // live in the service — this gate is coarse on purpose.
  .use('*', requireRole('superadmin', 'admin'))
  .get('/', async c => {
    const { staff, invitations } = await svc.listStaffAndInvitations()
    return c.json({
      staff: staff.map(serializeStaff),
      invitations: invitations.map(serializeInvitation),
    })
  })
  .post('/invite', superadminOnly, zValidator('json', inviteSchema), async c => {
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
  .post('/invitations/:id/revoke', superadminOnly, zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId')
    const inv = await svc.revokeInvitation(id, actor)
    c.set('auditTarget' as any, { table: 'staff_invitations', id })
    return c.json(serializeInvitation({ ...inv, invitedByStaffName: null }))
  })
  .post('/invitations/:id/resend', superadminOnly, zValidator('param', idParam), async c => {
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
        ...(body.annual_leave_days !== undefined
          ? { annualLeaveDays: body.annual_leave_days }
          : {}),
        ...(body.medical_leave_days !== undefined
          ? { medicalLeaveDays: body.medical_leave_days }
          : {}),
        ...(body.study_leave_days !== undefined
          ? { studyLeaveDays: body.study_leave_days }
          : {}),
        ...(body.annual_remaining_days !== undefined
          ? { annualRemainingDays: body.annual_remaining_days }
          : {}),
        ...(body.medical_remaining_days !== undefined
          ? { medicalRemainingDays: body.medical_remaining_days }
          : {}),
        ...(body.study_remaining_days !== undefined
          ? { studyRemainingDays: body.study_remaining_days }
          : {}),
      },
    })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json(serializeStaff(row))
  })
  .post('/:id/archive', superadminOnly, zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId')
    const row = await archiveStaff({ targetStaffId: id, actorStaffId: actor })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json(serializeStaff(row))
  })
  .post('/:id/unarchive', superadminOnly, zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId')
    const row = await unarchiveStaff({ targetStaffId: id, actorStaffId: actor })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json(serializeStaff(row))
  })
  .delete('/:id', superadminOnly, zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId')
    await softDeleteStaff({ targetStaffId: id, actorStaffId: actor })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.body(null, 204)
  })

export default app
