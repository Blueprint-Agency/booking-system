/**
 * Client submits a PT request. Service inserts pt_requests + pt_request_slots
 * and debits 1 session from the chosen PT package (whose session_type must match).
 *
 * No approve/decline step in the new flow — admin negotiates on WhatsApp and
 * then directly schedules from the portal (see ./schedule.ts), which is the
 * implicit approval. See docs/md/be-client.md §PT for the full contract.
 */

import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages, ptPackages } from '../../db/schema/packages'
import { ptRequests, ptRequestSlots } from '../../db/schema/schedule'
import { ptBookingConfig } from '../../db/schema/policy'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { computeActive } from '../packages/validity'

const PT_CONFIG_SINGLETON_ID = '00000000-0000-0000-0000-000000000002'

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

export async function submitPtRequest(input: PtRequestInput): Promise<{ ptRequestId: string }> {
  if (input.slots.length === 0) throw new BadRequestError('no_slots')
  for (const s of input.slots) {
    if (s.endTime <= s.startTime) throw new BadRequestError('slot_end_before_start')
  }
  if (input.sessionType === '2on1' && !input.partner) throw new BadRequestError('partner_required')
  if (input.sessionType === '1on1' && input.partner) throw new BadRequestError('partner_not_allowed')

  return db.transaction(async tx => {
    const [pkg] = await tx
      .select({
        id: clientPackages.id,
        kind: clientPackages.kind,
        active: clientPackages.active,
        expiresAt: clientPackages.expiresAt,
        remaining: clientPackages.creditsOrSessionsRemaining,
        sessionType: ptPackages.sessionType,
      })
      .from(clientPackages)
      .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
      .where(and(eq(clientPackages.id, input.clientPackageId), eq(clientPackages.clientId, input.clientId)))
      .for('update')
      .limit(1)

    if (!pkg) throw new NotFoundError('client_package_not_found')
    if (pkg.kind !== 'pt') throw new BadRequestError('not_a_pt_package')
    if (pkg.sessionType !== input.sessionType) throw new BadRequestError('session_type_mismatch')

    const now = new Date()
    const notExpired = pkg.expiresAt === null || pkg.expiresAt > now
    if (!pkg.active || !notExpired) throw new ConflictError('package_not_consumable')
    if ((pkg.remaining ?? 0) < 1) throw new ConflictError('insufficient_pt_credit')

    const [cfg] = await tx
      .select({ days: ptBookingConfig.bookInAdvanceDays })
      .from(ptBookingConfig)
      .where(eq(ptBookingConfig.id, PT_CONFIG_SINGLETON_ID))
      .limit(1)
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + (cfg?.days ?? 14))

    const newRemaining = (pkg.remaining ?? 0) - 1
    await tx
      .update(clientPackages)
      .set({
        creditsOrSessionsRemaining: newRemaining,
        active: computeActive({ kind: 'pt', expiresAt: pkg.expiresAt, creditsOrSessionsRemaining: newRemaining }, now),
      })
      .where(eq(clientPackages.id, pkg.id))

    const [req] = await tx
      .insert(ptRequests)
      .values({
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
        ptRequestId: req!.id,
        proposedDate: s.proposedDate,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    )

    return { ptRequestId: req!.id }
  })
}
