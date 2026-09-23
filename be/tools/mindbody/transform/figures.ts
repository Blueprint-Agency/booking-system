import type { TenantArchive } from '../../../src/services/tenants/transfer-shape'
import { isoDay, localDateOf, money } from './values'

/**
 * What a migrated studio should add up to, counted the same way twice: once
 * from the archive the transform wrote (the expected figures, kept beside the
 * zip), and once from an export of the studio after the import. Any difference
 * is something lost or invented between the two, and is named by member or class.
 *
 * Counted from archive rows on both sides, so the comparison needs no database:
 * the operator exports the studio from the super portal and hands over the zip.
 */

export type MemberFigures = { name: string; packages: number; credits: number; sessions: number; bookings: number }

/** A studio's year, the three figures that say whether its past came across whole. */
export type YearFigures = { classes: number; attended: number; noShows: number }

/** A Refund, by the Purchase it closes. */
export type RefundFigure = { name: string; cents: number }

/** Which counts arrived with the timetable (#179, #180), history (#181) and the money history (#217), and so may be missing from an older file. */
type AddedLater = 'classes' | 'ptSessions' | 'workshops' | 'bookings' | 'perClass' | 'perWorkshop' | 'byYear' | 'revenueByMonth' | 'refunds'

/**
 * Figures as an `expected.json` on disk may hold them. `figuresOf` always
 * counts all of these; a file written before the timetable came across holds
 * none of the timetable counts, and `verify` on it must still compare the rest.
 */
export type StoredFigures = Omit<Figures, AddedLater | 'perMember'> &
  Partial<Pick<Figures, AddedLater>> & { perMember: Record<string, Omit<MemberFigures, 'bookings'> & { bookings?: number }> }

export type Figures = {
  members: number
  staffByRole: Record<string, number>
  /** Packages still good — running or waiting — by kind. */
  livePackagesByKind: Record<string, number>
  creditsLeft: number
  sessionsLeft: number
  /** Classes, PT sessions and workshops on the timetable, not cancelled. */
  classes: number
  ptSessions: number
  workshops: number
  /** Seats held: confirmed bookings, of a class, a PT session or a workshop. */
  bookings: number
  /** By client id, which the import keeps as the transform wrote it. Only members holding something. */
  perMember: Record<string, MemberFigures>
  /** By class id: what it is, and how many are booked into it. Every class, booked or not. */
  perClass: Record<string, { name: string; booked: number }>
  /** By workshop id: its name, and how many have a place on it. Every workshop, sold out or empty. */
  perWorkshop: Record<string, { name: string; booked: number }>
  /**
   * By the studio's own calendar year: classes held, class visits attended and
   * class no-shows. A studio importing no history has only the year ahead here;
   * for one that is, this is the figure that says a whole year did not quietly
   * go missing on the way in.
   */
  byYear: Record<string, YearFigures>
  /**
   * Money in, in cents, by the studio's own month (`YYYY-MM`): what each
   * package was paid (a Complimentary one was paid nothing), its Add-On, and
   * each workshop place — the sales Finance counts, on the day it counts them.
   */
  revenueByMonth: Record<string, number>
  /** Every Refund, by the id of the Purchase it closes. */
  refunds: Record<string, RefundFigure>
}

const tally = (counts: Record<string, number>, key: string, by = 1) => {
  counts[key] = (counts[key] ?? 0) + by
}

export function figuresOf(archive: TenantArchive): Figures {
  const clients = archive.rows.clients ?? []
  const names = new Map(clients.map(c => [String(c.id), `${String(c.name)} <${String(c.email)}>`]))
  const figures: Figures = {
    members: clients.length,
    staffByRole: {},
    livePackagesByKind: {},
    creditsLeft: 0,
    sessionsLeft: 0,
    classes: 0,
    ptSessions: 0,
    workshops: 0,
    bookings: 0,
    perMember: {},
    perClass: {},
    perWorkshop: {},
    byYear: {},
    revenueByMonth: {},
    refunds: {},
  }
  // The studio's own year, not UTC's: a class at 8am in Singapore on 1 January
  // is the new year's, and would otherwise be counted in the old one.
  const timeZone = archive.manifest.tenant.timezone
  const yearOf = new Map<string, string>()
  const tallyForYear = (year: string): YearFigures =>
    (figures.byYear[year] ??= { classes: 0, attended: 0, noShows: 0 })
  for (const s of archive.rows.staff_users ?? []) tally(figures.staffByRole, String(s.role))
  const member = (clientId: string) =>
    (figures.perMember[clientId] ??= { name: names.get(clientId) ?? clientId, packages: 0, credits: 0, sessions: 0, bookings: 0 })

  const typeNames = new Map((archive.rows.class_types ?? []).map(t => [String(t.id), String(t.name)]))
  for (const c of archive.rows.classes ?? []) {
    if (c.lifecycle !== 'active') continue
    figures.classes += 1
    // An instant, so it reads the same from the transform's text and the database's.
    const at = new Date(String(c.starts_at)).toISOString()
    figures.perClass[String(c.id)] = { name: `${typeNames.get(String(c.class_type_id)) ?? 'class'} at ${at}`, booked: 0 }
    const held = String(localDateOf(new Date(at), timeZone).year)
    yearOf.set(String(c.id), held)
    tallyForYear(held).classes += 1
  }
  figures.ptSessions = (archive.rows.pt_sessions ?? []).filter(s => s.lifecycle === 'active').length
  for (const w of archive.rows.workshops ?? []) {
    if (w.lifecycle !== 'active') continue
    figures.workshops += 1
    figures.perWorkshop[String(w.id)] = { name: `workshop ${String(w.name)}`, booked: 0 }
  }
  for (const b of archive.rows.bookings ?? []) {
    // A visit and a no-show are counted by the year of the class they were on,
    // whatever became of the booking — that is the whole point of the figure.
    const held = b.class_id == null ? undefined : yearOf.get(String(b.class_id))
    if (held && b.check_in_state === 'attended') tallyForYear(held).attended += 1
    if (held && b.state === 'no_show') tallyForYear(held).noShows += 1
    if (b.state !== 'confirmed') continue
    figures.bookings += 1
    member(String(b.client_id)).bookings += 1
    const cls = b.class_id == null ? undefined : figures.perClass[String(b.class_id)]
    if (cls) cls.booked += 1
    const workshop = b.workshop_id == null ? undefined : figures.perWorkshop[String(b.workshop_id)]
    if (workshop) workshop.booked += 1
  }

  const monthOf = (at: unknown) => {
    const d = localDateOf(new Date(String(at)), timeZone)
    return `${d.year}-${String(d.month).padStart(2, '0')}`
  }
  const cents = (v: unknown) => (v == null ? 0 : Math.round(Number(v) * 100))
  const earned = (at: unknown, amount: number) => {
    if (amount !== 0) tally(figures.revenueByMonth, monthOf(at), amount)
  }
  for (const p of archive.rows.client_packages ?? []) {
    if (p.complimentary !== true) earned(p.purchased_at, cents(p.amount_paid_sgd) + cents(p.cross_location_paid_sgd))
  }
  for (const b of archive.rows.bookings ?? []) if (b.kind === 'workshop') earned(b.booked_at, cents(b.amount_paid_sgd))
  for (const p of archive.rows.purchases ?? []) {
    if (p.status !== 'refunded' || p.refunded_at == null) continue
    const day = localDateOf(new Date(String(p.refunded_at)), timeZone)
    const who = names.get(String(p.client_id)) ?? String(p.client_id)
    figures.refunds[String(p.id)] = { name: `the refund to ${who} on ${isoDay(day)}`, cents: cents(p.total_sgd) }
  }

  for (const p of archive.rows.client_packages ?? []) {
    if (p.active !== true || p.client_id == null) continue
    const kind = String(p.kind)
    const left = Number(p.credits_or_sessions_remaining ?? 0)
    const clientId = String(p.client_id)
    const mine = member(clientId)
    tally(figures.livePackagesByKind, kind)
    mine.packages += 1
    if (kind === 'pt') {
      figures.sessionsLeft += left
      mine.sessions += left
    } else {
      figures.creditsLeft += left
      mine.credits += left
    }
  }
  return figures
}

/** Every way `actual` differs from `expected`, one line each. Empty means nothing was lost. */
export function compareFigures(expected: StoredFigures, actual: Figures): string[] {
  const differences: string[] = []
  const differ = (what: string, want: number, got: number) => {
    if (want !== got) differences.push(`${what}: expected ${want}, found ${got}`)
  }
  const keys = (a: object, b: object) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()

  const NO_YEAR: YearFigures = { classes: 0, attended: 0, noShows: 0 }
  differ('members', expected.members, actual.members)
  for (const role of keys(expected.staffByRole, actual.staffByRole)) {
    differ(`staff with the role ${role}`, expected.staffByRole[role] ?? 0, actual.staffByRole[role] ?? 0)
  }
  for (const kind of keys(expected.livePackagesByKind, actual.livePackagesByKind)) {
    differ(`live ${kind} packages`, expected.livePackagesByKind[kind] ?? 0, actual.livePackagesByKind[kind] ?? 0)
  }
  differ('class credits left, in total', expected.creditsLeft, actual.creditsLeft)
  differ('PT sessions left, in total', expected.sessionsLeft, actual.sessionsLeft)
  // `?? 0`, `?? {}`: an expected file written before the timetable came across
  // holds none of these, and is read as a studio with nothing on its timetable.
  differ('classes', expected.classes ?? 0, actual.classes)
  differ('PT sessions', expected.ptSessions ?? 0, actual.ptSessions)
  differ('workshops', expected.workshops ?? 0, actual.workshops)
  differ('bookings, in total', expected.bookings ?? 0, actual.bookings)
  for (const held of keys(expected.byYear ?? {}, actual.byYear)) {
    const want = expected.byYear?.[held] ?? NO_YEAR
    const got = actual.byYear[held] ?? NO_YEAR
    differ(`${held}: classes held`, want.classes, got.classes)
    differ(`${held}: visits attended`, want.attended, got.attended)
    differ(`${held}: no-shows`, want.noShows, got.noShows)
  }
  // Money is said as money. A month whose takings moved is named by the month,
  // so a sale dated a day out — or lost — is found where Finance would show it.
  const dollars = (c: number) => money(c / 100)
  for (const month of keys(expected.revenueByMonth ?? {}, actual.revenueByMonth)) {
    const want = expected.revenueByMonth?.[month] ?? 0
    const got = actual.revenueByMonth[month] ?? 0
    if (want !== got) differences.push(`${month}: revenue: expected ${dollars(want)}, found ${dollars(got)}`)
  }
  for (const purchaseId of keys(expected.refunds ?? {}, actual.refunds)) {
    const want = expected.refunds?.[purchaseId]
    const got = actual.refunds[purchaseId]
    if (!got) differences.push(`${want!.name}: ${dollars(want!.cents)} in the archive, and no such refund in the studio`)
    else if (!want) differences.push(`${got.name}: ${dollars(got.cents)} in the studio, and no such refund in the archive`)
    else if (want.cents !== got.cents) differences.push(`${want.name}: expected ${dollars(want.cents)}, found ${dollars(got.cents)}`)
  }

  const nothing = { name: '', booked: 0 }
  const attendance = (want: typeof nothing | undefined, got: typeof nothing | undefined, id: string) => {
    const what = (want ?? got ?? nothing).name || id
    if (!want) differences.push(`${what}: on the timetable, and was not in the archive`)
    else if (!got) differences.push(`${what}: in the archive, and not on the timetable`)
    else differ(`${what}: members booked`, want.booked, got.booked)
  }
  for (const classId of keys(expected.perClass ?? {}, actual.perClass)) {
    attendance(expected.perClass?.[classId], actual.perClass[classId], classId)
  }
  for (const workshopId of keys(expected.perWorkshop ?? {}, actual.perWorkshop)) {
    attendance(expected.perWorkshop?.[workshopId], actual.perWorkshop[workshopId], workshopId)
  }

  const nobody: MemberFigures = { name: '', packages: 0, credits: 0, sessions: 0, bookings: 0 }
  for (const clientId of keys(expected.perMember, actual.perMember)) {
    const want = expected.perMember[clientId] ?? nobody
    const got = actual.perMember[clientId] ?? nobody
    const who = want.name || got.name
    differ(`${who}: live packages`, want.packages, got.packages)
    differ(`${who}: class credits left`, want.credits, got.credits)
    differ(`${who}: PT sessions left`, want.sessions, got.sessions)
    differ(`${who}: bookings`, want.bookings ?? 0, got.bookings)
  }
  return differences
}
