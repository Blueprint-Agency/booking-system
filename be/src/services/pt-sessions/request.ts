/**
 * Client submits a PT request. Service inserts pt_requests + pt_request_slots
 * and debits 1 session from the chosen PT package (whose session_type must match).
 *
 * No approve/decline step in the new flow — admin negotiates on WhatsApp and
 * then directly schedules from the portal (see ./schedule.ts), which is the
 * implicit approval. See docs/md/be-client.md §PT for the full contract.
 */

import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { clientPackages, ptPackages } from '../../db/schema/packages'
import { ptRequests, ptRequestSlots } from '../../db/schema/schedule'
import { ptBookingConfig } from '../../db/schema/policy'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { activatePackage, sweepExpired } from '../packages/activation'
import { debitCredits } from '../packages/ledger'
import { activationExpiry, isDormant } from '../packages/validity'
import { ptSessionCost } from './cost'

export interface PtRequestSlotInput {
  /** YYYY-MM-DD (local Singapore date). */
  proposedDate: string
  /** HH:mm 24h, local. */
  startTime: string
  /** HH:mm 24h, local. Must be after startTime. */
  endTime: string
}

/** Identity for the 2on1 partner. Required when sessionType='2on1', omitted otherwise. */
export type PtRequestPartner =
  | { kind: 'existing'; coClientId: string }
  // Partner isn't a member yet — admin will create their account at scheduling time.
  | { kind: 'new'; name: string; email: string }

export interface PtRequestInput {
  clientId: string
  /** Class type the client wants the session focused on. FK to class_types. */
  classTypeId: string
  /** Studio location the client wants the session at. FK to locations. */
  locationId: string
  sessionType: '1on1' | '2on1'
  /** Source PT package the request is debited from. Must be the requester's. */
  clientPackageId: string
  /** 1..N proposed date/time-frame slots. Admin picks one (or negotiates a new one) when scheduling. */
  slots: PtRequestSlotInput[]
  /** Optional free-form note from the client (preferences, focus areas, injuries). */
  message?: string
  /** Required when sessionType='2on1'. */
  partner?: PtRequestPartner
}

export async function submitPtRequest(
  tenantId: string,
  input: PtRequestInput,
): Promise<{ ptRequestId: string }> {
  if (input.slots.length === 0) throw new BadRequestError('no_slots')
  for (const s of input.slots) {
    if (s.endTime <= s.startTime) throw new BadRequestError('slot_end_before_start')
  }
  if (input.sessionType === '2on1' && !input.partner) throw new BadRequestError('partner_required')
  if (input.sessionType === '1on1' && input.partner) throw new BadRequestError('partner_not_allowed')

  return db.transaction(async tx => {
    const now = new Date()
    // Same as the class path: an ended package must not hold the family's one
    // Activated slot until the nightly sweep gets to it.
    await sweepExpired(tx, tenantId, input.clientId, now)
    const [pkg] = await tx
      .select({
        id: clientPackages.id,
        kind: clientPackages.kind,
        active: clientPackages.active,
        expiresAt: clientPackages.expiresAt,
        validityDays: clientPackages.validityDays,
        remaining: clientPackages.creditsOrSessionsRemaining,
        sessionType: ptPackages.sessionType,
      })
      .from(clientPackages)
      .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
      .where(
        and(
          eq(clientPackages.tenantId, tenantId),
          eq(clientPackages.id, input.clientPackageId),
          eq(clientPackages.clientId, input.clientId),
        ),
      )
      // Lock only client_packages — Postgres rejects FOR UPDATE on the nullable
      // side of the outer join (pt_packages is read-only metadata here anyway).
      .for('update', { of: clientPackages })
      .limit(1)

    if (!pkg) throw new NotFoundError('client_package_not_found')
    if (pkg.kind !== 'pt') throw new BadRequestError('not_a_pt_package')
    if (pkg.sessionType !== input.sessionType) throw new BadRequestError('session_type_mismatch')

    const notExpired = pkg.expiresAt === null || pkg.expiresAt > now
    if (!pkg.active || !notExpired) throw new ConflictError('package_not_consumable')

    // One Activated PT package at a time (§3). The member picks which package
    // pays, so the rule is a check rather than a selection: while one PT
    // package is running, it is the only one a request may be debited from,
    // and a Dormant one waits behind it whatever its session type. A Dormant
    // pick with nothing running is this request's Activation.
    const [running] = await tx
      .select({ id: clientPackages.id })
      .from(clientPackages)
      .where(
        and(
          eq(clientPackages.tenantId, tenantId),
          eq(clientPackages.clientId, input.clientId),
          eq(clientPackages.kind, 'pt'),
          eq(clientPackages.active, true),
          isNotNull(clientPackages.expiresAt),
        ),
      )
      .limit(1)
    if (running && running.id !== pkg.id) throw new ConflictError('pt_package_not_current')

    // 1on1 debits 1 session, 2on1 debits 2 (one per attendee).
    const cost = ptSessionCost(input.sessionType)
    if ((pkg.remaining ?? 0) < cost) throw new ConflictError('insufficient_pt_credit')

    if (isDormant(pkg)) {
      const until = activationExpiry({ kind: 'pt', durationMonths: null, validityDays: pkg.validityDays }, now)
      if (!until) throw new ConflictError('package_not_consumable')
      await activatePackage(tx, tenantId, pkg.id, until)
    }

    const [cfg] = await tx
      .select({ days: ptBookingConfig.bookInAdvanceDays })
      .from(ptBookingConfig)
      // One row per tenant, keyed on the tenant rather than a fixed singleton id.
      .where(eq(ptBookingConfig.tenantId, tenantId))
      .limit(1)
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + (cfg?.days ?? 14))

    // Debit through the credit ledger: it re-derives `active` and writes the
    // credit-movement audit row, so the cancel/expiry refund is reversible to
    // the exact package (backend-architecture §4, parity with classes).
    await debitCredits(tx, {
      tenantId,
      clientId: input.clientId,
      clientPackageId: pkg.id,
      amount: cost,
      reason: 'pt_request_submit',
    })

    const [req] = await tx
      .insert(ptRequests)
      .values({
        tenantId,
        clientId: input.clientId,
        classTypeId: input.classTypeId,
        locationId: input.locationId,
        sessionType: input.sessionType,
        coClientId: input.partner?.kind === 'existing' ? input.partner.coClientId : null,
        coClientName: input.partner?.kind === 'new' ? input.partner.name : null,
        coClientEmail: input.partner?.kind === 'new' ? input.partner.email : null,
        message: input.message ?? null,
        expiresAt,
        debitedClientPackageId: pkg.id,
      })
      .returning({ id: ptRequests.id })

    await tx.insert(ptRequestSlots).values(
      input.slots.map(s => ({
        tenantId,
        ptRequestId: req!.id,
        proposedDate: s.proposedDate,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    )

    return { ptRequestId: req!.id }
  })
}

export async function linkPtRequestPartner(input: {
  tenantId: string
  ptRequestId: string
  coClientId?: string
  email?: string
}): Promise<void> {
  if (!input.coClientId && !input.email?.trim()) throw new BadRequestError('partner_required')

  await db.transaction(async tx => {
    const [req] = await tx
      .select({
        id: ptRequests.id,
        clientId: ptRequests.clientId,
        sessionType: ptRequests.sessionType,
        status: ptRequests.status,
        coClientId: ptRequests.coClientId,
      })
      .from(ptRequests)
      .where(and(eq(ptRequests.tenantId, input.tenantId), eq(ptRequests.id, input.ptRequestId)))
      .for('update')
      .limit(1)

    if (!req) throw new NotFoundError('pt_request_not_found')
    if (req.status !== 'pending') throw new ConflictError('pt_request_not_pending')
    if (req.sessionType !== '2on1') throw new BadRequestError('not_a_2on1_request')
    if (req.coClientId) throw new ConflictError('partner_already_linked')

    const [partner] = await tx
      .select({ id: clients.id, status: clients.status, deletedAt: clients.deletedAt })
      .from(clients)
      .where(
        and(
          // A partner is a member of THIS studio. Looking one up by email
          // across the platform would confirm that an address is registered
          // somewhere else, and then attach that stranger to the session.
          eq(clients.tenantId, input.tenantId),
          input.coClientId
            ? eq(clients.id, input.coClientId)
            : sql`lower(${clients.email}) = ${input.email!.trim().toLowerCase()}`,
        ),
      )
      .limit(1)
    if (!partner) throw new NotFoundError('partner_client_not_found')
    if (req.clientId === partner.id) throw new BadRequestError('partner_cannot_be_requester')
    if (partner.status !== 'active' || partner.deletedAt) throw new ConflictError('partner_not_active')

    await tx
      .update(ptRequests)
      .set({
        coClientId: partner.id,
        coClientName: null,
        coClientEmail: null,
      })
      .where(and(eq(ptRequests.tenantId, input.tenantId), eq(ptRequests.id, input.ptRequestId)))
  })
}
