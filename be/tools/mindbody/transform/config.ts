import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { offlinePaymentMethodEnum } from '../../../src/db/enums'
import { proposeCatalogue } from './catalogue'
import type { MindbodyReports } from './mapper'
import { proposeSchedule } from './schedule-proposal'
import { EMAIL, dateOfIso, dayNumber, normaliseClassName, normaliseOptionName, normaliseStaffName } from './values'

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

/** The platform's offline payment methods, as the database's enum lists them. */
export const OFFLINE_METHODS = offlinePaymentMethodEnum.enumValues
export type OfflineMethod = (typeof OFFLINE_METHODS)[number]

const locationSchema = z.object({
  /** How rooms and the default refer to this Location in the config. */
  key: z.string().min(1),
  name: open(z.string().min(1)),
  address: open(z.string()),
  phone: open(z.string()),
  /** The numeric location ids Mindbody prints for it (Retention Management's "Location"). */
  mindbodyIds: z.array(z.string()).default([]),
  /** What the schedule and roster reports call it, where that is not `name`. */
  mindbodyNames: z.array(z.string()).default([]),
})

const roomSchema = z.object({
  name: open(z.string().min(1)),
  location: open(z.string().min(1)),
  capacity: open(z.number().int().positive()),
  /** Every spelling Mindbody uses for this one room ("Studio2-Normal Room", "Studio 2 - Normal Room"). */
  mindbodyNames: z.array(z.string()).default([]),
  /**
   * For a spelling Mindbody uses for more than one room — a studio that started
   * filing two rooms under one label — the Class Types (by name) that, under
   * that spelling, are held in this Room. Of the Rooms sharing a spelling, the
   * one with no `classTypes` takes every other class.
   */
  classTypes: z.array(z.string()).default([]),
})

const classTypeSchema = z.object({
  name: open(z.string().min(1)),
  /** The raw class names that are this Class Type. Matched trimmed and case-folded. */
  mindbodyNames: z.array(z.string()).default([]),
  /**
   * Seats in a class of this type, where that is not its Room's capacity. No
   * report has a class's capacity; needed for a class held off-site, which has
   * no Room to take it from.
   */
  capacity: z.number().int().positive().nullable().default(null),
})

/**
 * A weekly class, proposed by the starter config from what ran at the same
 * weekday, time and Room under the same name in each of the last four weeks,
 * led by the latest week's own teacher. One a person confirms (`migrate: true`)
 * is written as a Class Series, with any imported future classes it matches
 * linked to it — so the first thing the studio does after launch is extend it.
 */
const seriesSchema = z.object({
  /** A class name as Mindbody writes it; its Class Type is looked up like any class's. */
  className: z.string().min(1),
  /** ISO weekday: Monday 1 … Sunday 7. */
  weekday: z.number().int().min(1).max(7),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  /** A Room, by its name or any of its Mindbody spellings. */
  room: z.string().min(1),
  /** Who teaches it from now on, as the phone book names them. They must be coming across as an instructor. */
  teacher: z.string().min(1),
  migrate: open(z.boolean()),
})

/**
 * One room type a workshop or a retreat was sold by — twin, single, non-resident.
 * Mindbody sells each as a pricing option of its own; here they are the
 * workshop's Tiers, and what a member holds of one is their place on it.
 */
const workshopTierSchema = z.object({
  /** The name the platform's workshop page shows. */
  name: open(z.string().min(1)),
  /** Every pricing option that buys this tier: the room type itself, its deposit, its top-up. */
  mindbodyNames: z.array(z.string()).min(1),
  /** What the tier costs. No report holds a workshop's price list. */
  priceSgd: open(z.number().min(0)),
  /**
   * The days of the workshop it grants, by their place in it (1 is the first
   * day). Absent, it grants every day: a room type is the whole retreat. A day
   * pass or a weekend-only option says which days it is.
   */
  days: z.array(z.number().int().positive()).min(1).optional(),
})

/**
 * A workshop or a retreat, still to come or — for a studio bringing its past —
 * already held, as the platform is to know it.
 *
 * Identified by the Mindbody service category its occurrences are scheduled
 * under — a workshop, a retreat or a course has one of its own — which must
 * also be in `workshopCategories`, or its days would be imported as classes too.
 * `migrate` decides both: its days to come, and every past run of it inside
 * `history`.
 */
const workshopSchema = z.object({
  category: z.string().min(1),
  name: open(z.string().min(1)),
  /** A Location, by its key. */
  location: open(z.string().min(1)),
  /** Seats per day. No report holds a workshop's capacity. */
  capacity: open(z.number().int().positive()),
  migrate: open(z.boolean()),
  tiers: z.array(workshopTierSchema).default([]),
})

/**
 * How much of the studio's past to bring across.
 *
 * Absent (`null`) is a studio that starts on launch day with nothing behind it:
 * the fastest rehearsal, and the default. Given, `from` is the first day of
 * history to import — every class, booking, check-in, no-show, late cancel and
 * PT session from that day up to the download — and `purchases` says whether
 * the packages members bought and used up before then come too, which is what
 * puts pre-launch money in Finance.
 *
 * Not `open(...)`: history is a thing a studio either wants or does not, and
 * `null` is that answer rather than an unfilled field.
 */
const historySchema = z.object({
  /** The first day to import, `YYYY-MM-DD`, on the studio's own calendar. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Past purchases, as inactive packages. Off by default: they show as pre-launch revenue in Finance. */
  purchases: z.boolean().default(false),
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
  /**
   * Comes across active by name with no login — no email of their own — so
   * their classes and pay name them and nobody can sign in as them. Any
   * `email` is ignored.
   */
  noLogin: z.boolean().default(false),
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
    /**
     * The owner: imported an active Admin, so the studio has someone in it from
     * the first minute, and named as whoever created what the import writes.
     * Either a staff member coming across as active, or one of `admins`.
     */
    ownerEmail: open(z.string()),
    /**
     * Everyone who is to run the portal from launch day: each is imported an
     * active Admin who can sign in at once (by setting a password), with no
     * invitation to send. One whose email is a staff member's coming across as
     * active is that staff member; anyone else — an owner or an agency Mindbody
     * never listed as staff — is a staff row of their own, named `name` (or by
     * their email where that is null).
     */
    admins: z
      .array(z.object({ email: z.string().min(1), name: z.string().min(1).nullable().default(null) }))
      .default([]),
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
  /**
   * The country (ISO code) a member's phone is dialled from where the Mailing
   * List gives them no Country: the studio's own.
   */
  defaultCountry: z.string().regex(/^[A-Za-z]{2}$/).default('SG'),
  rooms: z.array(roomSchema).default([]),
  /** Room spellings that are really off-site venues (outdoors, a company office, a retreat). Not Rooms. */
  offSiteVenues: z.array(z.string()).default([]),
  classTypes: z.array(classTypeSchema).default([]),
  /**
   * Mindbody service categories that are a workshop, a retreat or a course of
   * their own and not the studio's timetable. What is scheduled under one is not
   * a class, and is left to the workshop import.
   */
  workshopCategories: z.array(z.string()).default([]),
  /**
   * The workshops and retreats still to come that are to be imported, one entry
   * per `workshopCategories` category. Proposed by the starter config; a person
   * decides `migrate` and fills in the price of each room type.
   */
  workshops: z.array(workshopSchema).default([]),
  /** What the roster calls a personal-training appointment. A roster row under one of these is a PT session, not a class. */
  ptAppointmentNames: z.array(z.string()).default([]),
  /** The Class Type an imported PT appointment's focus is. Created if `classTypes` does not already list it. */
  ptClassType: z.string().min(1).default('Personal Training'),
  series: z.array(seriesSchema).default([]),
  /** How far back to bring the studio's past, or `null` for none. */
  history: historySchema.nullable().default(null),
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
   * How the staff coming across as active get in.
   *
   * `invite`: each arrives pending, with an invitation an admin sends (or
   * resends) from the portal. `active`: each with an email arrives an active
   * member of staff with no invitation at all — shown by name in the portal
   * from the first minute, and signing in by setting a password (Forgot
   * password, or an admin's "send set-password link") when the studio says so.
   *
   * Either way, one with no email arrives active by name with no login: they
   * teach, are paid and appear on the timetable, and nobody can sign in as them.
   */
  staffOnboarding: z.enum(['invite', 'active']).default('invite'),
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
  /**
   * How each of Mindbody's payment method labels (the Sales report's, `Cash`,
   * `Credit card (<card>-Keyed)`, `Misc. (<method>)`) is filed here: one of the
   * platform's offline methods. A past purchase is written with the method its
   * sale was paid by, so a label one of them needs and this does not map
   * refuses the transform, naming every such label: no sale is imported with a
   * guessed method. `fill` writes it from the answers file and proposes the rest.
   */
  paymentMethods: z.record(z.string(), z.enum(OFFLINE_METHODS)).default({}),
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
    admins: { email: string; name: string | null }[]
    mailReplyTo: string | null
    emailFooter: string | null
  }
  asOf: string
  secret: string
  originPatterns: string
  locations: {
    key: string
    name: string
    address: string | null
    phone: string | null
    mindbodyIds: string[]
    mindbodyNames: string[]
  }[]
  defaultLocation: string
  defaultCountry: string
  rooms: { name: string; location: string; capacity: number; mindbodyNames: string[]; classTypes: string[] }[]
  offSiteVenues: string[]
  classTypes: { name: string; mindbodyNames: string[]; capacity: number | null }[]
  workshopCategories: string[]
  workshops: {
    category: string
    name: string
    location: string
    capacity: number
    migrate: boolean
    tiers: { name: string; mindbodyNames: string[]; priceSgd: number; days?: number[] }[]
  }[]
  ptAppointmentNames: string[]
  ptClassType: string
  series: {
    className: string
    weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7
    startTime: string
    endTime: string
    room: string
    teacher: string
    migrate: boolean
  }[]
  history: { from: string; purchases: boolean } | null
  policy: Parsed['policy']
  staff: (
    | {
        mindbodyName: string
        migrate: 'active'
        /** Null only with `noLogin`. */
        email: string | null
        role: 'admin' | 'instructor'
        teaches: boolean
        noLogin?: boolean
      }
    | { mindbodyName: string; migrate: 'archived'; email: string | null; role: 'admin' | 'instructor' | null; teaches: boolean }
    | { mindbodyName: string; migrate: 'skip'; email: string | null; role: 'admin' | 'instructor' | null; teaches: boolean }
  )[]
  staffOnboarding: 'invite' | 'active'
  sharedEmailKeepers: Record<string, string>
  catalogue: CatalogueEntry[]
  paymentMethods: Record<string, OfflineMethod>
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
  if (c.studio.mailReplyTo && !EMAIL.test(c.studio.mailReplyTo.trim())) {
    problems.push(`studio.mailReplyTo "${c.studio.mailReplyTo}" is not an email address`)
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
  /** Spelling → the Rooms that use it and whether each names the Class Types it takes. */
  const sharing = new Map<string, { name: string; split: boolean }[]>()
  for (const r of c.rooms) {
    for (const s of new Set(r.mindbodyNames.map(n => n.trim().toLowerCase()))) {
      spelled.set(s, r.name ?? '')
      sharing.set(s, [...(sharing.get(s) ?? []), { name: r.name ?? '', split: r.classTypes.length > 0 }])
    }
  }
  for (const [s, holders] of sharing) {
    // Shared, a spelling needs every Room but one to say which classes are its.
    if (holders.length > 1 && holders.filter(h => !h.split).length > 1) {
      problems.push(`room spelling "${s}" is mapped to two Rooms — give all but one of them the classTypes it holds under that spelling`)
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
  const adminEmails = new Set<string>()
  c.studio.admins.forEach((a, i) => {
    const email = a.email.trim().toLowerCase()
    if (!EMAIL.test(email)) problems.push(`studio.admins[${i}].email "${a.email}" is not an email address`)
    if (adminEmails.has(email)) problems.push(`studio.admins[${i}].email ${email} is listed twice`)
    adminEmails.add(email)
  })
  const staffEmails = new Set<string>()
  const staffNames = new Set<string>()
  // The owner may be an admin Mindbody never listed as staff.
  let ownerFound = !!owner && adminEmails.has(owner)
  c.staff.forEach((s, i) => {
    const label = `staff[${i}] (${s.mindbodyName})`
    need(s.migrate, `${label}.migrate`)
    const nameKey = normaliseStaffName(s.mindbodyName)
    if (s.migrate !== 'skip' && staffNames.has(nameKey)) {
      problems.push(`${label}: two staff records share this name — resolve which is which, and skip the other`)
    }
    if (s.migrate !== 'skip') staffNames.add(nameKey)
    if (s.migrate !== 'active') return
    // No email is a decision like any other: `noLogin` says it was made.
    if (!s.noLogin) need(s.email, `${label}.email`)
    need(s.role, `${label}.role`)
    const email = s.email?.trim().toLowerCase()
    if (email && !EMAIL.test(email)) problems.push(`${label}.email "${s.email}" is not an email address`)
    if (email && staffEmails.has(email)) problems.push(`${label}.email ${email} is used by two staff`)
    if (email) staffEmails.add(email)
    if (email && email === owner) {
      ownerFound = true
      if (s.role && s.role !== 'admin') problems.push(`${label} is the owner, so their role must be admin`)
    }
    if (email && email !== owner && adminEmails.has(email) && s.role && s.role !== 'admin') {
      problems.push(`${label} is in studio.admins, so their role must be admin`)
    }
  })
  if (owner && !ownerFound) {
    problems.push(`studio.ownerEmail ${owner} is not the email of any staff member being migrated as active, nor one of studio.admins`)
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

  const categories = new Set(c.workshopCategories.map(s => s.trim().toLowerCase()))
  const claimed = new Map<string, number>()
  const tierSpellings = new Map<string, number>()
  c.workshops.forEach((w, i) => {
    const label = `workshops[${i}] (${w.name ?? w.category})`
    const category = w.category.trim().toLowerCase()
    const other = claimed.get(category)
    if (other !== undefined) problems.push(`${label}: workshops[${other}] already claims the category "${w.category}"`)
    claimed.set(category, i)
    need(w.migrate, `${label}.migrate`)
    if (w.migrate !== true) return
    // Both lists read the category: one keeps its days off the timetable, the
    // other turns them into a Workshop. Listed in only one, they arrive twice.
    if (!categories.has(category)) {
      problems.push(`${label}.category "${w.category}" is not in workshopCategories, so its days would be imported as classes too`)
    }
    need(w.name, `${label}.name`)
    need(w.location, `${label}.location`)
    need(w.capacity, `${label}.capacity`)
    if (w.location && !locationKeys.has(w.location)) problems.push(`${label}.location "${w.location}" names no Location`)
    if (w.tiers.length === 0) problems.push(`${label}: a workshop coming across needs at least one tier (room type)`)
    // A Tier's row id is derived from its name, so two of one name would be one
    // row — caught here rather than by a duplicate key halfway through an import.
    const tierNames = new Set<string>()
    w.tiers.forEach((t, j) => {
      const tierLabel = `${label}.tiers[${j}]${t.name ? ` (${t.name})` : ''}`
      need(t.name, `${tierLabel}.name`)
      need(t.priceSgd, `${tierLabel}.priceSgd`)
      const tierKey = t.name === null ? null : normaliseOptionName(t.name)
      if (tierKey !== null && tierNames.has(tierKey)) problems.push(`${tierLabel} is listed twice`)
      if (tierKey !== null) tierNames.add(tierKey)
      for (const spelling of t.mindbodyNames) {
        const k = normaliseOptionName(spelling)
        const twice = tierSpellings.get(k)
        if (twice !== undefined) problems.push(`${tierLabel}: "${spelling}" is also a tier of workshops[${twice}]`)
        tierSpellings.set(k, i)
        // A place on a workshop is not a package. Listed as one that comes
        // across, a member would arrive holding both the place and credits.
        const listed = optionSpellings.get(k)
        if (listed !== undefined && c.catalogue[listed]!.migrate !== 'skip') {
          problems.push(`${tierLabel}: "${spelling}" is also catalogue[${listed}], which is not skipped — a workshop place is not a package`)
        }
      }
    })
  })

  const roomSpellings = new Set(c.rooms.flatMap(r => [r.name ?? '', ...r.mindbodyNames]).map(s => s.trim().toLowerCase()))
  const classNames = new Set(c.classTypes.flatMap(t => [t.name ?? '', ...t.mindbodyNames]).map(normaliseClassName))
  c.rooms.forEach((r, i) => {
    for (const t of r.classTypes) {
      if (!classNames.has(normaliseClassName(t))) problems.push(`rooms[${i}] (${r.name}).classTypes: "${t}" is in no Class Type`)
    }
  })
  const instructorsComing = new Set(
    c.staff.filter(s => s.migrate === 'active' && s.role === 'instructor').map(s => normaliseStaffName(s.mindbodyName)),
  )
  c.series.forEach((s, i) => {
    const label = `series[${i}] (${s.className}, weekday ${s.weekday} at ${s.startTime})`
    need(s.migrate, `${label}.migrate`)
    if (s.migrate !== true) return
    if (s.endTime <= s.startTime) problems.push(`${label} ends before it starts`)
    if (!roomSpellings.has(s.room.trim().toLowerCase())) problems.push(`${label}.room "${s.room}" names no Room`)
    if (!classNames.has(normaliseClassName(s.className))) problems.push(`${label}.className is in no Class Type`)
    // The portal only lets an instructor lead a class, so a series led by
    // anyone else could never be extended.
    if (!instructorsComing.has(normaliseStaffName(s.teacher))) {
      problems.push(`${label}.teacher "${s.teacher}" is not a staff member coming across as an active instructor`)
    }
  })

  // A cutoff after the download would bring no history at all, which is what
  // `history: null` says plainly — so it is a mistake rather than a choice.
  if (c.history && c.asOf && c.history.from > c.asOf.slice(0, 10)) {
    problems.push(`history.from "${c.history.from}" is after the download (${c.asOf.slice(0, 10)}), so nothing would come across`)
  }

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
  // What the timetable calls each Location, oldest first. Mindbody numbers its
  // Locations in the order they were made, so where there are as many names as
  // numbers the first to hold a class is taken to be number 1 — a proposal, for
  // a person to confirm, like the rest of this file.
  const firstHeld = new Map<string, number>()
  for (const r of reports.schedule) {
    const name = r.location.trim()
    if (name && (firstHeld.get(name) ?? Infinity) > dayNumber(r.date)) firstHeld.set(name, dayNumber(r.date))
  }
  const named = [...firstHeld].sort(([a, x], [b, y]) => x - y || a.localeCompare(b)).map(([name]) => name)
  const locations =
    named.length > 0 && (locationIds.length === 0 || named.length === locationIds.length)
      ? named.map((name, i) => ({
          key: locationIds[i] ? `location-${locationIds[i]}` : `location-${i + 1}`,
          name,
          address: null,
          phone: null,
          mindbodyIds: locationIds[i] ? [locationIds[i]!] : [],
          mindbodyNames: [name],
        }))
      : locationIds.length > 0
        ? locationIds.map(id => ({ key: `location-${id}`, name: null, address: null, phone: null, mindbodyIds: [id] }))
        : [{ key: 'main', name: null, address: null, phone: null, mindbodyIds: [] }]
  const locationKeys = new Map(locations.flatMap(l => (l.name ? [[l.name, l.key] as [string, string]] : [])))
  const schedule = proposeSchedule(reports, asOf ? dateOfIso(asOf) : null, locationKeys)

  return {
    studio: { slug: null, displayName: null, timezone: null, ownerEmail: null, admins: [], mailReplyTo: null, emailFooter: null },
    asOf,
    secret: randomBytes(32).toString('base64url'),
    locations,
    defaultLocation: locations[0]!.key,
    // From the timetable (`./schedule-proposal.ts`): every Room and class name
    // still to come, one entry per spelling, for a person to merge and fill in.
    rooms: schedule.rooms,
    offSiteVenues: [],
    classTypes: schedule.classTypes,
    workshopCategories: schedule.workshopCategories,
    workshops: schedule.workshops,
    ptAppointmentNames: schedule.ptAppointmentNames,
    series: schedule.series,
    // Nothing behind launch day, because that is the quick rehearsal. A studio
    // that wants its past writes `{ "from": "2019-01-01", "purchases": false }`.
    history: null,
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
