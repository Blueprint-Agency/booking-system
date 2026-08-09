import { and, asc, eq, gt, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  classes,
  classSupportingInstructors,
  corporateRequests,
  corporateSessions,
  corporateSessionSupportingInstructors,
  ptSessions,
  workshopDays,
  workshopInstructors,
  workshops,
} from '../../db/schema/schedule'
import { corporatePackages } from '../../db/schema/packages'
import { assertRoomAvailable, assertRoomInLocation } from '../schedule/room-conflicts'
import { AppError } from '../../shared/errors'

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

export type CorporateSessionError =
  | 'package_archived'
  | 'package_not_found'
  | 'room_conflict'
  | 'instructor_conflict'
  | 'main_in_supporting'
  | 'bad_time_range'
  | 'location_required'

export type CreateCorporateSessionResult =
  | { ok: true; session: CorporateSessionRow }
  | { ok: false; error: CorporateSessionError }

export interface CorporateSessionHydrated extends CorporateSessionRow {
  supportingInstructorIds: string[]
}

/**
 * Main-instructor conflict scan. Supporting instructors do NOT block.
 * Checks against active classes (main only), pt_sessions, corporate_sessions
 * (main only), and workshops (main only — via workshop_instructors.role='main').
 * Returns true if a conflict exists.
 */
async function hasMainInstructorConflict(
  instructorId: string,
  startsAt: Date,
  endsAt: Date,
  opts: { excludeCorporateSessionId?: string } = {},
): Promise<boolean> {
  // classes (main only)
  const classHit = await db
    .select({ id: classes.id })
    .from(classes)
    .where(
      and(
        eq(classes.mainInstructorId, instructorId),
        eq(classes.lifecycle, 'active'),
        lt(classes.startsAt, endsAt),
        gt(classes.endsAt, startsAt),
      ),
    )
    .limit(1)
  if (classHit.length) return true

  // pt sessions
  const ptHit = await db
    .select({ id: ptSessions.id })
    .from(ptSessions)
    .where(
      and(
        eq(ptSessions.instructorId, instructorId),
        eq(ptSessions.lifecycle, 'active'),
        lt(ptSessions.startsAt, endsAt),
        gt(ptSessions.endsAt, startsAt),
      ),
    )
    .limit(1)
  if (ptHit.length) return true

  // corporate sessions (main only, exclude self when rescheduling)
  const corpConds = [
    eq(corporateSessions.mainInstructorId, instructorId),
    eq(corporateSessions.lifecycle, 'active'),
    lt(corporateSessions.startsAt, endsAt),
    gt(corporateSessions.endsAt, startsAt),
  ]
  if (opts.excludeCorporateSessionId) {
    corpConds.push(ne(corporateSessions.id, opts.excludeCorporateSessionId))
  }
  const corpHit = await db
    .select({ id: corporateSessions.id })
    .from(corporateSessions)
    .where(and(...corpConds))
    .limit(1)
  if (corpHit.length) return true

  // workshops (main role only) via workshop_days time window
  const wsHit = await db
    .select({ id: workshopDays.id })
    .from(workshopDays)
    .innerJoin(workshops, eq(workshops.id, workshopDays.workshopId))
    .innerJoin(
      workshopInstructors,
      and(
        eq(workshopInstructors.workshopId, workshops.id),
        eq(workshopInstructors.role, 'main'),
        eq(workshopInstructors.instructorId, instructorId),
      ),
    )
    .where(
      and(
        eq(workshops.lifecycle, 'active'),
        lt(workshopDays.startsAt, endsAt),
        gt(workshopDays.endsAt, startsAt),
      ),
    )
    .limit(1)
  if (wsHit.length) return true

  return false
}

function uniqueSorted(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort()
}

export async function createCorporateSession(
  input: CreateCorporateSessionInput,
): Promise<CreateCorporateSessionResult> {
  // 1. Time range
  if (input.endsAt <= input.startsAt) {
    return { ok: false, error: 'bad_time_range' }
  }

  // 2. Main not in supporting list
  if (input.supportingInstructorIds.includes(input.mainInstructorId)) {
    return { ok: false, error: 'main_in_supporting' }
  }

  // 3. Package must exist and be active
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

  // 4. Location: a studio location_id OR a free-text off-site venue is required.
  const locationText = input.locationText?.trim() || null
  if (!input.locationId && !locationText) {
    return { ok: false, error: 'location_required' }
  }

  // 5. Room (optional). A room only makes sense inside a studio location; validate
  //    it belongs to that location and is free. Off-site venues carry no room.
  if (input.roomId) {
    if (!input.locationId) return { ok: false, error: 'location_required' }
    // Room must belong to location (throws on mismatch — let the AppError propagate
    // so misconfigured requests still surface 400, consistent with sister-services).
    await assertRoomInLocation(input.roomId, input.locationId)
    try {
      await assertRoomAvailable(input.roomId, input.startsAt, input.endsAt)
    } catch (err) {
      if (err instanceof AppError && err.code === 'room_clash') {
        return { ok: false, error: 'room_conflict' }
      }
      throw err
    }
  }

  // 6. Main-instructor conflict (supporting does not block)
  if (
    await hasMainInstructorConflict(input.mainInstructorId, input.startsAt, input.endsAt)
  ) {
    return { ok: false, error: 'instructor_conflict' }
  }

  const supports = uniqueSorted(input.supportingInstructorIds)

  // 6. Insert in a transaction
  const session = await db.transaction(async tx => {
    const rows = await tx
      .insert(corporateSessions)
      .values({
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

    if (supports.length > 0) {
      await tx.insert(corporateSessionSupportingInstructors).values(
        supports.map(instructorId => ({
          corporateSessionId: row.id,
          instructorId,
        })),
      )
    }
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
  const supports = await listSupportingInstructorIds(id)
  return { ...row, supportingInstructorIds: supports }
}

export async function listSupportingInstructorIds(
  corporateSessionId: string,
): Promise<string[]> {
  const rows = await db
    .select({
      instructorId: corporateSessionSupportingInstructors.instructorId,
    })
    .from(corporateSessionSupportingInstructors)
    .where(eq(corporateSessionSupportingInstructors.corporateSessionId, corporateSessionId))
  return rows.map(r => r.instructorId).sort()
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

  const currentSupports = await listSupportingInstructorIds(id)
  const nextSupports = patch.supportingInstructorIds
    ? uniqueSorted(patch.supportingInstructorIds)
    : currentSupports

  // 1. Time range
  if (nextEndsAt <= nextStartsAt) {
    return { ok: false, error: 'bad_time_range' }
  }

  // 2. Main not in supporting
  if (nextSupports.includes(nextMainInstructorId)) {
    return { ok: false, error: 'main_in_supporting' }
  }

  // 3. Package must exist and be active when changed; when unchanged we still
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
    await assertRoomInLocation(nextRoomId, nextLocationId)
    try {
      await assertRoomAvailable(nextRoomId, nextStartsAt, nextEndsAt, {
        kind: 'corporate_session',
        id,
      })
    } catch (err) {
      if (err instanceof AppError && err.code === 'room_clash') {
        return { ok: false, error: 'room_conflict' }
      }
      throw err
    }
  }

  // 5. Main-instructor conflict (exclude self)
  if (
    await hasMainInstructorConflict(nextMainInstructorId, nextStartsAt, nextEndsAt, {
      excludeCorporateSessionId: id,
    })
  ) {
    return { ok: false, error: 'instructor_conflict' }
  }

  // 6. Apply in a transaction
  const session = await db.transaction(async tx => {
    const set: Partial<typeof corporateSessions.$inferInsert> = {}
    if (patch.corporatePackageId !== undefined) set.corporatePackageId = nextCorporatePackageId
    if (patch.clientName !== undefined) set.clientName = nextClientName
    if (patch.mainInstructorId !== undefined) set.mainInstructorId = nextMainInstructorId
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

    if (patch.supportingInstructorIds !== undefined) {
      await tx
        .delete(corporateSessionSupportingInstructors)
        .where(eq(corporateSessionSupportingInstructors.corporateSessionId, id))
      if (nextSupports.length > 0) {
        await tx.insert(corporateSessionSupportingInstructors).values(
          nextSupports.map(instructorId => ({
            corporateSessionId: id,
            instructorId,
          })),
        )
      }
    }
    return row
  })

  return { ok: true, session }
}

/**
 * Hydrate a batch of corporate sessions with their supporting-instructor IDs.
 * Used by the schedule aggregator to avoid N+1 queries.
 */
export async function listSupportingInstructorsForSessions(
  sessionIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (!sessionIds.length) return map
  const rows = await db
    .select({
      corporateSessionId: corporateSessionSupportingInstructors.corporateSessionId,
      instructorId: corporateSessionSupportingInstructors.instructorId,
    })
    .from(corporateSessionSupportingInstructors)
    .where(
      inArray(corporateSessionSupportingInstructors.corporateSessionId, sessionIds),
    )
  for (const r of rows) {
    const list = map.get(r.corporateSessionId) ?? []
    list.push(r.instructorId)
    map.set(r.corporateSessionId, list)
  }
  for (const list of map.values()) list.sort()
  return map
}

// Avoid an unused-import warning until/unless we need raw SQL again.
void sql
