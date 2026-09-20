import type { TenantArchive } from '../services/tenants/transfer-shape'

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

/** Which counts arrived with the timetable (#179), and so may be missing from an older file. */
type Timetable = 'classes' | 'ptSessions' | 'bookings' | 'perClass'

/**
 * Figures as an `expected.json` on disk may hold them. `figuresOf` always
 * counts all of these; a file written before the timetable came across holds
 * none of the timetable counts, and `verify` on it must still compare the rest.
 */
export type StoredFigures = Omit<Figures, Timetable | 'perMember'> &
  Partial<Pick<Figures, Timetable>> & { perMember: Record<string, Omit<MemberFigures, 'bookings'> & { bookings?: number }> }

export type Figures = {
  members: number
  staffByRole: Record<string, number>
  /** Packages still good — running or waiting — by kind. */
  livePackagesByKind: Record<string, number>
  creditsLeft: number
  sessionsLeft: number
  /** Classes and PT sessions on the timetable, not cancelled. */
  classes: number
  ptSessions: number
  /** Seats held: confirmed bookings, of a class or a PT session. */
  bookings: number
  /** By client id, which the import keeps as the transform wrote it. Only members holding something. */
  perMember: Record<string, MemberFigures>
  /** By class id: what it is, and how many are booked into it. Every class, booked or not. */
  perClass: Record<string, { name: string; booked: number }>
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
    bookings: 0,
    perMember: {},
    perClass: {},
  }
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
  }
  figures.ptSessions = (archive.rows.pt_sessions ?? []).filter(s => s.lifecycle === 'active').length
  for (const b of archive.rows.bookings ?? []) {
    if (b.state !== 'confirmed') continue
    figures.bookings += 1
    member(String(b.client_id)).bookings += 1
    const cls = b.class_id == null ? undefined : figures.perClass[String(b.class_id)]
    if (cls) cls.booked += 1
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
  differ('future classes', expected.classes ?? 0, actual.classes)
  differ('future PT sessions', expected.ptSessions ?? 0, actual.ptSessions)
  differ('future bookings, in total', expected.bookings ?? 0, actual.bookings)
  const noClass = { name: '', booked: 0 }
  for (const classId of keys(expected.perClass ?? {}, actual.perClass)) {
    const want = expected.perClass?.[classId]
    const got = actual.perClass[classId]
    const what = (want ?? got ?? noClass).name
    if (!want) differences.push(`${what}: on the timetable, and was not in the archive`)
    else if (!got) differences.push(`${what}: in the archive, and not on the timetable`)
    else differ(`${what}: members booked`, want.booked, got.booked)
  }

  const nobody: MemberFigures = { name: '', packages: 0, credits: 0, sessions: 0, bookings: 0 }
  for (const clientId of keys(expected.perMember, actual.perMember)) {
    const want = expected.perMember[clientId] ?? nobody
    const got = actual.perMember[clientId] ?? nobody
    const who = want.name || got.name
    differ(`${who}: live packages`, want.packages, got.packages)
    differ(`${who}: class credits left`, want.credits, got.credits)
    differ(`${who}: PT sessions left`, want.sessions, got.sessions)
    differ(`${who}: future bookings`, want.bookings ?? 0, got.bookings)
  }
  return differences
}
