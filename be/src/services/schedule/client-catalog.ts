import { z } from 'zod'
import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import { db } from '../../db'
import { now as clockNow } from '../../lib/clock'
import { publicObjectUrl } from '../../lib/r2'
import { bookings } from '../../db/schema/bookings'
import { classes, classSupportingInstructors } from '../../db/schema/schedule'
import { classTypes, instructors, locations, rooms } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { classDifficultyEnum } from '../../db/enums'
import { NotFoundError } from '../../shared/errors'
import { readRosters, type Tx } from './roster'
import { countSeats, countSeatsByClass, seatsOf, spotsLeft, type SeatCounts } from '../bookings/seats'
import { lineupsOf } from './lineup'
import { waitlistSummaries, type WaitlistSummary } from '../waitlist/line'
import { clashJson, firstClash, heldWindows } from '../bookings/member-time'
import { cancelWindowResolver, classCancelWindow } from '../policy/cancel-window'
import { namedClassRule, namedRuleJson } from './package-rules'
import { localDateOf, zonedInstant } from './series-dates'
import { loadTenantById } from '../tenants/tenants'

export interface LocationLite {
  id: string
  name: string
  address: string | null
  gmaps_url: string | null
}

export interface ClassCardPayload {
  id: string
  class_type: { id: string; name: string; difficulty: ClassLevel }
  instructor: { id: string; name: string }
  main_instructor_id: string
  supporting_instructor_ids: string[]
  /** Back-compat — [main, ...supporting]. */
  instructor_ids: string[]
  location: LocationLite | null
  room: { id: string; name: string } | null
  starts_at: string
  ends_at: string
  credit_cost: number
  /**
   * An online seat is free. Only whether, never how many: a class's seat
   * counts are for its studio's staff (spec-waitlist.md §9).
   */
  has_seats: boolean
  lifecycle: string
  /** This class's Cancellation Window in hours — its own, else the studio's (policy/cancel-window.ts). */
  effective_cancel_window_hours: number
  /** The class's line (spec-waitlist.md §9). `my_entry` is null for a signed-out reader. */
  waitlist: WaitlistSummary
  /**
   * The class takes only some packages (a Package rule other than `all`). Just
   * the flag, for the row's "Some packages" hint: which ones is in the detail,
   * read for the class opened.
   */
  restricted: boolean
}

export interface ClassDetailPayload extends ClassCardPayload {
  class_type: { id: string; name: string; difficulty: ClassLevel; description: string | null }
  location: { id: string; name: string; address: string | null; gmaps_url: string | null } | null
  supporting_instructors: { id: string; name: string }[]
  /** Which packages may pay for the class, each named (be/CONTEXT.md § Package rule). */
  package_rule: ReturnType<typeof namedRuleJson>
}

export type ClassLevel = (typeof classDifficultyEnum.enumValues)[number]

export interface ClassListFilters {
  from?: Date
  to?: Date
  locationId?: string
  instructorId?: string
  classTypeId?: string
  level?: ClassLevel
}

export const classFiltersSchema = z.object({
  location_id: z.string().uuid().optional(),
  instructor_id: z.string().uuid().optional(),
  class_type_id: z.string().uuid().optional(),
  level: z.enum(classDifficultyEnum.enumValues).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export function parseClassFilters(raw: Record<string, string>): ClassListFilters {
  const q = classFiltersSchema.parse(raw)
  return {
    locationId: q.location_id,
    instructorId: q.instructor_id,
    classTypeId: q.class_type_id,
    level: q.level,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Default window: start of today → +28 days. Range hard-capped at 90 days.
 * "Today" is the studio's own day on the app clock: midnight in its timezone,
 * never the server's.
 */
export function resolveWindow(timezone: string, from?: Date, to?: Date): { from: Date; to: Date } {
  const start = from ?? zonedInstant(localDateOf(clockNow(), timezone), '00:00', timezone)
  let end = to ?? new Date(start.getTime() + 28 * DAY_MS)
  if (end.getTime() - start.getTime() > 90 * DAY_MS) {
    end = new Date(start.getTime() + 90 * DAY_MS)
  }
  return { from: start, to: end }
}

/**
 * What a member is shown of a class's seats: whether an online seat is free,
 * and nothing more. How many seats a class has, how many are taken and how many
 * remain are for staff; buffer and overbook seats never count here
 * (spec-waitlist.md §2, §9).
 */
function memberSeats(counts: SeatCounts, capacityOnline: number) {
  return { has_seats: spotsLeft(counts, { capacityOnline }) > 0 }
}

/** `clientId` is the signed-in member, whose own place in each line is shown; null on the public route. */
export async function listClassCards(
  tenantId: string,
  filters: ClassListFilters,
  clientId: string | null = null,
): Promise<ClassCardPayload[]> {
  const tenant = await loadTenantById(tenantId)
  if (!tenant) throw new NotFoundError('tenant_not_found')
  const { from, to } = resolveWindow(tenant.timezone, filters.from, filters.to)
  const conds = [
    eq(classes.tenantId, tenantId),
    eq(classes.lifecycle, 'active'),
    gte(classes.endsAt, from),
    lt(classes.startsAt, to),
  ]
  if (filters.locationId) conds.push(eq(classes.locationId, filters.locationId))
  if (filters.instructorId) conds.push(eq(classes.mainInstructorId, filters.instructorId))
  if (filters.classTypeId) conds.push(eq(classes.classTypeId, filters.classTypeId))
  if (filters.level) conds.push(eq(classTypes.difficulty, filters.level))

  const rows = await db
    .select({
      id: classes.id,
      classTypeId: classes.classTypeId,
      className: classTypes.name,
      classDifficulty: classTypes.difficulty,
      instructorId: classes.mainInstructorId,
      instructorName: staffUsers.name,
      locationId: classes.locationId,
      locationName: locations.name,
      locationAddress: locations.address,
      locationGmapsUrl: locations.gmapsUrl,
      roomId: classes.roomId,
      startsAt: classes.startsAt,
      endsAt: classes.endsAt,
      creditCost: classes.creditCost,
      capacityOnline: classes.capacityOnline,
      capacityWaitlist: classes.capacityWaitlist,
      cancelWindowHours: classes.cancelWindowHours,
      packageRuleMode: classes.packageRuleMode,
      lifecycle: classes.lifecycle,
    })
    .from(classes)
    .innerJoin(classTypes, eq(classes.classTypeId, classTypes.id))
    .innerJoin(instructors, eq(classes.mainInstructorId, instructors.staffUserId))
    .innerJoin(staffUsers, eq(instructors.staffUserId, staffUsers.id))
    .innerJoin(locations, eq(classes.locationId, locations.id))
    .where(and(...conds))
    .orderBy(classes.startsAt)
  const waitlists = await waitlistSummaries(tenantId, rows, clientId)
  const windowOf = await cancelWindowResolver(tenantId)

  const roomIds = Array.from(new Set(rows.map(r => r.roomId).filter((v): v is string => !!v)))
  const roomById = new Map<string, { id: string; name: string }>()
  if (roomIds.length) {
    const roomRows = await db
      .select({ id: rooms.id, name: rooms.name })
      .from(rooms)
      .where(
        and(eq(rooms.tenantId, tenantId), inArray(rooms.id, roomIds), isNull(rooms.deletedAt)),
      )
    for (const r of roomRows) roomById.set(r.id, { id: r.id, name: r.name })
  }

  const seats = await countSeatsByClass(
    db,
    tenantId,
    rows.map(r => r.id),
  )
  const supportingByClass = await loadSupportingByClass(
    tenantId,
    rows.map(r => r.id),
  )

  return rows.map(r => {
    const supporting = supportingByClass.get(r.id) ?? []
    return {
      id: r.id,
      class_type: { id: r.classTypeId, name: r.className, difficulty: r.classDifficulty },
      instructor: { id: r.instructorId, name: r.instructorName || 'Instructor' },
      main_instructor_id: r.instructorId,
      supporting_instructor_ids: supporting,
      instructor_ids: [r.instructorId, ...supporting],
      location: { id: r.locationId, name: r.locationName, address: r.locationAddress, gmaps_url: r.locationGmapsUrl },
      room: r.roomId ? roomById.get(r.roomId) ?? null : null,
      starts_at: r.startsAt.toISOString(),
      ends_at: r.endsAt.toISOString(),
      credit_cost: r.creditCost,
      ...memberSeats(seatsOf(seats, r.id), r.capacityOnline),
      lifecycle: r.lifecycle,
      effective_cancel_window_hours: windowOf(r),
      waitlist: waitlists.get(r.id)!,
      restricted: r.packageRuleMode !== 'all',
    }
  })
}

async function loadSupportingByClass(
  tenantId: string,
  classIds: string[],
): Promise<Map<string, string[]>> {
  // Classes with nobody supporting now get an empty entry rather than none —
  // every caller reads through `?? []`, so the result is the same.
  return new Map(
    [...lineupsOf(await readRosters(tenantId, 'class', classIds))].map(([id, l]) => [
      id,
      l.supportingInstructorIds,
    ]),
  )
}

export async function getClassDetail(
  tenantId: string,
  id: string,
): Promise<ClassDetailPayload> {
  const [r] = await db
    .select({
      id: classes.id,
      classTypeId: classes.classTypeId,
      className: classTypes.name,
      classDifficulty: classTypes.difficulty,
      classDescription: classTypes.description,
      instructorId: classes.mainInstructorId,
      instructorName: staffUsers.name,
      locationId: classes.locationId,
      locationName: locations.name,
      locationAddress: locations.address,
      gmapsUrl: locations.gmapsUrl,
      roomId: classes.roomId,
      startsAt: classes.startsAt,
      endsAt: classes.endsAt,
      creditCost: classes.creditCost,
      capacityOnline: classes.capacityOnline,
      capacityWaitlist: classes.capacityWaitlist,
      cancelWindowHours: classes.cancelWindowHours,
      packageRuleMode: classes.packageRuleMode,
      lifecycle: classes.lifecycle,
    })
    .from(classes)
    .innerJoin(classTypes, eq(classes.classTypeId, classTypes.id))
    .innerJoin(instructors, eq(classes.mainInstructorId, instructors.staffUserId))
    .innerJoin(staffUsers, eq(instructors.staffUserId, staffUsers.id))
    .innerJoin(locations, eq(classes.locationId, locations.id))
    .where(and(eq(classes.tenantId, tenantId), eq(classes.id, id)))
    .limit(1)

  if (!r || r.lifecycle !== 'active') throw new NotFoundError('class_not_found')

  let room: { id: string; name: string } | null = null
  if (r.roomId) {
    const [roomRow] = await db
      .select({ id: rooms.id, name: rooms.name })
      .from(rooms)
      .where(and(eq(rooms.tenantId, tenantId), eq(rooms.id, r.roomId), isNull(rooms.deletedAt)))
      .limit(1)
    room = roomRow ?? null
  }

  const seats = await countSeats(db, tenantId, r.id)

  const supportingRows = await db
    .select({
      instructorId: classSupportingInstructors.instructorId,
      name: staffUsers.name,
    })
    .from(classSupportingInstructors)
    .leftJoin(staffUsers, eq(staffUsers.id, classSupportingInstructors.instructorId))
    .where(
      and(
        eq(classSupportingInstructors.tenantId, tenantId),
        eq(classSupportingInstructors.classId, r.id),
      ),
    )
  const supporting = supportingRows
    .map(s => ({ id: s.instructorId, name: s.name ?? 'Instructor' }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const supportingIds = supporting.map(s => s.id)

  return {
    id: r.id,
    class_type: { id: r.classTypeId, name: r.className, difficulty: r.classDifficulty, description: r.classDescription },
    instructor: { id: r.instructorId, name: r.instructorName || 'Instructor' },
    main_instructor_id: r.instructorId,
    supporting_instructor_ids: supportingIds,
    supporting_instructors: supporting,
    instructor_ids: [r.instructorId, ...supportingIds],
    location: {
      id: r.locationId,
      name: r.locationName,
      address: r.locationAddress,
      gmaps_url: r.gmapsUrl,
    },
    room,
    starts_at: r.startsAt.toISOString(),
    ends_at: r.endsAt.toISOString(),
    credit_cost: r.creditCost,
    ...memberSeats(seats, r.capacityOnline),
    lifecycle: r.lifecycle,
    effective_cancel_window_hours: await classCancelWindow(tenantId, r),
    // Public route: whether the line is open, never anyone's place in it.
    waitlist: (await waitlistSummaries(tenantId, [r], null)).get(r.id)!,
    restricted: r.packageRuleMode !== 'all',
    package_rule: namedRuleJson(await namedClassRule(tenantId, r)),
  }
}

/** Returns the set of class IDs (from the given list) the client has a confirmed booking for. */
export async function myBookedClassIds(
  tenantId: string,
  clientId: string,
  classIds: string[],
): Promise<Set<string>> {
  if (classIds.length === 0) return new Set()
  const rows = await db
    .select({ classId: bookings.classId })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        eq(bookings.clientId, clientId),
        eq(bookings.state, 'confirmed'),
        inArray(bookings.classId, classIds),
      ),
    )
  const out = new Set<string>()
  for (const r of rows) if (r.classId) out.add(r.classId)
  return out
}

/**
 * For each class, the member's own booking it overlaps, if any — what the
 * schedule row shows instead of Book ("Clashes with …"). One read of the
 * member's held windows across the classes' span; the rule is `firstClash`.
 */
export async function myClashes(
  tenantId: string,
  clientId: string,
  classes: readonly { id: string; starts_at: string; ends_at: string }[],
): Promise<Map<string, ReturnType<typeof clashJson>>> {
  const out = new Map<string, ReturnType<typeof clashJson>>()
  if (classes.length === 0) return out
  const windows = classes.map(c => ({ id: c.id, startsAt: new Date(c.starts_at), endsAt: new Date(c.ends_at) }))
  const span = {
    startsAt: new Date(Math.min(...windows.map(w => w.startsAt.getTime()))),
    endsAt: new Date(Math.max(...windows.map(w => w.endsAt.getTime()))),
  }
  const held = await heldWindows(db, tenantId, clientId, span)
  for (const w of windows) {
    const clash = firstClash(held, w, { kind: 'class', id: w.id })
    if (clash) out.set(w.id, clashJson(clash))
  }
  return out
}

export async function listActiveLocations(tenantId: string): Promise<
  { id: string; name: string; address: string | null; gmaps_url: string | null; phone: string | null }[]
> {
  const rows = await db
    .select({
      id: locations.id,
      name: locations.name,
      address: locations.address,
      gmapsUrl: locations.gmapsUrl,
      phone: locations.phone,
    })
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        isNull(locations.archivedAt),
        isNull(locations.deletedAt),
      ),
    )
    .orderBy(locations.name)
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    address: r.address,
    gmaps_url: r.gmapsUrl,
    phone: r.phone,
  }))
}

export interface InstructorLite {
  id: string
  name: string
  bio: string | null
  avatar_url: string | null
}

/**
 * `handle` lets a caller already inside a transaction read the roster on that
 * transaction's own connection. Tenant context is transaction-local — a read on
 * a different pooled connection is outside it, and RLS fails closed there.
 */
export async function listActiveInstructors(
  tenantId: string,
  handle: typeof db | Tx = db,
): Promise<InstructorLite[]> {
  const rows = await handle
    .select({
      staffUserId: instructors.staffUserId,
      bio: staffUsers.bio,
      photoR2Key: instructors.photoR2Key,
      name: staffUsers.name,
      status: staffUsers.status,
      archivedAt: staffUsers.archivedAt,
    })
    .from(instructors)
    .innerJoin(staffUsers, eq(instructors.staffUserId, staffUsers.id))
    .where(
      and(
        eq(staffUsers.tenantId, tenantId),
        isNull(staffUsers.archivedAt),
        isNull(staffUsers.deletedAt),
        eq(staffUsers.status, 'active'),
      ),
    )
    .orderBy(staffUsers.name)

  return rows.map(r => ({
    id: r.staffUserId,
    name: r.name || 'Instructor',
    bio: r.bio,
    avatar_url: publicObjectUrl(r.photoR2Key),
  }))
}

