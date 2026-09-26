import { z } from 'zod'
import * as seriesSvc from '../../services/schedule/series'
import { cancelWindowHoursSchema } from './class-cancel-window'

/**
 * A Class Series on the wire, shared by the admin and instructor schedule
 * routes (be/CONTEXT.md § Class Series). Both create a series by preview then
 * commit of one body; they differ only in who the instructors are and what they
 * are paid, which the admin sends and the instructor route fills in itself.
 * Shape only: what a series does is `services/schedule/series`.
 */

export const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM')

/** Everything a series body carries except its instructors and their pay. */
export const seriesTemplateFields = z.object({
  class_type_id: z.string().uuid(),
  location_id: z.string().uuid(),
  room_id: z.string().uuid(),
  weekday: z.number().int().min(1).max(7),
  start_time: localTime,
  end_time: localTime,
  capacity_online: z.number().int().min(0),
  capacity_waitlist: z.number().int().min(0).default(0),
  capacity_buffer: z.number().int().min(0).default(0),
  credit_cost: z.number().int().min(0),
  // Copied onto every class the series creates; blank = the studio's window.
  cancel_window_hours: cancelWindowHoursSchema.optional(),
  first_date: plainDate,
  last_date: plainDate,
  excluded_dates: z.array(plainDate).default([]),
})

/** `.refine(hasCapacity, NO_CAPACITY)`: a series must seat someone. */
export const hasCapacity = (v: { capacity_online: number; capacity_waitlist: number; capacity_buffer: number }) =>
  v.capacity_online + v.capacity_waitlist + v.capacity_buffer > 0
export const NO_CAPACITY = { message: 'capacity must be positive', path: ['capacity_online'] }

type TemplateBody = z.infer<typeof seriesTemplateFields>
type SeriesStaffing = Pick<
  seriesSvc.CreateSeriesInput,
  'mainInstructorId' | 'instructorPaySgd' | 'supportingInstructors'
>

/** A parsed series body plus who teaches it, as the service takes it. */
export function toSeriesInput(b: TemplateBody, staffing: SeriesStaffing): seriesSvc.CreateSeriesInput {
  return {
    ...staffing,
    classTypeId: b.class_type_id,
    locationId: b.location_id,
    roomId: b.room_id,
    weekday: b.weekday as seriesSvc.SeriesTemplate['weekday'],
    startTime: b.start_time,
    endTime: b.end_time,
    capacityOnline: b.capacity_online,
    capacityWaitlist: b.capacity_waitlist,
    capacityBuffer: b.capacity_buffer,
    creditCost: b.credit_cost,
    cancelWindowHours: b.cancel_window_hours ?? null,
    firstDate: b.first_date,
    lastDate: b.last_date,
    excludedDates: b.excluded_dates,
  }
}

export function seriesRow(s: seriesSvc.SeriesDetail) {
  return {
    id: s.id,
    class_type_id: s.classTypeId,
    main_instructor_id: s.mainInstructorId,
    instructor_pay_sgd: s.instructorPaySgd,
    supporting_instructors: s.supportingInstructors.map(i => ({
      instructor_id: i.instructorId,
      pay_sgd: i.paySgd,
    })),
    location_id: s.locationId,
    room_id: s.roomId,
    weekday: s.weekday,
    start_time: s.startTime,
    end_time: s.endTime,
    capacity_online: s.capacityOnline,
    capacity_waitlist: s.capacityWaitlist,
    capacity_buffer: s.capacityBuffer,
    credit_cost: s.creditCost,
    cancel_window_hours: s.cancelWindowHours,
    first_date: s.firstDate,
    last_date: s.lastDate,
    excluded_dates: s.excludedDates,
    ended_from: s.endedFrom,
    created_at: s.createdAt.toISOString(),
  }
}

export const previewJson = (dates: seriesSvc.PreviewDate[]) => ({
  dates: dates.map(seriesSvc.previewDateJson),
  clash_count: dates.filter(d => d.clashes.length > 0).length,
})
