import { slugForEntityName } from '../../../src/services/catalog/entity-rules'
import type { StudioConfig } from './config'
import { money } from './values'

type Row = Record<string, unknown>

/**
 * The studio's other Entities (`config.entities`): lines of practice it started
 * that Mindbody never knew. Each is an Entity after the first, with its Class
 * Types and the packages it sells from launch, made new and live: no member
 * holds any of them and nothing in the export is theirs. A package's Promotion
 * runs from the download to its `endsAt`, made by the owner as an admin's would
 * be in the portal.
 *
 * Ids are keyed by the Entity's link as well as the name, so a Class Type
 * called what an imported one is called (a "Pilates" Mindbody ran once, in the
 * first Entity) is a row of its own.
 */
export function mapOtherEntities(input: {
  config: StudioConfig
  tenantId: string
  id: (kind: string, key: string) => string
  ownerId: string
}): { entities: Row[]; classTypes: Row[]; classPackages: Row[]; ptPackages: Row[]; promotions: Row[] } {
  const { config, tenantId, id, ownerId } = input
  const asOf = new Date(config.asOf).toISOString()
  const out = { entities: [] as Row[], classTypes: [] as Row[], classPackages: [] as Row[], ptPackages: [] as Row[], promotions: [] as Row[] }

  config.entities.forEach((e, i) => {
    const slug = slugForEntityName(e.name)
    const entityId = id('entity', slug)
    out.entities.push({ id: entityId, tenant_id: tenantId, name: e.name, slug, position: i + 1, archived_at: null })

    for (const name of e.classTypes) {
      out.classTypes.push({
        id: id('class-type', `${slug}/${name.toLowerCase()}`),
        tenant_id: tenantId,
        name,
        entity_id: entityId,
        archived_at: null,
      })
    }

    for (const p of e.packages) {
      const common = {
        tenant_id: tenantId,
        entity_id: entityId,
        name: p.name,
        description: p.description,
        is_trial: p.trial,
        price_sgd: money(p.priceSgd),
        status: 'active',
        archived_at: null,
        deleted_at: null,
      }
      const key = `${slug}/${p.name.toLowerCase()}`
      let parent: { type: 'class_package' | 'pt_package'; id: string }
      if (p.kind === 'pt') {
        const row = {
          id: id('pt-package', key),
          ...common,
          session_type: p.sessionType,
          num_sessions: p.credits,
          instructor_bound: p.instructorBound,
          validity_days: p.validityDays,
        }
        out.ptPackages.push(row)
        parent = { type: 'pt_package', id: row.id }
      } else {
        const row = {
          id: id('class-package', key),
          ...common,
          kind: p.kind,
          credits: p.kind === 'unlimited' ? null : p.credits,
          validity_days: p.kind === 'unlimited' ? null : p.validityDays,
          duration_months: p.kind === 'unlimited' ? p.durationMonths : null,
        }
        out.classPackages.push(row)
        parent = { type: 'class_package', id: row.id }
      }

      if (p.promotion) {
        out.promotions.push({
          id: id('promotion', key),
          tenant_id: tenantId,
          parent_type: parent.type,
          parent_id: parent.id,
          label: p.promotion.label,
          kind: 'special_price',
          percent_off: null,
          special_price_sgd: money(p.promotion.specialPriceSgd),
          starts_at: asOf,
          ends_at: new Date(p.promotion.endsAt).toISOString(),
          status: 'active',
          created_by_staff_id: ownerId,
        })
      }
    }
  })
  return out
}
