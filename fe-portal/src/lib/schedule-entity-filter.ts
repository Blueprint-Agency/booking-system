import { ALL_ENTITIES, showEntityFilter } from "./entities";

/**
 * The Entity filter on the staff schedules (the Admin's Schedule and an
 * Instructor's My schedule and Full studio schedule). It narrows classes by
 * their Class Type's Entity on the server (`?entity=<id>`); workshops, private
 * sessions and corporate sessions stay in view under every Entity. The filter
 * is hidden when the studio has one Entity (`showEntityFilter`). The Entities
 * come from `useEntities`.
 *
 * `entity` carries an Entity id here; the member app's routes take a slug.
 */

/** The filter's choices: All, then each Entity in the order given. */
export function entityFilterOptions(entities: readonly { id: string; name: string }[]): { val: string; label: string }[] {
  return [{ val: ALL_ENTITIES, label: "All" }, ...entities.map((e) => ({ val: e.id, label: e.name }))];
}

/**
 * The `entity` the read sends for a pick (ALL_ENTITIES or an Entity id): the id
 * only while the pill is shown and offers it, so a pick can never narrow a read
 * through a filter nobody can see or undo.
 */
export function entityFilterQuery(picked: string, entities: readonly { id: string; name: string }[]): string | undefined {
  if (!showEntityFilter(entities)) return undefined;
  return entities.some((e) => e.id === picked) ? picked : undefined;
}
