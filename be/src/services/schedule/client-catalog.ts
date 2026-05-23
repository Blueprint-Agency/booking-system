import { z } from 'zod'
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../../db'
import { env } from '../../env'
import { bookings } from '../../db/schema/bookings'
import { classes, ptSessionClients, ptSessions } from '../../db/schema/schedule'
import { classTypes, instructors, locations, rooms } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'
import { ptBookingConfig } from '../../db/schema/policy'
import { NotFoundError } from '../../shared/errors'

function r2Url(key: string | null | undefined): string | null {
  if (!key || !env.R2_PUBLIC_URL) return null
  return `${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key.replace(/^\//, '')}`
}

export interface LocationLite {
  id: string
  name: string
  address: string | null
}

export interface ClassCardPayload {
  id: string
  class_type: { id: string; name: string }
  instructor: { id: string; name: string }
  location: LocationLite | null
  room: { id: string; name: string } | null
  starts_at: string
  ends_at: string
  credit_cost: number
  capacity_online: number
  booked_count: number
  spots_left: number
  lifecycle: string
}

export interface ClassDetailPayload extends ClassCardPayload {
  class_type: { id: string; name: string; description: string | null }
  location: { id: string; name: string; address: string | null; gmaps_url: string | null } | null
}

export interface ClassListFilters {
  from?: Date
  to?: Date
  locationId?: string
  instructorId?: string
  classTypeId?: string
}

export const classFiltersSchema = z.object({
  location_id: z.string().uuid().optional(),
  instructor_id: z.string().uuid().optional(),
  class_type_id: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export function parseClassFilters(raw: Record<string, string>): ClassListFilters {
  const q = classFiltersSchema.parse(raw)
  return {
    locationId: q.location_id,
    instructorId: q.instructor_id,
    classTypeId: q.class_type_id,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Default window: start of today → +28 days. Range hard-capped at 90 days. */
export function resolveWindow(from?: Date, to?: Date): { from: Date; to: Date } {
  const start = from ?? new Date(new Date().setHours(0, 0, 0, 0))
  let end = to ?? new Date(start.getTime() + 28 * DAY_MS)
  if (end.getTime() - start.getTime() > 90 * DAY_MS) {
    end = new Date(start.getTime() + 90 * DAY_MS)
  }
  return { from: start, to: end }
}

async function bookedCountByClass(classIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (classIds.length === 0) return map
  const rows = await db
    .select({ classId: bookings.classId, cnt: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(inArray(bookings.classId, classIds), eq(bookings.state, 'confirmed')))
    .groupBy(bookings.classId)
  for (const r of rows) if (r.classId) map.set(r.classId, Number(r.cnt))
  return map
}

export async function listClassCards(filters: ClassListFilters): Promise<ClassCardPayload[]> {
  const { from, to } = resolveWindow(filters.from, filters.to)
  const conds = [
    eq(classes.lifecycle, 'active'),
    gte(classes.endsAt, from),
    lt(classes.startsAt, to),
  ]
  if (filters.locationId) conds.push(eq(classes.locationId, filters.locationId))
  if (filters.instructorId) conds.push(eq(classes.mainInstructorId, filters.instructorId))
  if (filters.classTypeId) conds.push(eq(classes.classTypeId, filters.classTypeId))

  const rows = await db
    .select({
      id: classes.id,
      classTypeId: classes.classTypeId,
      className: classTypes.name,
      instructorId: classes.mainInstructorId,
      instructorName: staffUsers.name,
      locationId: classes.locationId,
      locationName: locations.name,
      locationAddress: locations.address,
      roomId: classes.roomId,
      startsAt: classes.startsAt,
      endsAt: classes.endsAt,
      creditCost: classes.creditCost,
      capacityOnline: classes.capacityOnline,
      lifecycle: classes.lifecycle,
    })
    .from(classes)
    .innerJoin(classTypes, eq(classes.classTypeId, classTypes.id))
    .innerJoin(instructors, eq(classes.mainInstructorId, instructors.staffUserId))
    .innerJoin(staffUsers, eq(instructors.staffUserId, staffUsers.id))
    .innerJoin(locations, eq(classes.locationId, locations.id))
    .where(and(...conds))
    .orderBy(classes.startsAt)

  const roomIds = Array.from(new Set(rows.map(r => r.roomId).filter((v): v is string => !!v)))
  const roomById = new Map<string, { id: string; name: string }>()
  if (roomIds.length) {
    const roomRows = await db
      .select({ id: rooms.id, name: rooms.name })
      .from(rooms)
      .where(inArray(rooms.id, roomIds))
    for (const r of roomRows) roomById.set(r.id, { id: r.id, name: r.name })
  }

  const booked = await bookedCountByClass(rows.map(r => r.id))

  return rows.map(r => {
    const bookedCount = booked.get(r.id) ?? 0
    return {
      id: r.id,
      class_type: { id: r.classTypeId, name: r.className },
      instructor: { id: r.instructorId, name: r.instructorName || 'Instructor' },
      location: { id: r.locationId, name: r.locationName, address: r.locationAddress },
      room: r.roomId ? roomById.get(r.roomId) ?? null : null,
      starts_at: r.startsAt.toISOString(),
      ends_at: r.endsAt.toISOString(),
      credit_cost: r.creditCost,
      capacity_online: r.capacityOnline,
      booked_count: bookedCount,
      spots_left: Math.max(0, r.capacityOnline - bookedCount),
      lifecycle: r.lifecycle,
    }
  })
}

export async function getClassDetail(id: string): Promise<ClassDetailPayload> {
  const [r] = await db
    .select({
      id: classes.id,
      classTypeId: classes.classTypeId,
      className: classTypes.name,
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
      lifecycle: classes.lifecycle,
    })
    .from(classes)
    .innerJoin(classTypes, eq(classes.classTypeId, classTypes.id))
    .innerJoin(instructors, eq(classes.mainInstructorId, instructors.staffUserId))
    .innerJoin(staffUsers, eq(instructors.staffUserId, staffUsers.id))
    .innerJoin(locations, eq(classes.locationId, locations.id))
    .where(eq(classes.id, id))
    .limit(1)

  if (!r || r.lifecycle !== 'active') throw new NotFoundError('class_not_found')

  let room: { id: string; name: string } | null = null
  if (r.roomId) {
    const [roomRow] = await db
      .select({ id: rooms.id, name: rooms.name })
      .from(rooms)
      .where(eq(rooms.id, r.roomId))
      .limit(1)
    room = roomRow ?? null
  }

  const booked = (await bookedCountByClass([r.id])).get(r.id) ?? 0

  return {
    id: r.id,
    class_type: { id: r.classTypeId, name: r.className, description: r.classDescription },
    instructor: { id: r.instructorId, name: r.instructorName || 'Instructor' },
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
    capacity_online: r.capacityOnline,
    booked_count: booked,
    spots_left: Math.max(0, r.capacityOnline - booked),
    lifecycle: r.lifecycle,
  }
}

/** Returns the set of class IDs (from the given list) the client has a confirmed booking for. */
export async function myBookedClassIds(clientId: string, classIds: string[]): Promise<Set<string>> {
  if (classIds.length === 0) return new Set()
  const rows = await db
    .select({ classId: bookings.classId })
    .from(bookings)
    .where(
      and(
        eq(bookings.clientId, clientId),
        eq(bookings.state, 'confirmed'),
        inArray(bookings.classId, classIds),
      ),
    )
  const out = new Set<string>()
  for (const r of rows) if (r.classId) out.add(r.classId)
  return out
}

export async function listActiveLocations(): Promise<
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
    .where(isNull(locations.archivedAt))
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

export async function listActiveInstructors(): Promise<InstructorLite[]> {
  const rows = await db
    .select({
      staffUserId: instructors.staffUserId,
      bio: instructors.bio,
      photoR2Key: instructors.photoR2Key,
      name: staffUsers.name,
      status: staffUsers.status,
      archivedAt: staffUsers.archivedAt,
    })
    .from(instructors)
    .innerJoin(staffUsers, eq(instructors.staffUserId, staffUsers.id))
    .where(and(isNull(staffUsers.archivedAt), eq(staffUsers.status, 'active')))
    .orderBy(staffUsers.name)

  return rows.map(r => ({
    id: r.staffUserId,
    name: r.name || 'Instructor',
    bio: r.bio,
    avatar_url: r2Url(r.photoR2Key),
  }))
}

export interface PtSlotPayload {
  id: string
  starts_at: string
  ends_at: string
  session_type: '1on1' | '2on1'
  spots_left: number
  location: { id: string; name: string } | null
}

async function getBookInAdvanceDays(): Promise<number> {
  const [cfg] = await db
    .select({ days: ptBookingConfig.bookInAdvanceDays })
    .from(ptBookingConfig)
    .limit(1)
  return cfg?.days ?? 14
}

export async function listInstructorAvailability(instructorId: string): Promise<PtSlotPayload[]> {
  const days = await getBookInAdvanceDays()
  const now = new Date()
  const until = new Date(now.getTime() + days * DAY_MS)

  const rows = await db
    .select({
      id: ptSessions.id,
      startsAt: ptSessions.startsAt,
      endsAt: ptSessions.endsAt,
      sessionType: ptSessions.sessionType,
      capacityOnline: ptSessions.capacityOnline,
      locationId: locations.id,
      locationName: locations.name,
    })
    .from(ptSessions)
    .leftJoin(locations, eq(ptSessions.locationId, locations.id))
    .where(
      and(
        eq(ptSessions.instructorId, instructorId),
        eq(ptSessions.lifecycle, 'active'),
        gte(ptSessions.startsAt, now),
        lt(ptSessions.startsAt, until),
      ),
    )
    .orderBy(ptSessions.startsAt)

  const ids = rows.map(r => r.id)
  const bookedBySession = new Map<string, number>()
  if (ids.length) {
    const counts = await db
      .select({ ptSessionId: ptSessionClients.ptSessionId, cnt: sql<number>`count(*)::int` })
      .from(ptSessionClients)
      .where(inArray(ptSessionClients.ptSessionId, ids))
      .groupBy(ptSessionClients.ptSessionId)
    for (const c of counts) bookedBySession.set(c.ptSessionId, Number(c.cnt))
  }

  return rows.map(r => ({
    id: r.id,
    starts_at: r.startsAt.toISOString(),
    ends_at: r.endsAt.toISOString(),
    session_type: r.sessionType as '1on1' | '2on1',
    spots_left: Math.max(0, r.capacityOnline - (bookedBySession.get(r.id) ?? 0)),
    location: r.locationId && r.locationName ? { id: r.locationId, name: r.locationName } : null,
  }))
}
