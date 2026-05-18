import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  bookings,
  classes,
  classTypes,
  clients,
  ptSessionClients,
  ptSessions,
  workshopDays,
  workshopInstructors,
  workshops,
} from '../../db/schema'
import { computeEventState, type EventState } from '../policy/event-state'

export type ScheduleKind = 'class' | 'workshop' | 'pt'

export interface ScheduleEntryRow {
  kind: ScheduleKind
  id: string
  workshopId: string | null
  label: string
  classTypeId: string | null
  instructorIds: string[]
  locationId: string | null
  startsAt: string
  endsAt: string
  capacity: number
  bookedCount: number
  eventState: EventState
  dayIndex: number | null
  dayCount: number | null
}

export interface ListScheduleOptions {
  from?: Date
  to?: Date
  type?: ScheduleKind
  instructorId?: string
  classTypeId?: string
  locationId?: string
}

function firstNameOf(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full
}

export async function listSchedule(opts: ListScheduleOptions): Promise<ScheduleEntryRow[]> {
  const now = new Date()
  const out: ScheduleEntryRow[] = []
  const wantClass = !opts.type || opts.type === 'class'
  const wantWorkshop = !opts.type || opts.type === 'workshop'
  const wantPt = !opts.type || opts.type === 'pt'

  // ---- classes ----------------------------------------------------------------
  if (wantClass) {
    const conds = []
    if (opts.from) conds.push(gte(classes.endsAt, opts.from))
    if (opts.to) conds.push(lt(classes.startsAt, opts.to))
    if (opts.instructorId) conds.push(eq(classes.instructorId, opts.instructorId))
    if (opts.classTypeId) conds.push(eq(classes.classTypeId, opts.classTypeId))
    if (opts.locationId) conds.push(eq(classes.locationId, opts.locationId))

    const rows = await db
      .select({
        id: classes.id,
        classTypeId: classes.classTypeId,
        className: classTypes.name,
        instructorId: classes.instructorId,
        locationId: classes.locationId,
        startsAt: classes.startsAt,
        endsAt: classes.endsAt,
        capacityOnline: classes.capacityOnline,
        capacityWaitlist: classes.capacityWaitlist,
        capacityBuffer: classes.capacityBuffer,
        lifecycle: classes.lifecycle,
      })
      .from(classes)
      .innerJoin(classTypes, eq(classes.classTypeId, classTypes.id))
      .where(conds.length ? and(...conds) : undefined)

    const ids = rows.map(r => r.id)
    const counts = ids.length
      ? await db
          .select({ classId: bookings.classId, cnt: sql<number>`count(*)::int` })
          .from(bookings)
          .where(and(inArray(bookings.classId, ids), eq(bookings.state, 'confirmed')))
          .groupBy(bookings.classId)
      : []
    const bookedByClass = new Map<string, number>()
    for (const c of counts) if (c.classId) bookedByClass.set(c.classId, Number(c.cnt))

    for (const r of rows) {
      out.push({
        kind: 'class',
        id: r.id,
        workshopId: null,
        label: r.className,
        classTypeId: r.classTypeId,
        instructorIds: [r.instructorId],
        locationId: r.locationId,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        capacity: r.capacityOnline + r.capacityWaitlist + r.capacityBuffer,
        bookedCount: bookedByClass.get(r.id) ?? 0,
        eventState: computeEventState({
          startsAt: r.startsAt,
          endsAt: r.endsAt,
          lifecycle: r.lifecycle,
          now,
        }),
        dayIndex: null,
        dayCount: null,
      })
    }
  }

  // ---- workshop days ---------------------------------------------------------
  if (wantWorkshop) {
    const conds = []
    if (opts.from) conds.push(gte(workshopDays.endsAt, opts.from))
    if (opts.to) conds.push(lt(workshopDays.startsAt, opts.to))
    if (opts.classTypeId) conds.push(eq(workshops.classTypeId, opts.classTypeId))
    if (opts.locationId) conds.push(eq(workshops.locationId, opts.locationId))

    const rows = await db
      .select({
        dayId: workshopDays.id,
        workshopId: workshopDays.workshopId,
        ord: workshopDays.ord,
        startsAt: workshopDays.startsAt,
        endsAt: workshopDays.endsAt,
        capacityOnline: workshopDays.capacityOnline,
        capacityWaitlist: workshopDays.capacityWaitlist,
        capacityBuffer: workshopDays.capacityBuffer,
        wsName: workshops.name,
        wsClassTypeId: workshops.classTypeId,
        wsLocationId: workshops.locationId,
        wsLifecycle: workshops.lifecycle,
      })
      .from(workshopDays)
      .innerJoin(workshops, eq(workshopDays.workshopId, workshops.id))
      .where(conds.length ? and(...conds) : undefined)

    const workshopIds = Array.from(new Set(rows.map(r => r.workshopId)))

    const dayTotals = workshopIds.length
      ? await db
          .select({
            workshopId: workshopDays.workshopId,
            cnt: sql<number>`count(*)::int`,
          })
          .from(workshopDays)
          .where(inArray(workshopDays.workshopId, workshopIds))
          .groupBy(workshopDays.workshopId)
      : []
    const dayCountMap = new Map<string, number>()
    for (const r of dayTotals) dayCountMap.set(r.workshopId, Number(r.cnt))

    const instructorRows = workshopIds.length
      ? await db
          .select({
            workshopId: workshopInstructors.workshopId,
            instructorId: workshopInstructors.instructorId,
          })
          .from(workshopInstructors)
          .where(inArray(workshopInstructors.workshopId, workshopIds))
      : []
    const instructorsByWorkshop = new Map<string, string[]>()
    for (const r of instructorRows) {
      const list = instructorsByWorkshop.get(r.workshopId) ?? []
      list.push(r.instructorId)
      instructorsByWorkshop.set(r.workshopId, list)
    }

    const wsBookings = workshopIds.length
      ? await db
          .select({ workshopId: bookings.workshopId, cnt: sql<number>`count(*)::int` })
          .from(bookings)
          .where(
            and(inArray(bookings.workshopId, workshopIds), eq(bookings.state, 'confirmed')),
          )
          .groupBy(bookings.workshopId)
      : []
    const bookedByWorkshop = new Map<string, number>()
    for (const r of wsBookings) if (r.workshopId) bookedByWorkshop.set(r.workshopId, Number(r.cnt))

    for (const r of rows) {
      const ids = instructorsByWorkshop.get(r.workshopId) ?? []
      if (opts.instructorId && !ids.includes(opts.instructorId)) continue
      out.push({
        kind: 'workshop',
        id: r.dayId,
        workshopId: r.workshopId,
        label: r.wsName,
        classTypeId: r.wsClassTypeId,
        instructorIds: ids,
        locationId: r.wsLocationId,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        capacity: r.capacityOnline + r.capacityWaitlist + r.capacityBuffer,
        bookedCount: bookedByWorkshop.get(r.workshopId) ?? 0,
        eventState: computeEventState({
          startsAt: r.startsAt,
          endsAt: r.endsAt,
          lifecycle: r.wsLifecycle,
          now,
        }),
        dayIndex: r.ord,
        dayCount: dayCountMap.get(r.workshopId) ?? 1,
      })
    }
  }

  // ---- pt sessions -----------------------------------------------------------
  if (wantPt) {
    const conds = [eq(ptSessions.lifecycle, 'active')]
    if (opts.from) conds.push(gte(ptSessions.endsAt, opts.from))
    if (opts.to) conds.push(lt(ptSessions.startsAt, opts.to))
    if (opts.instructorId) conds.push(eq(ptSessions.instructorId, opts.instructorId))
    if (opts.locationId) conds.push(eq(ptSessions.locationId, opts.locationId))

    const rows = await db
      .select({
        id: ptSessions.id,
        instructorId: ptSessions.instructorId,
        locationId: ptSessions.locationId,
        startsAt: ptSessions.startsAt,
        endsAt: ptSessions.endsAt,
        capacityOnline: ptSessions.capacityOnline,
        capacityWaitlist: ptSessions.capacityWaitlist,
        capacityBuffer: ptSessions.capacityBuffer,
        lifecycle: ptSessions.lifecycle,
      })
      .from(ptSessions)
      .where(and(...conds))

    const ids = rows.map(r => r.id)
    const clientLinks = ids.length
      ? await db
          .select({
            ptSessionId: ptSessionClients.ptSessionId,
            name: clients.name,
          })
          .from(ptSessionClients)
          .innerJoin(clients, eq(ptSessionClients.clientId, clients.id))
          .where(inArray(ptSessionClients.ptSessionId, ids))
      : []
    const namesBySession = new Map<string, string[]>()
    for (const r of clientLinks) {
      const list = namesBySession.get(r.ptSessionId) ?? []
      list.push(firstNameOf(r.name))
      namesBySession.set(r.ptSessionId, list)
    }

    for (const r of rows) {
      const names = namesBySession.get(r.id) ?? []
      out.push({
        kind: 'pt',
        id: r.id,
        workshopId: null,
        label: `Private · ${names.join(' + ') || 'Unknown'}`,
        classTypeId: null,
        instructorIds: [r.instructorId],
        locationId: r.locationId,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        capacity: r.capacityOnline + r.capacityWaitlist + r.capacityBuffer,
        bookedCount: names.length,
        eventState: computeEventState({
          startsAt: r.startsAt,
          endsAt: r.endsAt,
          lifecycle: r.lifecycle,
          now,
        }),
        dayIndex: null,
        dayCount: null,
      })
    }
  }

  out.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  return out
}
