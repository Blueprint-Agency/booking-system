import type { OfflineMethod } from './config'
import type { ReportFacts, StaffFact } from './facts'
import { locationNamedIn, type LocationSpelling } from './lookups'
import { normaliseClassName, normaliseStaffName, paymentMethodKey } from './values'

/**
 * Fill a starter config (`mindbody starter`) with a studio's answers, by rule.
 *
 * The rules are here; every value is the studio's, in a private answers file
 * beside its downloads (`StudioAnswers`): its name, people, emails, Locations,
 * Rooms, what it sells and at what. So the same rules fill any studio's config,
 * and a rerun on new downloads fills it the same way.
 *
 * One answers file can fill several configs (`outputs`) that differ only in the
 * environment they are for — a staging rehearsal and a local one, say.
 */

/** A config as JSON: the transform validates it (`./config.ts`); this only fills it in. */
type Json = Record<string, any>

export type StudioAnswers = {
  /** Decision 1: who the studio is, and who runs the portal from day one. */
  studio: {
    displayName: string
    timezone: string
    ownerEmail: string
    admins: { email: string; name: string | null }[]
    /** Where members' replies to the studio's emails go. Left out, the Tenant keeps the one it has. */
    mailReplyTo?: string | null
    /** Printed at the foot of every email. */
    emailFooter?: string | null
  }
  /** Decision 2: the Locations, as the config spells them. */
  locations: Json[]
  /** Decision 14: where an Unlimited Plan naming no Location is homed. */
  defaultLocation: string
  /**
   * Decision 3: the Rooms. `capacity` is the largest headcount the roster shows
   * under the Room's own name; `classTypesMatching` (a case-insensitive pattern)
   * gives a Room every class name it matches — for one Mindbody label shared by two rooms.
   */
  rooms: { name: string; location: string; mindbodyNames: string[]; classTypesMatching?: string }[]
  /** Room spellings that are really off-site venues. */
  offSiteVenues: string[]
  /** Seats for a class held only off-site (no Room to size it by). */
  roomlessCapacity: number
  /** Service categories that are the timetable, not workshops (case-insensitive pattern on the whole name). */
  notWorkshopCategories: string
  /** Decision 15, until settled: whether a proposed workshop is migrated. */
  workshopsMigrate: boolean
  /** What a PT appointment is called (case-insensitive pattern). Default: "PT" or "personal training". */
  ptPattern?: string
  /** How active staff get in: `active` (no invitation) or `invite`. */
  staffOnboarding: 'active' | 'invite'
  /**
   * Decision 10: an email for a staff member Mindbody holds none for, by their
   * Mindbody name (`Sumit Sumit` → address). With it they come across with a login,
   * as a staff member Mindbody has an email for does. Mindbody's own email wins.
   */
  staffEmails?: Record<string, string>
  /** Decision 6. */
  catalogue: {
    /** On sale now (option names). Everything else still held is `legacy`. The price is the commonest of the last 90 days. */
    sell: string[]
    /** An option sold under a second name: `from` (pattern) is folded into `into` (pattern). */
    merge: { from: string; into: string }[]
    /** Entries to add when the catalogue lists none of that name (on sale, held by nobody). */
    add: Json[]
    /** Where a lone access pass is homed, by a pattern on its name; else `defaultLocation`. */
    accessPassLocations: { match: string; location: string }[]
    /** What an entry the studio said nothing about gets. */
    defaults: { credits: number; validityDays: number; ptSessionType: string; unlimitedMonths: number }
  }
  /** Decision 17. */
  history: Json | null
  /**
   * Decision 21: how many may wait on a class still to come, and Class Types
   * (by name) that take another number. Every class has a waitlist; left out,
   * each starts at 0 and staff type a figure in the portal.
   */
  waitlist?: { enabled?: boolean; capacity?: number; classTypes?: Record<string, number> }
  /**
   * How each Mindbody payment method label is filed here (`Cash` → `cash`). The
   * studio's own labels, so they live here and not in the code. A past purchase
   * paid by a label this leaves out is refused by the transform; `fill` lists
   * those it sees in the Sales report, with a proposal (`unmappedPaymentMethods`).
   */
  paymentMethods?: Record<string, OfflineMethod>
  /** The configs to write: name → what differs (slug, and the environment's origin patterns). */
  outputs: Record<string, { slug: string; originPatterns?: string }>
}

/** Decision 21 where the answers name no figure: the switch on, every class at 0 until staff set one. */
export const DEFAULT_WAITLIST = { enabled: true, capacity: 0 } as const

const pattern = (source: string) => new RegExp(source, 'i')
/** One key per name the way a person reads it: NFKC-folded, single-spaced, case-folded. */
const nameKey = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * An option Mindbody sells once per Location — `Unlimited 6` and `Unlimited 6 -
 * <Location>` — is one package here, where the member picks the Location when
 * they buy. Each entry whose name names a Location folds into the one entry of
 * the same kind whose name, with the Location taken out, is the same (spacing
 * and separators aside) and names none: its spellings join that entry's
 * `mindbodyNames`, and that entry's terms stand. Which Location a member's plan
 * covers is read off the spelling they bought (`optionHome` in `./packages.ts`).
 * An access pass is never folded: it is the other Location, not a copy.
 */
export function foldLocationVariants(catalogue: Json[], locations: Json[]): { into: string; from: string[] }[] {
  const spellings = locations.flatMap((l: Json) => [l.name, ...(l.mindbodyNames ?? [])]).filter(Boolean).map(nameKey)
  const bare = (name: string) => {
    let s = nameKey(name)
    for (const l of spellings) s = s.split(l).join(' ')
    return s.replace(/[^\p{L}\p{N}+]+/gu, '')
  }
  const foldable = (e: Json) => e.migrate !== 'skip' && e.kind !== 'access_pass' && typeof e.name === 'string'
  const targets = new Map<string, Json[]>()
  for (const e of catalogue) {
    if (!foldable(e) || locationNamedIn(locations as LocationSpelling[], e.name)) continue
    const k = `${e.kind}/${bare(e.name)}`
    targets.set(k, [...(targets.get(k) ?? []), e])
  }
  const folded = new Map<Json, string[]>()
  for (const e of [...catalogue]) {
    if (!foldable(e) || !locationNamedIn(locations as LocationSpelling[], e.name)) continue
    const into = targets.get(`${e.kind}/${bare(e.name)}`)
    // None, or two it could be: left as it is, homed by its own name.
    if (into?.length !== 1) continue
    const target = into[0]!
    target.mindbodyNames = [...new Set([...target.mindbodyNames, ...e.mindbodyNames])]
    folded.set(target, [...(folded.get(target) ?? []), e.name])
    catalogue.splice(catalogue.indexOf(e), 1)
  }
  return [...folded].map(([t, from]) => ({ into: t.name, from })).sort((a, b) => a.into.localeCompare(b.into))
}

/**
 * Decision 15, by rule: every workshop category has an entry, and every entry
 * coming across is complete. The starter proposes workshops from the download
 * it was made from; a workshop the studio has run since, or one only its past
 * knows, gets an entry here. What the entry leaves open is read off the reports
 * (`WorkshopFact`): its title, the Location it was held at, a capacity that
 * seats everyone who came or holds a place, and each room type's price.
 *
 * A room type's pricing options buy a place, never a package, so the catalogue
 * entry of any of them is `skip`. One option is one workshop's tier: an option
 * two entries both list stays with the first. An entry with nothing ever sold
 * under it has no tier to book, and does not come across.
 */
function completeWorkshops(c: Json, answers: StudioAnswers, facts: ReportFacts, notes?: string[]) {
  const factOf = new Map((facts.workshops ?? []).map(f => [nameKey(f.category), f]))
  const listed = new Set(c.workshops.map((w: Json) => nameKey(w.category)))
  for (const category of c.workshopCategories as string[]) {
    if (listed.has(nameKey(category))) continue
    c.workshops.push({ category, name: category, location: null, capacity: null, migrate: answers.workshopsMigrate, tiers: [] })
  }

  const names = new Set<string>()
  const claimed = new Set<string>()
  for (const w of c.workshops) {
    if (w.migrate !== true) continue
    const f = factOf.get(nameKey(w.category))
    // The category's own name is cut short in Mindbody; its days carry the whole one.
    if ((w.name == null || w.name === w.category) && f?.title && !names.has(nameKey(f.title))) w.name = f.title
    if (w.name == null || names.has(nameKey(w.name))) w.name = w.category
    names.add(nameKey(w.name))
    if (w.location == null) w.location = (f?.location && locationNamedIn(answers.locations as LocationSpelling[], f.location)) || answers.defaultLocation
    if (w.capacity == null) w.capacity = Math.max(1, f?.capacity ?? 0)

    const priceOf = new Map((f?.tiers ?? []).flatMap(t => t.mindbodyNames.map(n => [nameKey(n), t.priceSgd] as const)))
    const had = new Set((w.tiers as Json[]).flatMap(t => t.mindbodyNames.map(nameKey)))
    const tiers: Json[] = [...(w.tiers as Json[]), ...(f?.tiers ?? []).filter(t => !t.mindbodyNames.some(n => had.has(nameKey(n))))]
    w.tiers = tiers.flatMap(t => {
      // One spelling per option: they are matched case-folded, so "1 Day" and "1 day" are one.
      const mindbodyNames = [...new Map((t.mindbodyNames as string[]).map(n => [nameKey(n), n])).entries()]
        .filter(([k]) => !claimed.has(k))
        .map(([, n]) => n)
      if (mindbodyNames.length === 0) return []
      for (const n of mindbodyNames) claimed.add(nameKey(n))
      const priceSgd = t.priceSgd ?? mindbodyNames.map(n => priceOf.get(nameKey(n))).find(p => p != null) ?? 0
      return [{ ...(t.days ? { days: t.days } : {}), name: t.name, mindbodyNames, priceSgd }]
    })
    if (w.tiers.length === 0) {
      w.migrate = false
      notes?.push(`workshop ${w.name}: nothing was ever sold under "${w.category}", so it has no room type to book and is not migrated`)
    }
  }

  for (const e of c.catalogue) {
    if (e.migrate !== 'skip' && e.mindbodyNames.some((n: string) => claimed.has(nameKey(n)))) e.migrate = 'skip'
  }
  const coming = c.workshops.filter((w: Json) => w.migrate === true)
  if (coming.length > 0) {
    notes?.push(
      `workshops: ${coming.length} coming across; each tier priced at what one place most often sold for, and each capacity ` +
        `seats everyone who came to a run or holds a place — check the ones still to come before members book`,
    )
  }
}

/** Starter + answers + facts → one filled config (before `outputs` are applied). */
export function fillConfig(starter: Json, answers: StudioAnswers, facts: ReportFacts, staff: StaffFact[], notes?: string[]): Json {
  const c = structuredClone(starter) as Json
  const norm = normaliseStaffName
  const optionKey = nameKey

  // 1. The studio, and the portal's admins from day one.
  Object.assign(c.studio, {
    displayName: answers.studio.displayName,
    timezone: answers.studio.timezone,
    ownerEmail: answers.studio.ownerEmail,
    admins: answers.studio.admins,
    mailReplyTo: answers.studio.mailReplyTo ?? null,
    emailFooter: answers.studio.emailFooter ?? null,
  })

  // 2. Locations.
  c.locations = answers.locations
  c.defaultLocation = answers.defaultLocation

  // 5. Class Types: every class name the studio ever ran (history needs them all), one per normalised name.
  const byKey = new Map<string, Json>(c.classTypes.map((t: Json) => [nameKey(t.name), t]))
  for (const t of facts.classTypes) {
    const k = nameKey(t.name)
    const had = byKey.get(k)
    if (had) had.mindbodyNames = [...new Set([...had.mindbodyNames, ...t.mindbodyNames])].sort()
    else byKey.set(k, { name: t.name, mindbodyNames: t.mindbodyNames, capacity: null })
  }
  c.classTypes = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
  // Held only off-site (retreat days, outdoor and corporate classes): no Room to size them.
  const roomlessOnly = new Set(Object.entries(facts.roomless).filter(([, v]) => v.alsoInRooms === 0).map(([k]) => k))
  for (const t of c.classTypes) {
    if (roomlessOnly.has(normaliseClassName(t.name)) && t.capacity == null) t.capacity = answers.roomlessCapacity
  }

  // 3. Rooms, sized by the largest class the roster shows in each.
  c.rooms = answers.rooms.map(room => ({
    name: room.name,
    location: room.location,
    capacity: facts.maxByRoom[room.name],
    mindbodyNames: room.mindbodyNames,
    ...(room.classTypesMatching === undefined
      ? {}
      : { classTypes: c.classTypes.filter((t: Json) => pattern(room.classTypesMatching!).test(t.name)).map((t: Json) => t.name) }),
  }))
  c.offSiteVenues = answers.offSiteVenues

  // Workshops, retreats and courses: their own service category, never the class timetable.
  const classLike = pattern(`^(${answers.notWorkshopCategories})$`)
  c.workshopCategories = facts.categories.filter(cat => !classLike.test(cat.trim()))
  for (const w of c.workshops) if (w.migrate == null) w.migrate = answers.workshopsMigrate

  c.ptAppointmentNames = facts.ptNames

  /* 10. Staff. Instructor = taught in the 12 months to the download or is on the future timetable.
     Active in Mindbody with an email: comes across active — instructors as Instructor, everyone
     else as Admin. Active with no email: an instructor comes across by name with no login; a
     non-instructor who ever taught is archived (so history names them); one who never taught is
     left behind. Inactive in Mindbody: archived if they ever taught, else left behind. Of several
     records with one name, the active one with an email wins. */
  c.staffOnboarding = answers.staffOnboarding
  // An email the studio gave for someone Mindbody has none for counts as theirs from here on.
  const givenEmail = new Map(Object.entries(answers.staffEmails ?? {}).map(([name, email]) => [norm(name), email.trim()]))
  for (const s of c.staff) if (!s.email && givenEmail.has(norm(s.mindbodyName))) s.email = givenEmail.get(norm(s.mindbodyName))
  for (const name of Object.keys(answers.staffEmails ?? {})) {
    if (!c.staff.some((s: Json) => norm(s.mindbodyName) === norm(name))) notes?.push(`staffEmails: no staff member named "${name}" in the reports; its email is not used`)
  }
  const factOf = new Map<string, Pick<StaffFact, 'instructor' | 'lastTaught'>>()
  for (const f of staff) {
    const had = factOf.get(norm(f.name))
    // One person, several records: they taught if any record says so.
    factOf.set(norm(f.name), had ? { ...had, instructor: had.instructor || f.instructor, lastTaught: had.lastTaught || f.lastTaught } : f)
  }
  const rank = (s: Json) => (s.migrate === 'active' ? 2 : 0) + (s.email ? 1 : 0)
  const keeper = new Map<string, number>()
  c.staff.forEach((s: Json, i: number) => {
    const k = norm(s.mindbodyName)
    const held = keeper.get(k)
    if (held === undefined || rank(s) > rank(c.staff[held])) keeper.set(k, i)
  })
  c.staff.forEach((s: Json, i: number) => {
    const f = factOf.get(norm(s.mindbodyName)) ?? { instructor: false, lastTaught: null }
    const everTaught = f.instructor || f.lastTaught != null
    const activeInMindbody = s.migrate === 'active'
    s.noLogin = false
    s.teaches = f.instructor
    s.role = f.instructor ? 'instructor' : 'admin'
    if (keeper.get(norm(s.mindbodyName)) !== i) s.migrate = 'skip'
    else if (activeInMindbody && s.email) s.migrate = 'active'
    else if (activeInMindbody && f.instructor) {
      s.migrate = 'active'
      s.noLogin = true
      s.email = null
    } else s.migrate = everTaught ? 'archived' : 'skip'
    if (s.migrate === 'archived') {
      s.teaches = true
      s.role = 'instructor' // a former teacher, kept so history names them
    }
  })

  /* 6. Catalogue. `sell` = on sale now, at the commonest price of the 90 days up to the download.
     Everything else members still hold is `legacy`: honoured, archived, not for sale. */
  const sell = new Set(answers.catalogue.sell.map(optionKey))
  const recentPrice = (names: string[]) => {
    const counts: Record<string, number> = {}
    for (const n of names) for (const [p, k] of Object.entries(facts.sold[optionKey(n)]?.prices90 ?? {})) counts[p] = (counts[p] ?? 0) + k
    const best = Object.entries(counts).sort(([a, x], [b, y]) => y - x || Number(b) - Number(a))[0]
    return best ? Number(best[0]) : null
  }
  for (const { from, into } of answers.catalogue.merge) {
    const copy = c.catalogue.findIndex((e: Json) => pattern(from).test(e.name))
    const target = c.catalogue.find((e: Json) => pattern(into).test(e.name))
    if (copy >= 0 && target) {
      target.mindbodyNames = [...new Set([...target.mindbodyNames, ...c.catalogue[copy].mindbodyNames])]
      c.catalogue.splice(copy, 1)
    }
  }
  for (const entry of answers.catalogue.add) {
    if (!c.catalogue.some((e: Json) => optionKey(e.name ?? '') === optionKey(entry.name))) c.catalogue.push(structuredClone(entry))
  }
  // Past purchases (history.purchases) need an entry for every option ever sold, held today or not.
  const listed = new Set<string>(c.catalogue.flatMap((e: Json) => e.mindbodyNames.map(optionKey)))
  for (const e of facts.everySold) {
    if (e.mindbodyNames.some(n => listed.has(optionKey(n)))) continue
    c.catalogue.push({ ...e, migrate: e.migrate === 'skip' ? 'skip' : null })
    for (const n of e.mindbodyNames) listed.add(optionKey(n))
  }
  for (const e of c.catalogue) if (e.name == null) e.name = e.mindbodyNames[0]
  for (const folded of foldLocationVariants(c.catalogue, answers.locations)) {
    if (folded.from.some(n => sell.has(optionKey(n)))) sell.add(optionKey(folded.into))
    notes?.push(`catalogue: "${folded.from.join('", "')}" folded into "${folded.into}" (one package here; the member's plan keeps the Location its option names)`)
  }
  const d = answers.catalogue.defaults
  for (const e of c.catalogue) {
    if (e.migrate === 'skip') continue
    if (e.kind == null) e.kind = 'credit_bundle'
    if (e.kind === 'access_pass') {
      e.migrate = 'legacy' // never sold alone
      e.location = answers.catalogue.accessPassLocations.find(a => pattern(a.match).test(e.name))?.location ?? answers.defaultLocation
      continue
    }
    e.migrate = sell.has(optionKey(e.name)) ? 'sell' : 'legacy'
    if (e.migrate === 'sell') e.priceSgd = recentPrice(e.mindbodyNames) ?? e.priceSgd
    if (['credit_bundle', 'trial', 'pt'].includes(e.kind)) {
      if (e.credits == null) e.credits = d.credits
      if (e.validityDays == null) e.validityDays = d.validityDays
    }
    if (e.kind === 'pt' && e.sessionType == null) e.sessionType = d.ptSessionType
    if (e.kind === 'unlimited' && e.durationMonths == null) e.durationMonths = d.unlimitedMonths
  }

  // 15. Workshops: one entry per workshop category, each coming across completed from its reports.
  completeWorkshops(c, answers, facts, notes)

  // 19. Series: on, where led by someone coming across as an active instructor.
  const instructors = new Set(c.staff.filter((s: Json) => s.migrate === 'active' && s.role === 'instructor').map((s: Json) => norm(s.mindbodyName)))
  for (const s of c.series) if (s.migrate == null) s.migrate = instructors.has(norm(s.teacher))

  // 17. History.
  c.history = answers.history
  // 21. Waitlists.
  c.waitlist = { ...DEFAULT_WAITLIST, ...answers.waitlist, classTypes: { ...answers.waitlist?.classTypes } }
  // How each Mindbody payment method is filed: the answers' table, as it is.
  c.paymentMethods = { ...(answers.paymentMethods ?? {}) }

  // The class cancellation window: the cut-off the members' own early and late cancels show.
  if (facts.classWindow) c.policy = { ...c.policy, classWindowHours: facts.classWindow.hours }
  return c
}

/**
 * The payment method labels the Sales report shows that the answers do not map,
 * each with the method it looks like (null where it looks like none): the rows
 * to add to the answers file's `paymentMethods`, once a person has checked them.
 */
export function unmappedPaymentMethods(answers: StudioAnswers, facts: ReportFacts): Record<string, OfflineMethod | null> {
  const mapped = new Set(Object.keys(answers.paymentMethods ?? {}).map(paymentMethodKey))
  return Object.fromEntries(Object.entries(facts.paymentMethods).filter(([label]) => !mapped.has(paymentMethodKey(label))))
}

/** Every config the answers ask for, by output name. */
export function fillConfigs(
  starter: Json,
  answers: StudioAnswers,
  facts: ReportFacts,
  staff: StaffFact[],
  /** Collects what a person should check — once, however many outputs. */
  notes?: string[],
): Record<string, Json> {
  return Object.fromEntries(
    Object.entries(answers.outputs).map(([name, out], i) => {
      const c = fillConfig(starter, answers, facts, staff, i === 0 ? notes : undefined)
      c.studio.slug = out.slug
      if (out.originPatterns !== undefined) c.originPatterns = out.originPatterns
      return [name, c]
    }),
  )
}
