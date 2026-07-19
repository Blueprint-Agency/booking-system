import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireRole } from '../../../middleware/require-role'
import {
  listClients,
  createClientWithInvite,
  getClientById,
  listRecentAdjustments,
  softDeleteClient,
  restoreClient,
  type ClientRow,
  type ManualAdjustmentRow,
} from '../../../services/clients/manage'
import { listClientPackages, type ClientPackageWithSource } from '../../../services/packages/entitlements'
import { adjustBalance, setBalance, setPackageExpiry, type ClientPackageRow } from '../../../services/packages/adjust'

const idParam = z.object({ id: z.string().uuid() })
const idPkgParam = z.object({ id: z.string().uuid(), pid: z.string().uuid() })

const listQuery = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  // Stringly-typed because Hono query params are strings; only "true" enables.
  include_deleted: z.enum(['true', 'false']).optional(),
})

const createSchema = z.object({
  name: z.string().min(1).max(160),
  email: z.string().email(),
  phone: z.string().min(1).max(40),
})

const adjustSchema = z.object({
  delta: z.number().int(),
  reason: z.string().min(1).max(2000),
})
const balanceSchema = z.object({
  balance: z.number().int().min(0),
  reason: z.string().min(1).max(2000),
})
const expirySchema = z.object({
  expires_at: z.string().datetime({ offset: true }).nullable(),
  reason: z.string().min(1).max(2000),
})

function clientRow(c: ClientRow) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    status: c.status,
    joined_at: c.joinedAt,
    suspended_at: c.suspendedAt,
    deleted_at: c.deletedAt,
    deleted_by_staff_id: c.deletedByStaffId,
  }
}

function packageView(p: ClientPackageWithSource) {
  return {
    id: p.id,
    kind: p.kind,
    source_package_id: p.sourcePackageId,
    package_name: p.packageName,
    credits_or_sessions_remaining: p.creditsOrSessionsRemaining,
    credits_or_sessions_total: p.creditsOrSessionsTotal,
    expires_at: p.expiresAt,
    purchased_at: p.purchasedAt,
    amount_paid_sgd: p.amountPaidSgd,
  }
}

function adjustmentView(a: ManualAdjustmentRow) {
  return {
    id: a.id,
    client_package_id: a.clientPackageId,
    delta: a.delta,
    reason: a.reason,
    acted_by_staff_id: a.actedByStaffId,
    created_at: a.createdAt,
  }
}

// A package edit returns the raw client_packages row — reshape to the same
// snake_case view the profile uses (total/name aren't on the row, so omit them;
// the client refetches the profile to repaint authoritative values).
function editedPackageView(p: ClientPackageRow) {
  return {
    id: p.id,
    kind: p.kind,
    credits_or_sessions_remaining: p.creditsOrSessionsRemaining,
    expires_at: p.expiresAt,
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    // Only superadmins can see the deleted view; non-superadmins silently get
    // the default filtered list regardless of the query param.
    const role = c.get('staffRow')?.role
    const includeDeleted = q.include_deleted === 'true' && role === 'superadmin'
    const rows = await listClients({ q: q.q, status: q.status, includeDeleted })
    return c.json({ clients: rows.map(clientRow) })
  })
  .post('/', zValidator('json', createSchema), async c => {
    const body = c.req.valid('json')
    const staffId = c.get('staffUserId')
    const row = await createClientWithInvite({
      name: body.name,
      email: body.email,
      phone: body.phone,
      invitedByStaffId: staffId,
    })
    c.set('auditTarget' as any, { table: 'clients', id: row.id })
    return c.json(clientRow(row), 201)
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const [client, packages, adjustments] = await Promise.all([
      getClientById(id),
      listClientPackages(id, true),
      listRecentAdjustments(id),
    ])
    return c.json({
      ...clientRow(client),
      packages: packages.map(packageView),
      adjustments: adjustments.map(adjustmentView),
    })
  })
  // ---- package wallet edits (admin/superadmin) ----
  .post('/:id/packages/:pid/adjust', zValidator('param', idPkgParam), zValidator('json', adjustSchema), async c => {
    const { id, pid } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await adjustBalance({
      clientId: id,
      clientPackageId: pid,
      delta: body.delta,
      reason: body.reason,
      actedByStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'client_packages', id: pid })
    return c.json(editedPackageView(row))
  })
  .post('/:id/packages/:pid/balance', zValidator('param', idPkgParam), zValidator('json', balanceSchema), async c => {
    const { id, pid } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await setBalance({
      clientId: id,
      clientPackageId: pid,
      balance: body.balance,
      reason: body.reason,
      actedByStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'client_packages', id: pid })
    return c.json(editedPackageView(row))
  })
  .post('/:id/packages/:pid/expiry', zValidator('param', idPkgParam), zValidator('json', expirySchema), async c => {
    const { id, pid } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await setPackageExpiry({
      clientId: id,
      clientPackageId: pid,
      expiresAt: body.expires_at ? new Date(body.expires_at) : null,
      reason: body.reason,
      actedByStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'client_packages', id: pid })
    return c.json(editedPackageView(row))
  })
  // Blocking is DELETE /:id + POST /:id/restore below — there is deliberately no
  // separate suspend mechanism.
  .post('/:id/packages/issue', c => c.json({ todo: 'admin grants complimentary package' }, 501))
  // ---- soft delete + restore (superadmin-only) ----
  .delete('/:id', requireRole('superadmin'), zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await softDeleteClient({
      targetClientId: id,
      actorStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'clients', id })
    return c.json(clientRow(row))
  })
  .post('/:id/restore', requireRole('superadmin'), zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await restoreClient({
      targetClientId: id,
      actorStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'clients', id })
    return c.json(clientRow(row))
  })

export default app
