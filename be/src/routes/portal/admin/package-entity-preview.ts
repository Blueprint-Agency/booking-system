import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { previewMove, type MovableKind } from '../../../services/packages/entity-move'
import { tenantId } from '../../../middleware/tenant'
import { movePreviewQuery } from '../../entity-fields'

const idParam = z.object({ id: z.string().uuid() })

/**
 * `GET /:id/entity-preview?entity_id=`: how many members hold this package,
 * before it is moved to another Entity. A read: the move itself is the PATCH,
 * and cancels nothing. The same answer for each kind of package, so the form
 * asks one way; for a corporate package it is always none (a company buys one
 * and no member holds it). Mounted before `/:id`, which would otherwise take it.
 */
export const packageEntityPreview = (kind: MovableKind, explain: Parameters<typeof zValidator>[2]) =>
  new Hono().get('/:id/entity-preview', zValidator('param', idParam), zValidator('query', movePreviewQuery, explain), async c => {
    const { id } = c.req.valid('param')
    const { entity_id } = c.req.valid('query')
    return c.json(await previewMove(tenantId(c), kind, id, entity_id))
  })
