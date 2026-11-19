/**
 * The pure rules of Entities (be/CONTEXT.md § Entity): names, slugs and when two
 * Entities are "the same". Kept out of `entities.ts` for the reason
 * `entities-usage.ts` is: importing that module builds a database pool, and
 * seeds, the transfer upgrade and the unit tests need these without one.
 */

/**
 * The Entity every studio starts with. A generic default, never a studio's own
 * words: the studio renames it from settings when it adds a second Entity.
 */
export const DEFAULT_ENTITY_NAME = 'All classes'

/** The longest slug an Entity may have, and the longest `?entity=` a read accepts. */
export const ENTITY_SLUG_MAX = 60

/** The URL-safe form of an Entity's name: lowercase letters and digits, joined by single hyphens. */
export function slugForEntityName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Whether two Entities match for a rule that pairs a package with a class: they
 * do when both are known and equal, and when either is missing. A row with no
 * Entity (one made before Entities, a legacy import's) restricts nothing, on
 * either side, so it keeps working as it did.
 */
export function entitiesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return a == null || b == null || a === b
}
