/**
 * The Entity filter on the staff schedules (the Admin's Schedule and an
 * Instructor's My schedule and Full studio schedule). It narrows classes by
 * their Class Type's Entity on the server (`?entity=<id>`); workshops, private
 * sessions and corporate sessions stay in view under every Entity. The filter
 * is hidden when the studio has one Entity.
 *
 * `entity` carries an Entity id here; the member app's routes take a slug.
 */

/** An Entity as the filter offers it. */
export interface EntityChoice {
  id: string;
  name: string;
}

/** The Entities list as either portal reads it: the Admin's, or the Instructor catalog's (live ones only). */
interface EntitiesResponse {
  entities: ({ id: string; name: string; archived_at?: string | null } & Record<string, unknown>)[];
}

/** Where each portal reads the studio's Entities: an Instructor never calls an admin route. */
export const ENTITIES_PATH = {
  admin: "/portal/admin/entities",
  instructor: "/portal/instructor/catalog/entities",
} as const;

/** The studio's live Entities, in order, as the filter's choices; none when the read gave none. */
export function scheduleEntities(res: EntitiesResponse | null): EntityChoice[] {
  return (res?.entities ?? []).filter((e) => !e.archived_at).map((e) => ({ id: e.id, name: e.name }));
}

/** The filter is shown only where there is a choice to make. */
export function showEntityFilter(entities: readonly EntityChoice[]): boolean {
  return entities.length >= 2;
}

export function entityFilterOptions(entities: readonly EntityChoice[]): { val: string; label: string }[] {
  return [{ val: "all", label: "All" }, ...entities.map((e) => ({ val: e.id, label: e.name }))];
}

/**
 * The `entity` the read sends for a pick ("all" or an Entity id): the id only
 * while the pill is shown and offers it, so a pick can never narrow a read
 * through a filter nobody can see or undo.
 */
export function entityFilterQuery(picked: string, entities: readonly EntityChoice[]): string | undefined {
  if (!showEntityFilter(entities)) return undefined;
  return entities.some((e) => e.id === picked) ? picked : undefined;
}
