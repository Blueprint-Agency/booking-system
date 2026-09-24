/**
 * A member's profile: name, gender and phone (#281).
 *
 * An admin edits all three in one save, following the email change
 * (`change-email.ts`) beside it: this studio's member only, never a blocked
 * one, and one audit row that knows what changed from and to — the audit
 * middleware records only that the route was called. Only the fields that
 * actually change are written to that row, and a save that changes nothing
 * writes none, so the trail holds only real changes.
 *
 * A member edits their own name, phone and gender through the same rules, so
 * the two paths cannot drift: a name of 1–160 and a phone of 1–40, both
 * trimmed, as at create and registration. A phone is free text, as it is at
 * registration. Gender may be cleared with null.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { auditLog } from '../../db/schema/ledger'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import type { ClientRow } from './manage'

export type ClientGender = NonNullable<ClientRow['gender']>

const NAME_MAX = 160
const PHONE_MAX = 40

/** The editable fields. Absent: left as it is. A null gender: cleared. */
export type ProfileFields = { name?: string; phone?: string; gender?: ClientGender | null }

export type EditClientProfileInput = ProfileFields & {
  tenantId: string
  clientId: string
  actorStaffId: string
}

export async function editClientProfile(input: EditClientProfileInput): Promise<ClientRow> {
  const next = validated(input)

  const target = await findClient(input.tenantId, input.clientId)
  // A blocked member's record is closed, as it is to an email change: unblock first.
  if (target.deletedAt) throw new ConflictError('client_blocked')

  const { from, to } = changesFrom(target, next)
  if (Object.keys(to).length === 0) return target

  return db.transaction(async tx => {
    const [row] = await tx
      .update(clients)
      .set({ ...to, updatedAt: new Date() })
      .where(and(eq(clients.tenantId, input.tenantId), eq(clients.id, input.clientId)))
      .returning()
    await tx.insert(auditLog).values({
      tenantId: input.tenantId,
      actorStaffId: input.actorStaffId,
      actorType: 'staff',
      action: 'client_profile_edited',
      targetTable: 'clients',
      targetId: input.clientId,
      payload: { from, to },
    })
    return row!
  })
}

/**
 * The member's own edit, from the member app. Not audited: the audit trail is
 * what staff did to a member's record. Blocked members never get this far —
 * `requireActiveClient` refuses them before the route.
 */
export async function editOwnProfile(
  tenantId: string,
  clientId: string,
  fields: ProfileFields,
): Promise<ClientRow> {
  const next = validated(fields)
  const target = await findClient(tenantId, clientId)
  if (Object.keys(next).length === 0) return target
  const [row] = await db
    .update(clients)
    .set({ ...next, updatedAt: new Date() })
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, clientId)))
    .returning()
  return row!
}

async function findClient(tenantId: string, clientId: string): Promise<ClientRow> {
  const [target] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.id, clientId)))
    .limit(1)
  if (!target) throw new NotFoundError('client_not_found')
  return target
}

function validated(fields: ProfileFields): ProfileFields {
  const next: ProfileFields = {}
  if (fields.name !== undefined) next.name = trimmedWithin(fields.name, 'name_required', 'A name', NAME_MAX)
  if (fields.phone !== undefined) next.phone = trimmedWithin(fields.phone, 'phone_required', 'A phone number', PHONE_MAX)
  if (fields.gender !== undefined) next.gender = fields.gender
  return next
}

/** The before and after of only the fields `next` changes. */
function changesFrom(target: ClientRow, next: ProfileFields): { from: ProfileFields; to: ProfileFields } {
  const from: Record<string, unknown> = {}
  const to: Record<string, unknown> = {}
  for (const key of ['name', 'gender', 'phone'] as const) {
    if (next[key] === undefined || next[key] === target[key]) continue
    from[key] = target[key]
    to[key] = next[key]
  }
  return { from: from as ProfileFields, to: to as ProfileFields }
}

/** Trimmed, and refused with a sentence a person can read when blank or too long. */
function trimmedWithin(value: string, code: 'name_required' | 'phone_required', what: string, max: number): string {
  const trimmed = value.trim()
  if (!trimmed) throw new BadRequestError(code, { message: `${what} is required.` })
  if (trimmed.length > max) throw new BadRequestError('invalid_request', { message: `${what} is at most ${max} characters.` })
  return trimmed
}
