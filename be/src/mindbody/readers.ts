import { readHtmlTable, type TableRow } from './html-table'
import { cleanEmail, cleanPhone, parseMindbodyDate, tidy, type LocalDateTime } from './values'

/**
 * One reader per Mindbody report: a file's text in, typed rows out.
 *
 * Each finds its header row by the column names it needs — not by position,
 * because a report's column set changes with the options it was run with — and
 * then keeps only the rows that are data by that report's own test, which is
 * what drops the group headers, subtotals, blank separators and total lines.
 * A report whose header is missing is refused by name: reading it as empty would
 * import a studio with no members and say nothing.
 */

/** A client barcode: nine digits, or the rare imported legacy shape (two letters, six digits). */
const CLIENT_ID = /^(\d{9}|[A-Z]{2}\d{6})$/

type Columns = Record<string, number>

function header(rows: TableRow[], report: string, required: readonly string[]): { at: number; columns: Columns } {
  const at = rows.findIndex(row => required.every(name => row.cells.some(c => c.toLowerCase() === name.toLowerCase())))
  if (at < 0) {
    throw new Error(`${report}: no header row with the columns ${required.join(', ')} — is this the right report?`)
  }
  const columns: Columns = {}
  rows[at]!.cells.forEach((cell, i) => {
    const key = cell.toLowerCase()
    if (!(key in columns)) columns[key] = i
  })
  return { at, columns }
}

function cell(row: TableRow, columns: Columns, name: string): string {
  const i = columns[name.toLowerCase()]
  return i === undefined ? '' : (row.cells[i] ?? '')
}

/** The client id from its cell, or from a `/clients/<id>/` link where the cell has only a name. */
function clientId(row: TableRow, columns: Columns, name: string): string | null {
  const text = cell(row, columns, name)
  if (CLIENT_ID.test(text)) return text
  for (const link of row.links) {
    const id = link?.match(/\/clients\/([A-Z0-9]+)\//i)?.[1]
    if (id && CLIENT_ID.test(id)) return id
  }
  return null
}

function dataRows(rows: TableRow[], at: number) {
  return rows.slice(at + 1)
}

/* ── 02 Mailing Lists — Mailing List (or Email List): the client master ───── */

export type MemberListRow = {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string
}

/** `.` and `,` are what a surname field holds when nobody typed one. */
function surname(raw: string): string {
  const name = tidy(raw)
  return /^[.,\s-]*$/.test(name) ? '' : name
}

export function readMemberList(html: string): MemberListRow[] {
  const rows = readHtmlTable(html)
  const { at, columns } = header(rows, 'Member list (Mailing Lists)', ['Last name', 'First name', 'ID', 'Email'])
  const out: MemberListRow[] = []
  for (const row of dataRows(rows, at)) {
    const id = clientId(row, columns, 'ID')
    if (!id) continue // the "Total clients: N" line
    out.push({
      id,
      firstName: tidy(cell(row, columns, 'First name')),
      lastName: surname(cell(row, columns, 'Last name')),
      email: cleanEmail(cell(row, columns, 'Email')),
      phone: cleanPhone(cell(row, columns, 'Mobile phone')),
    })
  }
  return out
}

/* ── 21 Referral Types (detail files): each client's profile creation date ─── */

export type ReferralRow = { id: string; createdAt: LocalDateTime }

export function readReferralTypes(html: string): ReferralRow[] {
  const rows = readHtmlTable(html)
  const { at, columns } = header(rows, 'Referral Types', ['Client', 'Barcode', 'Entry Date'])
  const out: ReferralRow[] = []
  for (const row of dataRows(rows, at)) {
    const id = clientId(row, columns, 'Barcode')
    // Entry Date is D/M/YYYY with a lower-case am/pm, or the date alone.
    const createdAt = parseMindbodyDate(cell(row, columns, 'Entry Date'), 'DM')
    if (!id || !createdAt) continue
    out.push({ id, createdAt })
  }
  return out
}

/* ── 24 Retention Management: gender, for members holding a membership ────── */

export type RetentionRow = {
  id: string
  gender: 'female' | 'male' | null
  /** Mindbody's numeric location id, as the report prints it. */
  location: string
  memberSince: LocalDateTime | null
  membershipExpiration: LocalDateTime | null
  lastVisit: LocalDateTime | null
}

export function readRetentionManagement(html: string): RetentionRow[] {
  const rows = readHtmlTable(html)
  const { at, columns } = header(rows, 'Retention Management', ['ID', 'Gender', 'Member Since'])
  const out: RetentionRow[] = []
  for (const row of dataRows(rows, at)) {
    const id = clientId(row, columns, 'ID')
    if (!id) continue
    const gender = cell(row, columns, 'Gender').toUpperCase()
    out.push({
      id,
      gender: gender === 'F' ? 'female' : gender === 'M' ? 'male' : null,
      location: cell(row, columns, 'Location'),
      memberSince: parseMindbodyDate(cell(row, columns, 'Member Since'), 'DM'),
      // The one M/D column in an otherwise D/M report.
      membershipExpiration: parseMindbodyDate(cell(row, columns, 'Membership Expiration'), 'MD'),
      lastVisit: parseMindbodyDate(cell(row, columns, 'Last'), 'DM'),
    })
  }
  return out
}

/* ── 35 Phone Book: the staff master ──────────────────────────────────────── */

export type PhoneBookRow = {
  /** `First Last`, spaces collapsed. There is no staff id in any report. */
  name: string
  phone: string
  email: string | null
  active: boolean
  teacher: boolean
  staff: boolean
}

export function readPhoneBook(html: string): PhoneBookRow[] {
  const rows = readHtmlTable(html)
  const { at, columns } = header(rows, 'Staff phone book', ['Name', 'Email', 'Active', 'Teacher'])
  const flag = (row: TableRow, name: string) => cell(row, columns, name).toLowerCase() === 'true'
  const out: PhoneBookRow[] = []
  for (const row of dataRows(rows, at)) {
    const name = tidy(cell(row, columns, 'Name'))
    if (!name) continue
    out.push({
      name,
      phone: cleanPhone(cell(row, columns, 'Mobile phone')),
      email: cleanEmail(cell(row, columns, 'Email')),
      active: flag(row, 'Active'),
      teacher: flag(row, 'Teacher'),
      staff: flag(row, 'Staff'),
    })
  }
  return out
}
