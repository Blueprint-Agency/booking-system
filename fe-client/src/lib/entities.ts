/**
 * Entities, as the member app reads them: the lines of practice a studio sells
 * for (Yoga, Pilates), from `GET /public/entities` in the studio's order.
 *
 * Pure rules and the remembered pick live here, with no `@/` imports so
 * `node --test` can load them; the read itself is `public-entities.ts`.
 *
 * The schedule's Entity buttons (fe-client-features §3.1): shown only when the
 * studio has two or more, never with an "All", opened on the member's last pick
 * and on the studio's first Entity before there is one. The pick is kept in this
 * hostname's `localStorage` (one hostname is one studio, so it cannot cross
 * studios), and is only ever a slug checked against the live list: a pick that
 * is no longer in it falls back to the first.
 */

/** A live Entity, as the public read lists it. */
export interface PublicEntity {
  id: string;
  name: string;
  slug: string;
}

export const SCHEDULE_ENTITY_KEY = "rt.client.schedule-entity";

/** The buttons appear only for two or more Entities; a one-Entity studio's schedule is unchanged. */
export function showEntityButtons(entities: readonly PublicEntity[]): boolean {
  return entities.length >= 2;
}

/**
 * The slug the schedule is on: the remembered one while it is still a live
 * Entity (compared in any casing, as the backend does), otherwise the first.
 * Null only for a studio with no Entity to choose from.
 */
export function pickScheduleEntity({
  entities,
  stored,
}: {
  entities: readonly PublicEntity[];
  stored: string | null;
}): string | null {
  const wanted = stored?.trim().toLowerCase();
  const remembered = wanted ? entities.find((e) => e.slug.toLowerCase() === wanted) : undefined;
  return (remembered ?? entities[0])?.slug ?? null;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Storage blocked (a locked-down browser profile): the pick lasts for the
    // life of the page, and the next visit opens on the first Entity.
    return null;
  }
}

/** The member's last pick on this hostname, or null: none yet, or storage unavailable. */
export function readRememberedEntity(): string | null {
  try {
    return storage()?.getItem(SCHEDULE_ENTITY_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Keep `slug` as the member's pick. Storage that refuses is not an error: the page works without it. */
export function rememberEntity(slug: string): void {
  try {
    storage()?.setItem(SCHEDULE_ENTITY_KEY, slug);
  } catch {
    // Full, or blocked after the read succeeded: nothing to do.
  }
}
