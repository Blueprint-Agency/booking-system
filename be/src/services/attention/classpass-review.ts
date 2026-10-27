import { and, asc, count, eq } from 'drizzle-orm'
import { db } from '../../db'
import { classes, classpassInboundEmails, classpassLocationMappings } from '../../db/schema'
import type { ClassPassReviewReason } from '../../db/enums'
import { normaliseClassPassLocation } from '../classpass/location-name'
import { isOpen } from '../classpass/review-items'
import { formatAge, formatWhen } from './format'
import type { AttentionContext, AttentionProvider, ProviderItem } from './types'

/**
 * A ClassPass email the import could not place. It is exactly the ClassPass
 * page's open review list (`isOpen`: outcome `review` or `unparsed`, no
 * `resolved_at`), so it goes when an Admin books it, dismisses it or maps its
 * location (which closes it, or changes its reason, when the import re-runs).
 * Admins only; a review item is about the studio, not a location.
 */
type Row = typeof classpassInboundEmails.$inferSelect

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** The title for one open item, one sentence per reason. */
function titleFor(ctx: AttentionContext, r: Row, matching: number | null): string {
  const reason: ClassPassReviewReason | null = r.reviewReason
  const member = r.memberName ?? 'a member'
  const when = r.startsAt ? ` for ${formatWhen(r.startsAt, ctx.timezone)}` : ''
  switch (reason) {
    case 'unmapped_location':
      return r.locationName
        ? `ClassPass location "${r.locationName}" isn't linked to one of your locations`
        : "A ClassPass location isn't linked to one of your locations"
    case 'no_class':
      return `No class matches ${member}'s ClassPass booking${when}`
    case 'ambiguous_class':
      return matching !== null && matching > 1
        ? `${matching} ${plural(matching, 'class', 'classes')} match ${member}'s ClassPass booking${when}`
        : `Several classes match ${member}'s ClassPass booking${when}`
    case 'class_cancelled':
      return `${member} booked a cancelled class through ClassPass`
    case 'client_deleted':
      return `A ClassPass booking came in for ${member}, who was deleted`
    case 'already_booked':
      return `${member} is already booked on ${r.className ?? 'that class'}, but ClassPass sent another booking`
    case 'import_off':
      return `A ClassPass ${r.kind === 'cancellation' ? 'cancellation' : 'booking'} for ${member} arrived while the import was off`
    case 'import_error':
      return `${member === 'a member' ? 'A' : `${member}'s`} ClassPass booking couldn't be imported`
    case 'unparsed':
    default:
      return "A ClassPass email couldn't be read"
  }
}

/** For each ambiguous item, how many active classes sit at the Location and start it names. */
async function matchingClasses(tenantId: string, rows: Row[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ambiguous = rows.filter(r => r.reviewReason === 'ambiguous_class' && r.startsAt && r.locationName)
  if (ambiguous.length === 0) return out
  const mappings = await db
    .select({ name: classpassLocationMappings.locationName, locationId: classpassLocationMappings.locationId })
    .from(classpassLocationMappings)
    .where(eq(classpassLocationMappings.tenantId, tenantId))
  const locationOf = new Map(mappings.map(m => [m.name, m.locationId]))
  for (const r of ambiguous) {
    const locationId = locationOf.get(normaliseClassPassLocation(r.locationName!))
    if (!locationId) continue
    const [found] = await db
      .select({ n: count() })
      .from(classes)
      .where(
        and(
          eq(classes.tenantId, tenantId),
          eq(classes.locationId, locationId),
          eq(classes.startsAt, r.startsAt!),
          eq(classes.lifecycle, 'active'),
        ),
      )
    out.set(r.id, Number(found?.n ?? 0))
  }
  return out
}

export const classpassReview: AttentionProvider = {
  kind: 'classpass_review',
  group: 'classpass',
  badge: 'classpass',
  dismissable: false,
  appliesTo: ctx => ctx.role === 'admin',
  count: async ctx => {
    const [row] = await db
      .select({ n: count() })
      .from(classpassInboundEmails)
      .where(and(eq(classpassInboundEmails.tenantId, ctx.tenantId), isOpen))
    return Number(row?.n ?? 0)
  },
  list: async (ctx, limit) => {
    const rows = await db
      .select()
      .from(classpassInboundEmails)
      .where(and(eq(classpassInboundEmails.tenantId, ctx.tenantId), isOpen))
      .orderBy(asc(classpassInboundEmails.receivedAt), asc(classpassInboundEmails.id))
      .limit(limit)
    const matching = await matchingClasses(ctx.tenantId, rows)
    return rows.map(
      (r): ProviderItem => ({
        subjectId: r.id,
        location: null,
        occurredAt: r.receivedAt,
        title: titleFor(ctx, r, matching.get(r.id) ?? null),
        detail: `Received ${formatAge(r.receivedAt, ctx.now)} · book, map or dismiss it`,
        href: `/admin/classpass?review=${r.id}`,
      }),
    )
  },
  seeAllHref: () => '/admin/classpass',
  seeAllLabel: 'ClassPass',
}
