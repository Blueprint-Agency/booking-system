import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { instructorPermissionEnum } from '../../../db/enums'
import { requireRole } from '../../../middleware/require-role'
import { tenantId } from '../../../middleware/tenant'
import { permissionsView, withInstructorPermissions } from '../../../services/auth/instructor-permissions'
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
  EMAIL_CHANGE_RESEND_AFTER_MS,
  pendingStaffEmails,
  revokeStaffEmailChange,
  startStaffEmailChange,
  type PendingStaffEmail,
} from '../../../services/auth/staff-email-change'
import { sessionView } from '../session-view'
import { explainInvalid } from '../../explain-invalid'
import { publicObjectUrl } from '../../../lib/r2'

const EMAIL_MESSAGE = 'Enter a full email address, like name@example.com.'
const emailField = z.string({ message: EMAIL_MESSAGE }).email(EMAIL_MESSAGE).max(254, 'An email address can be at most 254 characters.')

// Trimming and lower-casing are the service's, so a refusal can name what was typed.
const emailChangeSchema = z.object({ email: emailField })

// The three Instructor Permissions (be/docs/adr/0012), each at most once. A
// duplicate is a malformed request, not a grant made twice.
const PERMISSIONS_MESSAGE = 'Permissions are a list of the Instructor Permissions, each at most once.'
const permissionsSchema = z
  .array(z.enum(instructorPermissionEnum.enumValues, { message: PERMISSIONS_MESSAGE }), { message: PERMISSIONS_MESSAGE })
  .max(instructorPermissionEnum.enumValues.length, PERMISSIONS_MESSAGE)
  .refine(keys => new Set(keys).size === keys.length, { message: PERMISSIONS_MESSAGE })

const roleField = z.enum(['admin', 'instructor'], { message: 'A role is either admin or instructor.' })

const inviteSchema = z.object({
  email: emailField,
  role: roleField.optional(), // default 'admin' in the service
  // An Instructor's permissions from their first sign-in; omitted = all three.
  permissions: permissionsSchema.optional(),
})

const genderEnum = z.enum(['female', 'male', 'non_binary', 'prefer_not_to_say'], {
  message: 'A gender is female, male, non-binary or prefer not to say.',
})

const ASSIGNED_DAYS_MESSAGE = 'Assigned Days must be a whole number from 0 to 365.'
const assignedDays = z.number({ message: ASSIGNED_DAYS_MESSAGE }).int(ASSIGNED_DAYS_MESSAGE).min(0, ASSIGNED_DAYS_MESSAGE).max(365, ASSIGNED_DAYS_MESSAGE)
const REMAINING_MESSAGE = 'Remaining must be in half days, between -365 and 365.'
const remainingDays = z
  .number({ message: REMAINING_MESSAGE })
  .multipleOf(0.5, REMAINING_MESSAGE)
  .min(-365, REMAINING_MESSAGE)
  .max(365, REMAINING_MESSAGE)

const updateStaffSchema = z.object({
  first_name: z
    .string({ message: 'A first name must be text.' })
    .trim()
    .min(1, 'A first name is required.')
    .max(120, 'A first name can be at most 120 characters.')
    .optional(),
  last_name: z.string({ message: 'A last name must be text.' }).trim().max(120, 'A last name can be at most 120 characters.').nullable().optional(),
  phone: z.string({ message: 'A phone number must be text.' }).trim().max(40, 'A phone number can be at most 40 characters.').nullable().optional(),
  address: z.string({ message: 'An address must be text.' }).trim().max(500, 'An address can be at most 500 characters.').nullable().optional(),
  gender: genderEnum.nullable().optional(),
  bio: z.string({ message: 'A bio must be text.' }).nullable().optional(),
  languages: z
    .array(
      z
        .string({ message: 'A language must be text.' })
        .trim()
        .min(1, 'A language cannot be blank.')
        .max(60, 'A language can be at most 60 characters.'),
      { message: 'Languages are a list of languages, each written as text.' },
    )
    .optional(),
  role: roleField.optional(),
  // The whole grant, replacing what is stored. An Instructor's only: on an
  // admin, or with a role change to admin, 400 `permissions_require_instructor`.
  permissions: permissionsSchema.optional(),
  // Assigned Days — any staff member's, admins included.
  annual_leave_days: assignedDays.optional(),
  medical_leave_days: assignedDays.optional(),
  study_leave_days: assignedDays.optional(),
  // The Remaining for the current Leave Year, which back-solves that year's
  // Pool. Half-grained like every leave day count. Negatives are let through
  // the schema so the domain refusal — which names the floor and the ceiling —
  // is what the admin is shown.
  annual_remaining_days: remainingDays.optional(),
  medical_remaining_days: remainingDays.optional(),
  study_remaining_days: remainingDays.optional(),
})

const explainStaff = explainInvalid('That staff change is not valid.')

const idParam = z.object({ id: z.string().uuid() })

function serializePendingEmail(pending: PendingStaffEmail) {
  return {
    email: pending.email,
    sent_at: pending.sentAt,
    expires_at: pending.expiresAt,
    expired: pending.expired,
  }
}

/** One staff member's Unverified address, or null. */
async function pendingEmailOf(tenant: string, staffId: string) {
  return (await pendingStaffEmails(tenant, [staffId])).get(staffId) ?? null
}

/**
 * A staff row a write returned, with the Instructor's stored permissions on it,
 * so the response reports the grant rather than the default.
 */
async function withPermissionsOf(tenant: string, row: StaffProfileRow): Promise<StaffProfileRow> {
  const [profile] = await withInstructorPermissions(tenant, [row])
  return profile ?? row
}

/**
 * `pending_email` is an address saved but not yet confirmed by its link: the
 * portal labels it Unverified, and `email` still signs the person in.
 */
function serializeStaff(row: StaffProfileRow, pendingEmail: PendingStaffEmail | null) {
  return {
    id: row.id,
    email: row.email,
    pending_email: pendingEmail ? serializePendingEmail(pendingEmail) : null,
    name: row.name,
    first_name: row.firstName,
    last_name: row.lastName,
    phone: row.phone,
    address: row.address,
    gender: row.gender,
    bio: row.bio,
    photo_url: publicObjectUrl(row.photoR2Key),
    languages: row.languages,
    role: row.role,
    status: row.status,
    // The Instructor Permissions held: the granted keys for an Instructor,
    // null for an Admin, whom the switches never gate.
    permissions: permissionsView(row.role, row.permissions),
    invited_at: row.invitedAt,
    accepted_at: row.acceptedAt,
    archived_at: row.archivedAt,
    // Assigned Days: every staff member's, admins included — leave belongs to
    // a staff member, not an instructor profile.
    annual_leave_days: row.annualLeaveDays,
    medical_leave_days: row.medicalLeaveDays,
    study_leave_days: row.studyLeaveDays,
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
    const pending = await pendingStaffEmails(tenantId(c))
    return c.json({
      staff: staff.map(row => serializeStaff(row, pending.get(row.id) ?? null)),
      invitations: invitations.map(serializeInvitation),
    })
  })
  .post('/invite', zValidator('json', inviteSchema, explainStaff), async c => {
    const body = c.req.valid('json')
    const actor = c.get('staffUserId')
    const inv = await svc.inviteAdmin({
      tenantId: tenantId(c),
      email: body.email,
      role: body.role,
      invitedByStaffId: actor,
      ...(body.permissions !== undefined ? { permissions: body.permissions } : {}),
    })
    c.set('auditTarget', { table: 'staff_invitations', id: inv.id })
    return c.json(serializeInvitation({ ...inv, invitedByStaffName: null }), 201)
  })
  .post('/invitations/:id/revoke', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const actor = c.get('staffUserId')
    const inv = await svc.revokeInvitation(tenantId(c), id, actor)
    c.set('auditTarget', { table: 'staff_invitations', id })
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
    c.set('auditTarget', { table: 'staff_invitations', id })
    return c.json(serializeInvitation({ ...inv, invitedByStaffName: null }))
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateStaffSchema, explainStaff), async c => {
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
        ...(body.permissions !== undefined ? { permissions: body.permissions } : {}),
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
    c.set('auditTarget', { table: 'staff_users', id })
    return c.json(serializeStaff(row, await pendingEmailOf(tenantId(c), id)))
  })
  // The sign-in email, anyone's the admin may edit, their own included: the new
  // address is saved Unverified and mailed a confirmation link, and nothing
  // moves until the link is clicked (`routes/public/staff-email-change.ts`).
  // The same address again is the resend.
  .post('/:id/email', zValidator('param', idParam), zValidator('json', emailChangeSchema, explainStaff), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const pending = await startStaffEmailChange({
      tenantId: tenantId(c),
      targetStaffId: id,
      actorStaffId: c.get('staffUserId'),
      email: body.email,
    })
    c.set('auditTarget', { table: 'staff_users', id })
    return c.json({
      pending_email: serializePendingEmail(pending),
      resend_after_seconds: EMAIL_CHANGE_RESEND_AFTER_MS / 1000,
    })
  })
  // Revoke the Unverified address: its link stops working.
  .delete('/:id/email', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    await revokeStaffEmailChange({
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
    c.set('auditTarget', { table: 'staff_users', id })
    return c.json(serializeStaff(await withPermissionsOf(tenantId(c), row), await pendingEmailOf(tenantId(c), id)))
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
    c.set('auditTarget', { table: 'staff_users', id })
    return c.json(serializeStaff(await withPermissionsOf(tenantId(c), row), await pendingEmailOf(tenantId(c), id)))
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
    c.set('auditTarget', { table: 'staff_users', id })
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
    c.set('auditTarget', { table: 'staff_users', id })
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
    c.set('auditTarget', { table: 'staff_users', id })
    return c.body(null, 204)
  })

export default app
