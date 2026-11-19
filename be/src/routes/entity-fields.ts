import { z } from 'zod'
import { explainInvalid } from './explain-invalid'
import { ENTITY_SLUG_MAX } from '../services/catalog/entity-rules'

/** `?entity=<slug>` on a package read. Left out or blank, every Entity's packages are returned. */
export const entityQuery = z.object({
  entity: z.string().trim().max(ENTITY_SLUG_MAX, `An Entity slug is at most ${ENTITY_SLUG_MAX} characters.`).optional(),
})
export const explainEntityQuery = explainInvalid('That Entity is not valid.')

/**
 * The Entity a body or query field names, on a Class Type or a package: it only
 * has to be an id here. The service refuses another studio's and an archived one.
 */
const ENTITY_ID_MESSAGE = 'Pick an entity from the studio’s list.'
export const entityIdField = z.string({ message: ENTITY_ID_MESSAGE }).uuid(ENTITY_ID_MESSAGE)

/** What a move-preview endpoint takes: the Entity the Class Type or package would move to. */
export const movePreviewQuery = z.object({ entity_id: entityIdField })
