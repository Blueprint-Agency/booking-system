/**
 * Entities, as the member app reads them: what a studio sells packages under
 * (Yoga, Pilates), from `GET /public/entities` in the studio's order.
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

/**
 * A live Entity, as the public read lists it, and as a class names its own
 * (`entity` on a class card and detail, which carries no `has_live_packages`).
 * Absent from a backend that predates Entities, and null on a class whose Class
 * Type has none, so every reader treats a class's as optional.
 */
export interface PublicEntity {
  id: string;
  name: string;
  slug: string;
  /**
   * Whether a package is on sale in it. Optional: a backend that has not yet
   * been redeployed does not send it, and then every Entity counts as having
   * some. The schedule's buttons ignore it; the Packages menu reads it.
   */
  has_live_packages?: boolean;
}

export const SCHEDULE_ENTITY_KEY = "rt.client.schedule-entity";

// ── Packages ─────────────────────────────────────────────────────────────────
// The Packages menu and the page per Entity (`/packages/<slug>`): only the
// Entities with something on sale are offered, in the studio's order.

/** The Entities a member can buy from: those with a package on sale, in the order given. */
export function packageEntities(entities: readonly PublicEntity[]): PublicEntity[] {
  return entities.filter((e) => e.has_live_packages !== false);
}

/**
 * The Packages dropdown (and the phone's switcher) appears only for two or more
 * Entities with live packages. A studio with one sees exactly the one Packages
 * page it always had, and an Entity with nothing on sale is left out.
 */
export function showEntityDropdown(entities: readonly PublicEntity[]): boolean {
  return packageEntities(entities).length >= 2;
}

/**
 * The Entity a Packages page opens on: the one `slug` names (in any casing, as
 * the backend compares) while it is live and has packages, otherwise the first.
 * That covers an unknown slug, an archived Entity's, one with nothing on sale,
 * and no slug at all (`/packages`). Undefined only when nothing is on sale.
 */
export function resolveEntity(
  slug: string | null | undefined,
  entities: readonly PublicEntity[],
): PublicEntity | undefined {
  const offered = packageEntities(entities);
  const wanted = slug?.trim().toLowerCase();
  return (wanted ? offered.find((e) => e.slug.toLowerCase() === wanted) : undefined) ?? offered[0];
}

/**
 * Where an Entity's packages are: `/packages/<slug>`, or `/packages` for none.
 * `hash` (without the `#`) picks a tab on the page: `trial`, `private`, ….
 */
export function packagesHref(entity?: { slug: string } | string | null, hash?: string): string {
  const slug = typeof entity === "string" ? entity : entity?.slug;
  const path = slug ? `/packages/${encodeURIComponent(slug)}` : "/packages";
  return hash ? `${path}#${hash}` : path;
}

/** The Entity slug in a Packages path (`/packages/pilates`), or undefined for `/packages` and other pages. */
export function entitySlugInPath(pathname: string): string | undefined {
  const match = /^\/packages\/([^/]+)\/?$/.exec(pathname);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1];
  }
}

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
