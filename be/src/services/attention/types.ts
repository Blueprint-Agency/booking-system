import type { InstructorPermission, StaffRole } from '../../db/enums'

/**
 * The panel's groups, in the order they are shown: most time-sensitive first.
 * A group is fixed here; a kind picks which one it files under.
 */
export const ATTENTION_GROUPS = [
  { key: 'classes_sessions', label: 'Classes & sessions' },
  { key: 'requests', label: 'Requests' },
  { key: 'classpass', label: 'ClassPass' },
  { key: 'payments_refunds', label: 'Payments & refunds' },
  { key: 'people_email', label: 'People & email' },
  // Pinned above the rest when present: only ReserveToday can act on it.
  { key: 'studio_account', label: 'Studio account' },
] as const

export type AttentionGroupKey = (typeof ATTENTION_GROUPS)[number]['key']

/**
 * The keys of `/summary`'s `by_group`: what the sidebar badges read, one per
 * page a badge points at. Finer than the panel's groups, because one group
 * (Requests) is several pages.
 */
export type AttentionBadgeKey = 'pt_requests' | 'corporate_requests' | 'leave' | 'check_in' | 'classpass'

/** The Attention item kinds, each the `kind` of one provider. */
export type AttentionKind =
  | 'pt_request_pending'
  | 'corporate_request_pending'
  | 'corporate_session_unmarked'
  | 'corporate_refunded_still_scheduled'
  | 'leave_request_pending'
  | 'check_in_unfinished'
  | 'waitlist_seat_free'
  | 'series_ending'
  | 'series_ended_class_kept'
  | 'classpass_review'
  | 'classpass_overbooked'
  | 'instructor_pay_missing'
  | 'part_payment_silent'
  | 'staff_invitation_expired'
  | 'staff_email_change_expired'
  | 'staff_without_email'
  | 'studio_term_ending'
  | 'payments_not_configured'

/** Who is asking, and everything a provider needs to decide what they are owed. */
export interface AttentionContext {
  tenantId: string
  staffId: string
  role: StaffRole
  /** Resolved on this request (ADR 0012): a switch an Admin turned off is already off. */
  permissions: ReadonlySet<InstructorPermission>
  /** Every active location of the studio: all staff work across all of them. */
  locations: ReadonlyArray<{ id: string; name: string }>
  /** The studio's IANA zone: every date in the copy is written in it. */
  timezone: string
  now: Date
}

export interface CountScope {
  /** Narrow a location-bound kind to one location. Studio-wide kinds ignore it. */
  locationId?: string | undefined
}

/** One row a provider lists, before the service gives it its id and its group. */
export interface ProviderItem {
  /** What the item is about: its identity is `kind` + `subjectId`. */
  subjectId: string
  location: { id: string; name: string } | null
  /** When the situation arose: items are worked oldest first. */
  occurredAt: Date
  /** The next deadline on it (a request's expiry, a leave's start), to order ties. */
  deadlineAt?: Date | null
  /** One sentence, the person or thing first. */
  title: string
  /** What to do, or the context needed to do it. */
  detail: string
  /** A portal path for the caller's role, or null where no page can act. */
  href: string | null
}

/**
 * One kind of Attention item. Adding a kind is adding one of these to
 * `registry.ts`: the service, the endpoints, the groups and the badge keys all
 * read the registry, so nothing else changes.
 */
export interface AttentionProvider {
  kind: AttentionKind
  group: AttentionGroupKey
  /** The `by_group` key this kind counts toward, if a sidebar badge shows it. */
  badge?: AttentionBadgeKey
  /** Whether an admin may dismiss an item of this kind for the whole studio. */
  dismissable: boolean
  /**
   * Dismissable kinds only: whether the item for `subjectId` is open right now
   * (its predicate holds and it is not dismissed). A dismissal of one that is
   * not is a 404.
   */
  isOpen?(ctx: AttentionContext, subjectId: string): Promise<boolean>
  /** Whether this caller is owed this kind at all (their role, their permissions). */
  appliesTo(ctx: AttentionContext): boolean
  /** A cheap SQL count of the open items this caller is owed. */
  count(ctx: AttentionContext, scope: CountScope): Promise<number>
  /** The oldest `limit` of them, with the copy already written. */
  list(ctx: AttentionContext, limit: number): Promise<ProviderItem[]>
  /** The page that lists every item of this kind, for the group's "See all". */
  seeAllHref(ctx: AttentionContext): string | null
}
