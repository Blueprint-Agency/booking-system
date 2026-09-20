import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { proposeCatalogue } from './catalogue'
import type { MindbodyReports } from './mapper'
import { EMAIL, dateOfIso, normaliseOptionName, normaliseStaffName } from './values'

/**
 * The studio config: the facts about a studio that no Mindbody report holds.
 *
 * Written once by hand per studio (starting from `starterConfig`, which fills in
 * whatever the reports imply), kept beside the downloads and never committed —
 * it holds real people's emails. The transform refuses to run while any field it
 * needs is still open, and names each one.
 *
 * "Open" is `null`. The starter config writes `null` wherever a person has to
 * decide, so an unfilled field cannot be mistaken for a decision.
 */

const open = <T extends z.ZodTypeAny>(schema: T) => schema.nullable()

const locationSchema = z.object({
  /** How rooms and the default refer to this Location in the config. */
  key: z.string().min(1),
  name: open(z.string().min(1)),
  address: open(z.string()),
  phone: open(z.string()),
  /** The numeric location ids Mindbody prints for it (Retention Management's "Location"). */
  mindbodyIds: z.array(z.string()).default([]),
})

const roomSchema = z.object({
  name: open(z.string().min(1)),
  location: open(z.string().min(1)),
  capacity: open(z.number().int().positive()),
  /** Every spelling Mindbody uses for this one room ("Studio2-Normal Room", "Studio 2 - Normal Room"). */
  mindbodyNames: z.array(z.string()).default([]),
})

const classTypeSchema = z.object({
  name: open(z.string().min(1)),
  /** The raw class names that are this Class Type. Matched trimmed and case-folded. */
  mindbodyNames: z.array(z.string()).default([]),
})

const staffSchema = z.object({
  /** The name as the phone book writes it; matched in any word order and case. */
  mindbodyName: z.string().min(1),
  /**
   * `active` comes across and can sign in (the owner at once, everyone else by
   * invitation); `archived` comes across so history can name them, and nobody
   * can sign in as them; `skip` is left behind.
   */
  migrate: open(z.enum(['active', 'archived', 'skip'])),
  email: open(z.string()),
  role: open(z.enum(['admin', 'instructor'])),
  /** Teaches classes, so gets an instructor profile. */
  teaches: z.boolean().default(false),
})

/**
 * One Mindbody pricing option, as the platform is to know it.
 *
 * The starter config proposes every value from what was sold; a person corrects
 * them and decides `migrate`. Merging two entries (an option and its "Copy")
 * is moving one's spellings into the other's `mindbodyNames`.
 */
const catalogueSchema = z.object({
  /** The name the platform's catalogue shows. */
  name: open(z.string().min(1)),
  /** Every spelling Mindbody uses for this option. Matched tidied and case-folded. */
  mindbodyNames: z.array(z.string()).min(1),
  /**
   * `sell` is in the catalogue at `priceSgd` and can be bought; `legacy` is in
   * the catalogue archived, so what members hold is honoured and nobody can buy
   * another; `skip` is not a package at all (a workshop place, mat storage) and
   * whoever holds one is listed in the preflight report.
   */
  migrate: open(z.enum(['sell', 'legacy', 'skip'])),
  /**
   * `access_pass` is Mindbody's way of letting an Unlimited Plan into the other
   * Location. It is no catalogue row here: held beside a plan it becomes that
   * plan's Cross-Location Add-On, and held alone it is listed in the preflight.
   */
  kind: open(z.enum(['credit_bundle', 'unlimited', 'trial', 'pt', 'access_pass'])),
  /** Credits, or sessions for PT. */
  credits: z.number().int().positive().nullable().default(null),
  validityDays: z.number().int().positive().nullable().default(null),
  /** An Unlimited Plan's Duration, in whole calendar months. */
  durationMonths: z.number().int().positive().nullable().default(null),
  /** The List Price. Needed to `sell`; on a `legacy` option it is the price it used to have, or nothing. */
  priceSgd: z.number().min(0).nullable().default(null),
  sessionType: z.enum(['1on1', '2on1']).nullable().default(null),
  /**
   * For an Unlimited Plan, its Home Location; for an access pass, the Location
   * it opens. Left null on a plan, the Location named inside the option's name
   * is used, and failing that `defaultLocation`.
   */
  location: z.string().nullable().default(null),
})

export const studioConfigSchema = z.object({
  studio: z.object({
    slug: open(z.string().min(1)),
    displayName: open(z.string().min(1)),
    timezone: open(z.string().min(1)),
    /** The owner: imported an active Admin, so the studio has someone in it from the first minute. */
    ownerEmail: open(z.string()),
    mailReplyTo: z.string().nullable().default(null),
    /** Printed at the foot of every email. Optional; naming nothing beats naming the wrong premises. */
    emailFooter: z.string().nullable().default(null),
  }),
  /**
   * When the download finished — the "as of" moment for everything imported,
   * and the one clock the transform reads, so the same inputs give the same zip.
   */
  asOf: open(z.string().datetime({ offset: true })),
  /**
   * Keys the invitation tokens. Written at random by the starter config, then
   * fixed, so a rerun reproduces the same tokens and nobody can derive them from
   * the reports alone. Private, like the rest of this file.
   */
  secret: open(z.string().min(32)),
  /**
   * The tenant origin wildcards of the environment the archive is for, as
   * `TENANT_ORIGIN_PATTERNS` spells them. The links baked into the email
   * templates are built from these.
   */
  originPatterns: z.string().default('https://*.reservetoday.app,https://*.portal.reservetoday.app'),
  locations: z.array(locationSchema),
  /**
   * Where an Unlimited Plan whose name names no Location is homed. Asked for
   * now, with the Locations, so the config is settled in one sitting; read when
   * packages arrive (#178), as are `mindbodyIds` and `offSiteVenues` when
   * classes do (#179).
   */
  defaultLocation: open(z.string().min(1)),
  rooms: z.array(roomSchema).default([]),
  /** Room spellings that are really off-site venues (outdoors, a company office, a retreat). Not Rooms. */
  offSiteVenues: z.array(z.string()).default([]),
  classTypes: z.array(classTypeSchema).default([]),
  policy: z
    .object({
      classWindowHours: z.number().int().min(0).default(24),
      ptWindowHours: z.number().int().min(0).default(24),
      cancelCapCount: z.number().int().min(0).default(3),
      cancelCapCycleDays: z.number().int().positive().default(30),
      ptBookInAdvanceDays: z.number().int().positive().default(7),
    })
    .default({}),
  staff: z.array(staffSchema),
  /**
   * Who keeps an email that several members share: email → client id. Anyone
   * not named here is decided by the rule in the mapper (most recent visit).
   */
  sharedEmailKeepers: z.record(z.string(), z.string()).default({}),
  /**
   * The catalogue: every pricing option a member still holds something of. The
   * transform refuses a live holding whose option is not listed here.
   */
  catalogue: z.array(catalogueSchema).default([]),
})

export type StudioConfigInput = z.input<typeof studioConfigSchema>
type Parsed = z.output<typeof studioConfigSchema>

/** A config with every field it needs filled in. */
export type StudioConfig = {
  studio: {
    slug: string
    displayName: string
    timezone: string
    ownerEmail: string
    mailReplyTo: string | null
    emailFooter: string | null
  }
  asOf: string
  secret: string
  originPatterns: string
  locations: { key: string; name: string; address: string | null; phone: string | null; mindbodyIds: string[] }[]
  defaultLocation: string
  rooms: { name: string; location: string; capacity: number; mindbodyNames: string[] }[]
  offSiteVenues: string[]
  classTypes: { name: string; mindbodyNames: string[] }[]
  policy: Parsed['policy']
  staff: (
    | { mindbodyName: string; migrate: 'active'; email: string; role: 'admin' | 'instructor'; teaches: boolean }
    | { mindbodyName: string; migrate: 'archived'; email: string | null; role: 'admin' | 'instructor' | null; teaches: boolean }
    | { mindbodyName: string; migrate: 'skip'; email: string | null; role: 'admin' | 'instructor' | null; teaches: boolean }
  )[]
  sharedEmailKeepers: Record<string, string>
  catalogue: CatalogueEntry[]
}

type CatalogueCommon = { name: string; mindbodyNames: string[]; priceSgd: number | null }

/** A pricing option the config has settled: what it is here, with the fields that kind needs. */
export type CatalogueEntry =
  | (CatalogueCommon & { migrate: 'skip' })
  | (CatalogueCommon & { migrate: 'sell' | 'legacy' } & (
        | { kind: 'credit_bundle' | 'trial'; credits: number; validityDays: number }
        | { kind: 'pt'; credits: number; validityDays: number; sessionType: '1on1' | '2on1' }
        | { kind: 'unlimited'; durationMonths: number; location: string | null }
        | { kind: 'access_pass'; location: string }
      ))

/** The config was not usable, and here is every reason, by field. */
export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`The studio config is not complete:\n${problems.map(p => `  - ${p}`).join('\n')}`)
  }
}

/**
 * Check a config and return it complete, or throw naming every open field.
 *
 * All problems at once, not the first: filling in a config is a sitting with
 * the studio, and a list is what that sitting needs.
 */
export function validateConfig(raw: unknown): StudioConfig {
  const parsed = studioConfigSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`))
  }
  const c = parsed.data
  const problems: string[] = []
  const need = (value: unknown, field: string) => {
    if (value === null || value === undefined || value === '') problems.push(`${field} is open`)
  }

  need(c.studio.slug, 'studio.slug')
  need(c.studio.displayName, 'studio.displayName')
  need(c.studio.timezone, 'studio.timezone')
  need(c.studio.ownerEmail, 'studio.ownerEmail')
  need(c.asOf, 'asOf')
  need(c.secret, 'secret')
  need(c.defaultLocation, 'defaultLocation')
  if (c.studio.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: c.studio.timezone })
    } catch {
      problems.push(`studio.timezone "${c.studio.timezone}" is not a timezone`)
    }
  }
  if (c.studio.ownerEmail && !EMAIL.test(c.studio.ownerEmail.trim())) {
    problems.push(`studio.ownerEmail "${c.studio.ownerEmail}" is not an email address`)
  }

  if (c.locations.length === 0) problems.push('locations: the studio needs at least one Location')
  const locationKeys = new Set<string>()
  c.locations.forEach((l, i) => {
    need(l.name, `locations[${i}] (${l.key}).name`)
    if (locationKeys.has(l.key)) problems.push(`locations[${i}].key "${l.key}" is used twice`)
    locationKeys.add(l.key)
  })
  if (c.defaultLocation && !locationKeys.has(c.defaultLocation)) {
    problems.push(`defaultLocation "${c.defaultLocation}" names no Location`)
  }

  const roomNames = new Set<string>()
  c.rooms.forEach((r, i) => {
    const label = `rooms[${i}]${r.name ? ` (${r.name})` : ''}`
    need(r.name, `${label}.name`)
    need(r.location, `${label}.location`)
    need(r.capacity, `${label}.capacity`)
    if (r.location && !locationKeys.has(r.location)) problems.push(`${label}.location "${r.location}" names no Location`)
    const key = `${r.location}/${r.name?.toLowerCase()}`
    if (r.name && roomNames.has(key)) problems.push(`${label} is listed twice at ${r.location}`)
    roomNames.add(key)
  })
  const spelled = new Map<string, string>()
  for (const r of c.rooms) {
    for (const s of r.mindbodyNames) {
      const k = s.trim().toLowerCase()
      if (spelled.has(k) && spelled.get(k) !== r.name) problems.push(`room spelling "${s}" is mapped to two Rooms`)
      spelled.set(k, r.name ?? '')
    }
  }

  for (const venue of c.offSiteVenues) {
    if (spelled.has(venue.trim().toLowerCase())) problems.push(`"${venue}" is both an off-site venue and a Room spelling`)
  }

  const typeNames = new Set<string>()
  c.classTypes.forEach((t, i) => {
    need(t.name, `classTypes[${i}].name`)
    const k = t.name?.trim().toLowerCase()
    if (k && typeNames.has(k)) problems.push(`classTypes[${i}] (${t.name}) is listed twice`)
    if (k) typeNames.add(k)
  })

  const owner = c.studio.ownerEmail?.trim().toLowerCase()
  const staffEmails = new Set<string>()
  const staffNames = new Set<string>()
  let ownerFound = false
  c.staff.forEach((s, i) => {
    const label = `staff[${i}] (${s.mindbodyName})`
    need(s.migrate, `${label}.migrate`)
    const nameKey = normaliseStaffName(s.mindbodyName)
    if (s.migrate !== 'skip' && staffNames.has(nameKey)) {
      problems.push(`${label}: two staff records share this name — resolve which is which, and skip the other`)
    }
    if (s.migrate !== 'skip') staffNames.add(nameKey)
    if (s.migrate !== 'active') return
    need(s.email, `${label}.email`)
    need(s.role, `${label}.role`)
    const email = s.email?.trim().toLowerCase()
    if (email && !EMAIL.test(email)) problems.push(`${label}.email "${s.email}" is not an email address`)
    if (email && staffEmails.has(email)) problems.push(`${label}.email ${email} is used by two staff`)
    if (email) staffEmails.add(email)
    if (email && email === owner) {
      ownerFound = true
      if (s.role && s.role !== 'admin') problems.push(`${label} is the owner, so their role must be admin`)
    }
  })
  if (owner && !ownerFound) {
    problems.push(`studio.ownerEmail ${owner} is not the email of any staff member being migrated as active`)
  }

  const optionSpellings = new Map<string, number>()
  c.catalogue.forEach((e, i) => {
    const label = `catalogue[${i}] (${e.name ?? e.mindbodyNames[0]})`
    for (const spelling of e.mindbodyNames) {
      const k = normaliseOptionName(spelling)
      const other = optionSpellings.get(k)
      if (other !== undefined && other !== i) problems.push(`${label}: "${spelling}" is also listed under catalogue[${other}]`)
      optionSpellings.set(k, i)
    }
    need(e.migrate, `${label}.migrate`)
    if (e.migrate === null || e.migrate === 'skip') return
    need(e.name, `${label}.name`)
    need(e.kind, `${label}.kind`)
    if (e.kind === 'credit_bundle' || e.kind === 'trial' || e.kind === 'pt') {
      need(e.credits, `${label}.credits`)
      need(e.validityDays, `${label}.validityDays`)
    }
    if (e.kind === 'pt') need(e.sessionType, `${label}.sessionType`)
    if (e.kind === 'unlimited') need(e.durationMonths, `${label}.durationMonths`)
    if (e.kind === 'access_pass') {
      need(e.location, `${label}.location`)
      if (e.migrate === 'sell') problems.push(`${label}: an access pass is not sold here — the Cross-Location Add-On is. Mark it legacy`)
    }
    if (e.migrate === 'sell') need(e.priceSgd, `${label}.priceSgd`)
    if (e.location && !locationKeys.has(e.location)) problems.push(`${label}.location "${e.location}" names no Location`)
  })

  if (problems.length > 0) throw new ConfigError(problems)
  return c as unknown as StudioConfig
}

/**
 * A config pre-filled with what the reports imply, for a person to complete.
 *
 * Staff come from the phone book, with its emails where it has them: active
 * people are proposed for migration (a teacher as an instructor; anyone else's
 * role left open, since the reports only say "staff"; an email the phone book
 * lacks left open too), inactive teachers as
 * archived so history can still name them, and inactive non-teachers skipped.
 * Locations come from the ids the member reports print, named by nobody yet.
 * The catalogue is proposed from what was sold (`./catalogue.ts`) — for the
 * options still held on `asOf` where that is given, and otherwise for every
 * option anybody has anything left of, which is a longer list to skip through.
 *
 * The secret is the one thing written at random. Everything after that reads
 * this file, so it is the last random step the pipeline takes.
 */
export function starterConfig(reports: MindbodyReports, asOf: string | null = null): StudioConfigInput {
  const locationIds = [...new Set(reports.retention.map(r => r.location).filter(id => id && id !== '0'))].sort()
  const locations =
    locationIds.length > 0
      ? locationIds.map(id => ({ key: `location-${id}`, name: null, address: null, phone: null, mindbodyIds: [id] }))
      : [{ key: 'main', name: null, address: null, phone: null, mindbodyIds: [] }]

  return {
    studio: { slug: null, displayName: null, timezone: null, ownerEmail: null, mailReplyTo: null, emailFooter: null },
    asOf,
    secret: randomBytes(32).toString('base64url'),
    locations,
    defaultLocation: locations[0]!.key,
    rooms: [],
    offSiteVenues: [],
    classTypes: [],
    policy: { classWindowHours: 24, ptWindowHours: 24, cancelCapCount: 3, cancelCapCycleDays: 30, ptBookInAdvanceDays: 7 },
    staff: reports.phoneBook.map(p => ({
      mindbodyName: p.name,
      migrate: p.active ? 'active' : p.teacher ? 'archived' : 'skip',
      email: p.email,
      role: p.teacher ? 'instructor' : null,
      teaches: p.teacher,
    })),
    sharedEmailKeepers: {},
    // The download's own date, as the studio's clock read it: the offset written
    // in `asOf` is the studio's, and no timezone has been chosen yet to ask.
    catalogue: proposeCatalogue(reports, asOf ? dateOfIso(asOf) : null),
  }
}
