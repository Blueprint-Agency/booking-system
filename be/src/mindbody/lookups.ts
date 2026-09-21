import type { StudioConfig } from './config'
import { normaliseClassName } from './values'

/**
 * What the config calls the things a report names: Rooms, Locations, Class
 * Types, off-site venues, workshop categories and PT appointments.
 *
 * Built once and read by both halves of the timetable — what is still to come
 * (`./schedule.ts`) and what already happened (`./history.ts`) — because a Room
 * spelling means the same thing on either side of the download, and two copies
 * of these maps would be two chances to disagree.
 */

/** Collapse runs of space and fold case: how a Room, Location or category name is matched. */
export const fold = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

export type ConfigLookups = {
  /** By every spelling, folded. */
  rooms: Map<string, { id: string; location: string; capacity: number }>
  /** Room spellings that are really an off-site venue, so a class there needs no Room. */
  offSite: Set<string>
  /** Location spelling → its config key. */
  locations: Map<string, string>
  /** Class name, normalised → the Class Type it is. */
  types: Map<string, { id: string; capacity: number | null }>
  /** Mindbody service categories left to the workshop import. */
  workshopCategories: Set<string>
  /** Class names that are really a PT appointment. */
  ptNames: Set<string>
}

export function configLookups(config: StudioConfig, id: (kind: string, key: string) => string): ConfigLookups {
  const rooms = new Map<string, { id: string; location: string; capacity: number }>()
  for (const r of config.rooms) {
    const room = {
      id: id('room', `${r.location}/${r.name.trim().toLowerCase()}`),
      location: r.location,
      capacity: r.capacity,
    }
    for (const spelling of [r.name, ...r.mindbodyNames]) rooms.set(fold(spelling), room)
  }
  const locations = new Map<string, string>()
  for (const l of config.locations) for (const s of [l.name, ...l.mindbodyNames]) locations.set(fold(s), l.key)
  const types = new Map<string, { id: string; capacity: number | null }>()
  for (const t of config.classTypes) {
    const type = { id: id('class-type', t.name.trim().toLowerCase()), capacity: t.capacity }
    for (const s of [t.name, ...t.mindbodyNames]) types.set(normaliseClassName(s), type)
  }
  return {
    rooms,
    offSite: new Set(config.offSiteVenues.map(fold)),
    locations,
    types,
    workshopCategories: new Set(config.workshopCategories.map(fold)),
    ptNames: new Set(config.ptAppointmentNames.map(normaliseClassName)),
  }
}
