/**
 * An admin changes a member's email (#176).
 *
 * The address is two things at once, and both move together or neither does:
 * the `clients` row's own email, which is what the studio writes to and
 * searches by, and the `client` pool account the row is linked to, which is what
 * the member signs in with. Changing one without the other leaves a member who
 * is written to at one address and signs in at another.
 *
 * The login is this studio's own (#231), so the change replaces it: a login for
 * the new address at this studio, made by the same `ensureAuthUser` helper the
 * invite and the self-registration use, and the old login deleted — its
 * password, and every session it held here, with it. Nothing is left behind,
 * because nothing of it was ever another studio's: the same person's login at
 * another studio is a different row, and untouched.
 *
 * The new login has no password, exactly as an admin-added member's does
 * (#173): the member's first sign-in at the new address mails them the link
 * that sets one. The old password is not carried over, because it was proven
 * only by the old address.
 */
import { and, eq, ne, sql } from 'drizzle-orm'
import { db } from '../../db'
import { isUniqueViolation } from '../../db/unique-violation'
import { clientAuthUsers } from '../../db/schema/auth'
import { clients } from '../../db/schema/identity'
import { auditLog } from '../../db/schema/ledger'
import { ensureAuthUser } from '../auth/auth-users'
import { recordStaffAct } from '../auth/staff-acts'
import { syncProviderCustomerEmail } from '../billing/payment-customers'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import type { ClientRow } from './manage'

export interface ChangeClientEmailInput {
  tenantId: string
  clientId: string
  email: string
  actorStaffId: string
  /** The acting staff member's request, for the `auth_events` row (#119). */
  from?: Headers
}

export async function changeClientEmail(input: ChangeClientEmailInput): Promise<ClientRow> {
  const email = input.email.trim().toLowerCase()
  if (!email) throw new BadRequestError('email_required')

  const [target] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.tenantId, input.tenantId), eq(clients.id, input.clientId)))
    .limit(1)
  if (!target) throw new NotFoundError('client_not_found')
  const previousEmail = target.email
  if (previousEmail.toLowerCase() === email) throw new BadRequestError('email_unchanged')

  // Per studio, like the unique index (`clients_tenant_email_unique`): one
  // person may be a member of two studios, and this studio's admin decides
  // nothing about the other's directory.
  const [taken] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(
        eq(clients.tenantId, input.tenantId),
        ne(clients.id, input.clientId),
        sql`lower(${clients.email}) = ${email}`,
      ),
    )
    .limit(1)
  if (taken) {
    throw new ConflictError('email_in_use', {
      message: 'Another member of this studio already uses that email.',
    })
  }

  const updated = await db
    .transaction(async tx => {
      const authUserId = await ensureAuthUser(tx, 'client', {
        tenantId: input.tenantId,
        email,
        name: target.name,
      })
      const [row] = await tx
        .update(clients)
        .set({ email, authUserId, updatedAt: new Date() })
        .where(and(eq(clients.tenantId, input.tenantId), eq(clients.id, input.clientId)))
        .returning()
      // The old login ends with the old address: its sessions here go by
      // cascade, so the old address cannot keep acting as this member.
      await tx
        .delete(clientAuthUsers)
        .where(and(eq(clientAuthUsers.tenantId, input.tenantId), eq(clientAuthUsers.id, target.authUserId)))
      return row!
    })
    .catch((err: unknown) => {
      // Two admins moving two members onto one address at once: the index
      // decides, and the loser gets the answer the check above would have given
      // a moment later.
      if (isUniqueViolation(err)) {
        throw new ConflictError('email_in_use', {
          message: 'Another member of this studio already uses that email.',
        })
      }
      throw err
    })

  // The provider's copy of the address moves too (#185).
  //
  // Since saved cards, a member with a Customer is sent to checkout as
  // `customer` **instead of** `customer_email`, so the provider stops reading
  // the address off the session and reads it off the Customer — the one frozen
  // at their first checkout. Without this, the front desk corrects a member's
  // address and every receipt from then on still goes to the wrong one, which
  // is the kind of wrong that is only discovered by the person not receiving
  // them. It never throws: the studio's directory is the record that matters,
  // and a provider that is down must not refuse an address correction.
  await syncProviderCustomerEmail(input.tenantId, input.clientId, email)

  // The old login's sessions ended with it, above; logged as the admin's act.
  await recordStaffAct({
    tenantId: input.tenantId,
    actorStaffId: input.actorStaffId,
    kind: 'sessions_revoked',
    subjectUserId: target.authUserId,
    from: input.from,
  })

  // Both addresses, in one row: the audit middleware records that an email
  // changed, and only this knows what it changed from and to.
  await db.insert(auditLog).values({
    tenantId: input.tenantId,
    actorStaffId: input.actorStaffId,
    actorType: 'staff',
    action: 'client_email_changed',
    targetTable: 'clients',
    targetId: input.clientId,
    payload: { from: previousEmail, to: email },
  })

  return updated
}
