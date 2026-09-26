import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireRole } from '../../../middleware/require-role'
import { tenantId } from '../../../middleware/tenant'
import * as svc from '../../../services/auth/invitations'
import {
  archiveStaff,
  softDeleteStaff,
  unarchiveStaff,
  updateStaffProfile,
  type StaffProfileRow,
} from '../../../services/auth/staff-archive'
import {
  listStaffSessions,
  resendStaffInvitation,
  resendStaffSetPassword,
  signStaffOutEverywhere,
} from '../../../services/auth/account-access'
import {
  cancelStaffEmailChange,
  confirmStaffEmailChange,
  EMAIL_CHANGE_RESEND_AFTER_MS,
  startStaffEmailChange,
} from '../../../services/auth/staff-email-change'
import { sessionView } from '../session-view'

// Trimming and lower-casing are the service's, so a refusal can name what was typed.
const emailChangeSchema = z.object({ email: z.string().email().max(254) })
const emailChangeCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) })

const inviteSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(['admin', 'instructor']).optional(), // default 'admin' in the service
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
  role: z.enum(['admin', 'instructor']).optional(),
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
    expires_at: inv.expiresAt,
    created_at: inv.createdAt,
    invited_by_staff_name: inv.invitedByStaffName,
  }
}

const app = new Hono()
  // Every staff route is an admin's, other admins included. The rules that are
  // not about role — who may edit whom, not yourself, never the last admin —
  // live in the services, so this gate is coarse on purpose.
  .use('*', requireRole('admin'))
  .get('/', async c => {
    const { staff, invitations } = await svc.listStaffAndInvitations(tenantId(c))
    return c.json({
      staff: staff.map(serializeStaff),
      invitations: invitations.map(serializeInvitation),
    })
  })
  .post('/invite', zValidator('json', inviteSchema), async c => {
    const body = c.req.valid('json')
    const actor = c.get('staffUserId')
    const inv = await svc.inviteAdmin({
      tenantId: tenantId(c),
      email: body.email,
      role: body.role,
      invitedByStaffId: actor,
    })
    c.set('auditTarget' as any, { table: 'staff_invitations', id: inv.id })
    return c.json(serializeInvitation({ ...inv, invitedByStaffName: null }), 201)
  })
  .post('/invitations/:id/revoke', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId')
    const inv = await svc.revokeInvitation(tenantId(c), id, actor)
    c.set('auditTarget' as any, { table: 'staff_invitations', id })
    return c.json(serializeInvitation({ ...inv, invitedByStaffName: null }))
  })
  .post('/invitations/:id/resend', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const inv = await resendStaffInvitation({
      tenantId: tenantId(c),
      invitationId: id,
      actorStaffId: c.get('staffUserId'),
      from: c.req.raw.headers,
    })
    c.set('auditTarget' as any, { table: 'staff_invitations', id })
    return c.json(serializeInvitation({ ...inv, invitedByStaffName: null }))
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateStaffSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const actor = c.get('staffUserId')
    const row = await updateStaffProfile({
      tenantId: tenantId(c),
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
  // The sign-in email, anyone's the admin may edit, their own included: a code
  // mailed to the new address, then that code back before anything moves.
  .post('/:id/email', zValidator('param', idParam), zValidator('json', emailChangeSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const pending = await startStaffEmailChange({
      tenantId: tenantId(c),
      targetStaffId: id,
      actorStaffId: c.get('staffUserId'),
      email: body.email,
    })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json({
      pending_email: pending.email,
      expires_at: pending.expiresAt,
      resend_after_seconds: EMAIL_CHANGE_RESEND_AFTER_MS / 1000,
    })
  })
  .post('/:id/email/confirm', zValidator('param', idParam), zValidator('json', emailChangeCodeSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await confirmStaffEmailChange({
      tenantId: tenantId(c),
      targetStaffId: id,
      actorStaffId: c.get('staffUserId'),
      code: body.code,
    })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json(serializeStaff(row))
  })
  .delete('/:id/email', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    await cancelStaffEmailChange({
      tenantId: tenantId(c),
      targetStaffId: id,
      actorStaffId: c.get('staffUserId'),
    })
    return c.body(null, 204)
  })
  .post('/:id/archive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId')
    const row = await archiveStaff({
      tenantId: tenantId(c),
      targetStaffId: id,
      actorStaffId: actor,
      from: c.req.raw.headers,
    })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json(serializeStaff(row))
  })
  .post('/:id/unarchive', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId')
    const row = await unarchiveStaff({
      tenantId: tenantId(c),
      targetStaffId: id,
      actorStaffId: actor,
      from: c.req.raw.headers,
    })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json(serializeStaff(row))
  })
  .get('/:id/sessions', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const sessions = await listStaffSessions(tenantId(c), id)
    return c.json({ sessions: sessions.map(sessionView) })
  })
  .post('/:id/sessions/revoke', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const revoked = await signStaffOutEverywhere({
      tenantId: tenantId(c),
      targetStaffId: id,
      actorStaffId: c.get('staffUserId'),
      from: c.req.raw.headers,
    })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json({ revoked })
  })
  .post('/:id/resend-invitation', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const sent = await resendStaffSetPassword({
      tenantId: tenantId(c),
      targetStaffId: id,
      actorStaffId: c.get('staffUserId'),
      from: c.req.raw.headers,
    })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.json({ sent })
  })
  .delete('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId')
    await softDeleteStaff({
      tenantId: tenantId(c),
      targetStaffId: id,
      actorStaffId: actor,
    })
    c.set('auditTarget' as any, { table: 'staff_users', id })
    return c.body(null, 204)
  })

export default app
