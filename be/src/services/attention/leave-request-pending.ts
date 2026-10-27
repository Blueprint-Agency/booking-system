import { daysBetween, sgToday } from '../../lib/time'
import { countPendingLeaveForDecision, listPendingLeaveForDecision, type PendingLeaveForDecision } from '../leave/pending'
import type { AttentionContext, AttentionProvider, ProviderItem } from './types'

/**
 * A leave request waiting for a decision. Admins are owed every one but their
 * own (unless they are the studio's only active admin): see
 * `listPendingLeaveForDecision`. It resolves when the request is approved,
 * rejected or withdrawn, because it stops being `pending`.
 */
const LEAVE_PAGE = '/admin/leave'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "18 Aug", with the year only when it is not this one. */
function day(date: string, thisYear: string): string {
  const year = date.slice(0, 4)
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}${year === thisYear ? '' : ` ${year}`}`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function toItem(ctx: AttentionContext, r: PendingLeaveForDecision): ProviderItem {
  const today = sgToday(ctx.now)
  const thisYear = today.slice(0, 4)
  const range =
    r.startDate === r.endDate
      ? day(r.startDate, thisYear)
      : `${day(r.startDate, thisYear)} to ${day(r.endDate, thisYear)}`
  const half = r.halfDay === 'none' ? '' : ` (${r.halfDay})`

  const untilStart = daysBetween(today, r.startDate)
  const timing =
    untilStart > 0
      ? `starts in ${plural(untilStart, 'day')}`
      : untilStart === 0
        ? 'starts today'
        : `started ${plural(-untilStart, 'day')} ago`
  const flag = !r.flag
    ? null
    : r.flag.kind === 'study_cap'
      ? 'over the study cap'
      : `clashes with ${r.flag.withName}'s leave`

  return {
    subjectId: r.id,
    location: null,
    occurredAt: r.createdAt,
    deadlineAt: new Date(`${r.startDate}T00:00:00+08:00`),
    title: `${r.applicantName} asked for ${r.type} leave, ${range}${half}`,
    detail: [plural(r.days, 'day'), timing, flag].filter(Boolean).join(' · '),
    href: `${LEAVE_PAGE}?request=${r.id}`,
  }
}

export const leaveRequestPending: AttentionProvider = {
  kind: 'leave_request_pending',
  group: 'requests',
  badge: 'leave',
  dismissable: false,
  appliesTo: ctx => ctx.role === 'admin',
  count: ctx => countPendingLeaveForDecision(ctx.tenantId, ctx.staffId),
  list: async (ctx, limit) => (await listPendingLeaveForDecision(ctx.tenantId, ctx.staffId, limit)).map(r => toItem(ctx, r)),
  seeAllHref: () => LEAVE_PAGE,
  seeAllLabel: 'Leave',
}
