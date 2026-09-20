import type { StudioConfigInput } from './config'
import type { MindbodyReports } from './mapper'
import type { ScheduledClassRow } from './readers'
import { dayNumber, isoClock, isoWeekday, normaliseClassName, normaliseOptionName, normaliseStaffName, type CalendarDate } from './values'

/**
 * What the timetable implies about a studio, proposed for a person to correct:
 * its Rooms and class names (one entry per spelling, to be merged and given a
 * capacity), which service categories are workshops and which of those are
 * still to come (with the room types they were sold by), what the roster calls
 * a PT appointment, and which classes are weekly.
 *
 * With `asOf`, only the timetable from four weeks before it onwards is read —
 * what the studio runs now, not every class it has ever held.
 */

/** A workshop, a retreat or a course has a service category of its own, and says so. */
const WORKSHOP = /workshop|retreat|training|course/i
const PT = /\bpt\b|personal training/i
const WEEKS = 4

type Proposal = Required<
  Pick<StudioConfigInput, 'rooms' | 'classTypes' | 'workshopCategories' | 'workshops' | 'ptAppointmentNames' | 'series'>
>

/** The spelling used most; between equals the first alphabetically, so report order never decides. */
function commonest(spellings: string[]): string {
  const counts = new Map<string, number>()
  for (const s of spellings) counts.set(s, (counts.get(s) ?? 0) + 1)
  return [...counts].sort(([a, n], [b, m]) => m - n || a.localeCompare(b))[0]![0]
}

export function proposeSchedule(reports: MindbodyReports, asOf: CalendarDate | null): Proposal {
  const today = asOf ? dayNumber(asOf) : null
  const recent = reports.schedule.filter(r => today === null || dayNumber(r.date) > today - WEEKS * 7)
  const workshopCategories = [...new Set(recent.map(r => r.serviceCategory).filter(c => WORKSHOP.test(c)))].sort()
  const classes = recent.filter(r => !WORKSHOP.test(r.serviceCategory))

  const rooms = [...new Set(classes.map(r => r.room).filter(Boolean))]
    .sort()
    .map(room => ({ name: room, location: null, capacity: null, mindbodyNames: [room] }))

  const byName = new Map<string, string[]>()
  for (const r of classes) {
    const key = normaliseClassName(r.description)
    byName.set(key, [...(byName.get(key) ?? []), r.description])
  }
  const classTypes = [...byName.keys()].sort().map(key => ({
    name: commonest(byName.get(key)!),
    mindbodyNames: [...new Set(byName.get(key)!)].sort(),
    capacity: null,
  }))

  // One entry per category with something still to come: a workshop that has
  // already run has no days to import, and is not worth a decision.
  const fold = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const toCome = new Set(
    reports.schedule.filter(r => today === null || dayNumber(r.date) >= today).map(r => fold(r.serviceCategory)),
  )
  const workshops: Proposal['workshops'] = workshopCategories
    .filter(category => toCome.has(fold(category)))
    .map(category => {
      // The room types it was sold by: the pricing options filed under its own
      // service category. A deposit or a top-up sold separately is one of these
      // too, and is moved into the tier it buys by hand.
      const options = reports.holdings.filter(h => fold(h.serviceCategory) === fold(category))
      const keys = [...new Set(options.map(h => normaliseOptionName(h.option)))].sort()
      return {
        category,
        // What Mindbody calls the category is the workshop's own name in it.
        name: category,
        location: null,
        capacity: null,
        migrate: null,
        tiers: keys.map(key => {
          const spellings = options.filter(h => normaliseOptionName(h.option) === key).map(h => h.option)
          return { name: commonest(spellings), mindbodyNames: [...new Set(spellings)].sort(), priceSgd: null }
        }),
      }
    })

  const ptAppointmentNames = [...new Set(reports.roster.map(r => r.description).filter(d => PT.test(d)))].sort()

  // Weekly: the same weekday, time, Room and name in each of the four weeks
  // that ended on the day of the download.
  const series: Proposal['series'] = []
  if (today !== null) {
    const phoneBook = new Map(reports.phoneBook.map(p => [normaliseStaffName(p.name), p.name]))
    const slots = new Map<string, ScheduledClassRow[]>()
    for (const r of classes) {
      const age = today - dayNumber(r.date)
      if (age < 0 || age >= WEEKS * 7 || !r.room) continue
      const slot = [isoWeekday(r.date), isoClock(r.start), isoClock(r.end)]
      const key = [...slot, r.room.toLowerCase(), normaliseClassName(r.description)].join('|')
      slots.set(key, [...(slots.get(key) ?? []), r])
    }
    for (const key of [...slots.keys()].sort()) {
      const rows = slots.get(key)!
      const weeks = new Set(rows.map(r => Math.floor((today - dayNumber(r.date)) / 7)))
      if (weeks.size < WEEKS) continue
      const teacher = commonest(rows.map(r => r.staff))
      series.push({
        className: commonest(rows.map(r => r.description)),
        weekday: isoWeekday(rows[0]!.date),
        startTime: isoClock(rows[0]!.start),
        endTime: isoClock(rows[0]!.end),
        room: commonest(rows.map(r => r.room)),
        teacher: phoneBook.get(normaliseStaffName(teacher)) ?? teacher,
        migrate: null,
      })
    }
  }

  return { rooms, classTypes, workshopCategories, workshops, ptAppointmentNames, series }
}
