import { instantAt } from '../../lib/studio-time'
import { providerAccountStatus } from '../billing/provider-credentials'
import { loadTenantById } from '../tenants/tenants'
import { localDate } from '../tenants/term-dates'
import type { AttentionContext, AttentionProvider, ProviderItem } from './types'

/**
 * The studio's own account with ReserveToday. Only ReserveToday can act on
 * these, so they are Admin-only and carry no link: the detail says who to
 * contact. They expose the studio's own facts and nothing of its credentials.
 */

/** A Term this close to its end is worth a heads-up. */
const TERM_WARNING_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "25 Jun 2031", from a `YYYY-MM-DD` calendar date. */
function written(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`
}

/** A calendar date plus whole days, as a calendar date (no clock, no zone). */
function plusDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** The Term's end date when it falls within the warning window on the studio's own clock, else null. */
async function endingTermDate(ctx: AttentionContext): Promise<string | null> {
  const tenant = await loadTenantById(ctx.tenantId)
  const end = tenant?.termEndDate
  if (!end) return null
  const today = localDate(ctx.timezone, ctx.now)
  return end <= plusDays(today, TERM_WARNING_DAYS) ? end : null
}

export const studioTermEnding: AttentionProvider = {
  kind: 'studio_term_ending',
  group: 'studio_account',
  dismissable: false,
  appliesTo: ctx => ctx.role === 'admin',
  count: async ctx => ((await endingTermDate(ctx)) ? 1 : 0),
  list: async (ctx): Promise<ProviderItem[]> => {
    const end = await endingTermDate(ctx)
    if (!end) return []
    return [
      {
        subjectId: ctx.tenantId,
        location: null,
        // When the warning began: the start of the window before the end date.
        occurredAt: instantAt(ctx.timezone, plusDays(end, -TERM_WARNING_DAYS), '00:00'),
        title: `Your studio's term with ReserveToday ends on ${written(end)}`,
        detail: "After that, members and staff can't use the apps. Contact ReserveToday to renew",
        href: null,
      },
    ]
  },
  seeAllHref: () => null,
}

export const paymentsNotConfigured: AttentionProvider = {
  kind: 'payments_not_configured',
  group: 'studio_account',
  dismissable: false,
  appliesTo: ctx => ctx.role === 'admin',
  count: async ctx => ((await providerAccountStatus(ctx.tenantId)).configured ? 0 : 1),
  list: async (ctx): Promise<ProviderItem[]> => {
    if ((await providerAccountStatus(ctx.tenantId)).configured) return []
    const tenant = await loadTenantById(ctx.tenantId)
    return [
      {
        subjectId: ctx.tenantId,
        location: null,
        occurredAt: tenant?.createdAt ?? ctx.now,
        title: "Online payments aren't set up",
        detail: "Members can't buy or be refunded until ReserveToday connects your Stripe account",
        href: null,
      },
    ]
  },
  seeAllHref: () => null,
}
