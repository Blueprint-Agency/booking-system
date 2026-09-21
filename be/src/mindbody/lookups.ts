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

type Room = { id: string; location: string; capacity: number }

export type ConfigLookups = {
  /**
   * By every spelling, folded. Where Rooms share a spelling, this is the one
   * that takes every class `roomsByType` does not place elsewhere.
   */
  rooms: Map<string, Room>
  /** A shared spelling → Class Type id → the Room that Class Type is held in under it (`rooms[].classTypes`). */
  roomsByType: Map<string, Map<string, Room>>
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
  const types = new Map<string, { id: string; capacity: number | null }>()
  for (const t of config.classTypes) {
    const type = { id: id('class-type', t.name.trim().toLowerCase()), capacity: t.capacity }
    for (const s of [t.name, ...t.mindbodyNames]) types.set(normaliseClassName(s), type)
  }

  const holders = new Map<string, number>()
  for (const r of config.rooms) {
    for (const s of new Set([r.name, ...r.mindbodyNames].map(fold))) holders.set(s, (holders.get(s) ?? 0) + 1)
  }
  const rooms = new Map<string, Room>()
  const roomsByType = new Map<string, Map<string, Room>>()
  for (const r of config.rooms) {
    const room = {
      id: id('room', `${r.location}/${r.name.trim().toLowerCase()}`),
      location: r.location,
      capacity: r.capacity,
    }
    const split = (r.classTypes ?? []).flatMap(n => types.get(normaliseClassName(n))?.id ?? [])
    for (const spelling of new Set([r.name, ...r.mindbodyNames].map(fold))) {
      // A spelling only this Room uses is this Room, whatever is held there.
      if (split.length === 0 || holders.get(spelling) === 1) rooms.set(spelling, room)
      if (split.length > 0) {
        const byType = roomsByType.get(spelling) ?? new Map<string, Room>()
        for (const typeId of split) byType.set(typeId, room)
        roomsByType.set(spelling, byType)
      }
    }
  }
  const locations = new Map<string, string>()
  for (const l of config.locations) for (const s of [l.name, ...l.mindbodyNames]) locations.set(fold(s), l.key)
  return {
    rooms,
    roomsByType,
    offSite: new Set(config.offSiteVenues.map(fold)),
    locations,
    types,
    workshopCategories: new Set(config.workshopCategories.map(fold)),
    ptNames: new Set(config.ptAppointmentNames.map(normaliseClassName)),
  }
}

/** The Room a report's room spelling means for a class of this Class Type. */
export function roomFor(lookups: ConfigLookups, spelling: string, typeId: string | null | undefined): Room | undefined {
  const key = fold(spelling)
  return (typeId ? lookups.roomsByType.get(key)?.get(typeId) : undefined) ?? lookups.rooms.get(key)
}
