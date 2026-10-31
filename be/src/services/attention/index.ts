import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import type { InstructorPermission, StaffRole } from '../../db/enums'
import { locations } from '../../db/schema/catalog'
import { now as clockNow } from '../../lib/clock'
import { tenantTimezone } from '../tenants/tenants'
import { providers } from './registry'
import { listUpdates, unreadUpdateCount, type UpdateView } from './updates'
import {
  ATTENTION_GROUPS,
  type AttentionBadgeKey,
  type AttentionContext,
  type AttentionGroupKey,
  type AttentionProvider,
  type ProviderItem,
} from './types'

/** The signed-in staff member, as the route hands them over. */
export interface AttentionCaller {
  tenantId: string
  staffId: string
  role: StaffRole
  permissions: ReadonlySet<InstructorPermission>
}

const DEFAULT_LIMIT_PER_GROUP = 5

export async function contextFor(caller: AttentionCaller): Promise<AttentionContext> {
  const [timezone, active] = await Promise.all([
    tenantTimezone(caller.tenantId),
    db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(
        and(eq(locations.tenantId, caller.tenantId), isNull(locations.deletedAt), isNull(locations.archivedAt)),
      )
      .orderBy(asc(locations.name)),
  ])
  return { ...caller, locations: active, timezone, now: clockNow() }
}

export interface AttentionSummary {
  needs_action: number
  unread_updates: number
  total: number
  by_group: Partial<Record<AttentionBadgeKey, number>>
}

/**
 * The bubble and the sidebar badges: a handful of indexed counts.
 *
 * `needs_action` and `total` cover every location the caller can reach, so the
 * bubble does not change when they switch workspace. `by_group` is narrowed to
 * `locationId` for location-bound kinds, so a badge matches the page it points
 * at, which shows one workspace.
 */
export async function attentionSummary(caller: AttentionCaller, locationId?: string): Promise<AttentionSummary> {
  const ctx = await contextFor(caller)
  const mine = providers.filter(p => p.appliesTo(ctx))
  const byGroup: Partial<Record<AttentionBadgeKey, number>> = {}
  let needsAction = 0
  await Promise.all(
    mine.map(async p => {
      const all = await p.count(ctx, {})
      needsAction += all
      if (!p.badge) return
      const scoped = locationId ? await p.count(ctx, { locationId }) : all
      byGroup[p.badge] = (byGroup[p.badge] ?? 0) + scoped
    }),
  )
  const unreadUpdates = await unreadUpdateCount(caller)
  return { needs_action: needsAction, unread_updates: unreadUpdates, total: needsAction + unreadUpdates, by_group: byGroup }
}

const byOldestThenSoonest = (a: ProviderItem, b: ProviderItem) =>
  a.occurredAt.getTime() - b.occurredAt.getTime() ||
  (a.deadlineAt?.getTime() ?? Infinity) - (b.deadlineAt?.getTime() ?? Infinity)

export interface AttentionItemView {
  id: string
  kind: string
  title: string
  detail: string
  href: string | null
  location: { id: string; name: string } | null
  occurred_at: string
  dismissable: boolean
}

/** A "See all {count}" link to one page that lists items the panel cut short. */
export interface SeeAllView {
  href: string
  label: string
  count: number
}

export interface AttentionGroupView {
  key: AttentionGroupKey
  label: string
  count: number
  /** The one page that lists the group, when one kind makes it up; null when several do. */
  see_all_href: string | null
  /** Per page: the kinds whose items the panel cut short, summed by the page they link to. */
  see_all: SeeAllView[]
  items: AttentionItemView[]
}

/**
 * For each page the group's kinds link to, how many items are open there, when
 * the panel shows fewer of them than that. Kinds that share a page (the three
 * corporate ones) are one link.
 */
function seeAllLinks(
  ctx: AttentionContext,
  inGroup: ReadonlyArray<{ provider: AttentionProvider; count: number }>,
  shown: ReadonlyMap<string, number>,
): SeeAllView[] {
  const pages = new Map<string, SeeAllView & { shown: number }>()
  for (const { provider, count } of inGroup) {
    const href = provider.seeAllHref(ctx)
    if (!href) continue
    const page = pages.get(href) ?? { href, label: provider.seeAllLabel ?? '', count: 0, shown: 0 }
    page.count += count
    page.shown += shown.get(provider.kind) ?? 0
    pages.set(href, page)
  }
  return [...pages.values()]
    .filter(p => p.count > p.shown)
    .map(({ href, label, count }) => ({ href, label, count }))
}

/** The panel's Needs action tab: the groups that have something, most urgent first. */
export async function attentionPanel(
  caller: AttentionCaller,
  opts: { limitPerGroup?: number; updatesBefore?: string } = {},
): Promise<{
  needs_action: { groups: AttentionGroupView[] }
  updates: { items: UpdateView[]; next_cursor: string | null }
}> {
  const limit = opts.limitPerGroup ?? DEFAULT_LIMIT_PER_GROUP
  const ctx = await contextFor(caller)
  const mine = providers.filter(p => p.appliesTo(ctx))

  const counted = await Promise.all(
    mine.map(async p => ({ provider: p, count: await p.count(ctx, {}) })),
  )
  const open = counted.filter(c => c.count > 0)

  const groups: AttentionGroupView[] = []
  for (const group of ATTENTION_GROUPS) {
    const inGroup = open.filter(c => c.provider.group === group.key)
    if (inGroup.length === 0) continue
    const rows = await Promise.all(
      inGroup.map(async ({ provider }) => (await provider.list(ctx, limit)).map(item => ({ provider, item }))),
    )
    const shownRows = rows
      .flat()
      .sort((a, b) => byOldestThenSoonest(a.item, b.item))
      .slice(0, limit)
    const items = shownRows.map(({ provider, item }) => view(provider, item))
    groups.push({
      key: group.key,
      label: group.label,
      count: inGroup.reduce((n, c) => n + c.count, 0),
      // One page lists a group's items only when one kind makes up the group.
      see_all_href: inGroup.length === 1 ? inGroup[0]!.provider.seeAllHref(ctx) : null,
      see_all: seeAllLinks(
        ctx,
        inGroup,
        new Map(
          inGroup.map(({ provider }) => [
            provider.kind,
            shownRows.filter(r => r.provider.kind === provider.kind).length,
          ]),
        ),
      ),
      items,
    })
  }
  // The studio's account is the one thing only ReserveToday can act on, so it leads.
  groups.sort((a, b) => Number(b.key === 'studio_account') - Number(a.key === 'studio_account'))

  return { needs_action: { groups }, updates: await listUpdates(caller, { before: opts.updatesBefore }) }
}

function view(provider: AttentionProvider, item: ProviderItem): AttentionItemView {
  return {
    id: `${provider.kind}:${item.subjectId}`,
    kind: provider.kind,
    title: item.title,
    detail: item.detail,
    href: item.href,
    location: item.location,
    occurred_at: item.occurredAt.toISOString(),
    dismissable: provider.dismissable,
  }
}
