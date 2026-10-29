import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as timetable from '../../services/schedule/timetable'
import { tenantId } from '../../middleware/tenant'
import { dateTime } from '../../shared/date-time'
import { seatFields } from './class-seats'
import type { BodyOf } from './parse'
import type { Surface } from './surface'

/**
 * A timetable entry on the wire: the Admin's and the Instructor's, which differ
 * in one field, the Class Series a class came from (Admin only).
 */
export function timetableEntryJson(e: timetable.ScheduleEntryRow, opts: { admin: boolean }) {
  return {
    kind: e.kind,
    id: e.id,
    workshop_id: e.workshopId,
    label: e.label,
    subtitle: e.subtitle ?? null,
    class_type_id: e.classTypeId,
    main_instructor_id: e.mainInstructorId,
    supporting_instructor_ids: e.supportingInstructorIds,
    instructor_ids: e.instructorIds,
    location_id: e.locationId,
    room_id: e.roomId,
    starts_at: e.startsAt,
    ends_at: e.endsAt,
    capacity: e.capacity,
    booked_count: e.bookedCount,
    ...seatFields(e),
    event_state: e.eventState,
    day_index: e.dayIndex,
    day_count: e.dayCount,
    ...(opts.admin ? { series_id: e.seriesId } : {}),
  }
}

const windowQuery = z.object({
  from: dateTime('A from time').optional(),
  to: dateTime('A to time').optional(),
  type: z.enum(['class', 'workshop', 'pt', 'corporate']).optional(),
})

type Window = z.infer<typeof windowQuery>
type Narrowing = Pick<Parameters<typeof timetable.listSchedule>[1], 'instructorId' | 'classTypeId' | 'locationId'>

/**
 * `GET /` — the timetable, optionally windowed by `from`/`to` and `type`. The
 * two surfaces differ in whose it is:
 *
 *   admin       the studio's, narrowed by the filters the query names.
 *   instructor  the caller's own classes and private sessions (and the
 *               workshops and corporate sessions they are assigned to),
 *               forced to the caller; the Admin's filters are not parsed.
 */
function timetableFor<Query extends Window>(spec: {
  query: BodyOf<Query>
  narrowing: (q: Query, self: string) => Narrowing
  admin: boolean
}) {
  return new Hono().get('/', zValidator('query', spec.query), async c => {
    const q = c.req.valid('query')
    const entries = await timetable.listSchedule(tenantId(c), {
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      type: q.type,
      ...spec.narrowing(q, c.get('staffUserId')),
    })
    return c.json({ entries: entries.map(e => timetableEntryJson(e, { admin: spec.admin })) })
  })
}

const surfaces: Record<Surface, Hono> = {
  admin: timetableFor({
    query: windowQuery.extend({
      instructor_id: z.string().uuid().optional(),
      class_type_id: z.string().uuid().optional(),
      location_id: z.string().uuid().optional(),
    }),
    narrowing: q => ({ instructorId: q.instructor_id, classTypeId: q.class_type_id, locationId: q.location_id }),
    admin: true,
  }),
  instructor: timetableFor({
    query: windowQuery,
    narrowing: (_q, self) => ({ instructorId: self }),
    admin: false,
  }),
}

export const timetableRoutes = (surface: Surface): Hono => surfaces[surface]
