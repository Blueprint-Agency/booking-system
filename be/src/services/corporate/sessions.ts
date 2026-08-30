import { and, asc, eq, gte, isNull, lt, ne } from 'drizzle-orm'
import { db } from '../../db'
import { corporateRequests, corporateSessions } from '../../db/schema/schedule'
import { corporatePackages } from '../../db/schema/packages'
import { assertRoomAvailable, assertRoomInLocation } from '../schedule/room-conflicts'
import { assertInstructorsAvailable, plannedInstructorIds } from '../schedule/occupancy'
import { ensureInstructors, readRoster, replaceRoster } from '../schedule/roster'

export type CorporateSessionRow = typeof corporateSessions.$inferSelect

export interface CreateCorporateSessionInput {
  corporatePackageId: string
  clientName: string
  mainInstructorId: string
  supportingInstructorIds: string[]
  // Either a studio location (locationId, optionally with a roomId) OR a free-text
  // off-site venue (locationText). Room is optional even for a studio location.
  locationId?: string | null
  locationText?: string | null
  roomId?: string | null
  startsAt: Date
  endsAt: Date
  createdByStaffId: string
}

/**
 * Roster mistakes are NOT in here. Naming the main instructor in the supporting
 * list, or naming someone who isn't an instructor, is refused by the roster
 * module with the same 400 the other three event kinds return
 * (`supporting_instructor_duplicates_main` / `invalid_instructor_id`).
 *
 * Nor are clashes: a taken room or a busy instructor throws
 * ConflictError('schedule_conflict') from the occupancy module — one 409 for
 * both subjects, shared with every other scheduling path.
 */
export type CorporateSessionError =
  | 'package_archived'
  | 'package_not_found'
  | 'bad_time_range'
  | 'location_required'

export type CreateCorporateSessionResult =
  | { ok: true; session: CorporateSessionRow }
  | { ok: false; error: CorporateSessionError }

export interface CorporateSessionHydrated extends CorporateSessionRow {
  supportingInstructorIds: string[]
}

// The main-instructor conflict scan that used to live here is gone: it read the
// main-instructor COLUMN of each kind, so a supporting instructor could be
// double-booked, and workshops were matched on role='main' only. The occupancy
// module asks the roster instead — see services/schedule/occupancy.ts.

export async function createCorporateSession(
  input: CreateCorporateSessionInput,
): Promise<CreateCorporateSessionResult> {
  // 1. Time range
  if (input.endsAt <= input.startsAt) {
    return { ok: false, error: 'bad_time_range' }
  }

  // 2. Package must exist and be active
  const [pkg] = await db
    .select()
    .from(corporatePackages)
    .where(
      and(
        eq(corporatePackages.id, input.corporatePackageId),
        isNull(corporatePackages.deletedAt),
      ),
    )
    .limit(1)
  if (!pkg) return { ok: false, error: 'package_not_found' }
  if (pkg.status !== 'active') return { ok: false, error: 'package_archived' }
  // The corporate package the session is sold against is the only tenant this
  // session can belong to. Scoping the rest of this service is the workshops/PT
  // batch (#62); the shared schedule primitives below need a tenant now.
  const tenantId = pkg.tenantId!

  // 3. Location: a studio location_id OR a free-text off-site venue is required.
  const locationText = input.locationText?.trim() || null
  if (!input.locationId && !locationText) {
    return { ok: false, error: 'location_required' }
  }

  // 4. Room (optional). A room only makes sense inside a studio location; validate
  //    it belongs to that location and is free. Off-site venues carry no room.
  if (input.roomId) {
    if (!input.locationId) return { ok: false, error: 'location_required' }
    // Room must belong to location (throws on mismatch — let the AppError propagate
    // so misconfigured requests still surface 400, consistent with sister-services).
    await assertRoomInLocation(tenantId, input.roomId, input.locationId)
    await assertRoomAvailable(tenantId, input.roomId, input.startsAt, input.endsAt)
  }

  // 5. Nobody on the session may already be booked then — supporting included.
  await assertInstructorsAvailable(
    tenantId,
    [input.mainInstructorId, ...input.supportingInstructorIds],
    { startsAt: input.startsAt, endsAt: input.endsAt },
  )

  // 6. Insert in a transaction
  const session = await db.transaction(async tx => {
    // The session row's own main_instructor_id FK points at
    // instructors.staff_user_id, so the profile row has to exist first.
    await ensureInstructors(tenantId, [input.mainInstructorId], tx)
    const rows = await tx
      .insert(corporateSessions)
      .values({
        tenantId,
        corporatePackageId: input.corporatePackageId,
        clientName: input.clientName,
        mainInstructorId: input.mainInstructorId,
        // Studio location and off-site text are mutually exclusive.
        locationId: input.locationId ?? null,
        locationText: input.locationId ? null : locationText,
        roomId: input.locationId ? (input.roomId ?? null) : null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        createdByStaffId: input.createdByStaffId,
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('insert returned no rows')

    // Instructor validation, dedup and the main-cannot-be-supporting rule all
    // live in the roster module — nothing to pre-check here.
    await replaceRoster(
      tx,
      tenantId,
      { kind: 'corporate_session', id: row.id },
      { supportingInstructorIds: input.supportingInstructorIds },
    )
    return row
  })

  return { ok: true, session }
}

export async function getCorporateSession(
  id: string,
): Promise<CorporateSessionHydrated | null> {
  const [row] = await db
    .select()
    .from(corporateSessions)
    .where(eq(corporateSessions.id, id))
    .limit(1)
  if (!row) return null
  const supports = await listSupportingInstructorIds(row.tenantId!, id)
  return { ...row, supportingInstructorIds: supports }
}

export async function listSupportingInstructorIds(
  tenantId: string,
  corporateSessionId: string,
): Promise<string[]> {
  const roster = await readRoster(tenantId, {
    kind: 'corporate_session',
    id: corporateSessionId,
  })
  return roster.filter(r => r.role === 'supporting').map(r => r.instructorId)
}

export interface ListCorporateSessionsOpts {
  from?: Date
  to?: Date
  locationId?: string
}

export async function listCorporateSessions(
  opts: ListCorporateSessionsOpts = {},
): Promise<CorporateSessionRow[]> {
  const conds = []
  if (opts.from) conds.push(gte(corporateSessions.endsAt, opts.from))
  if (opts.to) conds.push(lt(corporateSessions.startsAt, opts.to))
  if (opts.locationId) conds.push(eq(corporateSessions.locationId, opts.locationId))

  return db
    .select()
    .from(corporateSessions)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(corporateSessions.startsAt))
}

export async function cancelCorporateSession(
  id: string,
  staffId: string,
): Promise<CorporateSessionRow | null> {
  return db.transaction(async tx => {
    const now = new Date()
    const rows = await tx
      .update(corporateSessions)
      .set({
        lifecycle: 'cancelled',
        cancelledAt: now,
        cancelledByStaffId: staffId,
      })
      .where(and(eq(corporateSessions.id, id), eq(corporateSessions.lifecycle, 'active')))
      .returning()
    const session = rows[0] ?? null
    if (!session) return null

    if (session.corporateRequestId) {
      await tx
        .update(corporateRequests)
        .set({
          status: 'cancelled',
          resolvedAt: now,
          resolvedByStaffId: staffId,
        })
        .where(
          and(
            eq(corporateRequests.id, session.corporateRequestId),
            eq(corporateRequests.status, 'scheduled'),
          ),
        )
    }

    return session
  })
}

export type RescheduleCorporateSessionPatch = Partial<
  Omit<CreateCorporateSessionInput, 'createdByStaffId'>
>

export async function rescheduleCorporateSession(
  id: string,
  patch: RescheduleCorporateSessionPatch,
): Promise<CreateCorporateSessionResult | { ok: false; error: 'not_found' }> {
  const [existing] = await db
    .select()
    .from(corporateSessions)
    .where(eq(corporateSessions.id, id))
    .limit(1)
  if (!existing) return { ok: false, error: 'not_found' }
  // The session's own tenant — see the note in `createCorporateSession`.
  const tenantId = existing.tenantId!

  // Compose the proposed state by overlaying the patch.
  const nextCorporatePackageId = patch.corporatePackageId ?? existing.corporatePackageId
  const nextClientName = patch.clientName ?? existing.clientName
  const nextMainInstructorId = patch.mainInstructorId ?? existing.mainInstructorId
  const nextLocationId = patch.locationId ?? existing.locationId
  const nextRoomId = patch.roomId ?? existing.roomId
  const nextLocationText =
    patch.locationText !== undefined
      ? patch.locationText?.trim() || null
      : existing.locationText
  const nextStartsAt = patch.startsAt ?? existing.startsAt
  const nextEndsAt = patch.endsAt ?? existing.endsAt

  // 1. Time range
  if (nextEndsAt <= nextStartsAt) {
    return { ok: false, error: 'bad_time_range' }
  }

  // 2. Package must exist and be active when changed; when unchanged we still
  //    require it to be active (rescheduling an archived-package session would
  //    be inconsistent with createCorporateSession's contract).
  if (patch.corporatePackageId !== undefined) {
    const [pkg] = await db
      .select()
      .from(corporatePackages)
      .where(
        and(
          eq(corporatePackages.id, nextCorporatePackageId),
          isNull(corporatePackages.deletedAt),
        ),
      )
      .limit(1)
    if (!pkg) return { ok: false, error: 'package_not_found' }
    if (pkg.status !== 'active') return { ok: false, error: 'package_archived' }
  }

  // Location: a studio location_id OR a free-text venue must remain set.
  if (!nextLocationId && !nextLocationText) {
    return { ok: false, error: 'location_required' }
  }

  // Room (optional) is only valid inside a studio location — validate coherence
  // and availability only when both are present.
  if (nextRoomId) {
    if (!nextLocationId) return { ok: false, error: 'location_required' }
    await assertRoomInLocation(tenantId, nextRoomId, nextLocationId)
    await assertRoomAvailable(tenantId, nextRoomId, nextStartsAt, nextEndsAt, {
      kind: 'corporate_session',
      id,
    })
  }

  // 4. Whoever the session will END UP with has to be free then — the merge
  //    below is the same one the write performs, so the two can't disagree.
  await assertInstructorsAvailable(
    tenantId,
    await plannedInstructorIds(
      tenantId,
      { kind: 'corporate_session', id },
      {
        ...(patch.mainInstructorId !== undefined
          ? { main: { instructorId: patch.mainInstructorId } }
          : {}),
        ...(patch.supportingInstructorIds !== undefined
          ? { supportingInstructorIds: patch.supportingInstructorIds }
          : {}),
      },
    ),
    { startsAt: nextStartsAt, endsAt: nextEndsAt },
    { kind: 'corporate_session', id },
  )

  // 5. Apply in a transaction
  const session = await db.transaction(async tx => {
    const set: Partial<typeof corporateSessions.$inferInsert> = {}
    if (patch.corporatePackageId !== undefined) set.corporatePackageId = nextCorporatePackageId
    if (patch.clientName !== undefined) set.clientName = nextClientName
    // main_instructor_id is the roster's column, written below — not here.
    // Re-normalize location/room/text together so studio vs off-site stays coherent.
    if (
      patch.locationId !== undefined ||
      patch.locationText !== undefined ||
      patch.roomId !== undefined
    ) {
      set.locationId = nextLocationId ?? null
      set.locationText = nextLocationId ? null : nextLocationText
      set.roomId = nextLocationId ? (nextRoomId ?? null) : null
    }
    if (patch.startsAt !== undefined) set.startsAt = nextStartsAt
    if (patch.endsAt !== undefined) set.endsAt = nextEndsAt

    let row = existing
    if (Object.keys(set).length) {
      const rows = await tx
        .update(corporateSessions)
        .set(set)
        .where(eq(corporateSessions.id, id))
        .returning()
      if (!rows[0]) throw new Error('update returned no rows')
      row = rows[0]
    }

    if (patch.mainInstructorId !== undefined || patch.supportingInstructorIds !== undefined) {
      await replaceRoster(
        tx,
        tenantId,
        { kind: 'corporate_session', id },
        {
          ...(patch.mainInstructorId !== undefined
            ? { main: { instructorId: patch.mainInstructorId } }
            : {}),
          ...(patch.supportingInstructorIds !== undefined
            ? { supportingInstructorIds: patch.supportingInstructorIds }
            : {}),
        },
      )
      // main_instructor_id may have moved under us.
      const [fresh] = await tx
        .select()
        .from(corporateSessions)
        .where(eq(corporateSessions.id, id))
        .limit(1)
      if (fresh) row = fresh
    }
    return row
  })

  return { ok: true, session }
}

