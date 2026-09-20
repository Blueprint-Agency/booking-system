import type { TenantArchive } from '../services/tenants/transfer-shape'

/**
 * What a migrated studio should add up to, counted the same way twice: once
 * from the archive the transform wrote (the expected figures, kept beside the
 * zip), and once from an export of the studio after the import. Any difference
 * is something lost or invented between the two, and is named by member.
 *
 * Counted from archive rows on both sides, so the comparison needs no database:
 * the operator exports the studio from the super portal and hands over the zip.
 */

export type MemberFigures = { name: string; packages: number; credits: number; sessions: number }

export type Figures = {
  members: number
  staffByRole: Record<string, number>
  /** Packages still good — running or waiting — by kind. */
  livePackagesByKind: Record<string, number>
  creditsLeft: number
  sessionsLeft: number
  /** By client id, which the import keeps as the transform wrote it. Only members holding something. */
  perMember: Record<string, MemberFigures>
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
    perMember: {},
  }
  for (const s of archive.rows.staff_users ?? []) tally(figures.staffByRole, String(s.role))

  for (const p of archive.rows.client_packages ?? []) {
    if (p.active !== true || p.client_id == null) continue
    const kind = String(p.kind)
    const left = Number(p.credits_or_sessions_remaining ?? 0)
    const clientId = String(p.client_id)
    const mine = (figures.perMember[clientId] ??= { name: names.get(clientId) ?? clientId, packages: 0, credits: 0, sessions: 0 })
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
export function compareFigures(expected: Figures, actual: Figures): string[] {
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

  const nobody: MemberFigures = { name: '', packages: 0, credits: 0, sessions: 0 }
  for (const clientId of keys(expected.perMember, actual.perMember)) {
    const want = expected.perMember[clientId] ?? nobody
    const got = actual.perMember[clientId] ?? nobody
    const who = want.name || got.name
    differ(`${who}: live packages`, want.packages, got.packages)
    differ(`${who}: class credits left`, want.credits, got.credits)
    differ(`${who}: PT sessions left`, want.sessions, got.sessions)
  }
  return differences
}
