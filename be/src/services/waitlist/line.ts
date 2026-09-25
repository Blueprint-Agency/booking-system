/**
 * Reading a class's waitlist, and the status writes other services make to it
 * (spec-waitlist.md §3, §6, §9).
 *
 * Only `waiting` rows are in a line, and only while their class has not
 * started: a `waiting` row on a started class is expired whether or not the
 * cron has reached it yet (§6), so every read here filters on the class's start
 * too. Positions are counted from `(joined_at, id)` at read time — `./rules`.
 *
 * Nothing here books anyone; promotion is `./promote`, joining and leaving are
 * `./entries`.
 */
import { and, asc, eq, gt, inArray, lte } from 'drizzle-orm'
import { db } from '../../db'
import { waitlistEntries } from '../../db/schema/bookings'
import { classes } from '../../db/schema/schedule'
import { classTypes, locations } from '../../db/schema/catalog'
import { staffUsers, clients } from '../../db/schema/identity'
import type { Tx } from '../schedule/roster'
import { isEnabled } from '../feature-flags'
import { readCancellationPolicy } from '../policy/evaluate-cancellation'
import { now as clockNow } from '../../lib/clock'
import { inLine, positions, waitlistOpen, type LineEntry } from './rules'

/** The studio switch (§8), a `feature_flags` row. Unset is off. */
export const WAITLIST_FLAG = 'waitlist_enabled'

export const waitlistEnabled = (tenantId: string): boolean => isEnabled(tenantId, WAITLIST_FLAG)

/** The window a waitlist closes at: the class Cancellation Window, no policy of its own (§4). */
export async function classWindowHours(tenantId: string): Promise<number> {
  return (await readCancellationPolicy(tenantId)).classWindowHours
}

type Reader = typeof db | Tx

/** The `waiting` rows of these classes that are still live, in no order. */
async function liveWaiting(reader: Reader, tenantId: string, classIds: string[], now: Date) {
  if (classIds.length === 0) return []
  return reader
    .select({
      id: waitlistEntries.id,
      classId: waitlistEntries.classId,
      clientId: waitlistEntries.clientId,
      joinedAt: waitlistEntries.joinedAt,
    })
    .from(waitlistEntries)
    .innerJoin(classes, and(eq(classes.tenantId, waitlistEntries.tenantId), eq(classes.id, waitlistEntries.classId)))
    .where(
      and(
        eq(waitlistEntries.tenantId, tenantId),
        inArray(waitlistEntries.classId, classIds),
        eq(waitlistEntries.status, 'waiting'),
        gt(classes.startsAt, now),
      ),
    )
}

/** How many are waiting on each class, for the timetable's "+N waiting". A class with no line is absent. */
export async function waitingCounts(tenantId: string, classIds: string[], now: Date): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const w of await liveWaiting(db, tenantId, classIds, now)) out.set(w.classId, (out.get(w.classId) ?? 0) + 1)
  return out
}

/** A class's live line, in queue order. Pass the transaction holding the class lock. */
export async function waitingLine(reader: Reader, tenantId: string, classId: string, now: Date): Promise<LineEntry[]> {
  return inLine(await liveWaiting(reader, tenantId, [classId], now))
}

export interface LineState {
  enabled: boolean
  windowHours: number
  waiting: number
  open: boolean
}

/** How a class's line stands now: the `class_full` body and a join both read this. */
export async function lineState(
  reader: Reader,
  tenantId: string,
  cls: { id: string; lifecycle: string; startsAt: Date; capacityWaitlist: number },
  now: Date,
): Promise<LineState> {
  const enabled = waitlistEnabled(tenantId)
  const windowHours = await classWindowHours(tenantId)
  const waiting = (await liveWaiting(reader, tenantId, [cls.id], now)).length
  return {
    enabled,
    windowHours,
    waiting,
    open: waitlistOpen({ enabled, windowHours, waiting, now, ...cls }),
  }
}

/** The catalogue's `waitlist` object (§9). `my_entry` is null for a signed-out reader. */
export interface WaitlistSummary {
  enabled: boolean
  capacity: number
  waiting: number
  open: boolean
  my_entry: { id: string; position: number } | null
}

/** `WaitlistSummary` for every class in a catalogue page, in one read. */
export async function waitlistSummaries(
  tenantId: string,
  rows: readonly { id: string; lifecycle: string; startsAt: Date; capacityWaitlist: number }[],
  clientId: string | null,
  now: Date = clockNow(),
): Promise<Map<string, WaitlistSummary>> {
  const out = new Map<string, WaitlistSummary>()
  if (rows.length === 0) return out
  const enabled = waitlistEnabled(tenantId)
  const windowHours = await classWindowHours(tenantId)
  const waiting = await liveWaiting(
    db,
    tenantId,
    rows.map(r => r.id),
    now,
  )
  const byClass = new Map<string, LineEntry[]>()
  for (const w of waiting) byClass.set(w.classId, [...(byClass.get(w.classId) ?? []), w])

  for (const r of rows) {
    const line = byClass.get(r.id) ?? []
    const mine = clientId ? line.find(e => e.clientId === clientId) : undefined
    out.set(r.id, {
      enabled,
      capacity: r.capacityWaitlist,
      waiting: line.length,
      open: waitlistOpen({ enabled, windowHours, waiting: line.length, now, ...r }),
      my_entry: mine ? { id: mine.id, position: positions(line).get(mine.id)! } : null,
    })
  }
  return out
}

export interface ClientWaitlistEntry {
  id: string
  classId: string
  className: string
  startsAt: Date
  endsAt: Date
  locationName: string
  instructorName: string
  joinedAt: Date
  position: number
}

/** A member's live places in line, soonest class first — My Bookings' "Waitlisted" group. */
export async function listForClient(
  tenantId: string,
  clientId: string,
  now: Date = clockNow(),
): Promise<ClientWaitlistEntry[]> {
  const mine = await db
    .select({
      id: waitlistEntries.id,
      classId: waitlistEntries.classId,
      joinedAt: waitlistEntries.joinedAt,
      className: classTypes.name,
      startsAt: classes.startsAt,
      endsAt: classes.endsAt,
      locationName: locations.name,
      instructorName: staffUsers.name,
    })
    .from(waitlistEntries)
    .innerJoin(classes, and(eq(classes.tenantId, waitlistEntries.tenantId), eq(classes.id, waitlistEntries.classId)))
    .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .innerJoin(locations, eq(locations.id, classes.locationId))
    .innerJoin(staffUsers, eq(staffUsers.id, classes.mainInstructorId))
    .where(
      and(
        eq(waitlistEntries.tenantId, tenantId),
        eq(waitlistEntries.clientId, clientId),
        eq(waitlistEntries.status, 'waiting'),
        gt(classes.startsAt, now),
      ),
    )
    .orderBy(asc(classes.startsAt))
  const lines = await liveWaiting(
    db,
    tenantId,
    mine.map(m => m.classId),
    now,
  )
  return mine.map(m => ({
    ...m,
    instructorName: m.instructorName || 'Instructor',
    position: positions(lines.filter(l => l.classId === m.classId)).get(m.id)!,
  }))
}

export interface ClassWaitlistEntry {
  id: string
  clientId: string
  clientName: string
  joinedAt: Date
  position: number
}

/** Several classes' live lines with who is in them, in queue order — the check-in desk's. A class with no line is absent. */
export async function listForClasses(
  tenantId: string,
  classIds: string[],
  now: Date = clockNow(),
): Promise<Map<string, ClassWaitlistEntry[]>> {
  const out = new Map<string, ClassWaitlistEntry[]>()
  const waiting = await liveWaiting(db, tenantId, classIds, now)
  if (waiting.length === 0) return out
  const names = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(
      and(
        eq(clients.tenantId, tenantId),
        inArray(clients.id, [...new Set(waiting.map(e => e.clientId))]),
      ),
    )
  const nameOf = new Map(names.map(n => [n.id, n.name]))
  for (const classId of new Set(waiting.map(e => e.classId))) {
    out.set(
      classId,
      inLine(waiting.filter(e => e.classId === classId)).map((e, i) => ({
        id: e.id,
        clientId: e.clientId,
        clientName: nameOf.get(e.clientId) ?? '',
        joinedAt: e.joinedAt,
        position: i + 1,
      })),
    )
  }
  return out
}

/** A class's live line with who is in it, in queue order — the staff Waitlist panel's rows. */
export async function listForClass(
  tenantId: string,
  classId: string,
  now: Date = clockNow(),
): Promise<ClassWaitlistEntry[]> {
  const line = await waitingLine(db, tenantId, classId, now)
  if (line.length === 0) return []
  const names = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(
      and(
        eq(clients.tenantId, tenantId),
        inArray(
          clients.id,
          line.map(e => e.clientId),
        ),
      ),
    )
  const nameOf = new Map(names.map(n => [n.id, n.name]))
  return line.map((e, i) => ({
    id: e.id,
    clientId: e.clientId,
    clientName: nameOf.get(e.clientId) ?? '',
    joinedAt: e.joinedAt,
    position: i + 1,
  }))
}

/** One entry's live position, or null when it is no longer in a line. */
export async function positionOf(tenantId: string, entryId: string, now: Date = clockNow()): Promise<number | null> {
  const [entry] = await db
    .select({ classId: waitlistEntries.classId, status: waitlistEntries.status })
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.tenantId, tenantId), eq(waitlistEntries.id, entryId)))
    .limit(1)
  if (!entry || entry.status !== 'waiting') return null
  return positions(await waitingLine(db, tenantId, entry.classId, now)).get(entryId) ?? null
}

/* ── Status writes other services make ─────────────────────────────── */

/**
 * The member now holds a seat on the class by some other road than the line —
 * they booked it themselves, or staff booked them — so their place in its line
 * is spent. Without this they would sit in the line holding a seat, counting
 * against its length and in the way of the next promotion.
 */
export async function settleWaitingOnBooking(
  tx: Tx,
  tenantId: string,
  input: { classId: string; clientId: string; by: string; now: Date },
): Promise<void> {
  await tx
    .update(waitlistEntries)
    .set({
      status: input.by === 'client' ? 'withdrawn' : 'removed',
      resolvedAt: input.now,
      resolvedBy: input.by,
    })
    .where(
      and(
        eq(waitlistEntries.tenantId, tenantId),
        eq(waitlistEntries.classId, input.classId),
        eq(waitlistEntries.clientId, input.clientId),
        eq(waitlistEntries.status, 'waiting'),
      ),
    )
}

/** A whole-class cancel empties its line (§6): every `waiting` entry is `removed`. Returns who was waiting. */
export async function removeLineForCancelledClass(
  tx: Tx,
  tenantId: string,
  classId: string,
  staffId: string,
  now: Date,
): Promise<string[]> {
  const removed = await tx
    .update(waitlistEntries)
    .set({ status: 'removed', resolvedAt: now, resolvedBy: staffId })
    .where(
      and(
        eq(waitlistEntries.tenantId, tenantId),
        eq(waitlistEntries.classId, classId),
        eq(waitlistEntries.status, 'waiting'),
      ),
    )
    .returning({ clientId: waitlistEntries.clientId })
  return removed.map(r => r.clientId)
}

/**
 * The scheduled sweep (§6): a `waiting` entry whose class has started is
 * `expired`. Runs inside one Tenant's context (`jobs/index.ts`), so Row-Level
 * Security narrows it to that studio. Reads already treat these rows as
 * expired; this makes the stored status agree.
 */
export async function expireWaitlists(): Promise<number> {
  const now = clockNow()
  const started = db
    .select({ id: classes.id })
    .from(classes)
    .where(lte(classes.startsAt, now))
  const expired = await db
    .update(waitlistEntries)
    .set({ status: 'expired', resolvedAt: now, resolvedBy: 'system' })
    .where(and(eq(waitlistEntries.status, 'waiting'), inArray(waitlistEntries.classId, started)))
    .returning({ id: waitlistEntries.id })
  return expired.length
}
