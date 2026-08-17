/**
 * The Money Event — one thing that moved money, or that owes money, on the day
 * it happened. See be/CONTEXT.md §Money and be/docs/adr/0002-finance-replaces-payroll.md.
 *
 * Deliberately ONE flat shape rather than a union per kind. Finance's whole job
 * is to total across kinds and hand the same rows to a table and a CSV; a union
 * would be narrowed back to this shape at every one of those points.
 *
 * Money is `numeric(10,2)` — Postgres hands it over as a string, and it stays a
 * string until `summarizeFinance` turns it into cents. Nothing here parses.
 */

/**
 * Money in. Every one of these carries a List Price and an amount paid.
 *
 * `merch` is a Merch Order — paid online, collected in person. It takes no Promo
 * Code and has no catalogue price frozen on it, so its List Price is what was
 * paid and its discount is always zero, same as `corporate`.
 */
export const MONEY_IN_KINDS = [
  'purchase',
  'addon',
  'workshop_ticket',
  'corporate',
  'merch',
] as const

export type MoneyEventKind =
  | (typeof MONEY_IN_KINDS)[number]
  /** A Refund: the whole purchase back, carried as a negative `paidSgd`. */
  | 'refund'
  /** Instructor Pay for one session — class, PT or workshop. */
  | 'instructor_pay'
  /** A Manual Entry: money owed an instructor that no session accounts for. */
  | 'manual'

/**
 * What kind of thing this transaction was, in the studio's own words — the
 * column an owner scans down. Distinct from `kind`, which is a plumbing
 * distinction (which table the row came from, whether it is editable); two
 * kinds can share a type (`workshop_ticket` sold and `instructor_pay` for
 * teaching it are both a Workshop) and one kind splits into several types (a
 * `purchase` is a Credit, an Unlimited, a Trial or a PT Package).
 *
 * Carried on the event, never inferred downstream: only the query that read the
 * row knows which package kind it was.
 */
export const MONEY_EVENT_TYPES = [
  'credit',
  'unlimited',
  'trial',
  'pt_package',
  'addon',
  'workshop',
  'corporate',
  'merch',
  'refund',
  'class',
  'pt_session',
  'manual',
] as const

/** A list rather than a union so the route's filter enum is the same twelve. */
export type MoneyEventType = (typeof MONEY_EVENT_TYPES)[number]

const MONEY_IN: ReadonlySet<string> = new Set(MONEY_IN_KINDS)

export const isMoneyIn = (kind: MoneyEventKind): boolean => MONEY_IN.has(kind)

/** Instructor Pay and Manual Entries are the only rows an admin may edit. */
export const isEditable = (kind: MoneyEventKind): boolean =>
  kind === 'instructor_pay' || kind === 'manual'

export interface MoneyEvent {
  kind: MoneyEventKind
  type: MoneyEventType
  /**
   * The source row's id. NOT unique across a result set on its own — a session
   * with two instructors yields two `instructor_pay` events sharing one id, and
   * a Refund shares its purchase's id. `(kind, id, instructorId)` is the key.
   */
  id: string
  /** The date this belongs to: payment date, refund date, session date, entry date. */
  occurredAt: Date
  /**
   * Which one of the type — "Bundle of 10", "Vinyasa Flow", the merch item's
   * title. Null where the type is the whole story (a Refund, a Corporate
   * package, an Add-On).
   */
  variant: string | null
  /**
   * The person on the other side of the money: the member who paid on a
   * money-in row. Null on money-out rows, where `instructorName` is the person
   * — the two are kept apart because only one of them is payable.
   */
  party: string | null

  /** Null means **Unattributed** — see CONTEXT.md. Not "unknown"; "not recorded". */
  locationId: string | null
  locationName: string | null

  // ---- money in -----------------------------------------------------------
  /** List Price frozen at purchase. Null on every money-out kind. */
  listPriceSgd: string | null
  /** What was actually taken. Negative on a Refund. Null on every money-out kind. */
  paidSgd: string | null
  /** The Promo Code the member typed, if any. Never the Promotion — that applies itself. */
  promoCode: string | null
  /** True on a purchase that has since been refunded. The row stays; it is tagged. */
  refunded: boolean

  // ---- money out ----------------------------------------------------------
  instructorId: string | null
  instructorName: string | null
  /**
   * Instructor Pay. Null on a session means **Unpriced** — pay not decided yet,
   * NOT pay of zero. Excluded from every total and counted separately.
   */
  paySgd: string | null

  /**
   * Which table this pay row lives in, so a pay edit can be routed back to it.
   * Finance flattens class, PT and workshop pay into one `instructor_pay` kind
   * for display; the write needs them apart again. Carried rather than inferred
   * from the row's other fields, because every inference from those is a guess
   * that goes wrong on the first session that doesn't fit the pattern.
   */
  payKind: 'class' | 'pt' | 'workshop' | 'manual' | null

  /** For a session row: its class type, so the class-type filter can bite. */
  classTypeId: string | null
  /** Set only where the row has a meaningful span (a session). */
  endsAt: Date | null
  sessionType: '1on1' | '2on1' | null
}
