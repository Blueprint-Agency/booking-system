import { count, min, sql } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { memberWithoutEmail } from '../clients/manage'
import { formatDay } from './format'
import type { AttentionContext, AttentionProvider, ProviderItem } from './types'

/**
 * Two ways email stops reaching someone. Both admin-only, filed under People &
 * email, and neither can be dismissed: each clears by itself once it is fixed.
 */
const adminOnly = (ctx: AttentionContext) => ctx.role === 'admin'

/**
 * Every member on a placeholder address, as one line: they are a backlog to
 * work through on Customers, not a task each.
 */
export const membersWithoutEmail: AttentionProvider = {
  kind: 'members_without_email',
  group: 'people_email',
  dismissable: false,
  appliesTo: adminOnly,
  count: async ctx => {
    const [row] = await db.select({ n: count() }).from(clients).where(memberWithoutEmail(ctx.tenantId))
    return row && row.n > 0 ? 1 : 0
  },
  list: async ctx => {
    const [row] = await db
      .select({ n: count(), since: min(clients.joinedAt) })
      .from(clients)
      .where(memberWithoutEmail(ctx.tenantId))
    if (!row || row.n === 0) return []
    return [
      {
        subjectId: 'members',
        location: null,
        occurredAt: row.since ?? ctx.now,
        title: row.n === 1 ? '1 member has no email address' : `${row.n} members have no email address`,
        detail: "They can't sign in or get receipts",
        href: '/admin/customers?filter=no_email',
      } satisfies ProviderItem,
    ]
  },
  seeAllHref: () => '/admin/customers?filter=no_email',
}

/** How far back an outcome still counts. */
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000

type BouncingRow = {
  user_id: string
  kind: 'client' | 'staff'
  name: string
  address: string
  status: 'bounced' | 'complained' | 'suppressed'
  at: Date | string
}

/**
 * One row per recipient whose latest outcome inside the window is a bad one.
 * Outcomes are only those Resend's webhook filed (`outcome_at`), only mail sent
 * to the person's current address counts (so a changed address starts clean),
 * and mail logged with no recipient id (sent before an account existed) has no
 * one to point at.
 */
async function bouncing(ctx: AttentionContext): Promise<BouncingRow[]> {
  const since = new Date(ctx.now.getTime() - WINDOW_MS)
  const rows = await db.execute<BouncingRow>(sql`
    with people as (
      select 'client'::email_recipient_kind as kind, id, name, email
        from clients
       where tenant_id = ${ctx.tenantId} and deleted_at is null
      union all
      select 'staff'::email_recipient_kind, id, name, email
        from staff_users
       where tenant_id = ${ctx.tenantId} and status <> 'archived'
    ),
    latest as (
      select distinct on (l.recipient_user_kind, l.recipient_user_id)
             p.id as user_id, p.kind, p.name, p.email as address, l.status, l.outcome_at as at
        from email_log l
        join people p
          on p.kind = l.recipient_user_kind
         and p.id = l.recipient_user_id
         and lower(btrim(p.email)) = lower(btrim(l.recipient_email))
       where l.tenant_id = ${ctx.tenantId}
         and l.status in ('delivered', 'bounced', 'complained', 'suppressed')
         and l.outcome_at > ${since.toISOString()}::timestamptz
         and l.outcome_at <= ${ctx.now.toISOString()}::timestamptz
       order by l.recipient_user_kind, l.recipient_user_id, l.outcome_at desc, l.id
    )
    select * from latest where status <> 'delivered' order by at, user_id
  `)
  return [...rows]
}

const WORDING = {
  bounced: 'bounced',
  complained: 'marked our email as spam',
  suppressed: 'is blocked',
} as const

export const emailBouncing: AttentionProvider = {
  kind: 'email_bouncing',
  group: 'people_email',
  dismissable: false,
  appliesTo: adminOnly,
  count: async ctx => (await bouncing(ctx)).length,
  list: async (ctx, limit) =>
    (await bouncing(ctx)).slice(0, limit).map((r): ProviderItem => {
      const at = new Date(r.at)
      return {
        subjectId: r.user_id,
        location: null,
        occurredAt: at,
        title: `Emails to ${r.name} aren't being delivered`,
        detail: `${r.address} ${WORDING[r.status]} on ${formatDay(at, ctx.timezone)}. Check the address with them`,
        href: r.kind === 'client' ? `/admin/customers/${r.user_id}` : `/admin/staff?staff=${r.user_id}`,
      }
    }),
  // Members and staff live on different pages, so no one page lists them all.
  seeAllHref: () => null,
}
