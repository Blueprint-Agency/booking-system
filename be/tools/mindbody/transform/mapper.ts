import { buildEmailTemplates } from '../../../src/db/seed/email-copy'
import { parseOriginPatterns, tenantOriginFor } from '../../../src/lib/origin'
import { joinName, splitName } from '../../../src/lib/name'
import { ARCHIVE_VERSION, type TenantArchive } from '../../../src/services/tenants/transfer-shape'
import type { StudioConfig } from './config'
import { idsFor, secretToken } from './ids'
import { mapHistory, type MappedHistory } from './history'
import { configLookups } from './lookups'
import { mapPackages, type AccountBalance, type NotMigrated } from './packages'
import type {
  AccountBalanceRow,
  AttendanceRow,
  AutopayRow,
  CancellationRow,
  GroupCancellationRow,
  HoldingRow,
  MemberListRow,
  OptionSaleRow,
  PayRateRow,
  PayrollRow,
  PhoneBookRow,
  PromotionRow,
  ReferralRow,
  RetentionRow,
  RosterRow,
  SaleRow,
  ScheduledClassRow,
} from './readers'
import { bookingCoder } from './booking-codes'
import { joinSales } from './sales'
import { mapSchedule } from './schedule'
import { normaliseClassName, normaliseStaffName, zonedToInstant, type LocalDateTime } from './values'
import { mapWorkshops, workshopOptionKeys } from './workshops'

/**
 * Report rows plus the studio config in, archive rows out. Pure: no clock, no
 * randomness, no database — the same inputs give byte-for-byte the same rows,
 * which is what makes a rehearsal comparable with launch day.
 *
 * The rows are written in the archive format the super portal already imports
 * (`services/tenants/transfer.ts`), for the Tenant the archive is headed for:
 * `manifest.tenant.id` is that Tenant, so the importer keeps these ids as they
 * are. Nobody's sign-in account is in here — accounts are platform rows — so
 * the manifest asks the importer to ensure them (`ensureAccounts`).
 */

export type MindbodyReports = {
  members: MemberListRow[]
  referrals: ReferralRow[]
  retention: RetentionRow[]
  phoneBook: PhoneBookRow[]
  /** What every client holds of every pricing option. */
  holdings: HoldingRow[]
  /** Every pricing option sold: what each purchase became (activation, expiry, what is left), by name and phone. */
  optionSales: OptionSaleRow[]
  /** Every sale line and return, by client id: the studio's takings (`./sales.ts`). */
  sales: SaleRow[]
  /** What a promotion took off each sale, by sale number. Empty where the report was not downloaded. */
  promotions: PromotionRow[]
  /** Money on account, either way. Empty where the report was not downloaded. */
  balances: AccountBalanceRow[]
  /** The timetable, past and to come, empty classes included. */
  schedule: ScheduledClassRow[]
  /** Who is booked into what. Reaches past the download only where it was run over future dates. */
  roster: RosterRow[]
  payRates: PayRateRow[]
  /** Every past visit and how it ended. Empty where the report was not downloaded, or no history is wanted. */
  attendance: AttendanceRow[]
  /** What each teacher was actually paid, per past class. Empty where the report was not downloaded. */
  payroll: PayrollRow[]
  /** When each booking was cancelled and by whom (Cancellations, Individual records). Empty where not downloaded. */
  cancellations: CancellationRow[]
  /** The classes the studio called off, a line per member on each (Cancellations, Group cancellations). Empty where not downloaded. */
  groupCancellations: GroupCancellationRow[]
  /** The autopays still to run (Autopay Detail): none is imported. Empty where not downloaded. */
  autopay: AutopayRow[]
}

export type Preflight = {
  /** Live in Mindbody and not a package here: mat storage, a workshop place, a lone access pass. */
  notMigrated: NotMigrated[]
  /** Money on account. The platform keeps no such balance. */
  balances: AccountBalance[]
  /**
   * The timetable: a booking with no class or no package, a class over
   * capacity, a series with nothing to continue, a workshop with no days left,
   * and — where history came across — everything about the past that could not
   * be placed.
   */
  schedule: string[]
  /** Active staff with no email: imported by name, with no login. */
  staffWithoutLogin: { name: string; placeholder: string }[]
  /** Members with no usable email: imported under a placeholder, fixed later by an admin. */
  noEmail: { id: string; name: string; placeholder: string }[]
  /** Emails more than one member holds: one keeps it, the others get placeholders. */
  sharedEmails: {
    email: string
    keeper: { id: string; name: string }
    others: { id: string; name: string; placeholder: string }[]
  }[]
  /** Autopays still live in Mindbody. The platform charges none of them: each is stopped there and re-signed here. */
  autopays: LiveAutopay[]
}

/** Mindbody key → platform id, per table: how any imported row is traced back to its source. */
export type IdMapping = Record<string, Record<string, string>>

export type Transformed = { archive: TenantArchive; ids: IdMapping; preflight: Preflight }

/**
 * Where a placeholder email lives. `.invalid` is reserved (RFC 2606): nothing
 * is ever delivered there, so a set-password link cannot reach a stranger.
 */
const PLACEHOLDER_DOMAIN = 'no-email.invalid'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

type Row = Record<string, unknown>

/** A studio importing no history: the shape, with nothing in it. */
const noHistory = (): MappedHistory => ({
  classes: [],
  bookings: [],
  checkIns: [],
  cancellations: [],
  ptRequests: [],
  ptSessions: [],
  ptSessionClients: [],
  clientPackages: [],
  purchases: [],
  instructors: [],
  notes: [],
})

export function mapStudio(reports: MindbodyReports, config: StudioConfig, tenantId: string): Transformed {
  const id = idsFor(tenantId)
  const ids: IdMapping = { locations: {}, rooms: {}, class_types: {}, clients: {}, staff_users: {} }
  const asOf = new Date(config.asOf)
  const slug = config.studio.slug
  const tz = config.studio.timezone
  const instant = (local: LocalDateTime) => zonedToInstant(local, tz).toISOString()
  const placeholder = (kind: string, key: string) =>
    `${kind}-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.${slug}@${PLACEHOLDER_DOMAIN}`

  /* ── The studio shell ──────────────────────────────────────────────────── */

  const locations: Row[] = config.locations.map(l => {
    const row = { id: id('location', l.key), tenant_id: tenantId, name: l.name, address: l.address, phone: l.phone }
    ids.locations![l.key] = row.id
    return row
  })

  const rooms: Row[] = config.rooms.map(r => {
    const row = {
      id: id('room', `${r.location}/${r.name.trim().toLowerCase()}`),
      tenant_id: tenantId,
      location_id: ids.locations![r.location],
      name: r.name,
      capacity: r.capacity,
    }
    for (const spelling of [r.name, ...r.mindbodyNames]) ids.rooms![spelling] = row.id
    return row
  })

  const classTypes: Row[] = config.classTypes.map(t => {
    const row = { id: id('class-type', t.name.trim().toLowerCase()), tenant_id: tenantId, name: t.name }
    for (const name of [t.name, ...t.mindbodyNames]) ids.class_types![name] = row.id
    return row
  })

  const globalPolicy: Row[] = [
    {
      id: id('policy', 'global'),
      tenant_id: tenantId,
      cancel_cap_count: config.policy.cancelCapCount,
      cancel_cap_cycle_days: config.policy.cancelCapCycleDays,
      class_window_hours: config.policy.classWindowHours,
      pt_window_hours: config.policy.ptWindowHours,
    },
  ]
  const ptBookingConfig: Row[] = [
    { id: id('policy', 'pt'), tenant_id: tenantId, book_in_advance_days: config.policy.ptBookInAdvanceDays },
  ]

  // The same copy a studio provisioned in the super portal gets, pointing at
  // this studio's own hostnames in the environment the archive is for.
  const patterns = parseOriginPatterns(config.originPatterns)
  const clientUrl = tenantOriginFor('client', slug, patterns)
  const portalUrl = tenantOriginFor('portal', slug, patterns)
  if (!clientUrl || !portalUrl) {
    throw new Error(`originPatterns "${config.originPatterns}" has no ${clientUrl ? 'portal' : 'client'} wildcard`)
  }
  const emailTemplates: Row[] = buildEmailTemplates({
    clientUrl,
    portalUrl,
    studio: { name: config.studio.displayName, footer: config.studio.emailFooter ?? undefined },
  }).map(t => ({
    id: id('email-template', t.slug),
    tenant_id: tenantId,
    slug: t.slug,
    subject: t.subject,
    body_html: t.bodyHtml,
  }))

  const tenantSettings: Row[] = [
    {
      tenant_id: tenantId,
      display_name: config.studio.displayName,
      // Mindbody holds no branding, so none is said: the importer keeps the
      // logo, theme, copy and mail-from the super portal gave the Tenant.
      mail_from_name: null,
      mail_reply_to: config.studio.mailReplyTo,
      copy: null,
      theme: null,
    },
  ]

  /* ── Members ───────────────────────────────────────────────────────────── */

  // One profile per barcode, said by name here rather than by a duplicate
  // primary key halfway through the import.
  const seen = new Set<string>()
  for (const m of reports.members) {
    if (seen.has(m.id)) throw new Error(`the member list has client ${m.id} twice`)
    seen.add(m.id)
  }

  const created = new Map(reports.referrals.map(r => [r.id, r.createdAt]))
  const retention = new Map(reports.retention.map(r => [r.id, r]))
  const memberName = (m: MemberListRow) => joinName(m.firstName, m.lastName) || `Member ${m.id}`

  // Who holds which address. Case is already folded by the reader.
  const holders = new Map<string, MemberListRow[]>()
  for (const m of reports.members) {
    if (m.email) holders.set(m.email, [...(holders.get(m.email) ?? []), m])
  }

  const preflight: Preflight = { noEmail: [], sharedEmails: [], notMigrated: [], balances: [], schedule: [], staffWithoutLogin: [], autopays: liveAutopays(reports.autopay) }
  const emailOf = new Map<string, string>()
  for (const m of reports.members) {
    if (!m.email) {
      const email = placeholder('member', m.id)
      emailOf.set(m.id, email)
      preflight.noEmail.push({ id: m.id, name: memberName(m), placeholder: email })
    }
  }
  for (const [email, group] of [...holders].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.length === 1) {
      emailOf.set(group[0]!.id, email)
      continue
    }
    const keeper = keeperOf(email, group, config.sharedEmailKeepers[email], retention, created)
    emailOf.set(keeper.id, email)
    const others = group
      .filter(m => m !== keeper)
      .map(m => {
        const stand = placeholder('member', m.id)
        emailOf.set(m.id, stand)
        return { id: m.id, name: memberName(m), placeholder: stand }
      })
    preflight.sharedEmails.push({ email, keeper: { id: keeper.id, name: memberName(keeper) }, others })
  }

  const clients: Row[] = reports.members.map(m => {
    const joined = created.get(m.id) ?? retention.get(m.id)?.memberSince ?? null
    const row = {
      id: id('client', m.id),
      tenant_id: tenantId,
      // Filled by the importer from the client pool, by email (`ensureAccounts`).
      auth_user_id: null,
      email: emailOf.get(m.id),
      name: memberName(m),
      phone: m.phone,
      gender: retention.get(m.id)?.gender ?? null,
      status: 'active',
      joined_at: joined ? instant(joined) : asOf.toISOString(),
    }
    ids.clients![m.id] = row.id
    return row
  })

  /* ── Staff ─────────────────────────────────────────────────────────────── */

  const phoneBook = new Map(reports.phoneBook.map(p => [normaliseStaffName(p.name), p]))
  const owner = config.studio.ownerEmail.trim().toLowerCase()
  // The owner and every listed admin run the portal from the first minute.
  const admins = new Set([owner, ...config.studio.admins.map(a => a.email.trim().toLowerCase())])
  const staffUsers: Row[] = []
  const instructors: Row[] = []
  const invitations: Row[] = []
  const staffIds = new Map<string, string>()
  let ownerId: string | null = null
  const seatedAdmins = new Set<string>()

  for (const s of config.staff) {
    if (s.migrate === 'skip') continue
    const key = normaliseStaffName(s.mindbodyName)
    const listed = phoneBook.get(key)
    const name = listed?.name ?? s.mindbodyName.trim()
    const { firstName, lastName } = splitName(name)
    const staffId = id('staff', key)
    const archived = s.migrate === 'archived'
    const real = archived || (s.migrate === 'active' && s.noLogin) ? '' : (s.email?.trim().toLowerCase() ?? '')
    // No email, no login: they come across by name so their classes and pay
    // name them, under an address nobody receives, and nobody can sign in as them.
    const loginless = !archived && !real
    const email = real || placeholder('staff', key)
    const isAdmin = !archived && !loginless && admins.has(email)
    if (isAdmin) seatedAdmins.add(email)
    const role = isAdmin ? 'admin' : (s.role ?? 'instructor')
    // Onboarded now: active, no invitation, signing in by setting a password.
    const onboarded = isAdmin || (!archived && !loginless && config.staffOnboarding === 'active')
    const pending = !archived && !loginless && !onboarded
    if (loginless) preflight.staffWithoutLogin.push({ name, placeholder: email })

    staffUsers.push({
      id: staffId,
      tenant_id: tenantId,
      auth_user_id: null,
      email,
      name: joinName(firstName, lastName),
      first_name: firstName,
      last_name: lastName,
      role,
      // The owner, the admins and — with `staffOnboarding: 'active'` — everyone
      // with an email run the studio from the first minute; otherwise they
      // arrive by invitation, sent or resent by an admin when the studio decides.
      status: archived ? 'archived' : pending ? 'pending' : 'active',
      granted_location_ids: [],
      phone: listed?.phone || null,
      invited_at: pending ? asOf.toISOString() : null,
      archived_at: archived ? asOf.toISOString() : null,
    })
    ids.staff_users![s.mindbodyName] = staffId
    staffIds.set(key, staffId)
    if (isAdmin && email === owner) ownerId = staffId

    if (s.teaches || role === 'instructor') instructors.push({ staff_user_id: staffId, tenant_id: tenantId })

    if (pending) {
      invitations.push({
        id: id('staff-invitation', key),
        tenant_id: tenantId,
        email,
        role,
        granted_location_ids: [],
        token: secretToken(config.secret, `staff-invitation:${tenantId}:${key}`),
        expires_at: new Date(asOf.getTime() + INVITE_TTL_MS).toISOString(),
        status: 'pending',
        invited_by_staff_id: null,
        staff_user_id: staffId,
        created_at: asOf.toISOString(),
      })
    }
  }

  // Admins Mindbody never listed as staff — an owner who never taught, whoever
  // runs the migration: a staff row each, active, with no invitation to send.
  for (const email of admins) {
    if (seatedAdmins.has(email)) continue
    const listedName = config.studio.admins.find(a => a.email.trim().toLowerCase() === email)?.name?.trim()
    const { firstName, lastName } = splitName(listedName || email.split('@')[0]!)
    const staffId = id('staff', `admin:${email}`)
    staffUsers.push({
      id: staffId,
      tenant_id: tenantId,
      auth_user_id: null,
      email,
      name: joinName(firstName, lastName),
      first_name: firstName,
      last_name: lastName,
      role: 'admin',
      status: 'active',
      granted_location_ids: [],
      phone: null,
      invited_at: null,
      archived_at: null,
    })
    ids.staff_users![email] = staffId
    if (email === owner) ownerId = staffId
  }

  /* ── The catalogue, and what members still hold of it (`./packages.ts`) ─── */

  const memberNames = new Map(reports.members.map(m => [m.id, memberName(m)]))
  // The pricing options that buy a place on a workshop: a booking, never a package.
  const workshopOptions = workshopOptionKeys(config)
  // Every sale, joined to the register row it created and the return that
  // reversed it: the live packages leave a refunded purchase out, and history
  // rebuilds the past from it.
  const sales = joinSales({ sales: reports.sales, optionSales: reports.optionSales, promotions: reports.promotions, members: reports.members })
  const packages = mapPackages({
    holdings: reports.holdings,
    balances: reports.balances,
    config,
    tenantId,
    id,
    ids,
    memberNames,
    workshopOptions,
    optionSales: reports.optionSales,
    members: reports.members,
    sales,
  })
  preflight.notMigrated = packages.notMigrated
  preflight.balances = packages.balances

  /* ── The timetable to come, and who is booked on it (`./schedule.ts`) ───── */

  // `validateConfig` has already refused a config whose owner is not among the staff.
  if (!ownerId) throw new Error('the owner is not among the staff coming across')
  // One coder for the whole archive: a booking reference is unique within a
  // studio, and a class seat, a workshop place and a visit years ago all share
  // that one namespace.
  const codes = bookingCoder(config.secret, tenantId)
  const instructorIds = new Set(instructors.map(i => i.staff_user_id as string))
  const lookups = configLookups(config, id)

  // The Class Type a PT appointment's focus is. Made at most once, whichever of
  // the timetable and the history first needs it, so two PT imports are never
  // two Class Types of one name.
  const ptTypeKey = normaliseClassName(config.ptClassType)
  const ptClassTypes: Row[] = []
  let ptTypeId = lookups.types.get(ptTypeKey)?.id ?? null
  const ensurePtType = () => {
    if (!ptTypeId) {
      ptTypeId = id('class-type', ptTypeKey)
      ptClassTypes.push({ id: ptTypeId, tenant_id: tenantId, name: config.ptClassType })
      ids.class_types![config.ptClassType] = ptTypeId
    }
    return ptTypeId
  }

  const schedule = mapSchedule({
    schedule: reports.schedule,
    roster: reports.roster,
    payRates: reports.payRates,
    config,
    tenantId,
    id,
    ids,
    memberNames,
    staffIds,
    instructorIds,
    ownerId,
    clientPackages: packages.clientPackages,
    codes,
    lookups,
    ensurePtType,
  })

  /* ── Credits set aside for bookings that did not come across ─────────────── */

  // A package's balance is Mindbody's *Unbooked*: its credits less those already
  // set aside for future bookings, because each of those bookings arrives here
  // having spent its credit. A booking that does not arrive — the roster was not
  // downloaded far enough ahead, or its class did not come across — would take
  // its credit with it. So, per member and Family, whatever Mindbody set aside
  // beyond the bookings that did arrive is given back to the package it came from.
  const restored = restoreBookedAhead(packages, schedule.bookings)
  if (restored.credits > 0) {
    const rosterEnd = reports.roster.reduce<string | null>((last, r) => {
      const day = `${r.date.year}-${String(r.date.month).padStart(2, '0')}-${String(r.date.day).padStart(2, '0')}`
      return last === null || day > last ? day : last
    }, null)
    const asOfDay = config.asOf.slice(0, 10)
    schedule.notes.push(
      `packages: ${restored.credits} credit(s) on ${restored.packages} package(s) that Mindbody had set aside for future bookings which did not come across were given back` +
        (rosterEnd === null || rosterEnd <= asOfDay
          ? ` — Schedule at a Glance ends ${rosterEnd ?? '(not downloaded)'}, not after the download (${asOfDay}): download it into the future so those bookings come across`
          : ''),
    )
  }
  schedule.notes.push(...packages.notes)

  /* ── Workshops and retreats to come, and who has paid (`./workshops.ts`) ── */

  const workshops = mapWorkshops({
    schedule: reports.schedule,
    holdings: reports.holdings,
    config,
    tenantId,
    id,
    ids,
    memberNames,
    staffIds,
    instructorIds,
    ownerId,
    codes,
  })
  /* ── The studio's past, if the config asks for it (`./history.ts`) ─────── */

  const history = config.history
    ? mapHistory({
        history: config.history,
        schedule: reports.schedule,
        roster: reports.roster,
        attendance: reports.attendance,
        payroll: reports.payroll,
        cancellations: reports.cancellations,
        groupCancellations: reports.groupCancellations,
        sales,
        config,
        tenantId,
        id,
        ids,
        memberNames,
        staffIds,
        instructorIds,
        ownerId,
        lookups,
        ensurePtType,
        clientPackages: packages.clientPackages,
        packageRuns: packages.runs,
        workshopOptions,
        codes,
      })
    : noHistory()

  preflight.schedule = [...schedule.notes, ...workshops.notes, ...history.notes]

  /* ── The archive ───────────────────────────────────────────────────────── */

  // One profile per staff member, however many things they lead: the timetable
  // and the workshops each name whoever was not an instructor already.
  const extraInstructors = new Map<string, Row>()
  for (const i of [...schedule.instructors, ...workshops.instructors, ...history.instructors]) {
    extraInstructors.set(i.staff_user_id as string, i)
  }

  // Parents first, as an export writes them — the importer orders by the
  // schema, but a person reading the zip reads it in this order.
  const rows: Record<string, Row[]> = {
    locations,
    rooms,
    class_types: [...classTypes, ...ptClassTypes],
    staff_users: staffUsers,
    instructors: [...instructors, ...extraInstructors.values()],
    staff_invitations: invitations,
    clients,
    // Provider-less, and only a past sale that was returned: the Refund hangs from it.
    purchases: history.purchases,
    class_packages: packages.classPackages,
    pt_packages: packages.ptPackages,
    client_packages: [...packages.clientPackages, ...history.clientPackages],
    class_series: schedule.classSeries,
    classes: [...history.classes, ...schedule.classes],
    pt_requests: [...history.ptRequests, ...schedule.ptRequests],
    pt_sessions: [...history.ptSessions, ...schedule.ptSessions],
    pt_session_clients: [...history.ptSessionClients, ...schedule.ptSessionClients],
    workshops: workshops.workshops,
    workshop_days: workshops.workshopDays,
    workshop_tiers: workshops.workshopTiers,
    workshop_tier_days: workshops.workshopTierDays,
    workshop_instructors: workshops.workshopInstructors,
    bookings: [...history.bookings, ...schedule.bookings, ...workshops.bookings],
    // After `bookings`, which they point at. The importer sorts the tables it
    // writes by the schema's own foreign keys, so this order is for a person
    // reading the zip; it costs nothing to have it read the way it must be written.
    check_ins: history.checkIns,
    cancellations: history.cancellations,
    global_policy: globalPolicy,
    pt_booking_config: ptBookingConfig,
    email_templates: emailTemplates,
    tenant_settings: tenantSettings,
  }
  const tables = Object.keys(rows)

  return {
    archive: {
      manifest: {
        version: ARCHIVE_VERSION,
        exportedAt: asOf.toISOString(),
        tenant: { id: tenantId, slug, name: config.studio.displayName, timezone: tz },
        tables,
        deferred: {},
        counts: Object.fromEntries(tables.map(t => [t, rows[t]!.length])),
        ensureAccounts: true,
      },
      rows,
    },
    ids,
    preflight,
  }
}

/**
 * Give back the credits Mindbody set aside for future bookings that no imported
 * booking spends. Per member and Family, because a seat is paid by whichever
 * package runs, not necessarily the one Mindbody set the credit aside on.
 */
function restoreBookedAhead(
  packages: { clientPackages: Row[]; bookedAhead: Map<string, number> },
  bookings: Row[],
): { credits: number; packages: number } {
  const family = (kind: unknown) => (kind === 'pt' ? 'pt' : 'class')
  const spent = new Map<string, number>()
  const byId = new Map(packages.clientPackages.map(p => [String(p.id), p]))
  for (const b of bookings) {
    if (!b.client_package_id || Number(b.credits_or_sessions_used) < 1) continue
    const pkg = byId.get(String(b.client_package_id))
    if (!pkg) continue
    const key = `${pkg.client_id}/${family(pkg.kind)}`
    spent.set(key, (spent.get(key) ?? 0) + 1)
  }
  let credits = 0
  const touched = new Set<string>()
  for (const p of packages.clientPackages) {
    const aside = packages.bookedAhead.get(String(p.id))
    if (!aside || p.credits_or_sessions_remaining === null) continue
    const key = `${p.client_id}/${family(p.kind)}`
    const accounted = Math.min(aside, spent.get(key) ?? 0)
    spent.set(key, (spent.get(key) ?? 0) - accounted)
    const back = aside - accounted
    if (back > 0) {
      p.credits_or_sessions_remaining = Number(p.credits_or_sessions_remaining) + back
      credits += back
      touched.add(String(p.id))
    }
  }
  return { credits, packages: touched.size }
}

/**
 * Who keeps an email several members share.
 *
 * The config decides where it names someone. Otherwise the member with the most
 * recent visit keeps it — the one most likely to be the person reading that
 * inbox — then the most recently created profile, then the lowest id, so the
 * answer never depends on report order.
 */
function keeperOf(
  email: string,
  group: MemberListRow[],
  named: string | undefined,
  retention: Map<string, RetentionRow>,
  created: Map<string, LocalDateTime>,
): MemberListRow {
  if (named) {
    const chosen = group.find(m => m.id === named)
    if (!chosen) throw new Error(`sharedEmailKeepers: ${named} does not hold ${email}`)
    return chosen
  }
  const stamp = (d: LocalDateTime | null | undefined) =>
    d ? Date.UTC(d.year, d.month - 1, d.day, d.hour, d.minute, d.second) : -Infinity
  return [...group].sort(
    (a, b) =>
      stamp(retention.get(b.id)?.lastVisit) - stamp(retention.get(a.id)?.lastVisit) ||
      stamp(created.get(b.id)) - stamp(created.get(a.id)) ||
      a.id.localeCompare(b.id),
  )[0]!
}

/** The preflight report, for a person: what the studio should fix in Mindbody before the final download. */
export function renderPreflight(p: Preflight): string {
  const lines = ['# Preflight', '']
  lines.push(`## Members with no email (${p.noEmail.length})`, '')
  lines.push('Imported under a placeholder address nobody receives. Add a real email in Mindbody before the final download, or have an admin set it after launch.', '')
  for (const m of p.noEmail) lines.push(`- ${m.id} ${m.name} → ${m.placeholder}`)
  lines.push('', `## Emails shared by more than one member (${p.sharedEmails.length})`, '')
  lines.push('One member keeps the address (named in `sharedEmailKeepers`, or else the most recent visitor); the others get placeholders.', '')
  for (const s of p.sharedEmails) {
    lines.push(`- ${s.email}: kept by ${s.keeper.id} ${s.keeper.name}`)
    for (const o of s.others) lines.push(`  - ${o.id} ${o.name} → ${o.placeholder}`)
  }
  lines.push('', `## Staff with no email: imported by name, with no login (${p.staffWithoutLogin.length})`, '')
  lines.push('They teach, are paid and appear on the timetable; nobody can sign in as them until they have a real email.', '')
  for (const s of p.staffWithoutLogin) lines.push(`- ${s.name} → ${s.placeholder}`)
  lines.push('', `## Still live in Mindbody, and not migrated (${p.notMigrated.length})`, '')
  lines.push('The platform has no package for these. Decide with the studio how each is honoured after launch.', '')
  for (const n of p.notMigrated) {
    lines.push(`- ${n.clientId} ${n.name}: ${n.option} — ${n.left}, until ${n.expires} (${n.reason})`)
  }
  lines.push('', `## Money on account (${p.balances.length})`, '')
  lines.push('The platform keeps no account balance. A negative figure is money the member owes.', '')
  for (const b of p.balances) lines.push(`- ${b.clientId} ${b.name}: ${b.balance}`)
  lines.push('', `## The timetable and bookings (${p.schedule.length})`, '')
  lines.push('Imported as far as it could be; each line is something for a person to look at.', '')
  for (const note of p.schedule) lines.push(`- ${note}`)
  lines.push('', `## Autopays still live in Mindbody (${p.autopays.length})`, '')
  lines.push('Mindbody will keep charging these after launch. Stop each in Mindbody, and have the member sign up again on the platform.')
  for (const a of p.autopays) {
    lines.push(
      `- ${a.clientId ?? '(no id)'} ${a.client}${a.email ? ` <${a.email}>` : ''}: ${a.item}, next due ${a.next}` +
        `${a.location ? ` at ${a.location}` : ''} (${a.status}; ${a.runs} run${a.runs === 1 ? '' : 's'} scheduled)`,
    )
  }
  return `${lines.join('\n')}\n`
}

export type LiveAutopay = Omit<AutopayRow, 'date'> & { next: string; runs: number }

/**
 * Autopay Detail lists every run due in the next 12 months, so a monthly
 * autopay is twelve rows: one autopay per member and item, at its first run,
 * with how many are scheduled.
 */
function liveAutopays(rows: AutopayRow[]): LiveAutopay[] {
  const byKey = new Map<string, LiveAutopay>()
  for (const { date, ...a } of rows) {
    const key = `${a.clientId ?? a.client}\u0000${a.item}`
    const had = byKey.get(key)
    if (had) had.runs++
    else byKey.set(key, { ...a, next: date, runs: 1 })
  }
  return [...byKey.values()]
}
