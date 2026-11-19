import { ConflictError } from '../../shared/errors'

/**
 * What still belongs to an Entity, by kind. Pure, and kept out of `entities.ts`
 * for the reason `transfer-shape.ts` is: importing that module builds a
 * database pool, and this rule is testable without one.
 */
export type EntityUsage = {
  class_types: number
  class_packages: number
  pt_packages: number
  corporate_packages: number
}

/**
 * An Entity that still holds anything cannot be archived: the packages members
 * hold through it and the classes on the schedule would be stranded. The counts
 * travel in the refusal, so the admin is told how many.
 */
export function assertEntityUnused(usage: EntityUsage): void {
  const total = usage.class_types + usage.class_packages + usage.pt_packages + usage.corporate_packages
  if (total > 0) throw new ConflictError('entity_in_use', { ...usage })
}
