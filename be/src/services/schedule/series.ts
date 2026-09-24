/**
 * Class Series: a weekly repeating class, defined once, that creates ordinary
 * classes (be/CONTEXT.md § Class Series).
 *
 * Create and extend are both two steps through this one module:
 *
 *   - a **preview** returns every date the range produces, each with its clash
 *     result — the same occupancy check a single class runs (room, instructor,
 *     instructor on leave), only reported rather than thrown;
 *   - a **commit** re-runs that check inside one transaction and creates every
 *     class or none. A date the admin wants skipped is an excluded date, so the
 *     commit takes exactly the input the preview took.
 *
 * A class created here is a class in every respect — it books, edits, cancels
 * and restaffs through the ordinary class paths. `classes.series_id` only says
 * where it came from, which is also what keeps extend from ever creating a
 * second class on a date the series already has.
 *
 * Admin only: nothing here takes an audience, and the routes live under
 * /portal/admin.
 */
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  classes,
  classSeries,
  classSeriesSupportingInstructors,
} from '../../db/schema/schedule'
import { classTypes } from '../../db/schema/catalog'
import { bookings } from '../../db/schema/bookings'
import { loadTenantById } from '../tenants/tenants'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { assertRoomInLocation } from './room-conflicts'
import { findClash, type SubjectClash } from './occupancy'
import { ensureInstructors, exec, replaceRoster, type Tx } from './roster'
import {
  addDays,
  daysFrom,
  localDateOf,
  seriesOccurrences,
  zonedInstant,
  type IsoWeekday,
  type LocalTime,
  type Occurrence,
  type PlainDate,
} from './series-dates'

/** "One year" per create or extend: a typo in the last date cannot make hundreds of classes. */
export const MAX_RANGE_DAYS = 366

export interface SeriesTemplate {
  classTypeId: string
  mainInstructorId: string
  /** Null only on a series imported with no known rate: its classes are Unpriced. */
  instructorPaySgd: number | null
  supportingInstructors: { instructorId: string; paySgd: number }[]
  locationId: string
  roomId: string
  weekday: IsoWeekday
  startTime: LocalTime
  endTime: LocalTime
  capacityOnline: number
  capacityWaitlist: number
  capacityBuffer: number
  creditCost: number
}

export interface CreateSeriesInput extends SeriesTemplate {
  firstDate: PlainDate
  lastDate: PlainDate
  excludedDates: PlainDate[]
}

export interface ExtendSeriesInput {
  lastDate: PlainDate
  /** More dates to skip, typically holidays inside the new range. Added to the series'. */
  excludedDates?: PlainDate[]
}

export interface PreviewDate extends Occurrence {
  /** Empty = the class can be created on this date. */
  clashes: SubjectClash[]
}

export type SeriesRow = typeof classSeries.$inferSelect

export interface SeriesDetail extends SeriesTemplate {
  id: string
  firstDate: PlainDate
  lastDate: PlainDate
  excludedDates: PlainDate[]
  endedFrom: PlainDate | null
  createdAt: Date
}

export interface SeriesCommit {
  series: SeriesDetail
  classIds: string[]
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

export async function previewSeries(
  tenantId: string,
  input: CreateSeriesInput,
  now = new Date(),
): Promise<PreviewDate[]> {
  return withClashes(tenantId, input, await planCreate(tenantId, input, now))
}

export async function createSeries(
  tenantId: string,
  input: CreateSeriesInput & { createdByStaffId: string },
  now = new Date(),
): Promise<SeriesCommit> {
  const occurrences = await planCreate(tenantId, input, now)
  const created = await db.transaction(async tx => {
    await ensureInstructors(
      tenantId,
      [input.mainInstructorId, ...input.supportingInstructors.map(s => s.instructorId)],
      tx,
    )
    const [row] = await tx
      .insert(classSeries)
      .values({
        tenantId,
        classTypeId: input.classTypeId,
        mainInstructorId: input.mainInstructorId,
        instructorPaySgd: input.instructorPaySgd?.toFixed(2) ?? null,
        locationId: input.locationId,
        roomId: input.roomId,
        weekday: input.weekday,
        startTime: input.startTime,
        endTime: input.endTime,
        capacityOnline: input.capacityOnline,
        capacityWaitlist: input.capacityWaitlist,
        capacityBuffer: input.capacityBuffer,
        creditCost: input.creditCost,
        firstDate: input.firstDate,
        lastDate: input.lastDate,
        excludedDates: normaliseDates(input.excludedDates),
        createdByStaffId: input.createdByStaffId,
      })
      .returning({ id: classSeries.id })
    if (!row) throw new Error('insert returned no rows')
    if (input.supportingInstructors.length) {
      await tx.insert(classSeriesSupportingInstructors).values(
        input.supportingInstructors.map(s => ({
          tenantId,
          seriesId: row.id,
          instructorId: s.instructorId,
          paySgd: s.paySgd.toFixed(2),
        })),
      )
    }
    const classIds = await createClasses(
      tx,
      tenantId,
      row.id,
      input,
      occurrences,
      input.createdByStaffId,
    )
    return { id: row.id, classIds }
  })
  return { series: await getSeries(tenantId, created.id), classIds: created.classIds }
}

async function planCreate(
  tenantId: string,
  input: CreateSeriesInput,
  now: Date,
): Promise<Occurrence[]> {
  assertTemplate(input)
  const timezone = await tenantTimezone(tenantId)
  if (input.lastDate < input.firstDate) throw new BadRequestError('last_date_before_first_date')
  if (input.firstDate < localDateOf(now, timezone)) throw new BadRequestError('first_date_in_past')
  assertWithinYear(input.firstDate, input.lastDate)
  await assertTemplateRefs(tenantId, input)

  const occurrences = seriesOccurrences({
    ...input,
    from: input.firstDate,
    to: input.lastDate,
    excluded: input.excludedDates,
    timezone,
  }).filter(o => o.startsAt > now)
  if (occurrences.length === 0) throw new BadRequestError('series_has_no_dates')
  return occurrences
}

// ---------------------------------------------------------------------------
// extend
// ---------------------------------------------------------------------------

export async function previewExtend(
  tenantId: string,
  seriesId: string,
  input: ExtendSeriesInput,
  now = new Date(),
): Promise<PreviewDate[]> {
  const plan = await planExtend(tenantId, seriesId, input, now)
  return withClashes(tenantId, plan.template, plan.occurrences)
}

export async function extendSeries(
  tenantId: string,
  seriesId: string,
  input: ExtendSeriesInput & { actorStaffId: string },
  now = new Date(),
): Promise<SeriesCommit> {
  const classIds = await db.transaction(async tx => {
    // The series row is the lock: two extends of one series queue here, and the
    // second plans against the dates the first has just created.
    const plan = await planExtend(tenantId, seriesId, input, now, tx)
    await tx
      .update(classSeries)
      .set({
        lastDate: plan.lastDate,
        excludedDates: plan.excludedDates,
      })
      .where(and(eq(classSeries.tenantId, tenantId), eq(classSeries.id, seriesId)))
    if (plan.occurrences.length === 0) return []
    await ensureInstructors(
      tenantId,
      [plan.template.mainInstructorId, ...plan.template.supportingInstructors.map(s => s.instructorId)],
      tx,
    )
    return createClasses(tx, tenantId, seriesId, plan.template, plan.occurrences, input.actorStaffId)
  })
  return { series: await getSeries(tenantId, seriesId), classIds }
}

async function planExtend(
  tenantId: string,
  seriesId: string,
  input: ExtendSeriesInput,
  now: Date,
  tx?: Tx,
): Promise<{
  template: SeriesTemplate
  occurrences: Occurrence[]
  lastDate: PlainDate
  excludedDates: PlainDate[]
}> {
  const series = await loadSeries(tenantId, seriesId, tx)
  if (series.endedFrom) throw new ConflictError('series_ended', { ended_from: series.endedFrom })
  const timezone = await tenantTimezone(tenantId)
  const excludedDates = normaliseDates([...series.excludedDates, ...(input.excludedDates ?? [])])
  const lastDate = input.lastDate > series.lastDate ? input.lastDate : series.lastDate

  // Only dates after the series' current end are new. A range that reaches back
  // over dates already covered produces nothing for them, which is what makes
  // extend safe to repeat.
  const today = localDateOf(now, timezone)
  const nextDay = addDays(series.lastDate, 1)
  const from = nextDay > today ? nextDay : today
  if (input.lastDate < from) {
    return { template: series, occurrences: [], lastDate, excludedDates }
  }
  assertWithinYear(from, input.lastDate)
  await assertTemplateRefs(tenantId, series)

  // Belt and braces: a date that already has a class of this series — however
  // it got there — never gets a second one.
  const taken = new Set(
    (
      await exec(tx)
        .select({ startsAt: classes.startsAt })
        .from(classes)
        .where(
          and(
            eq(classes.tenantId, tenantId),
            eq(classes.seriesId, seriesId),
            gte(classes.startsAt, zonedInstant(from, '00:00', timezone)),
          ),
        )
    ).map(c => localDateOf(c.startsAt, timezone)),
  )

  const occurrences = seriesOccurrences({
    ...series,
    from,
    to: input.lastDate,
    excluded: excludedDates,
    timezone,
  }).filter(o => o.startsAt > now && !taken.has(o.date))
  return { template: series, occurrences, lastDate, excludedDates }
}

// ---------------------------------------------------------------------------
// end
// ---------------------------------------------------------------------------

export interface EndSeriesResult {
  endedFrom: PlainDate
  cancelledClassIds: string[]
  /** Future classes of the series that members have booked: left running for
   *  the admin to cancel one by one with the ordinary class-cancel, which refunds. */
  bookedClasses: { classId: string; startsAt: Date; bookedCount: number }[]
}

/**
 * Stop the series from `fromDate`: nothing is created on or after it again, and
 * its classes from then on that nobody has booked are cancelled here. A class
 * with bookings is returned instead of cancelled, so no member loses a class
 * without the admin deciding it.
 *
 * Ending again with an earlier date moves the end back; ending again with the
 * same one re-lists whatever still has bookings.
 */
export async function endSeries(
  tenantId: string,
  seriesId: string,
  input: { fromDate: PlainDate; actorStaffId: string },
  now = new Date(),
): Promise<EndSeriesResult> {
  const timezone = await tenantTimezone(tenantId)
  return db.transaction(async tx => {
    const series = await loadSeries(tenantId, seriesId, tx)
    const endedFrom =
      series.endedFrom && series.endedFrom < input.fromDate ? series.endedFrom : input.fromDate
    await tx
      .update(classSeries)
      .set({ endedFrom })
      .where(and(eq(classSeries.tenantId, tenantId), eq(classSeries.id, seriesId)))

    const boundary = zonedInstant(endedFrom, '00:00', timezone)
    const cutoff = boundary > now ? boundary : now
    // Locked the way a booking locks its class (services/bookings/book.ts), so
    // a booking cannot land between the count below and the cancel.
    const future = await tx
      .select({ id: classes.id, startsAt: classes.startsAt })
      .from(classes)
      .where(
        and(
          eq(classes.tenantId, tenantId),
          eq(classes.seriesId, seriesId),
          eq(classes.lifecycle, 'active'),
          gte(classes.startsAt, cutoff),
        ),
      )
      .for('update')
    if (future.length === 0) return { endedFrom, cancelledClassIds: [], bookedClasses: [] }

    const counts = await tx
      .select({ classId: bookings.classId, cnt: sql<number>`count(*)::int` })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          inArray(
            bookings.classId,
            future.map(c => c.id),
          ),
          eq(bookings.state, 'confirmed'),
        ),
      )
      .groupBy(bookings.classId)
    const booked = new Map(counts.map(c => [c.classId, Number(c.cnt)]))

    const unbooked = future.filter(c => !booked.has(c.id)).map(c => c.id)
    // Nobody to refund or tell, so the flip is all class-cancel would do here.
    if (unbooked.length) {
      await tx
        .update(classes)
        .set({ lifecycle: 'cancelled', cancelledAt: now, cancelledByStaffId: input.actorStaffId })
        .where(and(eq(classes.tenantId, tenantId), inArray(classes.id, unbooked)))
    }
    return {
      endedFrom,
      cancelledClassIds: unbooked,
      bookedClasses: future
        .filter(c => booked.has(c.id))
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .map(c => ({ classId: c.id, startsAt: c.startsAt, bookedCount: booked.get(c.id)! })),
    }
  })
}

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

export async function getSeries(tenantId: string, seriesId: string): Promise<SeriesDetail> {
  return loadSeries(tenantId, seriesId)
}

async function loadSeries(tenantId: string, seriesId: string, tx?: Tx): Promise<SeriesDetail> {
  const query = exec(tx)
    .select()
    .from(classSeries)
    .where(and(eq(classSeries.tenantId, tenantId), eq(classSeries.id, seriesId)))
    .limit(1)
  // Inside a commit the read is also the lock (see extendSeries / endSeries).
  const [row] = tx ? await query.for('update') : await query
  if (!row) throw new NotFoundError('series_not_found')
  const supporting = await exec(tx)
    .select()
    .from(classSeriesSupportingInstructors)
    .where(
      and(
        eq(classSeriesSupportingInstructors.tenantId, tenantId),
        eq(classSeriesSupportingInstructors.seriesId, seriesId),
      ),
    )
  return {
    id: row.id,
    classTypeId: row.classTypeId,
    mainInstructorId: row.mainInstructorId,
    instructorPaySgd: row.instructorPaySgd == null ? null : Number(row.instructorPaySgd),
    supportingInstructors: supporting
      .map(s => ({ instructorId: s.instructorId, paySgd: Number(s.paySgd) }))
      .sort((a, b) => a.instructorId.localeCompare(b.instructorId)),
    locationId: row.locationId,
    roomId: row.roomId,
    weekday: row.weekday as IsoWeekday,
    // Postgres hands `time` back as HH:MM:SS; a series is minute-grained.
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5),
    capacityOnline: row.capacityOnline,
    capacityWaitlist: row.capacityWaitlist,
    capacityBuffer: row.capacityBuffer,
    creditCost: row.creditCost,
    firstDate: row.firstDate,
    lastDate: row.lastDate,
    excludedDates: [...row.excludedDates].sort(),
    endedFrom: row.endedFrom,
    createdAt: row.createdAt,
  }
}

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------

/**
 * Every occurrence, each with what would stop a class being created on it.
 *
 * ponytail: one occupancy scan per subject per date — a year of weekly classes
 * with a main and one supporting instructor is ~150 scans. Batch the window
 * query by subject if a series ever needs to be checked faster than that.
 */
async function withClashes(
  tenantId: string,
  template: SeriesTemplate,
  occurrences: Occurrence[],
  tx?: Tx,
): Promise<PreviewDate[]> {
  const instructorIds = [
    template.mainInstructorId,
    ...template.supportingInstructors.map(s => s.instructorId),
  ]
  const out: PreviewDate[] = []
  for (const o of occurrences) {
    const window = { startsAt: o.startsAt, endsAt: o.endsAt }
    const clashes: SubjectClash[] = []
    const room = await findClash(tenantId, { kind: 'room', id: template.roomId }, window, undefined, tx)
    if (room) clashes.push(room)
    for (const id of instructorIds) {
      const busy = await findClash(tenantId, { kind: 'instructor', id }, window, undefined, tx)
      if (busy) clashes.push(busy)
    }
    out.push({ ...o, clashes })
  }
  return out
}

/** The commit: check every date again, then create every class or none. */
async function createClasses(
  tx: Tx,
  tenantId: string,
  seriesId: string,
  template: SeriesTemplate,
  occurrences: Occurrence[],
  createdByStaffId: string,
): Promise<string[]> {
  const dated = await withClashes(tenantId, template, occurrences, tx)
  const clashing = dated.filter(d => d.clashes.length > 0)
  if (clashing.length > 0) {
    throw new ConflictError('series_conflict', { dates: clashing.map(previewDateJson) })
  }

  const rows = await tx
    .insert(classes)
    .values(
      occurrences.map(o => ({
        tenantId,
        seriesId,
        classTypeId: template.classTypeId,
        mainInstructorId: template.mainInstructorId,
        locationId: template.locationId,
        roomId: template.roomId,
        startsAt: o.startsAt,
        endsAt: o.endsAt,
        capacityOnline: template.capacityOnline,
        capacityWaitlist: template.capacityWaitlist,
        capacityBuffer: template.capacityBuffer,
        creditCost: template.creditCost,
        instructorPaySgd: template.instructorPaySgd?.toFixed(2) ?? null,
        createdByStaffId,
      })),
    )
    .returning({ id: classes.id })

  // Supporting instructors join each class through the roster module, like any
  // class's — its pay rule and instructor checks are the ones that apply.
  if (template.supportingInstructors.length) {
    for (const { id } of rows) {
      await replaceRoster(tx, tenantId, { kind: 'class', id }, {
        supporting: template.supportingInstructors,
      })
    }
  }
  return rows.map(r => r.id)
}

/** A preview date as the API and the `series_conflict` payload carry it. */
export function previewDateJson(d: PreviewDate) {
  return {
    date: d.date,
    starts_at: d.startsAt.toISOString(),
    ends_at: d.endsAt.toISOString(),
    clashes: d.clashes,
  }
}

function assertTemplate(t: SeriesTemplate): void {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.endTime)) {
    throw new BadRequestError('invalid_time')
  }
  // Same-day only: a class that runs past midnight is not something a weekly
  // timetable has, and allowing it would make "the date" of an occurrence ambiguous.
  if (t.endTime <= t.startTime) throw new BadRequestError('end_time_before_start_time')
  const supporting = t.supportingInstructors.map(s => s.instructorId)
  if (supporting.includes(t.mainInstructorId)) {
    throw new BadRequestError('supporting_instructor_duplicates_main')
  }
  if (new Set(supporting).size !== supporting.length) {
    throw new BadRequestError('duplicate_supporting_instructor')
  }
}

/** The room, location and class type are this studio's and in use. */
async function assertTemplateRefs(tenantId: string, t: SeriesTemplate): Promise<void> {
  await assertRoomInLocation(tenantId, t.roomId, t.locationId)
  const [type] = await db
    .select({ id: classTypes.id })
    .from(classTypes)
    .where(and(eq(classTypes.tenantId, tenantId), eq(classTypes.id, t.classTypeId)))
    .limit(1)
  if (!type) throw new NotFoundError('class_type_not_found')
}

function assertWithinYear(from: PlainDate, to: PlainDate): void {
  if (daysFrom(from, to) >= MAX_RANGE_DAYS) {
    throw new BadRequestError('series_range_too_long', { max_days: MAX_RANGE_DAYS })
  }
}

async function tenantTimezone(tenantId: string): Promise<string> {
  const tenant = await loadTenantById(tenantId)
  if (!tenant) throw new NotFoundError('tenant_not_found')
  return tenant.timezone
}

const normaliseDates = (dates: PlainDate[]) => [...new Set(dates)].sort()
