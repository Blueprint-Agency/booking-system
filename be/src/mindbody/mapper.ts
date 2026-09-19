import { buildEmailTemplates } from '../db/seed/email-copy'
import { parseOriginPatterns, tenantOriginFor } from '../lib/origin'
import { joinName, splitName } from '../lib/name'
import { ARCHIVE_VERSION, type TenantArchive } from '../services/tenants/transfer-shape'
import type { StudioConfig } from './config'
import { idsFor, secretToken } from './ids'
import type { MemberListRow, PhoneBookRow, ReferralRow, RetentionRow } from './readers'
import { normaliseStaffName, zonedToInstant, type LocalDateTime } from './values'

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
}

export type Preflight = {
  /** Members with no usable email: imported under a placeholder, fixed later by an admin. */
  noEmail: { id: string; name: string; placeholder: string }[]
  /** Emails more than one member holds: one keeps it, the others get placeholders. */
  sharedEmails: {
    email: string
    keeper: { id: string; name: string }
    others: { id: string; name: string; placeholder: string }[]
  }[]
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
      mail_from_name: config.studio.displayName,
      mail_reply_to: config.studio.mailReplyTo,
      copy: {},
      theme: {},
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

  const preflight: Preflight = { noEmail: [], sharedEmails: [] }
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
  const staffUsers: Row[] = []
  const instructors: Row[] = []
  const invitations: Row[] = []

  for (const s of config.staff) {
    if (s.migrate === 'skip') continue
    const key = normaliseStaffName(s.mindbodyName)
    const listed = phoneBook.get(key)
    const name = listed?.name ?? s.mindbodyName.trim()
    const { firstName, lastName } = splitName(name)
    const staffId = id('staff', key)
    const archived = s.migrate === 'archived'
    const email = archived ? placeholder('staff', key) : s.email.trim().toLowerCase()
    const isOwner = !archived && email === owner
    const role = s.role ?? 'instructor'

    staffUsers.push({
      id: staffId,
      tenant_id: tenantId,
      auth_user_id: null,
      email,
      name: joinName(firstName, lastName),
      first_name: firstName,
      last_name: lastName,
      role,
      // The owner runs the studio from the first minute; everyone else arrives
      // by invitation, sent or resent by an admin when the studio decides.
      status: archived ? 'archived' : isOwner ? 'active' : 'pending',
      granted_location_ids: [],
      phone: listed?.phone || null,
      invited_at: archived || isOwner ? null : asOf.toISOString(),
      archived_at: archived ? asOf.toISOString() : null,
    })
    ids.staff_users![s.mindbodyName] = staffId

    if (s.teaches || role === 'instructor') instructors.push({ staff_user_id: staffId, tenant_id: tenantId })

    if (!archived && !isOwner) {
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

  /* ── The archive ───────────────────────────────────────────────────────── */

  // Parents first, as an export writes them — the importer orders by the
  // schema, but a person reading the zip reads it in this order.
  const rows: Record<string, Row[]> = {
    locations,
    rooms,
    class_types: classTypes,
    staff_users: staffUsers,
    instructors,
    staff_invitations: invitations,
    clients,
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
  return `${lines.join('\n')}\n`
}
